import {
  Controller,
  Get,
  GoneException,
  Logger,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { PublishingAssetStore } from "./publishing-asset.store";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";

/**
 * INTERNAL asset-serving route — the #121 boundary that the frozen dispatch
 * envelope's `assets[].retrieval_url` points at.
 *
 * Route: `GET /internal/v1/publishing/assets/:id`
 *
 * Authentication: the `InternalAuthGuard` (shared `x-publishing-internal-token`
 * bearer), NOT an owner JWT and NOT the n8n HMAC secret. An owner browser can
 * never reach this route. n8n's real-adapter fetch node sends the internal
 * token header when it pulls the committed media bytes.
 *
 * The route serves the raw immutable bytes with the manifest's `Content-Type`
 * and proves them against the committed SHA-256 at store load time (the store
 * excludes any asset whose on-disk digest drifted). `retrieval_expires_at` is
 * carried in the signed dispatch body and verified by the runner before the
 * fetch; the optional `exp` query is a defence-in-depth time-box (410 when
 * past) and is not the primary gate — the internal token is.
 */
@Controller("internal/v1/publishing/assets")
@UseGuards(InternalAuthGuard)
export class AssetsController {
  private readonly logger = new Logger(AssetsController.name);

  constructor(private readonly store: PublishingAssetStore) {}

  @Get(":id")
  getAsset(
    @Param("id") id: string,
    @Query("exp") exp: string | undefined,
    @Res() res: Response,
  ): void {
    if (exp !== undefined) {
      const expMs = Date.parse(exp);
      if (Number.isNaN(expMs)) {
        throw new GoneException("PUBLISHING_ASSET_UNAVAILABLE: invalid exp");
      }
      if (expMs < Date.now()) {
        throw new GoneException(
          "PUBLISHING_ASSET_UNAVAILABLE: retrieval window expired",
        );
      }
    }
    const record = this.store.getAsset(id);
    if (!record) {
      throw new NotFoundException("PUBLISHING_ASSET_UNAVAILABLE: unknown asset");
    }
    res.setHeader("Content-Type", record.mimeType);
    res.setHeader(
      "X-Publishing-Asset-Checksum",
      record.checksum,
    );
    res.send(record.bytes);
  }
}