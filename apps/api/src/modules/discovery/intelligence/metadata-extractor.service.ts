import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { getExternalText } from "../../../common/http/external-http-client";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import {
  IntelligenceObservationCandidate,
  IntelligenceSourceCandidate,
} from "./intelligence.types";

const METADATA_MAX_BODY_BYTES = 256 * 1024;

export type MetadataExtractionResult = {
  readonly source_refs: readonly IntelligenceSourceCandidate[];
  readonly research_observations: readonly IntelligenceObservationCandidate[];
};

@Injectable()
export class MetadataExtractorService {
  async extract(dto: StartDiscoveryDto): Promise<MetadataExtractionResult> {
    const links = dto.intake.social_links ?? [];
    const sources: IntelligenceSourceCandidate[] = [];
    const observations: IntelligenceObservationCandidate[] = [];

    for (const link of links) {
      const sourceIndex = sources.length;
      const source = await this.extractLink(link.platform, link.url);
      sources.push(source);
      observations.push({
        kind: "social_signal",
        statement:
          source.snippet ??
          source.title ??
          `Owner provided ${link.platform} link.`,
        source_index: sourceIndex,
        confidence: source.confidence,
        visibility: "internal",
        metadata: {
          platform: link.platform,
          owner_submitted: true,
        },
      });
    }

    return {
      source_refs: sources,
      research_observations: observations,
    };
  }

  private async extractLink(
    platform: string,
    url: string,
  ): Promise<IntelligenceSourceCandidate> {
    const fetchedAt = new Date().toISOString();

    try {
      const html = await getExternalText(url, {
        timeoutMs: externalProviderConfig().discoverySearchTimeoutMs,
        validateUrl: true,
        maxBodyBytes: METADATA_MAX_BODY_BYTES,
      });
      const metadata = extractPageMetadata(html);

      return {
        source_type: "owner_link",
        platform,
        url,
        title: metadata.title,
        snippet: metadata.description,
        fetched_at: fetchedAt,
        confidence: metadata.title || metadata.description ? 0.75 : 0.55,
        metadata: {
          owner_submitted: true,
          metadata_fetch_status: "complete",
        },
      };
    } catch (error) {
      return {
        source_type: "owner_link",
        platform,
        url,
        fetched_at: fetchedAt,
        confidence: 0.45,
        metadata: {
          owner_submitted: true,
          metadata_fetch_status: "failed",
          error_message:
            error instanceof Error ? error.message : "Metadata fetch failed.",
        },
      };
    }
  }
}

export function extractPageMetadata(html: string): {
  readonly title?: string;
  readonly description?: string;
} {
  return {
    title: cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]),
    description: metaDescription(html),
  };
}

function metaDescription(html: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const key = (
      attrValue(tag, "name") ?? attrValue(tag, "property")
    )?.toLowerCase();
    if (key !== "description" && key !== "og:description") {
      continue;
    }

    const content = cleanText(attrValue(tag, "content"));
    if (content) {
      return content;
    }
  }

  return undefined;
}

function attrValue(tag: string, attr: string): string | undefined {
  const pattern = new RegExp(`${attr}=["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1];
}

function cleanText(value: string | undefined): string | undefined {
  return value
    ?.replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
