/**
 * publishingPriorityFor unit tests.
 */

import { publishingPriorityFor } from "../publishing-priority.util";

const NOW = new Date("2026-08-05T12:00:00.000Z");

describe("publishingPriorityFor", () => {
  it("returns 0 for an overdue intent", () => {
    expect(publishingPriorityFor(new Date(NOW.getTime() - 5_000), NOW)).toBe(0);
  });

  it("returns 1 for a job due within the next hour", () => {
    expect(publishingPriorityFor(new Date(NOW.getTime() + 10 * 60_000), NOW)).toBe(1);
  });

  it("returns 2 for a job due within 6 hours", () => {
    expect(publishingPriorityFor(new Date(NOW.getTime() + 3 * 60 * 60_000), NOW)).toBe(2);
  });

  it("returns 3 for a job due within 24 hours", () => {
    expect(publishingPriorityFor(new Date(NOW.getTime() + 12 * 60 * 60_000), NOW)).toBe(3);
  });

  it("returns 4 for a job due later than 24 hours", () => {
    expect(publishingPriorityFor(new Date(NOW.getTime() + 30 * 60 * 60_000), NOW)).toBe(4);
  });

  it("returns 4 when no scheduled time is present", () => {
    expect(publishingPriorityFor(null, NOW)).toBe(4);
  });
});