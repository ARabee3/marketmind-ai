import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CandidatesService } from "./candidates.service";
import { IngestCandidateDto, UpdateCandidateStateDto } from "./candidates.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { BusinessOwnershipGuard } from "../common/guards/business-ownership.guard";

@Controller("publication-candidates")
@UseGuards(JwtAuthGuard, BusinessOwnershipGuard)
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  /** Ingest a candidate from the content pipeline.
   *  businessId is taken from the authenticated owner session, NOT the body —
   *  the body field is ignored to prevent cross-tenant injection (issue #119 G10). */
  @Post()
  async ingest(
    @Body() dto: IngestCandidateDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId?: string };
    return this.candidatesService.ingestCandidate({
      ...dto,
      businessId: user.businessId!,
    });
  }

  @Get()
  async list(@Req() req: Record<string, unknown>) {
    const user = req["user"] as { businessId?: string };
    return this.candidatesService.listCandidates(user.businessId!);
  }

  @Get(":candidateId")
  async getOne(
    @Param("candidateId") candidateId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId?: string };
    return this.candidatesService.getCandidate(candidateId, user.businessId!);
  }

  @Patch(":candidateId/state")
  async updateState(
    @Param("candidateId") candidateId: string,
    @Body() dto: UpdateCandidateStateDto,
  ) {
    return this.candidatesService.updateCandidateState(candidateId, dto);
  }
}
