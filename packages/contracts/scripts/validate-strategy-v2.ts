/**
 * Validates the canonical strategy-v2 examples (#135).
 *
 * The brief example is checked for the owner-channel invariants (1-3 unique
 * catalog channels, exactly one primary, safe setup states, no secret-bearing
 * fields). The plan example is run through `validateStrategyPlanV2` with the
 * brief's selected channels so the exact-commitment invariant is enforced.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  STRATEGY_CHANNEL_CATALOG,
  STRATEGY_CHANNEL_SETUP_STATES,
  validateStrategyPlanV2,
  type StrategyBriefV2,
} from "../src/index";

const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../examples");

function load(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, name), "utf8"));
}

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateBrief(brief: unknown): void {
  check(isObject(brief), "brief must be an object");
  if (!isObject(brief)) return;
  const b = brief as StrategyBriefV2;
  check(b.meta?.contract_version === "strategy-v2", "brief meta contract_version must be strategy-v2");
  check(
    Array.isArray(b.channel_choices) && b.channel_choices.length >= 1 && b.channel_choices.length <= 3,
    "brief must have 1-3 channel choices",
  );
  const seen = new Set<string>();
  let primaries = 0;
  for (const choice of b.channel_choices ?? []) {
    check(STRATEGY_CHANNEL_CATALOG.includes(choice.channel), `unknown channel ${choice.channel}`);
    check(!seen.has(choice.channel), `duplicate channel ${choice.channel}`);
    seen.add(choice.channel);
    if (choice.is_primary) primaries += 1;
    check(STRATEGY_CHANNEL_SETUP_STATES.includes(choice.setup_state), `invalid setup state ${choice.setup_state}`);
    if (choice.setup_state === "connected") {
      check(typeof choice.publishing_target_id === "string", `connected channel ${choice.channel} must carry a verified publishing_target_id`);
    }
    const forbidden = ["page_id", "access_token", "credential_ref", "provider_secret"];
    for (const key of Object.keys(choice)) {
      check(!forbidden.includes(key), `forbidden secret field ${key} on channel ${choice.channel}`);
    }
  }
  check(primaries === 1, `exactly one primary channel required, found ${primaries}`);
}

function validatePlan(plan: unknown, briefChoices: string[]): void {
  const result = validateStrategyPlanV2(plan, briefChoices);
  check(result.valid, `plan validation failed: ${result.issues.map((i) => `${i.code}: ${i.message}`).join("; ")}`);
}

const brief = load("strategy-brief-v2.example.json");
const plan = load("strategy-plan-v2.example.json");
validateBrief(brief);
validatePlan(plan, (brief as StrategyBriefV2).channel_choices.map((c) => c.channel));

if (failures.length > 0) {
  console.error("strategy-v2 example validation failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("strategy-v2 canonical examples are valid.");
