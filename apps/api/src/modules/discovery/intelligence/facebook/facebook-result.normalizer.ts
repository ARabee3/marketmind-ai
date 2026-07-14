import type { SearchResultCandidate } from "../search-result.types";

const MAX_TEXT_LENGTH = 900;

export function normalizeFacebookPageResults(
  response: unknown,
  pageUrl: string,
  actorId: string,
): readonly SearchResultCandidate[] {
  if (!Array.isArray(response)) {
    return [];
  }

  const item = recordValue(response[0]);
  const title = item
    ? firstString(item, ["pageName", "name", "title"])
    : undefined;
  if (!item || !title) {
    return [];
  }

  const categoriesText = textList(item.categories);
  const intro = firstString(item, ["intro", "about", "description"]);
  const address = firstString(item, ["address"]);
  const website = firstString(item, ["website"]);

  return [
    {
      provider: "apify_facebook_pages",
      title,
      url: pageUrl,
      snippet: truncate(
        [intro, categoriesText, address].filter(Boolean).join(" · "),
      ),
      rank: 1,
      query: "owner submitted Facebook Page",
      confidence: 0.8,
      metadata: compactMetadata({
        provider: "apify_facebook_pages",
        actor_id: actorId.replace("~", "/"),
        platform: "facebook",
        owner_submitted: true,
        facebook_page_id: firstString(item, ["pageId", "id"]),
        categories_text: categoriesText,
        address,
        website,
        phone: firstString(item, ["phone"]),
        email: firstString(item, ["email"]),
        followers_count: firstNumber(item, ["followers", "followersCount"]),
        likes_count: firstNumber(item, ["likes", "likesCount"]),
        rating: firstNumber(item, ["rating", "averageRating"]),
        rating_count: firstNumber(item, ["ratingCount", "reviews"]),
        enrichment_status: "complete",
      }),
    },
  ];
}

export function normalizeFacebookPostResults(
  response: unknown,
  pageUrl: string,
  actorId: string,
  maxPosts: number,
): readonly SearchResultCandidate[] {
  if (!Array.isArray(response)) {
    return [];
  }

  return response
    .slice(0, maxPosts)
    .map((value, index) => postCandidate(value, index, pageUrl, actorId))
    .filter((value): value is SearchResultCandidate => value !== undefined);
}

function postCandidate(
  value: unknown,
  index: number,
  pageUrl: string,
  actorId: string,
): SearchResultCandidate | undefined {
  const item = recordValue(value);
  if (!item) {
    return undefined;
  }

  const url = firstString(item, ["postUrl", "url", "facebookUrl"]);
  const text = firstString(item, ["text", "message", "caption"]);
  if (!url || !text) {
    return undefined;
  }

  return {
    provider: "apify_facebook_posts",
    title: `Facebook post ${index + 1}`,
    url,
    snippet: truncate(text),
    rank: index + 1,
    query: "recent owner submitted Facebook Page posts",
    confidence: 0.7,
    metadata: compactMetadata({
      provider: "apify_facebook_posts",
      actor_id: actorId.replace("~", "/"),
      platform: "facebook",
      owner_submitted: true,
      parent_page_url: pageUrl,
      facebook_post_id: firstString(item, ["postId", "id"]),
      published_at: firstString(item, ["timestamp", "time", "date"]),
      reactions_count: firstNumber(item, ["reactions", "reactionsCount"]),
      comments_count: firstNumber(item, ["comments", "commentsCount"]),
      shares_count: firstNumber(item, ["shares", "sharesCount"]),
      enrichment_status: "complete",
    }),
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(
  item: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstNumber(
  item: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function textList(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }
  const values = value
    .filter(
      (item): item is string =>
        typeof item === "string" && Boolean(item.trim()),
    )
    .slice(0, 5);
  return values.length > 0 ? values.join(", ") : undefined;
}

function compactMetadata(
  metadata: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined,
    ),
  );
}

function truncate(value: string): string | undefined {
  const text = value.trim();
  return text ? text.slice(0, MAX_TEXT_LENGTH) : undefined;
}
