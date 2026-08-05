import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import * as crypto from "crypto";
import { safeHttp } from "../common/http/safe-http.util";
import {
  signPublicationDispatchEnvelope,
  type PublicationDispatchBodyV1,
  type SignedPublicationDispatchEnvelopeV1,
} from "@marketmind/contracts";

export interface N8nDispatchResponse {
  executionId?: string;
  accepted: boolean;
}

/**
 * N8nClientService — sends the frozen `SignedPublicationDispatchEnvelopeV1`
 * (#120 boundary) to the n8n runner.
 *
 * P1 (#119 review): the outbound body is the frozen envelope built by
 * `DispatchEnvelopeBuilder`, NOT a custom camelCase shape. Two DISTINCT
 * credentials are used (issue #119):
 *  - `n8nAuthToken`   → `Authorization: Bearer ...` transport credential.
 *  - `signingSecret`  → HMAC-SHA256 over the canonical envelope (proven by the
 *                       runner and reused to verify inbound callbacks). NEVER a
 *                       bearer token.
 * Neither is logged — all errors go through safeHttp().
 */
@Injectable()
export class N8nClientService {
  private readonly logger = new Logger(N8nClientService.name);
  private readonly n8nWebhookUrl: string;
  private readonly signingSecret: string;
  private readonly signingKeyId: string;
  private readonly n8nAuthToken: string;

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
  }

  /**
   * Signs the frozen dispatch body and POSTs the
   * `SignedPublicationDispatchEnvelopeV1` to n8n. The envelope carries a fresh
   * `message_id`/`nonce`/`sent_at`; the `body_sha256` is the canonical hash the
   * runner validates against the attempt's `request_fingerprint`.
   */
  async dispatch(
    body: PublicationDispatchBodyV1,
  ): Promise<N8nDispatchResponse> {
    // Fail fast on misconfiguration instead of sending an unsigned body.
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

    const envelope: SignedPublicationDispatchEnvelopeV1 =
      signPublicationDispatchEnvelope(
        {
          contract_version: "publishing-dispatch-envelope-v1",
          message_id: crypto.randomUUID(),
          sent_at: new Date().toISOString(),
          nonce: crypto.randomUUID(),
          key_id: this.signingKeyId,
          body,
        },
        this.signingSecret,
      );

    return safeHttp(this.logger, "N8nClient.dispatch", async () => {
      const response = await firstValueFrom(
        this.http.post<N8nDispatchResponse>(this.n8nWebhookUrl, envelope, {
          headers: {
            "Content-Type": "application/json",
            // Bearer is the SEPARATE transport credential, NOT the HMAC secret.
            Authorization: `Bearer ${this.n8nAuthToken}`,
          },
          timeout: 15_000,
        }),
      );
      if (response.status !== 202 || response.data?.accepted !== true) {
        throw new Error(
          "PUBLISHING_WEBHOOK_REJECTED: n8n did not acknowledge the dispatch",
        );
      }
      return response.data;
    });
  }
}
