import {
  Injectable,
  Logger,
  UnprocessableEntityException,
  Inject,
} from "@nestjs/common";
import {
  validateRetrievedPublicationAssetsV1,
  type RetrievedPublicationAssetV1,
  type PublishingValidationResult,
} from "@marketmind/contracts";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";

/**
 * Contract shape of the asset metadata embedded in a frozen
 * PublicationCandidateV1 payload (the `assets` array). The dispatch hook reads
 * expected asset_id / mime_type / checksum from here and proves the retrieved
 * bytes match the approved SHA-256 digests before any provider call.
 */
export interface CandidateAssetMetadata {
  readonly asset_id: string;
  readonly mime_type: string;
  readonly checksum: string;
}

/**
 * Pluggable retrieval boundary for the immutable candidate media bytes.
 *
 * Real byte retrieval (object storage / signed URL fetch) is owned by
 * Publishing issue #121 (adapters and fallbacks). This interface is the seam
 * #119 depends on: the dispatch processor asks the retriever for the bytes
 * matching the approved asset ids, then proves them against the candidate
 * checksums via the frozen {@link validateRetrievedPublicationAssetsV1}.
 *
 * The default implementation below throws `PUBLISHING_ASSET_UNAVAILABLE`,
 * which is the HONEST behaviour until #121 supplies real retrieval: per
 * PUBLISHING_AUTOMATION_ARCHITECTURE.md §10.1, "the issue does not fake a
 * real success" when media retrieval is not ready, so real dispatch is blocked
 * rather than circumvented. Export and simulation modes never call this
 * retriever. Tests inject a fake retriever to prove the tamper/match paths.
 */
export interface AssetByteRetriever {
  retrieve(
    assetIds: readonly string[],
  ): Promise<readonly RetrievedPublicationAssetV1[]>;
}

/**
 * DI token for the pluggable {@link AssetByteRetriever}. Interfaces are erased
 * at runtime, so NestJS resolves this injection by a stable symbol token rather
 * than by type. #121 binds a real S3/object-storage retriever to this token.
 */
export const ASSET_BYTE_RETRIEVER = Symbol("ASSET_BYTE_RETRIEVER");

/**
 * Default retriever: real byte retrieval is not available until #121 lands.
 * Throws `PUBLISHING_ASSET_UNAVAILABLE` so real dispatch is blocked honestly
 * (never faked) when no retriever has been configured.
 */
@Injectable()
export class NullAssetByteRetriever implements AssetByteRetriever {
  private readonly logger = new Logger(NullAssetByteRetriever.name);
  async retrieve(
    assetIds: readonly string[],
  ): Promise<readonly RetrievedPublicationAssetV1[]> {
    this.logger.warn(
      `Asset byte retrieval requested for ${assetIds.length} asset(s) but no retriever is configured (#121 pending) — real dispatch blocked`,
    );
    throw new UnprocessableEntityException(
      `${PublishingErrorCode.ASSET_UNAVAILABLE}: asset byte retrieval is not configured for this environment`,
    );
  }
}

/**
 * Dispatch-time asset integrity boundary (issue #119 / §9.2 check #8).
 *
 * Extracts the expected immutable asset metadata from a frozen candidate
 * payload, retrieves the matching bytes via {@link AssetByteRetriever}, and
 * runs the frozen {@link validateRetrievedPublicationAssetsV1} contract
 * validator to prove every retrieved byte matches its approved SHA-256 digest
 * (matching IDs or checksum strings alone never authorize a provider call).
 *
 * On any validation issue this throws a stable, sanitized publishing error:
 *  - missing/unavailable bytes  → PUBLISHING_ASSET_UNAVAILABLE
 *  - mime mismatch / checksum drift / duplicate id → PUBLISHING_ASSET_TAMPERED
 * Secrets and full bytes are never logged — only the issue codes/fields.
 */
@Injectable()
export class AssetIntegrityValidator {
  private readonly logger = new Logger(AssetIntegrityValidator.name);

  constructor(
    @Inject(ASSET_BYTE_RETRIEVER)
    private readonly retriever: AssetByteRetriever,
  ) {}

  /**
   * Reads the expected asset metadata array from a PublicationCandidateV1
   * payload. Returns `[]` when the payload carries no media (e.g. a pure
   * text post), in which case dispatch proceeds without asset checks.
   * Throws PUBLISHING_ASSET_TAMPERED when the payload shape is malformed
   * (the candidate invariant was violated before dispatch).
   */
  static extractExpectedAssets(payload: unknown): CandidateAssetMetadata[] {
    if (payload == null) return [];
    const p = payload as Record<string, unknown>;
    const rawAssets = p["assets"];
    if (rawAssets == null) return [];
    if (!Array.isArray(rawAssets)) {
      throw new UnprocessableEntityException(
        `${PublishingErrorCode.ASSET_TAMPERED}: candidate payload.assets is not an array`,
      );
    }
    return rawAssets.map((raw, index) => {
      const a = raw as Record<string, unknown>;
      if (
        typeof a["asset_id"] !== "string" ||
        typeof a["mime_type"] !== "string" ||
        typeof a["checksum"] !== "string"
      ) {
        throw new UnprocessableEntityException(
          `${PublishingErrorCode.ASSET_TAMPERED}: candidate payload.assets[${index}] is missing asset_id/mime_type/checksum`,
        );
      }
      return {
        asset_id: a["asset_id"] as string,
        mime_type: a["mime_type"] as string,
        checksum: a["checksum"] as string,
      };
    });
  }

  /**
   * Proves retrieved asset bytes match the approved candidate digests before a
   * real provider call. Throws on any issue; returns void on success.
   * Export and simulation paths never invoke this (they have no external call).
   */
  async validateForDispatch(payload: unknown): Promise<void> {
    const expected = AssetIntegrityValidator.extractExpectedAssets(payload);

    // Text-only posts carry no media — nothing to retrieve or hash.
    if (expected.length === 0) return;

    const retrieved = await this.retriever.retrieve(
      expected.map((a) => a.asset_id),
    );

    const result: PublishingValidationResult =
      validateRetrievedPublicationAssetsV1({
        dispatch: { assets: expected },
        retrieved_assets: retrieved,
      });

    if (!result.valid) {
      // Surface the most severe issue as a stable error code. Never log the
      // bytes or full retrieved objects — only codes and field paths.
      const tampered = result.issues.some(
        (i) => i.code === PublishingErrorCode.ASSET_TAMPERED,
      );
      const code = tampered
        ? PublishingErrorCode.ASSET_TAMPERED
        : PublishingErrorCode.ASSET_UNAVAILABLE;
      const first = result.issues[0];
      this.logger.warn(
        `Asset integrity check failed: ${result.issues
          .map((i) => `${i.code}@${i.field}`)
          .join(", ")}`,
      );
      throw new UnprocessableEntityException(
        `${code}: ${first?.message ?? "asset integrity validation failed"}`,
      );
    }
  }
}
