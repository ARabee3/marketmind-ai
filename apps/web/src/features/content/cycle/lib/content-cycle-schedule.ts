const TIMEZONE = "Africa/Cairo";

/**
 * Returns YYYY-MM-DD in Africa/Cairo for a given ISO date or date string.
 */
export function cairoDateFromStrategyStart(startDateStr: string): string {
  const date = new Date(startDateStr);
  if (isNaN(date.getTime())) {
    // Fallback if plain YYYY-MM-DD
    const match = startDateStr.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    return new Date().toISOString().slice(0, 10);
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/**
 * Calculates the week start date (YYYY-MM-DD) for week `weekNumber` (1-based)
 * given the initial week 1 start date string (YYYY-MM-DD).
 */
export function getWeekStartDate(week1StartDate: string, weekNumber: number): string {
  const [yearStr, monthStr, dayStr] = week1StartDate.split("-");
  const year = parseInt(yearStr ?? "1970", 10);
  const month = parseInt(monthStr ?? "1", 10) - 1;
  const day = parseInt(dayStr ?? "1", 10);

  // Use UTC calendar math to add (weekNumber - 1) * 7 days cleanly without DST drift
  const baseUtc = Date.UTC(year, month, day);
  const offsetDays = (weekNumber - 1) * 7;
  const targetUtc = new Date(baseUtc + offsetDays * 86400000);

  const y = targetUtc.getUTCFullYear();
  const m = String(targetUtc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(targetUtc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Converts ISO UTC instant to Cairo local `datetime-local` input format: `YYYY-MM-DDTHH:mm`.
 */
export function isoToCairoLocalString(isoStr: string): string {
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return "";

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  let hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  if (hour === "24") hour = "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Converts a Cairo local `datetime-local` input string (`YYYY-MM-DDTHH:mm`)
 * to an ISO UTC string (`YYYY-MM-DDTHH:mm:ss.000Z`).
 */
export function cairoLocalToIsoString(cairoLocalStr: string): string {
  if (!cairoLocalStr || !cairoLocalStr.includes("T")) {
    throw new Error("Invalid datetime-local format");
  }

  const [datePart, timePart] = cairoLocalStr.split("T");
  const [yearStr, monthStr, dayStr] = (datePart ?? "").split("-");
  const [hourStr, minuteStr] = (timePart ?? "").split(":");

  const y = parseInt(yearStr ?? "0", 10);
  const m = parseInt(monthStr ?? "0", 10);
  const d = parseInt(dayStr ?? "0", 10);
  const h = parseInt(hourStr ?? "0", 10);
  const min = parseInt(minuteStr ?? "0", 10);

  if (!y || !m || !d) {
    throw new Error("Invalid date components");
  }

  // To find the UTC instant corresponding to local Cairo time:
  // We approximate UTC using a dummy Date object and calculate the Cairo offset at that date.
  const targetUtcGuess = new Date(Date.UTC(y, m - 1, d, h, min));

  // Determine current Cairo offset for this guess
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(targetUtcGuess);
  const cy = parseInt(parts.find((p) => p.type === "year")?.value ?? "0", 10);
  const cm = parseInt(parts.find((p) => p.type === "month")?.value ?? "0", 10);
  const cd = parseInt(parts.find((p) => p.type === "day")?.value ?? "0", 10);
  let ch = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  if (ch === 24) ch = 0;
  const cmin = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

  const cairoAsUtcMs = Date.UTC(cy, cm - 1, cd, ch, cmin);
  const diffMs = cairoAsUtcMs - targetUtcGuess.getTime();

  // Subtract Cairo offset from local time to get real UTC
  const realUtc = new Date(targetUtcGuess.getTime() - diffMs);
  return realUtc.toISOString();
}
