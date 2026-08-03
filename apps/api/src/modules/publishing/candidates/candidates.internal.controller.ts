import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { CandidatesService } from "./candidates.service";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";

/**
 * INTERNAL candidate ingestion endpoint — the authoritative content-service
 * handoff boundary.
 *
 * Route: `POST /internal/v1/publishing/candidates/ingest`
 *
 * Authentication: the `InternalAuthGuard` (a SEPARATE shared bearer token in
 * the `x-publishing-internal-token` header), NOT an owner browser JWT and NOT
 * the n8n HMAC secret. An owner JWT can never reach this route.
 *
 * The body is a frozen content-service event
 * (`IngestPublicationCandidateEventRequestV1`: created or state-changed). The
 * service reduces it with `reducePublicationCandidateEventV1`, which validates
 * the envelope, dedups by event fingerprint, enforces strictly-increasing
 * state_version, and binds candidate identity/checksum. The raw body is
 * accepted (no DTO whitelist) precisely so the frozen reducer — not NestJS
 * class-validator — is the validation authority.
 */
@Controller("internal/v1/publishing/candidates")
@UseGuards(InternalAuthGuard)
export class InternalCandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Post("ingest")
  @HttpCode(200)
  ingest(@Body() event: unknown) {
    return this.candidatesService.ingestEvent(event);
  }
}