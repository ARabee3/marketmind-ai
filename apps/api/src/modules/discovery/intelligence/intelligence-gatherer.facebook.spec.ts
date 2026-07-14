import "reflect-metadata";
import { ProviderError } from "../../../common/errors/provider-error";
import {
  createFacebookGathererFixture,
  facebookPageAttempt,
  facebookPageCandidate,
} from "./intelligence-gatherer.facebook.fixture";

describe("IntelligenceGathererService Facebook enrichment", () => {
  const fixture = createFacebookGathererFixture();
  const { dto, evidenceTriage, searchClient, socialEnrichment, createService } =
    fixture;

  beforeEach(fixture.reset);

  it("overlaps Facebook enrichment with normal search and consolidates accepted evidence", async () => {
    let releaseSocial!: () => void;
    socialEnrichment.enrich.mockReturnValue(
      new Promise((resolve) => {
        releaseSocial = () =>
          resolve({
            candidates: [facebookPageCandidate()],
            provider_warnings: [],
            provider_attempts: [facebookPageAttempt()],
          });
      }),
    );
    const service = createService();
    const progress = jest.fn().mockResolvedValue(undefined);

    const gathering = service.gather(dto, progress);
    for (
      let attempt = 0;
      attempt < 10 && !searchClient.search.mock.calls.length;
      attempt += 1
    ) {
      await Promise.resolve();
    }
    expect(searchClient.search).toHaveBeenCalled();
    expect(socialEnrichment.enrich).toHaveBeenCalled();
    releaseSocial();
    const result = await gathering;

    expect(evidenceTriage.triage).toHaveBeenLastCalledWith(
      expect.objectContaining({ intent: "social_profile" }),
      undefined,
    );
    expect(result.source_refs).toHaveLength(2);
    expect(result.source_refs[0]).toMatchObject({
      source_type: "owner_link",
      title: "قصر نابولي",
      metadata: { followers_count: 8500 },
    });
    expect(result.research_observations[2]).toMatchObject({
      source_ref_id: "source_ref_1",
      kind: "social_signal",
    });
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "metadata",
        messageKey: "discovery.facebook_enrichment.completed",
      }),
    );
    expect(JSON.stringify(progress.mock.calls)).not.toContain(
      "حلويات ومخبوزات في أسيوط",
    );
  });

  it("keeps ordinary evidence and returns partial when Facebook fails", async () => {
    socialEnrichment.enrich.mockResolvedValue({
      candidates: [],
      provider_warnings: [
        {
          code: "APIFY_FACEBOOK_PROVIDER_ERROR",
          message: "Facebook enrichment failed.",
          retryable: true,
        },
      ],
      provider_attempts: [
        {
          provider: "apify_facebook_pages",
          outcome: "failed",
          result_count: 0,
          duration_ms: 25,
          error_code: "APIFY_FACEBOOK_PROVIDER_ERROR",
        },
      ],
    });

    const result = await createService().gather(dto);

    expect(result.status).toBe("partial");
    expect(result.source_refs).toHaveLength(2);
    expect(result.safe_error?.code).toBe("APIFY_FACEBOOK_PROVIDER_ERROR");
  });

  it("aborts in-flight Facebook work when ordinary evidence triage exits early", async () => {
    let facebookSignal: AbortSignal | undefined;
    socialEnrichment.enrich.mockImplementation(async (_dto, signal) => {
      facebookSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    });
    evidenceTriage.triage.mockRejectedValue(
      new ProviderError(
        "AI_TRIAGE_PROVIDER_ERROR",
        "AI evidence review failed.",
        true,
      ),
    );

    const result = await createService().gather(dto);

    expect(facebookSignal?.aborted).toBe(true);
    expect(result.status).toBe("partial");
    expect(result.safe_error?.code).toBe("AI_TRIAGE_PROVIDER_ERROR");
  });

  it("preserves ordinary evidence when Facebook-specific LLM triage fails", async () => {
    const ordinaryTriage = evidenceTriage.triage.getMockImplementation();
    evidenceTriage.triage
      .mockImplementationOnce(ordinaryTriage!)
      .mockRejectedValueOnce(
        new ProviderError(
          "AI_TRIAGE_PROVIDER_ERROR",
          "AI Facebook evidence review failed.",
          true,
        ),
      );

    const result = await createService().gather(dto);

    expect(result.status).toBe("partial");
    expect(result.safe_error?.code).toBe("AI_TRIAGE_PROVIDER_ERROR");
    expect(result.source_refs).toHaveLength(2);
    expect(result.source_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_type: "owner_link" }),
        expect.objectContaining({ platform: "serpapi" }),
      ]),
    );
  });
});
