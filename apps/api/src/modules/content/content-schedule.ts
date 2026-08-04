const CAIRO_TIMEZONE = "Africa/Cairo" as const;
export const CONTENT_WEEK_COUNT = 12 as const;

function assertWeekNumber(weekNumber: number): void {
  if (
    !Number.isInteger(weekNumber) ||
    weekNumber < 1 ||
    weekNumber > CONTENT_WEEK_COUNT
  ) {
    throw new RangeError(
      `Content week must be between 1 and ${CONTENT_WEEK_COUNT}.`,
    );
  }
}

function toIsoDate(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new RangeError(`Invalid Cairo calendar date: ${iso}`);
  }
  return iso;
}

/** Adds calendar days without adding fixed UTC milliseconds across DST. */
export function addCairoCalendarDays(
  isoDate: string | Date,
  days: number,
): string {
  if (!Number.isInteger(days)) {
    throw new RangeError("Calendar-day offset must be an integer.");
  }
  const date = new Date(`${toIsoDate(isoDate)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Week N starts exactly 7 * (N - 1) Cairo calendar days after Week 1. */
export function weekStartDate(
  week1StartDate: string | Date,
  weekNumber: number,
): string {
  assertWeekNumber(weekNumber);
  return addCairoCalendarDays(week1StartDate, 7 * (weekNumber - 1));
}

/** The generation cutoff is the Cairo start of the following week. */
export function weekCutoffDate(
  week1StartDate: string | Date,
  weekNumber: number,
): Date {
  assertWeekNumber(weekNumber);
  const nextWeekStart =
    weekNumber === CONTENT_WEEK_COUNT
      ? addCairoCalendarDays(weekStartDate(week1StartDate, weekNumber), 7)
      : weekStartDate(week1StartDate, weekNumber + 1);
  return cairoMidnight(nextWeekStart);
}

/** Converts a Cairo local calendar midnight to its UTC instant. */
export function cairoMidnight(isoDate: string): Date {
  const target = toIsoDate(isoDate);
  let candidate = Date.UTC(
    Number(target.slice(0, 4)),
    Number(target.slice(5, 7)) - 1,
    Number(target.slice(8, 10)) - 1,
    20,
  );

  for (let hour = 0; hour < 8; hour += 1) {
    const instant = new Date(candidate + hour * 60 * 60 * 1000);
    if (cairoCalendarDate(instant) === target) {
      // If Cairo skips local 00:00 at a DST transition, return the first
      // instant in the requested calendar date rather than drifting to the
      // previous date or adding a fixed UTC offset.
      return instant;
    }
  }

  throw new RangeError(`Could not resolve Cairo midnight for ${target}.`);
}

export function cairoCalendarDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new RangeError(
      `Could not format Cairo date for ${date.toISOString()}.`,
    );
  }
  return `${year}-${month}-${day}`;
}
