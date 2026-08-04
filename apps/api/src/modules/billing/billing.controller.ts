import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import type {
  BillingCheckoutRequest,
  BillingSubscriptionResponse,
} from "@marketmind/contracts";
import { BillingService } from "./billing.service";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import { SubscriptionNoteDto } from "./dto/subscription-note.dto";
import { SandboxConfirmationDto } from "./dto/sandbox-confirmation.dto";

type RequestWithUser = Request & { user: AuthenticatedUser };
type WebhookRequest = Request & { rawBody?: Buffer };

@Controller("billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("prices")
  getPrices() {
    return this.billingService.getPrices();
  }

  @Get("subscription")
  @UseGuards(JwtAuthGuard)
  getSubscription(@Req() req: RequestWithUser) {
    return this.billingService.getSubscription(req.user.id);
  }

  @Get("usage")
  @UseGuards(JwtAuthGuard)
  getUsage(@Req() req: RequestWithUser) {
    return this.billingService.getUsage(req.user.id);
  }

  @Get("transactions")
  @UseGuards(JwtAuthGuard)
  getTransactions(@Req() req: RequestWithUser) {
    return this.billingService.getTransactions(req.user.id);
  }

  @Post("checkouts")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  createCheckout(
    @Req() req: RequestWithUser,
    @Body() dto: CreateCheckoutDto,
    @Headers("idempotency-key") headerIdempotencyKey?: string,
  ) {
    const input: BillingCheckoutRequest = {
      price_code: dto.price_code,
      payment_mode: dto.payment_mode,
      idempotency_key: headerIdempotencyKey ?? dto.idempotency_key,
    };
    return this.billingService.createCheckout(req.user.id, input);
  }

  @Post("manual-renewal")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  manualRenewal(
    @Req() req: RequestWithUser,
    @Body() dto: CreateCheckoutDto,
    @Headers("idempotency-key") headerIdempotencyKey?: string,
  ) {
    const input: BillingCheckoutRequest = {
      price_code: dto.price_code,
      payment_mode:
        dto.payment_mode === "recurring_card"
          ? "one_time_card"
          : dto.payment_mode,
      idempotency_key: headerIdempotencyKey ?? dto.idempotency_key,
    };
    return this.billingService.createCheckout(req.user.id, input);
  }

  @Post("subscription/cancel")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  cancelSubscription(
    @Req() req: RequestWithUser,
    @Body() _dto: SubscriptionNoteDto,
  ): Promise<BillingSubscriptionResponse> {
    return this.billingService.cancelSubscription(req.user.id);
  }

  @Post("subscription/resume")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  resumeSubscription(@Req() req: RequestWithUser) {
    return this.billingService.resumeSubscription(req.user.id);
  }

  @Post("sandbox/confirm")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  confirmSandboxCheckout(
    @Req() req: RequestWithUser,
    @Body() dto: SandboxConfirmationDto,
  ) {
    return this.billingService.confirmSandboxCheckout(
      req.user.id,
      dto.provider_checkout_ref,
      dto.outcome,
    );
  }

  @Post("webhooks/:provider")
  @HttpCode(HttpStatus.ACCEPTED)
  async webhook(
    @Param("provider") provider: string,
    @Req() req: WebhookRequest,
    @Headers("x-billing-signature") signature?: string,
    @Query("hmac") queryHmac?: string,
  ) {
    const bodyHmac =
      typeof req.body === "object" &&
      req.body !== null &&
      "hmac" in req.body &&
      typeof req.body.hmac === "string"
        ? req.body.hmac
        : undefined;
    return this.billingService.handleWebhook(
      provider,
      req.body,
      req.rawBody,
      signature ?? queryHmac ?? bodyHmac,
    );
  }
}
