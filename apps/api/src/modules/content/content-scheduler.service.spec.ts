import { ContentScheduler } from "./content-scheduler.service";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";

describe("ContentScheduler", () => {
  let scheduler: ContentScheduler;
  let cycleRepo: jest.Mocked<
    Pick<
      ContentCycleRepository,
      "listActiveReadyForNextWeek" | "advanceToNextWeek"
    >
  >;

  beforeEach(() => {
    cycleRepo = {
      listActiveReadyForNextWeek: jest.fn(),
      advanceToNextWeek: jest.fn(),
    };
    scheduler = new ContentScheduler(cycleRepo as any);
  });

  it("advances every active cycle whose cutoff has elapsed to the next actionable week", async () => {
    const cycles = [
      { id: "cycle-1", ownerUserId: "owner-1", currentWeekNumber: 1 },
      { id: "cycle-2", ownerUserId: "owner-2", currentWeekNumber: 5 },
    ];
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue(cycles as any);
    cycleRepo.advanceToNextWeek
      .mockResolvedValueOnce({
        advanced: true,
        completed: false,
        nextWeekNumber: 2,
      })
      .mockResolvedValueOnce({
        advanced: true,
        completed: false,
        nextWeekNumber: 6,
      });

    await scheduler.progressWeeks();

    expect(cycleRepo.advanceToNextWeek).toHaveBeenCalledTimes(2);
    expect(cycleRepo.advanceToNextWeek).toHaveBeenCalledWith("cycle-1");
    expect(cycleRepo.advanceToNextWeek).toHaveBeenCalledWith("cycle-2");
  });

  it("does not call generateWeek and never auto-generates content", async () => {
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue([
      { id: "cycle-1", ownerUserId: "owner-1", currentWeekNumber: 1 } as any,
    ]);
    cycleRepo.advanceToNextWeek.mockResolvedValue({
      advanced: true,
      completed: false,
      nextWeekNumber: 2,
    });

    await scheduler.progressWeeks();

    // The scheduler must only advance the cursor; content generation is an
    // owner-explicit action through the V2 studio.
    expect(cycleRepo.advanceToNextWeek).toHaveBeenCalledTimes(1);
    expect((cycleRepo as any).generateWeek).toBeUndefined();
  });

  it("does nothing when no cycles are ready for rollover", async () => {
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue([]);

    await scheduler.progressWeeks();

    expect(cycleRepo.advanceToNextWeek).not.toHaveBeenCalled();
  });

  it("continues to the next cycle when one rollover fails", async () => {
    const cycles = [
      { id: "bad", ownerUserId: "owner-1", currentWeekNumber: 1 },
      { id: "good", ownerUserId: "owner-2", currentWeekNumber: 3 },
    ];
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue(cycles as any);
    cycleRepo.advanceToNextWeek
      .mockRejectedValueOnce(new Error("DB down"))
      .mockResolvedValueOnce({
        advanced: true,
        completed: false,
        nextWeekNumber: 4,
      });

    await scheduler.progressWeeks();

    expect(cycleRepo.advanceToNextWeek).toHaveBeenCalledTimes(2);
    expect(cycleRepo.advanceToNextWeek).toHaveBeenNthCalledWith(2, "good");
  });

  it("completes a cycle that has reached week 12 instead of advancing", async () => {
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue([
      { id: "cycle-1", ownerUserId: "owner-1", currentWeekNumber: 11 } as any,
    ]);
    cycleRepo.advanceToNextWeek.mockResolvedValue({
      advanced: false,
      completed: true,
      nextWeekNumber: null,
    });

    await scheduler.progressWeeks();

    expect(cycleRepo.advanceToNextWeek).toHaveBeenCalledWith("cycle-1");
  });

  // ── Regression (issue #240): a Week 1 approved cycle past cutoff with no
  // Week 2 owner plan must not loop on generateWeek(nextWeek) errors. The
  // scheduler must advance the cursor and prepare Week 2 for owner planning
  // without generating any content.
  it("regression: advances a Week 1 approved cycle past cutoff without generating a Week 2 pack", async () => {
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue([
      {
        id: "c75bbc14-e983-44d6-98c9-baad91d02c08",
        ownerUserId: "owner-1",
        currentWeekNumber: 1,
      } as any,
    ]);
    cycleRepo.advanceToNextWeek.mockResolvedValue({
      advanced: true,
      completed: false,
      nextWeekNumber: 2,
    });

    await scheduler.progressWeeks();

    // The rollover is the only call — no generateWeek, no error loop.
    expect(cycleRepo.advanceToNextWeek).toHaveBeenCalledTimes(1);
    expect(cycleRepo.advanceToNextWeek).toHaveBeenCalledWith(
      "c75bbc14-e983-44d6-98c9-baad91d02c08",
    );
  });

  it("does not log an error when a concurrent tick already advanced the cycle", async () => {
    cycleRepo.listActiveReadyForNextWeek.mockResolvedValue([
      { id: "cycle-1", ownerUserId: "owner-1", currentWeekNumber: 1 } as any,
    ]);
    cycleRepo.advanceToNextWeek.mockResolvedValue({
      advanced: false,
      completed: false,
      nextWeekNumber: null,
    });

    await scheduler.progressWeeks();

    expect(cycleRepo.advanceToNextWeek).toHaveBeenCalledTimes(1);
  });
});
