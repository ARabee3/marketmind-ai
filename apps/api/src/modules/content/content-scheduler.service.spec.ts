import { ContentScheduler } from "./content-scheduler.service";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentService } from "./content.service";

describe("ContentScheduler", () => {
  let scheduler: ContentScheduler;
  let cycleRepo: jest.Mocked<
    Pick<ContentCycleRepository, "listActiveReadyForNextWeek" | "markCycleCompleted">
  >;
  let contentService: jest.Mocked<Pick<ContentService, "generateWeek">>;

  beforeEach(() => {
    cycleRepo = {
      listActiveReadyForNextWeek: jest.fn(),
      markCycleCompleted: jest.fn(),
    };
    contentService = {
      generateWeek: jest.fn().mockResolvedValue({
        content_pack: { id: "pack-id" },
        status: "queued" as const,
        correlation_id: "corr-id",
      } as any),
    };
    scheduler = new ContentScheduler(
      cycleRepo as any,
      contentService as any,
    );
  });

  it("generates the next week for every active cycle whose cutoff has elapsed", async () => {
    const cycles = [
      { id: "cycle-1", ownerUserId: "owner-1", currentWeekNumber: 2 },
      { id: "cycle-2", ownerUserId: "owner-2", currentWeekNumber: 5 },
    ];
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue(cycles as any);

    await scheduler.progressWeeks();

    expect(contentService.generateWeek).toHaveBeenCalledTimes(2);
    expect(contentService.generateWeek).toHaveBeenCalledWith(
      "cycle-1", 3,
      expect.objectContaining({ idempotency_key: "scheduler:cycle-1:week:3" }),
      "owner-1",
    );
    expect(contentService.generateWeek).toHaveBeenCalledWith(
      "cycle-2", 6,
      expect.objectContaining({ idempotency_key: "scheduler:cycle-2:week:6" }),
      "owner-2",
    );
  });

  it("does nothing when no cycles are ready for the next week", async () => {
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue([]);

    await scheduler.progressWeeks();

    expect(contentService.generateWeek).not.toHaveBeenCalled();
  });

  it("continues to the next cycle when one fails", async () => {
    const cycles = [
      { id: "bad", ownerUserId: "owner-1", currentWeekNumber: 1 },
      { id: "good", ownerUserId: "owner-2", currentWeekNumber: 3 },
    ];
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue(cycles as any);
    contentService.generateWeek
      .mockRejectedValueOnce(new Error("DB down"))
      .mockResolvedValueOnce({
        content_pack: { id: "pack-good" },
        status: "queued" as const,
        correlation_id: "corr-2",
      } as any);

    await scheduler.progressWeeks();

    expect(contentService.generateWeek).toHaveBeenCalledTimes(2);
    expect(contentService.generateWeek).toHaveBeenCalledWith(
      "good", 4,
      expect.objectContaining({ idempotency_key: "scheduler:good:week:4" }),
      "owner-2",
    );
  });

  it("marks the cycle completed after generating week 12", async () => {
    const cycles = [
      { id: "cycle-1", ownerUserId: "owner-1", currentWeekNumber: 11 },
    ];
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue(cycles as any);
    cycleRepo.markCycleCompleted.mockResolvedValue(undefined);

    await scheduler.progressWeeks();

    expect(contentService.generateWeek).toHaveBeenCalledWith(
      "cycle-1", 12,
      expect.objectContaining({ idempotency_key: "scheduler:cycle-1:week:12" }),
      "owner-1",
    );
    expect(cycleRepo.markCycleCompleted).toHaveBeenCalledWith("cycle-1");
  });
});
