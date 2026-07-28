import { BadRequestException } from "@nestjs/common";
import { validatePlanShape } from "./strategy-plan.validator";

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
});