import { BadRequestException } from "@nestjs/common";

const IANA_ZONE_PATTERN = /^[A-Za-z_]+(?:\/[A-Za-z_]+)*$/;

/** Validates that the supplied string is a plausible IANA timezone identifier
 *  before passing it to the Intl API. This is a syntactic pre-check only;
 *  the Intl.DateTimeFormat constructor below performs the authoritative check. */
function assertValidIanaZone(tz: string): void {
  if (!IANA_ZONE_PATTERN.test(tz)) {
    throw new BadRequestException(
      `PUBLISHING_INVALID_TIMEZONE: "${tz}" is not a valid IANA timezone identifier`,
    );
  }
  try {
    Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw new BadRequestException(
      `PUBLISHING_INVALID_TIMEZONE: "${tz}" is not recognized by the system IANA tzdb`,
    );
  }
}

/**
 * Converts a naive local datetime string (ISO-8601 without offset,
 * e.g. "2026-09-01T14:00:00") plus an IANA timezone to a UTC Date.
 *
 * DST edge-case rules (deterministic, not left to library defaults):
 * - Nonexistent local time (spring-forward gap) → throws (rejects the schedule)
 * - Ambiguous local time (fall-back overlap)    → uses the EARLIER UTC offset
 *
 * @param localIso  e.g. "2026-09-01T14:00:00" — no offset suffix
 * @param tz        IANA zone string, e.g. "Africa/Cairo"
 * @returns UTC Date
 */
export function localToUtc(localIso: string, tz: string): Date {
  assertValidIanaZone(tz);

  // Parse the naive local components
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(localIso);
  if (!m) {
    throw new BadRequestException(
      "PUBLISHING_INVALID_SCHEDULE: localIso must be ISO-8601 without offset",
    );
  }
  const [, year, month, day, hour, minute, second] = m.map(Number);

  // Strategy: construct a UTC guess by interpreting the local time as UTC,
  // then shift by the timezone offset. We do this twice ± 1 hour to detect
  // spring-forward gaps and fall-back ambiguity.

  const getCandidateOffset = (guessMs: number): number => {
    const d = new Date(guessMs);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)!.value, 10);
    const localMs = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    );
    return guessMs - localMs; // offset = utcMs - localMs
  };

  // Initial guess: treat the local time as UTC (offset = 0)
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  // Sample the offset at two points around our target to detect transitions
  const offsetAt = getCandidateOffset(naiveUtcMs);
  const offsetMinus = getCandidateOffset(naiveUtcMs - 60 * 60 * 1000); // 1h before
  const offsetPlus = getCandidateOffset(naiveUtcMs + 60 * 60 * 1000); // 1h after

  // Compute candidate UTC by applying the offset
  const utcMs = naiveUtcMs + offsetAt;

  // Verify the round-trip: convert utcMs back to local — if it differs from
  // the input local time, we're in a gap (nonexistent time → reject) or
  // ambiguous time. We pick the candidate that round-trips correctly using
  // the EARLIER offset (fall-back: prefer offsetMinus which is the STD offset).
  const roundTripOffset = getCandidateOffset(utcMs);

  if (roundTripOffset !== offsetAt) {
    // Possible gap or ambiguity — try the earlier-offset candidate
    const utcMsEarly = naiveUtcMs + offsetMinus;
    const rtEarly = getCandidateOffset(utcMsEarly);

    if (rtEarly !== offsetMinus) {
      // Neither candidate round-trips — this local time is nonexistent (DST gap).
      // This is a malformed schedule, NOT a past-time — use INVALID_SCHEDULE
      // so the API layer can tell "bad input" from "already due".
      throw new BadRequestException(
        `PUBLISHING_INVALID_SCHEDULE: The local time "${localIso}" in zone "${tz}" ` +
          `falls in a DST gap and does not exist — please choose a valid time`,
      );
    }
    // Ambiguous time: use the EARLIER UTC offset (documented rule)
    return new Date(utcMsEarly);
  }

  return new Date(utcMs);
}

/** Formats a UTC Date as a Cairo-local ISO string (naive, no offset suffix).
 *  Used in API responses to display both timestamps consistently. */
export function utcToCairoLocalIso(utcDate: Date, tz = "Africa/Cairo"): string {
  assertValidIanaZone(tz);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(utcDate);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const h = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${h}:${get("minute")}:${get("second")}`;
}

/** Returns true if the supplied UTC instant is in the past relative to now. */
export function isInPast(utcDate: Date): boolean {
  return utcDate.getTime() <= Date.now();
}
