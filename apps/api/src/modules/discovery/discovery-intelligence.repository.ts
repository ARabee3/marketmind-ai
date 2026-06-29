import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import { IntelligenceResult } from "./discovery-state";
import {
  metadataForPrisma,
  sessionStatusForIntelligence,
} from "./discovery-persistence.mapper";

@Injectable()
export class DiscoveryIntelligenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveIntelligenceResult(
    sessionId: string,
    intelligence: IntelligenceResult,
  ): Promise<void> {
    const completedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const run = await tx.intelligenceRun.create({
        data: {
          sessionId,
          status: intelligence.status,
          searchMode: intelligence.search_mode,
          completedAt,
          durationMs: 0,
          errorCode: intelligence.safe_error?.code,
          errorMessage: intelligence.safe_error?.message,
        },
      });
      const sourceIdByContractId = await this.createSourceRefs(
        tx,
        sessionId,
        run.id,
        intelligence,
      );
      const observationIdByContractId = await this.createObservations(
        tx,
        sessionId,
        intelligence,
        sourceIdByContractId,
      );

      await this.createConversationHooks(
        tx,
        sessionId,
        intelligence,
        observationIdByContractId,
      );
      await this.createKnowledgeGaps(tx, sessionId, intelligence);
      await tx.discoverySession.update({
        where: { id: sessionId },
        data: { status: sessionStatusForIntelligence(intelligence) },
      });
    });
  }

  private async createSourceRefs(
    tx: Prisma.TransactionClient,
    sessionId: string,
    runId: string,
    intelligence: IntelligenceResult,
  ): Promise<ReadonlyMap<string, string>> {
    const sourceIdByContractId = new Map<string, string>();

    for (const source of intelligence.source_refs) {
      const savedSource = await tx.sourceRef.create({
        data: {
          sessionId,
          intelligenceRunId: runId,
          sourceType: source.source_type,
          platform: source.platform,
          url: source.url,
          title: source.title,
          snippet: source.snippet,
          fetchedAt: source.fetched_at
            ? new Date(source.fetched_at)
            : undefined,
          confidence: source.confidence,
          metadata: metadataForPrisma(source.metadata),
        },
      });
      sourceIdByContractId.set(source.id, savedSource.id);
    }

    return sourceIdByContractId;
  }

  private async createObservations(
    tx: Prisma.TransactionClient,
    sessionId: string,
    intelligence: IntelligenceResult,
    sourceIdByContractId: ReadonlyMap<string, string>,
  ): Promise<ReadonlyMap<string, string>> {
    const observationIdByContractId = new Map<string, string>();

    for (const observation of intelligence.research_observations) {
      const savedObservation = await tx.researchObservation.create({
        data: {
          sessionId,
          sourceRefId: observation.source_ref_id
            ? sourceIdByContractId.get(observation.source_ref_id)
            : undefined,
          kind: observation.kind,
          statement: observation.statement,
          confidence: observation.confidence,
          visibility: observation.visibility,
          status: observation.status,
          discardReason: observation.discard_reason,
          metadata: metadataForPrisma(observation.metadata),
        },
      });
      observationIdByContractId.set(observation.id, savedObservation.id);
    }

    return observationIdByContractId;
  }

  private async createConversationHooks(
    tx: Prisma.TransactionClient,
    sessionId: string,
    intelligence: IntelligenceResult,
    observationIdByContractId: ReadonlyMap<string, string>,
  ): Promise<void> {
    if (intelligence.conversation_hooks.length === 0) {
      return;
    }

    await tx.conversationHook.createMany({
      data: intelligence.conversation_hooks.map((hook) => ({
        sessionId,
        sourceObservationId: hook.source_observation_id
          ? observationIdByContractId.get(hook.source_observation_id)
          : undefined,
        hookText: hook.hook_text,
        language: hook.language,
        status: hook.status,
      })),
    });
  }

  private async createKnowledgeGaps(
    tx: Prisma.TransactionClient,
    sessionId: string,
    intelligence: IntelligenceResult,
  ): Promise<void> {
    if (intelligence.knowledge_gaps.length === 0) {
      return;
    }

    await tx.knowledgeGap.createMany({
      data: intelligence.knowledge_gaps.map((gap) => ({
        sessionId,
        fieldKey: gap.field_key,
        questionHint: gap.question_hint,
        priority: gap.priority,
        status: gap.status,
      })),
    });
  }
}
