import { describe, expect, it } from "vitest";
import {
  cairoDateFromStrategyStart,
  getWeekStartDate,
  isoToCairoLocalString,
  cairoLocalToIsoString,
} from "../content-cycle-schedule";

describe("content-cycle-schedule", () => {
  it("cairoDateFromStrategyStart formats ISO string into YYYY-MM-DD", () => {
    expect(cairoDateFromStrategyStart("2026-08-10T12:00:00.000Z")).toBe("2026-08-10");
    expect(cairoDateFromStrategyStart("2026-08-15")).toBe("2026-08-15");
  });

  it("getWeekStartDate calculates exact 7-day offsets without cumulative drift", () => {
    expect(getWeekStartDate("2026-08-10", 1)).toBe("2026-08-10");
    expect(getWeekStartDate("2026-08-10", 2)).toBe("2026-08-17");
    expect(getWeekStartDate("2026-08-10", 12)).toBe("2026-10-26");
  });

  it("converts ISO UTC to Cairo local datetime-local format", () => {
    // 12:00 UTC = 15:00 Cairo (UTC+3 in August)
    const local = isoToCairoLocalString("2026-08-10T12:00:00.000Z");
    expect(local).toContain("2026-08-10T15:00");
  });

  it("round-trips Cairo local datetime-local to ISO UTC string", () => {
    const localStr = "2026-08-10T15:00";
    const isoStr = cairoLocalToIsoString(localStr);
    const convertedBack = isoToCairoLocalString(isoStr);
    expect(convertedBack).toBe(localStr);
  });
});
