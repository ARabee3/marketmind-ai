import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IntentsService } from "./intents.service";
import {
  ApproveIntentDto,
  CancelIntentDto,
  CreateIntentDto,
  DispatchLocalActionDto,
  ListIntentsQueryDto,
  RescheduleIntentDto,
  RetryIntentDto,
  ScheduleIntentDto,
} from "./intents.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { BusinessOwnershipGuard } from "../common/guards/business-ownership.guard";

@Controller("publication-intents")
@UseGuards(JwtAuthGuard, BusinessOwnershipGuard)
export class IntentsController {
  constructor(private readonly intentsService: IntentsService) {}

  @Post()
  create(@Body() dto: CreateIntentDto, @Req() req: Record<string, unknown>) {
    const user = req["user"] as { id: string; businessId: string };
    return this.intentsService.createIntent(user.businessId, user.id, dto);
  }

  @Get()
  list(
    @Query() query: ListIntentsQueryDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.intentsService.listIntents(user.businessId, query);
  }

  @Get(":intentId")
  getOne(
    @Param("intentId") intentId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.intentsService.getIntent(intentId, user.businessId);
  }

  @Put(":intentId/schedule")
  schedule(
    @Param("intentId") intentId: string,
    @Body() dto: ScheduleIntentDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.intentsService.scheduleIntent(intentId, user.businessId, dto);
  }

  @Post(":intentId/decisions")
  approve(
    @Param("intentId") intentId: string,
    @Body() dto: ApproveIntentDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { id: string; businessId: string };
    return this.intentsService.approveIntent(
      intentId,
      user.businessId,
      user.id,
      dto,
    );
  }

  @Get(":intentId/approvals")
  listApprovals(
    @Param("intentId") intentId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.intentsService.listApprovals(intentId, user.businessId);
  }

  @Post(":intentId/cancel")
  cancel(
    @Param("intentId") intentId: string,
    @Body() dto: CancelIntentDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.intentsService.cancelIntent(intentId, user.businessId, dto);
  }

  @Post(":intentId/reschedule")
  reschedule(
    @Param("intentId") intentId: string,
    @Body() dto: RescheduleIntentDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.intentsService.rescheduleIntent(intentId, user.businessId, dto);
  }

  @Post(":intentId/retry")
  retry(
    @Param("intentId") intentId: string,
    @Body() dto: RetryIntentDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.intentsService.retryIntent(intentId, user.businessId, dto);
  }

  /** Manual export dispatch (§8 draft → dispatching → succeeded, no external
   *  call). The owner's explicit Export action authorizes it; no real-publication
   *  approval or scheduled delay is required. */
  @Post(":intentId/dispatch-export")
  dispatchExport(
    @Param("intentId") intentId: string,
    @Body() dto: DispatchLocalActionDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { id: string; businessId: string };
    return this.intentsService.dispatchExport(
      intentId,
      user.businessId,
      user.id,
      dto,
    );
  }

  /** Simulation dispatch (§8 / §10.3): runs all local validation, never sends a
   *  provider request, and persists a permanent `SIMULATION` label. */
  @Post(":intentId/dispatch-simulation")
  dispatchSimulation(
    @Param("intentId") intentId: string,
    @Body() dto: DispatchLocalActionDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { id: string; businessId: string };
    return this.intentsService.dispatchSimulation(
      intentId,
      user.businessId,
      user.id,
      dto,
    );
  }

  @Get(":intentId/attempts")
  listAttempts(
    @Param("intentId") intentId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.intentsService.listAttempts(intentId, user.businessId);
  }

  @Get(":intentId/export")
  exportMetadata(
    @Param("intentId") intentId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.intentsService.getExportMetadata(intentId, user.businessId);
  }
}
