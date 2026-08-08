import { BadRequestException } from "@nestjs/common";
import { validatePlanShape } from "./strategy-plan.validator";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const V2_EXAMPLE = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "packages",
      "contracts",
      "examples",
      "strategy-plan-v2.example.json",
    ),
    "utf8",
  ),
);

const V2_BRIEF = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "packages",
      "contracts",
      "examples",
      "strategy-brief-v2.example.json",
    ),
    "utf8",
  ),
);

function v2Choices(): string[] {
  return (V2_BRIEF.channel_choices ?? []).map(
    (choice: { channel: string }) => choice.channel,
  );
}

function validPlan(): Record<string, unknown> {
  return {
    id: "plan-1",
    strategy_id: "strat-1",
    version: 1,
    contract_version: "2026-07-01",
    brief_id: "brief-1",
    retrieval_run_id: "run-1",
    executive_summary: { text: "summary", source: "model_synthesis", citation_ids: [] },
    situation_diagnosis: { text: "diagnosis", source: "model_synthesis", citation_ids: [] },
    primary_objective: "awareness",
    selected_channels: [],
    all_channel_scores: [],
    content_strategy: { format_mix: [], weekly_cadence: "1 post", weeks: [], experiments: [] },
    budget_mode: "organic_only",
    kpi_targets: [],
    citations: [],
    created_at: "2026-07-28T10:00:00.000Z",
  };
}

describe("validatePlanShape", () => {
  it("accepts a plan with all required fields", () => {
    expect(() => validatePlanShape(validPlan())).not.toThrow();
  });

  it("rejects a non-object plan", () => {
    expect(() => validatePlanShape(null)).toThrow(BadRequestException);
    expect(() => validatePlanShape("not-a-plan")).toThrow(BadRequestException);
    expect(() => validatePlanShape([])).toThrow(BadRequestException);
  });

  it("rejects a plan missing required fields with a descriptive message", () => {
    const plan = validPlan();
    delete plan["executive_summary"];
    delete plan["kpi_targets"];

    expect(() => validatePlanShape(plan)).toThrow(BadRequestException);
    expect(() => validatePlanShape(plan)).toThrow(/executive_summary.*kpi_targets/);
  });

  it("rejects a plan where selected_channels is not an array", () => {
    const plan = validPlan();
    plan["selected_channels"] = "not-an-array";

    expect(() => validatePlanShape(plan)).toThrow(/selected_channels must be an array/);
  });

  it("rejects a plan where kpi_targets is not an array", () => {
    const plan = validPlan();
    plan["kpi_targets"] = { not: "an array" };

    expect(() => validatePlanShape(plan)).toThrow(/kpi_targets must be an array/);
  });

  it("rejects a plan where citations is not an array", () => {
    const plan = validPlan();
    plan["citations"] = 42;

    expect(() => validatePlanShape(plan)).toThrow(/citations must be an array/);
  });

  describe("strategy-v2 (#135)", () => {
    it("accepts the canonical v2 plan when commitments match the brief choices", () => {
      expect(() =>
        validatePlanShape(V2_EXAMPLE, v2Choices()),
      ).not.toThrow();
    });

    it("rejects a v2 plan whose commitments include an unselected channel", () => {
      const plan = structuredClone(V2_EXAMPLE);
      plan.channel_commitments.push({
        channel: "instagram",
        role: "supporting",
        rationale: "x",
        capability_state: "setup_later",
      });
      expect(() => validatePlanShape(plan, v2Choices())).toThrow(
        /STRATEGY_V2_COMMITMENT_MISMATCH/,
      );
    });

    it("rejects a v2 plan missing a commitment for a selected channel", () => {
      const plan = structuredClone(V2_EXAMPLE);
      plan.channel_commitments = plan.channel_commitments.filter(
        (c: { channel: string }) => c.channel !== "tiktok",
      );
      expect(() => validatePlanShape(plan, v2Choices())).toThrow(
        /STRATEGY_V2_COMMITMENT_MISMATCH/,
      );
    });

    it("rejects a v2 plan with an unknown handoff format", () => {
      const plan = structuredClone(V2_EXAMPLE);
      plan.content_handoff.weeks[0].format = "reels";
      expect(() => validatePlanShape(plan, v2Choices())).toThrow(
        /STRATEGY_V2_HANDOFF_FORMAT/,
      );
    });

    it("accepts an explicitly unavailable handoff with a machine-readable reason", () => {
      const plan = structuredClone(V2_EXAMPLE);
      plan.content_handoff = {
        available: false,
        reason: "content_v1_unsupported_channels_only",
      };
      expect(() => validatePlanShape(plan, v2Choices())).not.toThrow();
    });
  });
});