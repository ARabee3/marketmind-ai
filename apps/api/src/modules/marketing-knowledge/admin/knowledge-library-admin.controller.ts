import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../rbac/guards/permissions.guard";
import { Permissions } from "../../rbac/decorators/permissions.decorator";
import { PERMISSIONS } from "../../rbac/rbac.constants";
import { AuthenticatedUser } from "../../auth/interfaces/jwt-payload.interface";
import { KnowledgeLibraryAdminService } from "./knowledge-library-admin.service";
import { ListLibraryEntriesQueryDto } from "./dto/list-library-entries-query.dto";

/**
 * Admin endpoints for the curated marketing knowledge library (issue #252
 * item 5).
 *
 * Authorization: a valid access token (JwtAuthGuard) PLUS the
 * `admin:manage_library` permission (PermissionsGuard). This permission was
 * declared in rbac.constants.ts but never enforced on any route — these
 * endpoints are the enforcement surface. Only the `admin` role holds it
 * (ROLE_PERMISSIONS), so owners and demo developers cannot review, approve,
 * reject, or trigger ingestion.
 *
 * Safety: nothing here introduces new knowledge content. Approve promotes an
 * existing draft to an immutable approved version (verbatim content, added
 * reviewer metadata). Reject retires the draft. Ingest records a real
 * ingestion-run request on the existing pipeline (the AI-service CLI executes
 * the validated corpus ingestion) — no fabricated or simulated entries.
 */
@Controller("admin/library")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(PERMISSIONS.ADMIN_MANAGE_LIBRARY)
export class KnowledgeLibraryAdminController {
  constructor(
    private readonly libraryService: KnowledgeLibraryAdminService,
  ) {}

  /** List knowledge entries with their latest (reviewable) version. */
  @Get("entries")
  async listEntries(@Query() query: ListLibraryEntriesQueryDto) {
    return this.libraryService.listEntries(query);
  }

  /** Detail for one entry including every immutable version + sources. */
  @Get("entries/*slug")
  async getEntry(@Param("slug") slug: string | string[]) {
    return this.libraryService.getEntry(toSlugString(slug));
  }

  /** Approve the current draft — promotes it to an immutable approved version. */
  @Post("entries/*slug/approve")
  async approve(
    @Param("slug") slug: string | string[],
    @Req() req: Request,
  ) {
    const actor = req.user as AuthenticatedUser;
    return this.libraryService.approveDraft(toSlugString(slug), {
      id: actor.id,
      email: actor.email,
    });
  }

  /** Reject the current draft — retires it (no separate "rejected" status). */
  @Post("entries/*slug/reject")
  async reject(@Param("slug") slug: string | string[], @Req() req: Request) {
    const actor = req.user as AuthenticatedUser;
    return this.libraryService.rejectDraft(toSlugString(slug), {
      id: actor.id,
      email: actor.email,
    });
  }

  /** Trigger a validated ingestion run on the existing corpus pipeline. */
  @Post("ingest")
  async triggerIngest(@Req() req: Request) {
    const actor = req.user as AuthenticatedUser;
    return this.libraryService.triggerIngestion({
      id: actor.id,
      email: actor.email,
    });
  }

  /** Recent ingestion run history for the admin console. */
  @Get("ingestion-runs")
  async listIngestionRuns(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? "1", 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize ?? "20", 10) || 20));
    return this.libraryService.listIngestionRuns(p, ps);
  }
}

/**
 * The `*slug` wildcard captures each slash-separated segment as an array
 * element; knowledge slugs contain slashes (e.g. `benchmark/ramadan-cpc`), so
 * they are rejoined here before reaching the repository.
 */
function toSlugString(slug: string | string[]): string {
  return Array.isArray(slug) ? slug.join("/") : slug;
}