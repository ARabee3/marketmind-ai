import { localToUtc, isInPast } from "../cairo-time.util";
import { BadRequestException } from "@nestjs/common";

describe("Cairo time utilities", () => {
  describe("localToUtc", () => {
    it("converts a standard Cairo summer time (UTC+3) correctly", () => {
      // Egypt reintroduced DST in 2023, so Sept is UTC+3 → 14:00 Cairo = 11:00 UTC
      const utc = localToUtc("2026-09-01T14:00:00", "Africa/Cairo");
      expect(utc.getUTCHours()).toBe(11);
      expect(utc.getUTCMinutes()).toBe(0);
    });

    it("converts correctly for UTC+3 (Asia/Riyadh) as a sanity cross-check", () => {
      const utc = localToUtc("2026-09-01T15:00:00", "Asia/Riyadh");
      // 15:00 Riyadh = 12:00 UTC
      expect(utc.getUTCHours()).toBe(12);
    });

    it("rejects an invalid timezone string", () => {
      expect(() => localToUtc("2026-09-01T14:00:00", "Not/ATimezone")).toThrow(
        BadRequestException,
      );
    });

    it("rejects a malformed localIso string (has offset)", () => {
      expect(() =>
        localToUtc("2026-09-01T14:00:00+03:00", "Africa/Cairo"),
      ).toThrow(BadRequestException);
    });

    it("round-trips: converting to UTC and back gives the same local time", () => {
      const localIso = "2026-03-15T10:30:00";
      const tz = "Africa/Cairo";
      const utc = localToUtc(localIso, tz);

      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(utc);
      const get = (type: string) => parts.find((p) => p.type === type)!.value;
      const roundTripped = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
      expect(roundTripped).toBe(localIso);
    });
  });

  describe("isInPast", () => {
    it("returns true for a time one second ago", () => {
      const past = new Date(Date.now() - 1000);
      expect(isInPast(past)).toBe(true);
    });

    it("returns false for a time one hour in the future", () => {
      const future = new Date(Date.now() + 3_600_000);
      expect(isInPast(future)).toBe(false);
    });
  });
});
