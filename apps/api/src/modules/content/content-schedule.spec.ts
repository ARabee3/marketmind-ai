import {
  addCairoCalendarDays,
  cairoCalendarDate,
  cairoMidnight,
  weekCutoffDate,
  weekStartDate,
} from "./content-schedule";

describe("content-schedule", () => {
  it("calculates exact Week 1–12 calendar dates from one immutable anchor", () => {
    const starts = Array.from({ length: 12 }, (_, index) =>
      weekStartDate("2026-04-10", index + 1),
    );

    expect(starts).toEqual([
      "2026-04-10",
      "2026-04-17",
      "2026-04-24",
      "2026-05-01",
      "2026-05-08",
      "2026-05-15",
      "2026-05-22",
      "2026-05-29",
      "2026-06-05",
      "2026-06-12",
      "2026-06-19",
      "2026-06-26",
    ]);
  });

  it("keeps calendar dates stable across Cairo DST start and end", () => {
    expect(addCairoCalendarDays("2026-04-23", 1)).toBe("2026-04-24");
    expect(addCairoCalendarDays("2026-10-29", 1)).toBe("2026-10-30");
    expect(weekStartDate("2026-10-23", 2)).toBe("2026-10-30");
  });

  it("uses the start of the following Cairo week as the cutoff", () => {
    const cutoff = weekCutoffDate("2026-04-23", 1);
    expect(cairoCalendarDate(cutoff)).toBe("2026-04-30");
    expect(cutoff.toISOString()).toBe("2026-04-29T21:00:00.000Z");
  });

  it("resolves Cairo midnight using the timezone rules, not fixed UTC hours", () => {
    expect(cairoCalendarDate(cairoMidnight("2026-04-24"))).toBe("2026-04-24");
    expect(cairoCalendarDate(cairoMidnight("2026-10-30"))).toBe("2026-10-30");
  });

  it("rejects Week 0 and Week 13", () => {
    expect(() => weekStartDate("2026-01-01", 0)).toThrow(RangeError);
    expect(() => weekStartDate("2026-01-01", 13)).toThrow(RangeError);
  });
});
