import { Test, type TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import type { OptimizationGenerationRequestV1 } from "@marketmind/contracts";
import { OptimizationAiClient } from "./optimization-ai.client";

const FINGERPRINT =
  "c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";
const EVIDENCE_CHECKSUM =
  "b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";

function request(): OptimizationGenerationRequestV1 {
  return {
    contract_version: "optimization-v1",
    generation_fingerprint: FINGERPRINT,
    evidence_checksum: EVIDENCE_CHECKSUM,
    identity: {
      business_id: "a1000000-0000-4000-8000-000000000002",
      strategy_id: "a1000000-0000-4000-8000-000000000011",
      strategy_version: 2,
      content_cycle_id: "a1000000-0000-4000-8000-000000000012",
      format_cohort: "text_post",
    },
    evidence: [1, 2, 3].map((index) => ({
      snapshot_id: `a1000000-0000-4000-8000-00000000000${index}`,
      candidate_id: `a2000000-0000-4000-8000-00000000000${index}`,
      content_format: "text_post" as const,
      published_at: `2026-08-${10 + index}T08:00:00Z`,
      metrics: {
        post_media_view: {
          status: "available" as const,
          value: 80 + index * 20,
        },
        post_clicks: { status: "available" as const, value: 8 + index },
      },
      untrusted_caption: `Caption ${index}`,
      untrusted_cta: "Learn more",
    })),
    deterministic_comparison: [
      {
        metric: "post_media_view",
        baseline_median: 120,
        values: [100, 120, 140],
        best_snapshot_id: "a1000000-0000-4000-8000-000000000003",
        best_value: 140,
        delta_from_median: 20,
        delta_percent: 16.666666666666664,
        direction: "higher_is_better",
      },
      {
        metric: "post_clicks",
        baseline_median: 10,
        values: [9, 10, 11],
        best_snapshot_id: "a1000000-0000-4000-8000-000000000003",
        best_value: 11,
        delta_from_median: 1,
        delta_percent: 10,
        direction: "higher_is_better",
      },
    ],
    allowed_change_kinds: ["hook_style", "cta_wording_style"],
    prohibited_changes: [
      "strategy",
      "goal",
      "topic",
      "purpose",
      "audience",
      "channel",
      "locale",
      "format",
      "post_count",
      "media",
      "publishing_date",
      "publishing_time",
      "publishing_window",
      "offer",
      "business_facts",
      "already_created_content",
    ],
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: "optimization-v1",
    outcome: "recommendation",
    generation_fingerprint: FINGERPRINT,
    model_version: "mock-optimization-model",
    prompt_version: "optimization-prompt-v1",
    evidence_snapshot_ids: [
      "a1000000-0000-4000-8000-000000000001",
      "a1000000-0000-4000-8000-000000000002",
      "a1000000-0000-4000-8000-000000000003",
    ],
    change_kind: "hook_style",
    summary: "Lead with a concrete situation.",
    rationale: "The strongest observed post used a direct opening.",
    uncertainty: "Small cohort; no causal claim.",
    instruction: "Try a concrete situation in one future hook only.",
    ...overrides,
  };
}

describe("OptimizationAiClient", () => {
  let client: OptimizationAiClient;
  let http: { post: jest.Mock };

  beforeEach(async () => {
    http = { post: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptimizationAiClient,
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("http://ai-service") },
        },
      ],
    }).compile();
    client = module.get(OptimizationAiClient);
  });

  it("posts the strict request and validates the provider result", async () => {
    http.post.mockReturnValue(of({ data: recommendation() }));

    await expect(client.generate(request())).resolves.toMatchObject({
      outcome: "recommendation",
      generation_fingerprint: FINGERPRINT,
    });
    expect(http.post).toHaveBeenCalledWith(
      "http://ai-service/internal/v1/ai/optimization/propose",
      expect.objectContaining({ generation_fingerprint: FINGERPRINT }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("rejects malformed requests before making a provider call", async () => {
    const invalid = {
      ...request(),
      evidence: [],
    } as OptimizationGenerationRequestV1;

    await expect(client.generate(invalid)).rejects.toMatchObject({
      code: "OPTIMIZATION_SCHEMA_FAILURE",
      retryable: false,
    });
    expect(http.post).not.toHaveBeenCalled();
  });

  it("rejects tampered deterministic comparison values before making a provider call", async () => {
    const valid = request();
    const invalid = {
      ...valid,
      deterministic_comparison: valid.deterministic_comparison.map(
        (comparison, index) =>
          index === 0 ? { ...comparison, baseline_median: 999 } : comparison,
      ),
    } as OptimizationGenerationRequestV1;

    await expect(client.generate(invalid)).rejects.toMatchObject({
      code: "OPTIMIZATION_SCHEMA_FAILURE",
      retryable: false,
    });
    expect(http.post).not.toHaveBeenCalled();
  });

  it("rejects a provider result that changes the generation identity", async () => {
    http.post.mockReturnValue(
      of({
        data: recommendation({
          generation_fingerprint:
            "d7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0",
        }),
      }),
    );

    await expect(client.generate(request())).rejects.toMatchObject({
      code: "OPTIMIZATION_IDENTITY_CONFLICT",
      retryable: false,
    });
  });

  it("rejects unsupported causal claims from the provider", async () => {
    http.post.mockReturnValue(
      of({
        data: recommendation({
          rationale:
            "This proves the hook causes higher clicks and will increase sales.",
        }),
      }),
    );

    await expect(client.generate(request())).rejects.toMatchObject({
      code: "OPTIMIZATION_SCHEMA_FAILURE",
      retryable: false,
    });
  });

  it("preserves a typed non-retryable provider error", async () => {
    http.post.mockReturnValue(
      throwError(() => ({
        response: {
          status: 422,
          data: {
            detail: {
              error_type: "OPTIMIZATION_PROVIDER_INVALID_OUTPUT",
              message: "The response remained outside optimization-v1.",
              retryable: false,
            },
          },
        },
      })),
    );

    await expect(client.generate(request())).rejects.toMatchObject({
      code: "OPTIMIZATION_PROVIDER_INVALID_OUTPUT",
      retryable: false,
    });
  });
});
