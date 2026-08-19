import { Test, TestingModule } from "@nestjs/testing";
import { Job } from "bullmq";
import { Prisma } from "@prisma/client";

import { BillingOutboxProcessor } from "./billing-outbox.processor";
import { BillingOutboxRepository } from "./billing-outbox.repository";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../../common/persistence/prisma.service";

type OutboxRow = Prisma.BillingOutboxGetPayload<Record<string, never>>;

const buildEvent = (overrides: Partial<OutboxRow> = {}): OutboxRow =>
  ({
    id: "event-1",
    billingAccountId: "account-1",
    eventType: "billing.payment_confirmed",
    dedupeKey: "fake:event-2",
    payload: {
      transaction_ref: "tx-1",
      bundle_code: "starter_150",
      bundle_name_en: "Starter",
      bundle_name_ar: "مبتدئ",
      points_granted: 150,
      amount_egp: 100,
      currency: "EGP",
      confirmed_at: "2026-08-20T10:00:00.000Z",
    },
    state: "pending",
    attempts: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    lastError: null,
    dispatchedAt: null,
    createdAt: new Date("2026-08-20T09:00:00.000Z"),
    ...overrides,
  }) as unknown as OutboxRow;

const buildJob = (eventId: string): Job<{ eventId: string }> =>
  ({ id: "job-1", data: { eventId } }) as unknown as Job<{ eventId: string }>;

describe("BillingOutboxProcessor", () => {
  let processor: BillingOutboxProcessor;
  let outbox: {
    claimEventById: jest.Mock;
    markDispatched: jest.Mock;
    releaseForRetry: jest.Mock;
  };
  let mail: { sendBillingPaymentConfirmation: jest.Mock };
  let prisma: { billingAccount: { findUnique: jest.Mock } };

  beforeEach(async () => {
    outbox = {
      claimEventById: jest.fn(),
      markDispatched: jest.fn().mockResolvedValue(true),
      releaseForRetry: jest.fn().mockResolvedValue(true),
    };
    mail = {
      sendBillingPaymentConfirmation: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      billingAccount: {
        findUnique: jest.fn().mockResolvedValue({ ownerUserId: "user-1" }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingOutboxProcessor,
        { provide: BillingOutboxRepository, useValue: outbox },
        { provide: MailService, useValue: mail },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    processor = module.get<BillingOutboxProcessor>(BillingOutboxProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it("sends a confirmation email and marks the event dispatched", async () => {
    outbox.claimEventById.mockResolvedValue(buildEvent());

    await processor.process(buildJob("event-1"));

    expect(outbox.claimEventById).toHaveBeenCalledWith(
      "event-1",
      expect.stringContaining("billing-mail-worker:"),
    );
    expect(mail.sendBillingPaymentConfirmation).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      bundleNameEn: "Starter",
      bundleNameAr: "مبتدئ",
      pointsGranted: 150,
      amountEgp: 100,
      currency: "EGP",
      transactionRef: "tx-1",
      confirmedAt: new Date("2026-08-20T10:00:00.000Z"),
    });
    expect(outbox.markDispatched).toHaveBeenCalledWith(
      "event-1",
      expect.stringContaining("billing-mail-worker:"),
    );
    expect(outbox.releaseForRetry).not.toHaveBeenCalled();
  });

  it("releases for retry and rethrows when the mail provider fails", async () => {
    outbox.claimEventById.mockResolvedValue(buildEvent());
    mail.sendBillingPaymentConfirmation.mockRejectedValue(
      new Error("SMTP down"),
    );

    await expect(processor.process(buildJob("event-1"))).rejects.toThrow(
      "SMTP down",
    );

    expect(outbox.releaseForRetry).toHaveBeenCalledWith(
      "event-1",
      expect.stringContaining("billing-mail-worker:"),
      "SMTP down",
    );
    expect(outbox.markDispatched).not.toHaveBeenCalled();
  });

  it("is a no-op when the event is not claimable (replay/duplicate)", async () => {
    outbox.claimEventById.mockResolvedValue(null);

    await processor.process(buildJob("event-1"));

    expect(mail.sendBillingPaymentConfirmation).not.toHaveBeenCalled();
    expect(outbox.markDispatched).not.toHaveBeenCalled();
  });

  it("fails fast when the billing account is missing", async () => {
    outbox.claimEventById.mockResolvedValue(buildEvent());
    prisma.billingAccount.findUnique.mockResolvedValue(null);

    await expect(processor.process(buildJob("event-1"))).rejects.toThrow(
      "Billing account account-1 not found",
    );
    expect(outbox.releaseForRetry).toHaveBeenCalled();
  });
});
