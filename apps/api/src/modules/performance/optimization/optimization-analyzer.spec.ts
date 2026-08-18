import {
  analyzeOptimizationSnapshots,
  type OptimizationSnapshotInput,
} from "./optimization-analyzer";

const BUSINESS_ID = "a1000000-0000-4000-8000-000000000002";
const STRATEGY_ID = "a1000000-0000-4000-8000-000000000011";
const CYCLE_ID = "a1000000-0000-4000-8000-000000000012";

function snapshot(
  index: number,
  overrides: Partial<OptimizationSnapshotInput> = {},
): OptimizationSnapshotInput {
  return {
    snapshot_id: `a1000000-0000-4000-8000-0000000000${index + 20}`,
    business_id: BUSINESS_ID,
    publishing_result_id: `a1000000-0000-4000-8000-0000000000${index + 40}`,
    candidate_id: `a1000000-0000-4000-8000-0000000000${index + 60}`,
    candidate_checksum: `checksum-${index}`,
    strategy_id: STRATEGY_ID,
    strategy_version: 2,
    content_cycle_id: CYCLE_ID,
    content_format: "text_post",
    provider: "facebook",
    window: "7d",
    published_at: `2026-08-${String(10 + index).padStart(2, "0")}T08:00:00Z`,
    observed_at: `2026-08-${String(17 + index).padStart(2, "0")}T08:00:00Z`,
    metrics: {
      post_media_view: { status: "available", value: 80 + index * 20 },
      post_clicks: { status: "available", value: 8 + index },
    },
    caption: `Caption ${index}`,
    cta: "Learn more",
    ...overrides,
  };
}

describe("analyzeOptimizationSnapshots", () => {
  it("requires three comparable complete seven-day snapshots and computes medians", () => {
    const result = analyzeOptimizationSnapshots({
      business_id: BUSINESS_ID,
      snapshots: [snapshot(0), snapshot(1), snapshot(2)],
    });

    expect(result.readiness.status).toBe("ready");
    expect(result.readiness.format_cohort).toBe("text_post");
    expect(result.comparisons).toEqual([
      expect.objectContaining({
        metric: "post_media_view",
        baseline_median: 100,
        best_value: 120,
        delta_from_median: 20,
        delta_percent: 20,
      }),
      expect.objectContaining({
        metric: "post_clicks",
        baseline_median: 9,
        best_value: 10,
        delta_from_median: 1,
      }),
    ]);
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence_checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not mix formats or strategy/cycle identities", () => {
    const result = analyzeOptimizationSnapshots({
      business_id: BUSINESS_ID,
      snapshots: [
        snapshot(0),
        snapshot(1),
        snapshot(2),
        snapshot(3, { content_format: "static_image_post" }),
        snapshot(4, { strategy_version: 3 }),
      ],
    });

    expect(result.evidence).toHaveLength(3);
    expect(result.format_cohort).toBe("text_post");
    expect(
      result.evidence.every((item) => item.content_format === "text_post"),
    ).toBe(true);
    expect(result.readiness.available_formats).toEqual([
      "static_image_post",
      "text_post",
    ]);
  });

  it("chooses the cohort with the most complete required evidence", () => {
    const incompleteCohort = [
      snapshot(0),
      snapshot(1, {
        strategy_version: 3,
        metrics: {
          post_media_view: { status: "unavailable", reason: "not_returned" },
          post_clicks: { status: "available", value: 2 },
        },
      }),
      snapshot(2, {
        strategy_version: 3,
        metrics: {
          post_media_view: { status: "unavailable", reason: "not_returned" },
          post_clicks: { status: "available", value: 3 },
        },
      }),
      snapshot(3, {
        strategy_version: 3,
        metrics: {
          post_media_view: { status: "unavailable", reason: "not_returned" },
          post_clicks: { status: "available", value: 4 },
        },
      }),
    ];
    const completeCohort = [
      snapshot(4, { strategy_version: 4 }),
      snapshot(5, { strategy_version: 4 }),
      snapshot(6, { strategy_version: 4 }),
    ];

    const result = analyzeOptimizationSnapshots({
      business_id: BUSINESS_ID,
      snapshots: [...incompleteCohort, ...completeCohort],
    });

    expect(result.readiness.status).toBe("ready");
    expect(result.identity?.strategy_version).toBe(4);
    expect(result.evidence).toHaveLength(3);
  });

  it("keeps numeric zero available and treats missing metrics as incomplete", () => {
    const result = analyzeOptimizationSnapshots({
      business_id: BUSINESS_ID,
      snapshots: [
        snapshot(0, {
          metrics: {
            post_media_view: { status: "available", value: 0 },
            post_clicks: { status: "available", value: 1 },
          },
        }),
        snapshot(1, {
          metrics: {
            post_media_view: { status: "unavailable", reason: "not_returned" },
            post_clicks: { status: "available", value: 2 },
          },
        }),
        snapshot(2, {
          metrics: {
            post_media_view: { status: "available", value: 10 },
            post_clicks: { status: "available", value: 3 },
          },
        }),
        snapshot(3, {
          metrics: {
            post_media_view: { status: "unavailable", reason: "not_returned" },
            post_clicks: { status: "available", value: 4 },
          },
        }),
      ],
    });

    expect(result.readiness.status).toBe("insufficient_evidence");
    expect(result.readiness.reason).toBe("missing_required_metric");
    expect(result.readiness.eligible_post_count).toBe(2);
  });

  it("returns weak readiness without exposing a flat cohort to the provider", () => {
    const result = analyzeOptimizationSnapshots({
      business_id: BUSINESS_ID,
      snapshots: [
        snapshot(0, {
          metrics: {
            post_media_view: { status: "available", value: 100 },
            post_clicks: { status: "available", value: 10 },
          },
        }),
        snapshot(1, {
          metrics: {
            post_media_view: { status: "available", value: 100 },
            post_clicks: { status: "available", value: 10 },
          },
        }),
        snapshot(2, {
          metrics: {
            post_media_view: { status: "available", value: 100 },
            post_clicks: { status: "available", value: 10 },
          },
        }),
      ],
    });

    expect(result.readiness.status).toBe("insufficient_evidence");
    expect(result.readiness.reason).toBe("weak_signal");
    expect(result.evidence).toEqual([]);
    expect(result.evidence_checksum).toBeNull();
  });

  it("fails closed on a snapshot ID with conflicting provenance", () => {
    const duplicate = snapshot(0, { strategy_version: 3 });
    const result = analyzeOptimizationSnapshots({
      business_id: BUSINESS_ID,
      snapshots: [snapshot(0), duplicate, snapshot(1), snapshot(2)],
    });

    expect(result.readiness.status).toBe("insufficient_evidence");
    expect(result.readiness.reason).toBe("snapshot_provenance_conflict");
    expect(result.evidence).toEqual([]);
  });
});
