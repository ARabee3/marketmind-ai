import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import { ProviderError } from "../../common/errors/provider-error";
import { ContentAiClient } from "./content.client";
import type {
  AiContentGenerateRequest,
  AiContentGenerateResponse,
  AiContentReviseRequest,
  AiContentReviseResponse,
  AiContentV2PlanRequest,
  AiContentV2PlanResponse,
  AiStaticAssetGenerateRequest,
  AiStaticAssetGenerateResponse,
} from "@marketmind/contracts";

function makeGenerateRequest(): AiContentGenerateRequest {
  return {
    contract_version: "content-v1",
    content_pack_id: "pack-1",
    business_id: "biz-1",
    strategy_id: "strat-1",
    strategy_version: 2,
    strategy_decision_id: "decision-1",
    strategy_plan: {
      strategy_id: "strat-1",
      version: 2,
      plan_language: "ar-EG",
      profile_version: {
        business_profile_version_id: "prof-1",
        version: 1,
      },
      selected_channels: [{ channel: "instagram" }],
      content_strategy: {
        weeks: [{ week_number: 1, theme: "intro", formats: [] }],
      },
    },
    business_profile: { id: "prof-1", business_id: "biz-1", version: 1 },
    week_context: { week_number: 1 },
    selected_channels: ["instagram"],
    allowed_formats: ["post"],
    language_mode: "ar-EG",
  } as unknown as AiContentGenerateRequest;
}

function makeGenerateResponse(): AiContentGenerateResponse {
  return {
    contract_version: "content-v1",
    content_pack: { id: "pack-1" },
    item_versions: [],
    validation: { valid: true, issues: [] },
  } as unknown as AiContentGenerateResponse;
}

const REVISE_REQUEST: AiContentReviseRequest = {
  contract_version: "content-v1",
  content_pack_id: "pack-1",
  content_item_id: "item-1",
  base_item_version_id: "ver-1",
  revision_notes: "Tighten the headline.",
  idempotency_key: "rev-1",
};

const REVISE_ENVELOPE = {
  request: REVISE_REQUEST,
  previous_item_version: { id: "ver-1" } as any,
  generation_request: { contract_version: "content-v1" } as any,
};

const REVISE_RESPONSE: AiContentReviseResponse = {
  contract_version: "content-v1",
  item_version: { id: "ver-2" },
  validation: { valid: true, issues: [] },
} as unknown as AiContentReviseResponse;

const STATIC_ASSET_REQUEST: AiStaticAssetGenerateRequest = {
  contract_version: "content-v1",
  asset_id: "asset-1",
  content_item_version_id: "ver-1",
  creative_brief: "brief",
  alt_text: "alt",
  width: 1080,
  height: 1080,
  idempotency_key: "asset-1",
};

const STATIC_ASSET_RESPONSE: AiStaticAssetGenerateResponse = {
  contract_version: "content-v1",
  asset: { id: "asset-1" },
  validation: { valid: true, issues: [] },
} as unknown as AiStaticAssetGenerateResponse;

describe("ContentAiClient", () => {
  let client: ContentAiClient;
  let httpService: { post: jest.Mock };

  beforeEach(async () => {
    httpService = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentAiClient,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("http://localhost:8000") },
        },
      ],
    }).compile();

    client = module.get<ContentAiClient>(ContentAiClient);
  });

  describe("generate", () => {
    it("posts the request to the internal generate endpoint and returns the validated response", async () => {
      const response = makeGenerateResponse();
      httpService.post.mockReturnValue(of({ data: response }));

      const result = await client.generate(makeGenerateRequest());

      expect(httpService.post).toHaveBeenCalledWith(
        "http://localhost:8000/internal/v1/ai/content/generate",
        expect.objectContaining({ content_pack_id: "pack-1" }),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(result).toEqual(response);
    });

    it("rejects a request that fails deterministic validation before POST", async () => {
      const request = makeGenerateRequest() as unknown as {
        selected_channels: unknown[];
      };
      request.selected_channels = [];
      const expected = expect.any(ProviderError);

      await expect(
        client.generate(request as unknown as AiContentGenerateRequest),
      ).rejects.toThrowError(expected);

      expect(httpService.post).not.toHaveBeenCalled();
      await expect(
        client.generate(request as unknown as AiContentGenerateRequest),
      ).rejects.toMatchObject({
        code: "CONTENT_SCHEMA_FAILURE",
        retryable: false,
      });
    });

    it("maps an HTTP 503 to a retryable CONTENT_PROVIDER_FAILURE", async () => {
      httpService.post.mockReturnValue(
        throwError(() => ({ response: { status: 503 } })),
      );

      await expect(
        client.generate(makeGenerateRequest()),
      ).rejects.toMatchObject({
        code: "CONTENT_PROVIDER_FAILURE",
        retryable: true,
      });
    });

    it("maps a timeout (ECONNABORTED) to a retryable CONTENT_PROVIDER_FAILURE", async () => {
      httpService.post.mockReturnValue(
        throwError(() => ({ code: "ECONNABORTED" })),
      );

      await expect(
        client.generate(makeGenerateRequest()),
      ).rejects.toMatchObject({
        code: "CONTENT_PROVIDER_FAILURE",
        retryable: true,
      });
    });

    it("preserves a safe non-retryable Content error returned by FastAPI", async () => {
      httpService.post.mockReturnValue(
        throwError(() => ({
          response: {
            status: 422,
            data: {
              detail: {
                error_type: "CONTENT_UNSUPPORTED_CLAIM",
                message: "Content provider output remained unsafe after bounded repair.",
                retryable: false,
              },
            },
          },
        })),
      );

      await expect(
        client.generate(makeGenerateRequest()),
      ).rejects.toMatchObject({
        code: "CONTENT_UNSUPPORTED_CLAIM",
        message:
          "Content provider output remained unsafe after bounded repair.",
        retryable: false,
      });
    });

    it("keeps an unstructured HTTP 422 non-retryable and generic", async () => {
      httpService.post.mockReturnValue(
        throwError(() => ({ response: { status: 422 } })),
      );

      await expect(
        client.generate(makeGenerateRequest()),
      ).rejects.toMatchObject({
        code: "CONTENT_PROVIDER_FAILURE",
        retryable: false,
      });
    });

    it("rejects a malformed response body with CONTENT_SCHEMA_FAILURE", async () => {
      httpService.post.mockReturnValue(
        of({ data: { contract_version: "content-v1" } }),
      );

      await expect(
        client.generate(makeGenerateRequest()),
      ).rejects.toMatchObject({
        code: "CONTENT_SCHEMA_FAILURE",
        retryable: false,
      });
    });

    it("rejects a response whose provider-side validation failed", async () => {
      const response = makeGenerateResponse() as unknown as {
        validation: { valid: boolean; issues: unknown[] };
      };
      response.validation = { valid: false, issues: [] };
      httpService.post.mockReturnValue(of({ data: response }));

      await expect(
        client.generate(makeGenerateRequest()),
      ).rejects.toMatchObject({
        code: "CONTENT_SCHEMA_FAILURE",
        retryable: false,
      });
    });
  });

  describe("revise", () => {
    it("posts to the revise endpoint and returns the validated response", async () => {
      httpService.post.mockReturnValue(of({ data: REVISE_RESPONSE }));

      const result = await client.revise(REVISE_ENVELOPE);

      expect(httpService.post).toHaveBeenCalledWith(
        "http://localhost:8000/internal/v1/ai/content/revise",
        REVISE_ENVELOPE,
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(result).toEqual(REVISE_RESPONSE);
    });

    it("maps an HTTP 503 to a retryable CONTENT_PROVIDER_FAILURE", async () => {
      httpService.post.mockReturnValue(
        throwError(() => ({ response: { status: 503 } })),
      );

      await expect(client.revise(REVISE_ENVELOPE)).rejects.toMatchObject({
        code: "CONTENT_PROVIDER_FAILURE",
        retryable: true,
      });
    });
  });

  describe("generateStaticAsset", () => {
    it("posts to the static-asset endpoint and returns the validated response", async () => {
      httpService.post.mockReturnValue(of({ data: STATIC_ASSET_RESPONSE }));

      const result = await client.generateStaticAsset(STATIC_ASSET_REQUEST);

      expect(httpService.post).toHaveBeenCalledWith(
        "http://localhost:8000/internal/v1/ai/content/assets/generate-static",
        STATIC_ASSET_REQUEST,
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(result).toEqual(STATIC_ASSET_RESPONSE);
    });

    it("rejects a malformed asset response with CONTENT_SCHEMA_FAILURE", async () => {
      httpService.post.mockReturnValue(
        of({ data: { contract_version: "content-v1" } }),
      );

      await expect(
        client.generateStaticAsset(STATIC_ASSET_REQUEST),
      ).rejects.toMatchObject({
        code: "CONTENT_SCHEMA_FAILURE",
        retryable: false,
      });
    });
  });

  describe("plan", () => {
    const PLAN_REQUEST: AiContentV2PlanRequest = {
      contract_version: "content-v2",
      week_plan_id: "week-plan-1",
      business_id: "biz-1",
      strategy_id: "strat-1",
      strategy_version: 2,
      strategy_decision_id: "decision-1",
      strategy_plan: {
        strategy_id: "strat-1",
        version: 2,
        contract_version: "strategy-v2",
        content_handoff: {
          available: true,
          channels: ["instagram"],
          language: "ar-EG",
          weeks: [{ week_number: 1, formats: ["static_image_post"] }],
        },
        calendar_weeks: [{ week_number: 1 }],
      } as unknown as AiContentV2PlanRequest["strategy_plan"],
      week_number: 1,
      editorial_profile: {
        language: "ar-EG",
      } as AiContentV2PlanRequest["editorial_profile"],
      cta_library: [],
      media_library: [],
      allowed_channels: ["instagram"],
      allowed_formats: ["static_image_post"],
      language_mode: "ar-EG",
      idempotency_key: "plan-key",
    };

    const PLAN_RESPONSE: AiContentV2PlanResponse = {
      contract_version: "content-v2",
      week_plan_id: "week-plan-1",
      post_plans: [
        {
          purpose: "Card one",
          intended_audience: null,
          channel: "instagram",
          format: "static_image_post",
          cta_library_entry_id: null,
          owner_instructions: null,
          visual_direction: null,
          selected_media_ids: [],
        },
        {
          purpose: "Card two",
          intended_audience: null,
          channel: "instagram",
          format: "static_image_post",
          cta_library_entry_id: null,
          owner_instructions: null,
          visual_direction: null,
          selected_media_ids: [],
        },
        {
          purpose: "Card three",
          intended_audience: null,
          channel: "instagram",
          format: "static_image_post",
          cta_library_entry_id: null,
          owner_instructions: null,
          visual_direction: null,
          selected_media_ids: [],
        },
      ],
      validation: { valid: true, issues: [] },
    };

    it("posts to the v2 plan endpoint and returns the validated response", async () => {
      httpService.post.mockReturnValue(of({ data: PLAN_RESPONSE }));

      const result = await client.plan(PLAN_REQUEST);

      expect(httpService.post).toHaveBeenCalledWith(
        "http://localhost:8000/internal/v1/ai/content/v2/plan",
        PLAN_REQUEST,
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(result).toEqual(PLAN_RESPONSE);
    });

    it("rejects planner language drift from the editorial profile", async () => {
      await expect(
        client.plan({ ...PLAN_REQUEST, language_mode: "en" }),
      ).rejects.toMatchObject({
        code: "CONTENT_SCHEMA_FAILURE",
        retryable: false,
      });
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it("rejects a plan response with fewer than three cards", async () => {
      httpService.post.mockReturnValue(
        of({
          data: {
            contract_version: "content-v2",
            post_plans: [],
            validation: { valid: true, issues: [] },
          },
        }),
      );

      await expect(client.plan(PLAN_REQUEST)).rejects.toMatchObject({
        code: "CONTENT_SCHEMA_FAILURE",
        retryable: false,
      });
    });

    it("rejects a non-v2 plan response", async () => {
      httpService.post.mockReturnValue(
        of({ data: { contract_version: "content-v1", post_plans: [] } }),
      );

      await expect(client.plan(PLAN_REQUEST)).rejects.toMatchObject({
        code: "CONTENT_SCHEMA_FAILURE",
        retryable: false,
      });
    });
  });
});
