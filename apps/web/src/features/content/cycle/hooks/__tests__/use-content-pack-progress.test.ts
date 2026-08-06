import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useContentPackProgress } from "../use-content-pack-progress";
import * as apiAdapter from "@/lib/api/content-cycle";
import { mockQueuedPack, mockDraftPack, mockPackProgressEvents, MOCK_PACK_ID } from "../../lib/content-cycle-fixtures";

vi.mock("@/lib/api/content-cycle");

describe("useContentPackProgress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null state when no packId is provided", () => {
    const { result } = renderHook(() => useContentPackProgress({ packId: null }));
    expect(result.current.pack).toBeNull();
    expect(result.current.events).toEqual([]);
    expect(result.current.isPolling).toBe(false);
  });

  it("fetches pack and progress and stops polling when pack is in terminal state (draft)", async () => {
    vi.mocked(apiAdapter.getContentPack).mockResolvedValueOnce(mockDraftPack);
    vi.mocked(apiAdapter.getContentPackProgress).mockResolvedValueOnce(mockPackProgressEvents);

    const onTerminal = vi.fn();
    const { result } = renderHook(() =>
      useContentPackProgress({ packId: MOCK_PACK_ID, onTerminal }),
    );

    await waitFor(() => {
      expect(result.current.pack?.id).toBe(MOCK_PACK_ID);
    });

    expect(result.current.pack?.status).toBe("draft");
    expect(result.current.events.length).toBe(2);
    expect(result.current.isPolling).toBe(false);
  });

  it("polls recursively while pack status is active (queued)", async () => {
    vi.useFakeTimers();

    vi.mocked(apiAdapter.getContentPack).mockResolvedValue(mockQueuedPack);
    vi.mocked(apiAdapter.getContentPackProgress).mockResolvedValue(mockPackProgressEvents);

    renderHook(() =>
      useContentPackProgress({ packId: MOCK_PACK_ID }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(apiAdapter.getContentPack).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(apiAdapter.getContentPack).toHaveBeenCalledTimes(2);
  });
});
