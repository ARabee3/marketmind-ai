import {
  BadRequestException,
  Body,
  Controller,
  Get,
  GoneException,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { IsNotEmpty, IsString } from "class-validator";
import { ContentAssetReader } from "../assets/content-asset.reader";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";
import { MetaProviderExecutor } from "./meta-provider.executor";
import { MediaFetchTokenService } from "./media-fetch-token.service";

/** Runner→API executor request (issue #175): opaque identifiers only — the
 *  runner never sends or receives credential material. */
export class ExecuteMetaDto {
  @IsString()
  @IsNotEmpty()
  attempt_id!: string;

  @IsString()
  @IsNotEmpty()
  intent_id!: string;

  @IsString()
  @IsNotEmpty()
  target_id!: string;
}

/**
 * Internal runner boundary — private API-owned Meta provider executor.
 *
 * The n8n workflow's real-mode adapter calls this endpoint instead of reading
 * a token from its environment. The executor resolves the exact target's vault
 * credential, performs the provider publish, and returns a sanitized
 * `publication-result-v1`. Authenticated with the shared internal service
 * token (never an owner JWT, never a customer credential).
 */
@Controller("internal/v1/publishing/execute-meta")
@UseGuards(InternalAuthGuard)
export class MetaExecutorController {
  constructor(private readonly executor: MetaProviderExecutor) {}

  @Post()
  run(@Body() dto: ExecuteMetaDto): Promise<{ result: unknown }> {
    return this.executor.execute({
      attemptId: dto.attempt_id,
      intentId: dto.intent_id,
      targetId: dto.target_id,
    });
  }
}

/**
 * Short-lived provider-fetch media route (issue #175).
 *
 * PUBLIC by design: Meta's Graph API fetches `image_url` without any headers,
 * so authenticity lives in the HMAC query token bound to the exact attempt +
 * asset and expiring quickly (PUBLISHING_MEDIA_FETCH_TTL_MS). Serves the
 * immutable checksum-addressed bytes from the same Content-backed storage
 * reader the dispatch-time integrity validator trusts.
 */
@Controller("internal/v1/publishing/media-fetch")
export class MediaFetchController {
  constructor(
    private readonly reader: ContentAssetReader,
    private readonly tokens: MediaFetchTokenService,
  ) {}

  @Get(":assetId")
  async getAsset(
    @Param("assetId") assetId: string,
    @Query("token") token: string | undefined,
    @Query("attempt") attemptId: string | undefined,
    @Query("exp") exp: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!token || !attemptId || !exp) {
      throw new BadRequestException(
        "PUBLISHING_ASSET_UNAVAILABLE: missing token",
      );
    }
    const expMs = Number(exp);
    if (
      !Number.isFinite(expMs) ||
      !this.tokens.verify({ token, attemptId, assetId, expMs })
    ) {
      throw new GoneException(
        "PUBLISHING_ASSET_UNAVAILABLE: provider-fetch token invalid or expired",
      );
    }
    const record = await this.reader.readAssetById(assetId);
    if (!record) {
      throw new NotFoundException(
        "PUBLISHING_ASSET_UNAVAILABLE: unknown asset",
      );
    }
    res.setHeader("Content-Type", record.mimeType);
    res.setHeader("X-Publishing-Asset-Checksum", record.checksum);
    // Private cache: the URL is attempt-bound; a shared cache could leak the
    // token to other tenants via the same URL.
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(record.bytes);
  }
}
