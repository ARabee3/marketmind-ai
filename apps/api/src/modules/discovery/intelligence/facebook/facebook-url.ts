const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "mobile.facebook.com",
]);

const BLOCKED_PATH_SEGMENTS = new Set([
  "events",
  "groups",
  "marketplace",
  "people",
  "permalink.php",
  "photo.php",
  "photos",
  "posts",
  "profile.php",
  "reel",
  "reels",
  "share",
  "sharer",
  "story.php",
  "stories",
  "videos",
  "watch",
]);
const MAX_PATH_SEGMENT_DECODE_ATTEMPTS = 10;

export function normalizeFacebookPageUrl(rawUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    !FACEBOOK_HOSTS.has(url.hostname.toLowerCase())
  ) {
    return null;
  }

  const segments = decodedSegments(url.pathname);
  if (
    segments === null ||
    segments.length !== 1 ||
    segments.some((segment) => BLOCKED_PATH_SEGMENTS.has(segment))
  ) {
    return null;
  }

  const path = url.pathname.replace(/\/+$/, "");
  return `https://facebook.com${path}`;
}

function decodedSegments(pathname: string): readonly string[] | null {
  const segments: string[] = [];

  for (const segment of pathname.split("/").filter(Boolean)) {
    const decoded = decodePathSegment(segment);
    if (decoded === null) {
      return null;
    }
    segments.push(decoded.toLowerCase());
  }

  return segments;
}

function decodePathSegment(segment: string): string | null {
  let decoded = segment;

  for (
    let attempt = 0;
    attempt < MAX_PATH_SEGMENT_DECODE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        return /[/\\?#]/.test(decoded) ? null : decoded;
      }
      decoded = next;
    } catch {
      return null;
    }
  }

  return null;
}
