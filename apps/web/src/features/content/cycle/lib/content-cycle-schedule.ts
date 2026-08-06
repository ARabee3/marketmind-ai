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
    throw new Error("Invalid Strategy start date");
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
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(cairoLocalStr);
  if (!match) {
    throw new Error("Invalid datetime-local format");
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const y = Number(yearStr);
  const m = Number(monthStr);
  const d = Number(dayStr);
  const h = Number(hourStr);
  const min = Number(minuteStr);
  const targetUtcMs = Date.UTC(y, m - 1, d, h, min);

  // Reject impossible calendar values before asking Intl for a zone offset.
  const calendarCheck = new Date(targetUtcMs);
  if (
    calendarCheck.getUTCFullYear() !== y ||
    calendarCheck.getUTCMonth() + 1 !== m ||
    calendarCheck.getUTCDate() !== d ||
    calendarCheck.getUTCHours() !== h ||
    calendarCheck.getUTCMinutes() !== min
  ) {
    throw new Error("Invalid date components");
  }

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

  // Iterate because the applicable offset can change at the local time being
  // resolved (for example, at an Egypt daylight-saving transition).
  let candidateMs = targetUtcMs;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidateMs));
    const cy = Number(parts.find((p) => p.type === "year")?.value ?? "0");
    const cm = Number(parts.find((p) => p.type === "month")?.value ?? "0");
    const cd = Number(parts.find((p) => p.type === "day")?.value ?? "0");
    let ch = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    if (ch === 24) ch = 0;
    const cmin = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const cairoAsUtcMs = Date.UTC(cy, cm - 1, cd, ch, cmin);
    const offsetMs = cairoAsUtcMs - candidateMs;
    const nextCandidateMs = targetUtcMs - offsetMs;
    if (nextCandidateMs === candidateMs) break;
    candidateMs = nextCandidateMs;
  }

  const realUtc = new Date(candidateMs);
  if (isoToCairoLocalString(realUtc.toISOString()) !== cairoLocalStr) {
    throw new Error("Local time does not exist in Africa/Cairo");
  }
  return realUtc.toISOString();
}
