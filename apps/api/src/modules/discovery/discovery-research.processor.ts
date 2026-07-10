import { Injectable, Logger } from "@nestjs/common";
import { externalProviderConfig } from "../../common/config/external-provider.config";
import { ProviderError } from "../../common/errors/provider-error";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryRepository } from "./discovery.repository";
import { StartDiscoveryDto, LanguageModeDto } from "./dto/start-discovery.dto";
import { DiscoveryProgressInput } from "./discovery-state";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { DiscoveryReadinessService } from "./discovery-readiness.service";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";

/**
 * Idempotent discovery research processor.
 *
 * PostgreSQL owns lifecycle and research state. The processor reloads
 * authoritative session/intake data from PostgreSQL before executing.
 * Safe under duplicate delivery, retry, API restart, and worker restart.
 */
@Injectable()
export class DiscoveryResearchProcessor {
  private readonly logger = new Logger(DiscoveryResearchProcessor.name);

  constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly conversationRepository: DiscoveryConversationRepository,
    private readonly intelligenceRepository: DiscoveryIntelligenceRepository,
    private readonly intelligenceGatherer: IntelligenceGathererService,
    private readonly aiDiscoveryClient: AiDiscoveryClient,
    private readonly progressGateway: DiscoveryProgressGateway,
    private readonly readinessService: DiscoveryReadinessService,
  ) {}

  /**
   * Process research for a session. Idempotent: skips if already in a terminal state.
   * Records retry and terminal-failure progress events with monotonic sequence.
   */
  async process(
    sessionId: string,
    attemptNumber: number,
    maxAttempts: number,
  ): Promise<void> {
    const session = await this.discoveryRepository.findSessionStatus(sessionId);
    if (!session) {
      this.logger.warn(`Session ${sessionId} not found, skipping.`);
      return;
    }
    if (
      session.status === "ready_for_chat" ||
      session.status === "confirmed" ||
      session.status === "failed"
    ) {
      this.logger.log(
        `Session ${sessionId} already in terminal state (${session.status}), skipping.`,
      );
      return;
    }

    try {
      const intake = await this.conversationRepository.getIntake(sessionId);
      const dto: StartDiscoveryDto = {
        intake,
        language_mode: undefined,
      };

      await this.runPreparedDiscovery(sessionId, dto);
    } catch (error) {
      const isLastAttempt = attemptNumber >= maxAttempts;
      if (isLastAttempt) {
        await this.handleTerminalFailure(sessionId, error);
      } else {
        await this.handleRetryFailure(
          sessionId,
          error,
          attemptNumber,
          maxAttempts,
        );
        throw error;
      }
    }
  }

  private async runPreparedDiscovery(
    sessionId: string,
    dto: StartDiscoveryDto,
  ): Promise<void> {
    await this.recordProgress(sessionId, {
      stage: "intelligence",
      status: "started",
      messageKey: "discovery.intelligence.started",
      messageText: "Research started.",
    });
    const intelligence = await withResearchDeadline(
      (signal) =>
        this.intelligenceGatherer.gather(
          dto,
          (event) => {
            signal.throwIfAborted();
            return this.recordProgress(sessionId, event);
          },
          signal,
        ),
      externalProviderConfig().discoveryResearchTimeoutMs,
    );
    await this.recordProgress(sessionId, {
      stage: "persisting",
      status: "started",
      messageKey: "discovery.persisting.started",
      messageText: "Saving research results.",
    });
    await this.intelligenceRepository.saveIntelligenceResult(
      sessionId,
      intelligence,
    );
    await this.recordProgress(sessionId, {
      stage: "persisting",
      status: "completed",
      messageKey: "discovery.persisting.completed",
      messageText: "Research results were saved.",
    });
    await this.recordProgress(sessionId, {
      stage: "intelligence",
      status: "completed",
      messageKey: "discovery.intelligence.completed",
      messageText: "Research finished.",
      payload: {
        status: intelligence.status,
        source_count: intelligence.source_refs.length,
        observation_count: intelligence.research_observations.length,
      },
    });
    await this.recordProgress(sessionId, {
      stage: "ai_discovery",
      status: "started",
      messageKey: "discovery.ai.started",
      messageText: "Preparing the first discovery question.",
    });
    const aiStarted = await this.startAiDiscovery(sessionId, dto, intelligence);
    await this.recordProgress(sessionId, {
      stage: "ai_discovery",
      status: aiStarted ? "completed" : "failed",
      messageKey: aiStarted
        ? "discovery.ai.completed"
        : "discovery.ai.provider_unavailable",
      messageText: aiStarted
        ? "First discovery question is ready."
        : "AI discovery provider is not available yet.",
    });
    if (!aiStarted) {
      return;
    }
    await this.recordProgress(sessionId, {
      stage: "ready",
      status: "completed",
      messageKey: "discovery.ready_for_chat",
      messageText: "Discovery chat is ready.",
    });
  }

  private async startAiDiscovery(
    sessionId: string,
    dto: StartDiscoveryDto,
    intelligence: Awaited<ReturnType<IntelligenceGathererService["gather"]>>,
  ): Promise<boolean> {
    try {
      const result = await this.aiDiscoveryClient.start(
        sessionId,
        dto,
        intelligence,
      );
      if (result.safe_error || !result.next_question) {
        return false;
      }
      await this.conversationRepository.recordInitialAssistantQuestion(
        sessionId,
        result.next_question,
        dto.language_mode ?? LanguageModeDto.Mixed,
        this.readinessService.evaluate(result, 0),
      );
      return true;
    } catch (error) {
      if (error instanceof ProviderError) {
        return false;
      }
      throw error;
    }
  }

  private async handleTerminalFailure(
    sessionId: string,
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      "Discovery background research failed terminally",
      error instanceof Error ? error.stack : String(error),
    );
    const failed = await this.discoveryRepository.updateStatusIfCurrent(
      sessionId,
      ["researching", "partial_ready", "ready_for_chat", "research_failed"],
      "failed",
    );
    if (!failed) {
      return;
    }
    await this.recordProgress(sessionId, {
      stage: "background",
      status: "failed",
      messageKey: "discovery.background.failed",
      messageText: "Discovery research failed after all retry attempts.",
      payload: {
        code: "DISCOVERY_RESEARCH_FAILED",
        retryable: false,
      },
    });
  }

  private async handleRetryFailure(
    sessionId: string,
    error: unknown,
    attemptNumber: number,
    maxAttempts: number,
  ): Promise<void> {
    this.logger.warn(
      `Discovery research attempt ${attemptNumber}/${maxAttempts} failed for session ${sessionId}`,
    );
    await this.recordProgress(sessionId, {
      stage: "background",
      status: "failed",
      messageKey: "discovery.background.retry",
      messageText: `Discovery research attempt ${attemptNumber} of ${maxAttempts} failed. Retrying...`,
      payload: {
        code: "DISCOVERY_RESEARCH_RETRY",
        retryable: true,
        attempt: attemptNumber,
        max_attempts: maxAttempts,
      },
    });
  }

  private async recordProgress(
    sessionId: string,
    event: DiscoveryProgressInput,
  ): Promise<void> {
    const savedEvent = await this.discoveryRepository.appendProgressEvent(
      sessionId,
      event,
    );
    this.progressGateway.emitProgress(sessionId, savedEvent);
  }
}

async function withResearchDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error("Discovery research exceeded its time limit."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
