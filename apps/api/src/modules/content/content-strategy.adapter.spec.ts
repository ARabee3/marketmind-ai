import {
  CONTENT_FORMATS,
  validateInternalContentGenerateRequest,
} from "@marketmind/contracts";
import type {
  ContentFormat,
  InternalContentGenerateRequest,
} from "@marketmind/contracts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProviderError } from "../../common/errors/provider-error";
import {
  adaptLanguageMode,
  adaptSelectedChannelsOrThrow,
  adaptStrategyWeekFormats,
  extractSupportedContentChannels,
  mapStrategyLabelToContentFormat,
  normalizeStrategyLabel,
} from "./content-strategy.adapter";

// RATIONALE: the canonical example Strategy plan is the authoritative
// cross-language fixture. Every week must map to a non-empty supported set;
// an all-unknown week must fail closed. The mapped week-2 request is then
// passed through the real TS grounding-snapshot validator to prove the
// adapter's output is contract-valid end to end (issue #110 P1).

const EXAMPLES_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "contracts",
  "examples",
);

function loadJson<T = unknown>(filename: string): T {
  return JSON.parse(readFileSync(resolve(EXAMPLES_DIR, filename), "utf8")) as T;
}

const strategyPlan = loadJson("strategy-plan.example.json");
const cafeJourney = loadJson("cafe-full-journey.example.json");
const safeDefaultWeekContext = loadJson("content-week-context-safe-default.example.json");

const WEEK_1_FORMATS = ["reels", "photo", "poll"];
const PLAN = strategyPlan as unknown as Record<string, unknown>;

/**
 * Asserts the adapter threw a non-retryable CONTENT_SCHEMA_FAILURE and did
 * not silently fall back to every supported format.
 */
function expectSchemaFailure(fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe("CONTENT_SCHEMA_FAILURE");
    expect((error as ProviderError).retryable).toBe(false);
  }
  if (!threw) {
    throw new Error("Expected CONTENT_SCHEMA_FAILURE but no error was thrown");
  }
}

describe("content-strategy.adapter", () => {
  // ── Normalization ───────────────────────────────────────────────────

  describe("normalizeStrategyLabel", () => {
    it("trims, lowercases, and converts spaces and hyphens to underscores", () => {
      expect(normalizeStrategyLabel("  Reels ")).toBe("reels");
      expect(normalizeStrategyLabel("Short-Video Script")).toBe(
        "short_video_script",
      );
      expect(normalizeStrategyLabel("Static Image Post")).toBe(
        "static_image_post",
      );
      expect(normalizeStrategyLabel("CAROUSEL-BRIEF")).toBe("carousel_brief");
      expect(normalizeStrategyLabel("text_post")).toBe("text_post");
    });
  });

  // ── Per-label mapping (every alias) ─────────────────────────────────

  describe("mapStrategyLabelToContentFormat", () => {
    const cases: ReadonlyArray<[string, ContentFormat]> = [
      ["static_image_post", "static_image_post"],
      ["static_image", "static_image_post"],
      ["photo", "static_image_post"],
      ["image", "static_image_post"],
      ["story", "static_image_post"],

      ["short_video_script", "short_video_script"],
      ["short_video", "short_video_script"],
      ["video", "short_video_script"],
      ["reel", "short_video_script"],
      ["reels", "short_video_script"],

      ["carousel_brief", "carousel_brief"],
      ["carousel", "carousel_brief"],

      ["text_post", "text_post"],
      ["text", "text_post"],
      ["post", "text_post"],
      ["caption", "text_post"],
      ["poll", "text_post"],
      ["quiz", "text_post"],
      ["question", "text_post"],
    ];

    it.each(cases)("maps %s -> %s", (label, expected) => {
      expect(mapStrategyLabelToContentFormat(label)).toBe(expected);
    });

    it("passes through the four exact content-v1 formats unchanged", () => {
      for (const format of CONTENT_FORMATS) {
        expect(mapStrategyLabelToContentFormat(format)).toBe(format);
      }
    });

    it("returns undefined for unknown labels", () => {
      expect(mapStrategyLabelToContentFormat("hologram")).toBeUndefined();
      expect(mapStrategyLabelToContentFormat("")).toBeUndefined();
    });
  });

  // ── Week format adaptation ─────────────────────────────────────────

  describe("adaptStrategyWeekFormats", () => {
    it("maps Strategy week 1 (reels,photo,poll) preserving order", () => {
      // The example week 1 fixture uses exactly these Strategy labels.
      expect(adaptStrategyWeekFormats(PLAN, 1)).toEqual([
        "short_video_script",
        "static_image_post",
        "text_post",
      ]);
    });

    it("maps all 12 example weeks to a non-empty supported set", () => {
      const weeks = (
        (PLAN["content_strategy"] as Record<string, unknown>)[
          "weeks"
        ] as Array<Record<string, unknown>>
      ).map((w) => Number(w["week_number"]));
      expect(weeks).toHaveLength(12);
      for (const weekNumber of weeks) {
        const mapped = adaptStrategyWeekFormats(PLAN, weekNumber);
        expect(mapped.length).toBeGreaterThan(0);
        for (const format of mapped) {
          expect((CONTENT_FORMATS as readonly string[]).includes(format)).toBe(
            true,
          );
        }
      }
    });

    it("deduplicates mapped values while preserving Strategy order", () => {
      const plan = {
        content_strategy: {
          weeks: [
            {
              week_number: 1,
              theme: "t",
              formats: ["reels", "video", "photo", "image", "post", "caption"],
            },
          ],
        },
      };
      expect(adaptStrategyWeekFormats(plan, 1)).toEqual([
        "short_video_script",
        "static_image_post",
        "text_post",
      ]);
    });

    it("drops unknown labels only when a known mapping remains", () => {
      const plan = {
        content_strategy: {
          weeks: [
            { week_number: 1, theme: "t", formats: ["reels", "hologram", "ai_video"] },
          ],
        },
      };
      expect(adaptStrategyWeekFormats(plan, 1)).toEqual(["short_video_script"]);
    });

    it("throws non-retryable CONTENT_SCHEMA_FAILURE when every label is unknown", () => {
      const plan = {
        content_strategy: {
          weeks: [{ week_number: 1, theme: "t", formats: ["hologram", "drone_show"] }],
        },
      };
      expectSchemaFailure(() => adaptStrategyWeekFormats(plan, 1));
    });

    it("fails closed (never falls back to all formats) for missing content_strategy", () => {
      expectSchemaFailure(() => adaptStrategyWeekFormats({}, 1));
      expectSchemaFailure(() => adaptStrategyWeekFormats({ content_strategy: {} }, 1));
    });

    it("fails closed for missing/empty weeks array", () => {
      expectSchemaFailure(() =>
        adaptStrategyWeekFormats({ content_strategy: { weeks: [] } }, 1),
      );
      expectSchemaFailure(() =>
        adaptStrategyWeekFormats({ content_strategy: { weeks: "nope" } }, 1),
      );
    });

    it("fails closed when the requested week is missing or has no formats array", () => {
      const plan = {
        content_strategy: {
          weeks: [{ week_number: 2, theme: "t", formats: ["reels"] }],
        },
      };
      expectSchemaFailure(() => adaptStrategyWeekFormats(plan, 1));
      expectSchemaFailure(() =>
        adaptStrategyWeekFormats(
          { content_strategy: { weeks: [{ week_number: 1, theme: "t" }] } },
          1,
        ),
      );
      expectSchemaFailure(() =>
        adaptStrategyWeekFormats(
          {
            content_strategy: {
              weeks: [{ week_number: 1, theme: "t", formats: [] }],
            },
          },
          1,
        ),
      );
    });
  });

  // ── Channels & language ─────────────────────────────────────────────

  describe("adaptSelectedChannelsOrThrow", () => {
    it("keeps supported channels (facebook, instagram) and drops others, preserving order", () => {
      // The example plan selects instagram + google_maps; only instagram is supported.
      const channels = extractSupportedContentChannels(PLAN);
      expect(channels).toEqual(["instagram"]);
    });

    it("keeps tiktok and google_business_profile as supported channels", () => {
      const channels = extractSupportedContentChannels({
        selected_channels: [
          { channel: "google_maps" },
          { channel: "google_business_profile" },
          { channel: "tiktok" },
        ],
      });
      expect(channels).toEqual(["google_business_profile", "tiktok"]);
    });

    it("fails closed when no supported channel remains", () => {
      expectSchemaFailure(() =>
        adaptSelectedChannelsOrThrow({ selected_channels: [{ channel: "google_maps" }] }),
      );
      expectSchemaFailure(() => adaptSelectedChannelsOrThrow({}));
    });
  });

  describe("adaptLanguageMode", () => {
    it("returns the plan language when supported", () => {
      expect(adaptLanguageMode(PLAN)).toBe("ar-EG");
    });

    it("defaults to ar-EG when the field is absent or unsupported", () => {
      expect(adaptLanguageMode({})).toBe("ar-EG");
      expect(adaptLanguageMode({ plan_language: "fr" })).toBe("ar-EG");
    });
  });

  // ── End-to-end grounding snapshot ───────────────────────────────────

  describe("validateInternalContentGenerateRequest accepts the adapted real request", () => {
    it("builds a contract-valid request from the canonical example plan", () => {
      const profile = (
        cafeJourney as Record<string, Record<string, unknown>>
      )["confirmed_business_profile"];
      const weekContext = safeDefaultWeekContext as unknown as Record<string, unknown>;

      // The safe-default example week_context is week 2; map that week.
      const weekNumber = Number(weekContext["week_number"]);
      const allowedFormats = adaptStrategyWeekFormats(PLAN, weekNumber);

      const request: InternalContentGenerateRequest = {
        contract_version: "content-v1",
        content_pack_id: "77777777-7777-4777-8777-777777777777",
        business_id: profile["business_id"] as string,
        strategy_id: PLAN["strategy_id"] as string,
        strategy_version: PLAN["version"] as number,
        strategy_decision_id: "55555555-5555-4555-8555-555555555555",
        strategy_plan: strategyPlan as unknown as InternalContentGenerateRequest["strategy_plan"],
        business_profile: profile as unknown as InternalContentGenerateRequest["business_profile"],
        week_context: weekContext as unknown as InternalContentGenerateRequest["week_context"],
        selected_channels: adaptSelectedChannelsOrThrow(PLAN),
        allowed_formats: allowedFormats,
        language_mode: adaptLanguageMode(PLAN),
      };

      const result = validateInternalContentGenerateRequest(request);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);

      // Week 2 of the canonical plan uses reels + photo → these two formats.
      expect(allowedFormats).toEqual([
        "short_video_script",
        "static_image_post",
      ]);
    });

    it("the real week 1 mapping matches the plan's required assertion", () => {
      expect(WEEK_1_FORMATS.map((f) => mapStrategyLabelToContentFormat(f))).toEqual([
        "short_video_script",
        "static_image_post",
        "text_post",
      ]);
    });
  });
});
describe("strategy-v2 content handoff adapter (#135)", () => {
  const v2Plan = loadJson("strategy-plan-v2.example.json") as Record<string, unknown>;

  it("reads the deterministic handoff channels, week format, and language", () => {
    const { adaptStrategyV2GenerationInput, isStrategyPlanV2 } =
      require("./content-strategy.adapter") as typeof import("./content-strategy.adapter");
    expect(isStrategyPlanV2(v2Plan)).toBe(true);
    const input = adaptStrategyV2GenerationInput(v2Plan, 3);
    expect(input.selected_channels).toEqual(["facebook", "tiktok"]);
    expect(input.allowed_formats).toEqual(["carousel_brief"]);
    expect(input.language_mode).toBe("ar-EG");
  });

  it("maps each of the 12 weeks deterministically from the handoff", () => {
    const { adaptStrategyV2WeekHandoff } =
      require("./content-strategy.adapter") as typeof import("./content-strategy.adapter");
    const formats = [1, 2, 3, 4].map((week) =>
      adaptStrategyV2WeekHandoff(v2Plan, week).format,
    );
    expect(formats).toEqual([
      "static_image_post",
      "short_video_script",
      "carousel_brief",
      "text_post",
    ]);
  });

  it("fails closed on an unknown handoff format (no fallback)", () => {
    const { adaptStrategyV2WeekHandoff } =
      require("./content-strategy.adapter") as typeof import("./content-strategy.adapter");
    const plan = structuredClone(v2Plan);
    (plan.content_handoff as { weeks: unknown[] }).weeks[0] = {
      week_number: 1,
      channel: "facebook",
      format: "reels",
    };
    expect(() => adaptStrategyV2WeekHandoff(plan, 1)).toThrow(ProviderError);
  });

  it("fails closed with a precise reason when the handoff is unavailable", () => {
    const {
      adaptStrategyV2GenerationInput,
      contentHandoffUnavailableReasonCode,
    } = require("./content-strategy.adapter") as typeof import("./content-strategy.adapter");
    const plan = structuredClone(v2Plan);
    plan.content_handoff = {
      available: false,
      reason: "content_v1_unsupported_channels_only",
    };
    expect(contentHandoffUnavailableReasonCode(plan)).toBe(
      "content_v1_unsupported_channels_only",
    );
    expect(() => adaptStrategyV2GenerationInput(plan, 1)).toThrow(
      "content_v1_unsupported_channels_only",
    );
  });

  it("does not treat a v1 plan as strategy-v2", () => {
    const { isStrategyPlanV2 } =
      require("./content-strategy.adapter") as typeof import("./content-strategy.adapter");
    expect(isStrategyPlanV2(loadJson("strategy-plan.example.json"))).toBe(false);
  });
});
