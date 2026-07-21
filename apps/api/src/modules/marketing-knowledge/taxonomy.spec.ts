import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_LOCALES,
  KNOWLEDGE_REVIEW_STATUSES,
  KNOWLEDGE_EVIDENCE_TIERS,
  KNOWLEDGE_OBJECTIVES,
  KNOWLEDGE_BUDGET_MODES,
  KNOWLEDGE_CHANNELS,
  validateTaxonomyArray,
  validateVersionTaxonomyArrays,
  assertTaxonomyValue,
} from "./taxonomy";

describe("marketing-knowledge taxonomy", () => {
  it("matches the merged contract controlled vocabularies", () => {
    expect(KNOWLEDGE_OBJECTIVES).toEqual([
      "awareness",
      "acquisition",
      "conversion",
      "retention",
      "launch",
    ]);
    expect(KNOWLEDGE_BUDGET_MODES).toEqual([
      "organic_only",
      "monthly_amount",
      "three_month_amount",
      "scenario_only",
    ]);
    expect(KNOWLEDGE_EVIDENCE_TIERS).toEqual([
      "verified_benchmark",
      "reviewed_guidance",
      "contextual_note",
    ]);
    expect(KNOWLEDGE_REVIEW_STATUSES).toEqual([
      "draft",
      "approved",
      "retired",
      "expired",
    ]);
    expect(KNOWLEDGE_LOCALES).toEqual(["ar-EG", "en", "mixed"]);
  });

  it("exposes the full kind vocabulary from the issue plan", () => {
    expect(KNOWLEDGE_KINDS).toContain("benchmark_report");
    expect(KNOWLEDGE_KINDS).toContain("sector_note");
  });

  it("validateTaxonomyArray passes for allowed values", () => {
    expect(() =>
      validateTaxonomyArray("channels", ["facebook", "tiktok"]),
    ).not.toThrow();
  });

  it("validateTaxonomyArray throws on the first invalid element", () => {
    expect(() =>
      validateTaxonomyArray("channels", ["facebook", "snapchat"]),
    ).toThrow(/channels/);
  });

  it("validateVersionTaxonomyArrays validates every provided array field", () => {
    expect(() =>
      validateVersionTaxonomyArrays({
        markets: ["egypt"],
        objectives: ["awareness"],
        channels: ["instagram"],
        budgetModes: ["organic_only"],
      }),
    ).not.toThrow();
  });

  it("validateVersionTaxonomyArrays rejects an invalid objective", () => {
    expect(() =>
      validateVersionTaxonomyArrays({ objectives: ["growth_hacking"] }),
    ).toThrow(/objectives/);
  });

  it("assertTaxonomyValue narrows the type when valid", () => {
    const value = "approved" as string;
    assertTaxonomyValue(KNOWLEDGE_REVIEW_STATUSES, value, "review_status");
    // compiles: value is now KnowledgeReviewStatus
    expect(value).toBe("approved");
  });

  it("assertTaxonomyValue throws for an out-of-vocabulary scalar", () => {
    expect(() =>
      assertTaxonomyValue(KNOWLEDGE_EVIDENCE_TIERS, "guess", "evidence_tier"),
    ).toThrow(/evidence_tier/);
  });
});