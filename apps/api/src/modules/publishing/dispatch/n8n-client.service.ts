import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import * as crypto from "crypto";
import { safeHttp } from "../common/http/safe-http.util";

export interface N8nDispatchPayload {
  attemptId: string;
  intentId: string;
  intentVersion: number;
  candidateId: string;
  targetId: string;
  mode: string;
  scheduledUtcAt: string;
  workflowVersion: string;
  callbackUrl: string;
  // Key id for the HMAC signing secret — present when key rotation is enabled,
  // so n8n (and inbound callbacks) can resolve which secret validates the
  // signature. Empty string in single-key mode.
  kid: string;
  nonce: string;
  timestamp: string;
  signature: string;
}

export interface N8nDispatchResponse {
  executionId?: string;
  accepted: boolean;
}

@Injectable()
export class N8nClientService {
  private readonly logger = new Logger(N8nClientService.name);
  private readonly n8nWebhookUrl: string;
  private readonly signingSecret: string;
  private readonly signingKeyId: string;
  private readonly n8nAuthToken: string;
  private readonly callbackBaseUrl: string;
  private readonly workflowVersion: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.n8nWebhookUrl = this.config.get<string>(
      "publishing.n8nWebhookUrl",
      "",
    );
    this.signingSecret = this.config.get<string>(
      "publishing.n8nSigningSecret",
      "",
    );
    this.signingKeyId = this.config.get<string>(
      "publishing.n8nSigningKeyId",
      "",
    );
    this.n8nAuthToken = this.config.get<string>("publishing.n8nAuthToken", "");
    this.callbackBaseUrl = this.config.get<string>(
      "publishing.callbackBaseUrl",
      "",
    );
    this.workflowVersion = this.config.get<string>(
      "publishing.workflowVersion",
      "v1",
    );
  }

  /**
   * Dispatches a publishing attempt to n8n via authenticated webhook.
   *
   * Two DISTINCT credentials are used (issue #119):
   *  - `n8nAuthToken`  → sent as `Authorization: Bearer ...` to authenticate
   *                      the transport (n8n proves we are allowed to call it).
   *  - `signingSecret`  → HMAC-SHA256 over the canonical body, proving the
   *                      payload integrity and origin to n8n, and the SAME
   *                      secret verifies inbound callbacks. It is NEVER put on
   *                      the wire as a bearer token: a shared MAC secret used
   *                      as transport auth collapses two boundaries and has no
   *                      rotation seam.
   * Neither is logged — all errors go through safeHttp().
   */
  async dispatch(
    attemptId: string,
    intentId: string,
    intentVersion: number,
    candidateId: string,
    targetId: string,
    mode: string,
    scheduledUtcAt: Date,
    credentialRef: string,
  ): Promise<N8nDispatchResponse> {
    // Fail fast on misconfiguration instead of silently sending an empty
    // bearer or an unsigned body to n8n. These are operator errors, not
    // provider/transient failures, so they surface as BadRequest here and the
    // dispatch processor records the attempt as FAILED.
    if (!this.n8nAuthToken) {
      throw new BadRequestException(
        "PUBLISHING_WEBHOOK_UNAUTHORIZED: PUBLISHING_N8N_AUTH_TOKEN is not configured — cannot authenticate outbound dispatch to n8n",
      );
    }
    if (!this.signingSecret) {
      throw new BadRequestException(
        "PUBLISHING_WEBHOOK_UNAUTHORIZED: PUBLISHING_N8N_SIGNING_SECRET is not configured — cannot sign outbound dispatch to n8n",
      );
    }

    const nonce = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const callbackUrl = `${this.callbackBaseUrl}/internal/v1/publishing/dispatch/${attemptId}/callback`;

    const canonicalBody = JSON.stringify({
      attemptId,
      intentId,
      intentVersion,
      candidateId,
      targetId,
      mode,
      scheduledUtcAt: scheduledUtcAt.toISOString(),
      workflowVersion: this.workflowVersion,
      callbackUrl,
      kid: this.signingKeyId,
      nonce,
      timestamp,
      credentialRef,
    });

    const signature = crypto
      .createHmac("sha256", this.signingSecret)
      .update(canonicalBody)
      .digest("hex");

    const payload = {
      attemptId,
      intentId,
      intentVersion,
      candidateId,
      targetId,
      mode,
      scheduledUtcAt: scheduledUtcAt.toISOString(),
      workflowVersion: this.workflowVersion,
      callbackUrl,
      kid: this.signingKeyId,
      nonce,
      timestamp,
      signature,
      credentialRef, // opaque ref — n8n resolves from its own secrets store
    };

    return safeHttp(this.logger, "N8nClient.dispatch", async () => {
      const response = await firstValueFrom(
        this.http.post<N8nDispatchResponse>(this.n8nWebhookUrl, payload, {
          headers: {
            "Content-Type": "application/json",
            // Bearer is the SEPARATE transport credential (PUBLISHING_N8N_AUTH_TOKEN),
            // NOT the HMAC signing secret. n8n authenticates the caller with this.
            Authorization: `Bearer ${this.n8nAuthToken}`,
          },
          timeout: 15_000,
        }),
      );
      return response.data;
    });
  }
}
