import { BillingOutboxRepository } from "./billing-outbox.repository";
import { PrismaService } from "../../common/persistence/prisma.service";

describe("BillingOutboxRepository", () => {
  let repo: BillingOutboxRepository;
  let updateMany: jest.Mock;
  let findFirst: jest.Mock;
  let findUnique: jest.Mock;
  let prisma: PrismaService;

  beforeEach(() => {
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    findFirst = jest.fn().mockResolvedValue({ attempts: 0 });
    findUnique = jest.fn().mockResolvedValue(null);
    prisma = {
      billingOutbox: { updateMany, findFirst, findUnique },
    } as unknown as PrismaService;
    repo = new BillingOutboxRepository(prisma);
  });

  afterEach(() => jest.clearAllMocks());

  it("marks an owned event as sent only for the lease owner", async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.markDispatched("event-1", "lease-1")).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "event-1", state: "processing", leaseOwner: "lease-1" },
      data: expect.objectContaining({
        state: "sent",
        dispatchedAt: expect.any(Date),
      }),
    });
  });

  it("returns false when the mark is not owned", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.markDispatched("event-1", "other-lease")).resolves.toBe(
      false,
    );
  });

  it("releases a failed delivery with exponential backoff", async () => {
    findFirst.mockResolvedValue({ attempts: 1 });

    await repo.releaseForRetry("event-1", "lease-1", "SMTP down");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "event-1", state: "processing", leaseOwner: "lease-1" },
        data: expect.objectContaining({
          state: "pending",
          attempts: 2,
          lastError: "SMTP down",
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
  });

  it("moves the event to failed after the terminal attempt count", async () => {
    findFirst.mockResolvedValue({ attempts: 4 });

    await repo.releaseForRetry("event-1", "lease-1", "SMTP down");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "failed",
          attempts: 5,
          nextAttemptAt: null,
        }),
      }),
    );
  });

  it("claims an event by id only while it is pending", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({ id: "event-1", state: "processing" });

    await repo.claimEventById("event-1", "lease-1");

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "event-1", state: "pending" },
      data: expect.objectContaining({
        state: "processing",
        leaseOwner: "lease-1",
        leaseExpiresAt: expect.any(Date),
      }),
    });
  });

  it("returns null when a concurrent worker already claimed the event", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.claimEventById("event-1", "lease-1")).resolves.toBeNull();
  });
});
