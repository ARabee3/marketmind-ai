import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { CandidatesService } from "./candidates.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { BusinessOwnershipGuard } from "../common/guards/business-ownership.guard";

/**
 * Owner-facing candidate routes — READ-ONLY.
 *
 * P1 (#119 review): candidates come from the authoritative content-service
 * handoff (see InternalCandidatesController + reducePublicationCandidateEventV1).
 * An owner JWT MUST NOT be able to invent an approved candidate payload or
 * mutate candidate state, so this controller exposes only list/get. Ingestion
 * lives under /internal/v1/... guarded by InternalAuthGuard.
 */
@Controller("publication-candidates")
@UseGuards(JwtAuthGuard, BusinessOwnershipGuard)
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get()
  list(@Req() req: Record<string, unknown>) {
    const user = req["user"] as { businessId: string };
    return this.candidatesService.listCandidates(user.businessId);
  }

  @Get(":candidateId")
  getOne(
    @Param("candidateId") candidateId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.candidatesService.getCandidate(candidateId, user.businessId);
  }
}