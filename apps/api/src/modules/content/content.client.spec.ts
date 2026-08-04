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

    it("maps an HTTP 422 to a non-retryable CONTENT_PROVIDER_FAILURE", async () => {
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
});
