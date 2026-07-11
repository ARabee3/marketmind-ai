import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { getExternalText } from "../../../common/http/external-http-client";
import type { SearchResultCandidate } from "./search-result.types";

const SOURCE_ENRICHMENT_MAX_BODY_BYTES = 256 * 1024;
const MAX_ENRICHED_RESULTS = 5;
const MAX_SNIPPET_LENGTH = 900;
const MAX_VISIBLE_EXCERPT_LENGTH = 500;

type SourceEnrichment = {
  readonly title?: string;
  readonly description?: string;
  readonly og_title?: string;
  readonly og_description?: string;
  readonly og_site_name?: string;
  readonly canonical_url?: string;
  readonly visible_text_excerpt?: string;
  readonly content_hints: readonly string[];
};

@Injectable()
export class SourceEnrichmentService {
  async enrich(
    results: readonly SearchResultCandidate[],
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]> {
    const enriched: SearchResultCandidate[] = [];
    let enrichedCount = 0;

    for (const result of results) {
      signal?.throwIfAborted();
      if (!result.url || enrichedCount >= MAX_ENRICHED_RESULTS) {
        enriched.push(result);
        continue;
      }

      enriched.push(await this.enrichResult(result, signal));
      enrichedCount += 1;
    }

    return enriched;
  }

  private async enrichResult(
    result: SearchResultCandidate,
    signal?: AbortSignal,
  ): Promise<SearchResultCandidate> {
    try {
      const html = await getExternalText(result.url ?? "", {
        timeoutMs: externalProviderConfig().discoverySearchTimeoutMs,
        validateUrl: true,
        maxBodyBytes: SOURCE_ENRICHMENT_MAX_BODY_BYTES,
        signal,
      });
      const enrichment = extractSourceEnrichment(html);
      const status = hasEnrichment(enrichment) ? "complete" : "empty";

      return {
        ...result,
        title: result.title ?? enrichment.title ?? enrichment.og_title,
        snippet: enrichedSnippet(result.snippet, enrichment),
        metadata: {
          ...(result.metadata ?? {}),
          enrichment_status: status,
          enriched_title: enrichment.title,
          enriched_description: enrichment.description,
          og_title: enrichment.og_title,
          og_description: enrichment.og_description,
          og_site_name: enrichment.og_site_name,
          canonical_url: enrichment.canonical_url,
          visible_text_excerpt: enrichment.visible_text_excerpt,
          content_hints: enrichment.content_hints,
        },
      };
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof Error)) {
        throw error;
      }

      return {
        ...result,
        metadata: {
          ...(result.metadata ?? {}),
          enrichment_status: "failed",
          enrichment_error_code: "SOURCE_ENRICHMENT_FAILED",
          enrichment_error_message: "Source enrichment failed.",
        },
      };
    }
  }
}

export function extractSourceEnrichment(html: string): SourceEnrichment {
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const visibleText = visibleTextExcerpt(html);

  return {
    title,
    description: metaContent(html, "description"),
    og_title: metaContent(html, "og:title"),
    og_description: metaContent(html, "og:description"),
    og_site_name: metaContent(html, "og:site_name"),
    canonical_url: canonicalUrl(html),
    visible_text_excerpt: visibleText,
    content_hints: contentHints(visibleText ?? ""),
  };
}

function enrichedSnippet(
  snippet: string | undefined,
  enrichment: SourceEnrichment,
): string | undefined {
  const values = [
    snippet,
    enrichment.description,
    enrichment.og_description,
    enrichment.visible_text_excerpt,
  ].filter((value): value is string => Boolean(value));
  const uniqueValues = [...new Set(values)];
  const combined = uniqueValues.join(" ");

  return combined ? combined.slice(0, MAX_SNIPPET_LENGTH) : undefined;
}

function hasEnrichment(enrichment: SourceEnrichment): boolean {
  return Boolean(
    enrichment.title ??
      enrichment.description ??
      enrichment.og_title ??
      enrichment.og_description ??
      enrichment.og_site_name ??
      enrichment.canonical_url ??
      enrichment.visible_text_excerpt,
  );
}

function metaContent(html: string, key: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const normalizedKey = key.toLowerCase();

  for (const tag of tags) {
    const tagKey = (
      attrValue(tag, "name") ?? attrValue(tag, "property")
    )?.toLowerCase();
    if (tagKey !== normalizedKey) {
      continue;
    }

    const content = cleanText(attrValue(tag, "content"));
    if (content) {
      return content;
    }
  }

  return undefined;
}

function canonicalUrl(html: string): string | undefined {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];

  for (const link of links) {
    if (attrValue(link, "rel")?.toLowerCase() !== "canonical") {
      continue;
    }

    const href = cleanText(attrValue(link, "href"));
    if (href) {
      return href;
    }
  }

  return undefined;
}

function visibleTextExcerpt(html: string): string | undefined {
  return cleanText(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )?.slice(0, MAX_VISIBLE_EXCERPT_LENGTH);
}

function contentHints(text: string): readonly string[] {
  const normalized = text.toLowerCase();
  const hints: string[] = [];

  if (/\bmenu\b|منيو|قائمة/.test(normalized)) {
    hints.push("menu");
  }
  if (/\boffer\b|\boffers\b|\bdiscount\b|عرض|عروض|خصم/.test(normalized)) {
    hints.push("offer");
  }
  if (/\bdelivery\b|\bdeliver\b|توصيل|دليفري/.test(normalized)) {
    hints.push("delivery");
  }
  if (/\breserv/.test(normalized) || /حجز/.test(normalized)) {
    hints.push("reservation");
  }
  if (/\bcontact\b|\bphone\b|تواصل|هاتف|رقم/.test(normalized)) {
    hints.push("contact");
  }

  return hints;
}

function attrValue(tag: string, attr: string): string | undefined {
  const pattern = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1];
}

function cleanText(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || undefined;
}
