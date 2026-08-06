import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../token-store";
import {
  createContentCycle,
  getContentCycle,
  listContentWeeks,
  updateContentWeekContext,
  generateContentWeek,
  getContentPack,
  getContentPackProgress,
  retryContentPack,
} from "../content-cycle";
import {
  mockActiveCycle,
  mockOwnerConfirmedContextWeek1,
  mockQueuedPack,
  mockPackProgressEvents,
  MOCK_BUSINESS_ID,
  MOCK_STRATEGY_ID,
  MOCK_DECISION_ID,
  MOCK_CYCLE_ID,
  MOCK_PACK_ID,
} from "@/features/content/cycle/lib/content-cycle-fixtures";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("Content Cycle API Adapter", () => {
  it("createContentCycle POSTs to /content-cycles with exact payload", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content_cycle: mockActiveCycle,
          initial_week_context: mockOwnerConfirmedContextWeek1,
        }),
        { status: 201 },
      ),
    );

    const payload = {
      business_id: MOCK_BUSINESS_ID,
      strategy_id: MOCK_STRATEGY_ID,
      strategy_version: 1,
      strategy_decision_id: MOCK_DECISION_ID,
      idempotency_key: "idem-1",
      initial_week_context: {
        week_number: 1,
        week_start_date: "2026-08-10",
        promotion_mode: "none" as const,
        promotion: null,
        must_include: [],
        must_avoid: [],
        approved_asset_ids: [],
        cta_destination: { type: "none" as const, value: null },
      },
    };

    const res = await createContentCycle(payload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3001/api/v1/content-cycles");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(payload);
    expect(res.content_cycle.id).toBe(MOCK_CYCLE_ID);
  });

  it("getContentCycle GETs /content-cycles/:id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockActiveCycle), { status: 200 }),
    );

    const res = await getContentCycle(MOCK_CYCLE_ID);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3001/api/v1/content-cycles/${MOCK_CYCLE_ID}`);
    expect(res.id).toBe(MOCK_CYCLE_ID);
  });

  it("listContentWeeks GETs /content-cycles/:id/weeks", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ weeks: [mockOwnerConfirmedContextWeek1] }),
        { status: 200 },
      ),
    );

    const res = await listContentWeeks(MOCK_CYCLE_ID);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3001/api/v1/content-cycles/${MOCK_CYCLE_ID}/weeks`);
    expect(res.weeks.length).toBe(1);
  });

  it("updateContentWeekContext PUTs to /content-cycles/:id/weeks/:week/context", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockOwnerConfirmedContextWeek1), { status: 200 }),
    );

    const payload = {
      week_number: 1,
      week_start_date: "2026-08-10",
      promotion_mode: "none" as const,
      promotion: null,
      must_include: [],
      must_avoid: [],
      approved_asset_ids: [],
      cta_destination: { type: "none" as const, value: null },
    };

    const res = await updateContentWeekContext(MOCK_CYCLE_ID, 1, payload);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://localhost:3001/api/v1/content-cycles/${MOCK_CYCLE_ID}/weeks/1/context`,
    );
    expect(init.method).toBe("PUT");
    expect(res.week_number).toBe(1);
  });

  it("generateContentWeek POSTs to /content-cycles/:id/weeks/:week/generate", async () => {
    const mockQueuedResponse = {
      content_pack: mockQueuedPack,
      status: "queued" as const,
      correlation_id: "corr-1",
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockQueuedResponse), { status: 202 }),
    );

    const payload = {
      content_cycle_id: MOCK_CYCLE_ID,
      week_number: 2,
      idempotency_key: "idem-2",
    };

    const res = await generateContentWeek(MOCK_CYCLE_ID, 2, payload);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://localhost:3001/api/v1/content-cycles/${MOCK_CYCLE_ID}/weeks/2/generate`,
    );
    expect(init.method).toBe("POST");
    expect(res.status).toBe("queued");
  });

  it("getContentPack GETs /content-packs/:id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockQueuedPack), { status: 200 }),
    );

    const res = await getContentPack(MOCK_PACK_ID);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3001/api/v1/content-packs/${MOCK_PACK_ID}`);
    expect(res.id).toBe(MOCK_PACK_ID);
  });

  it("getContentPackProgress GETs /content-packs/:id/progress", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockPackProgressEvents), { status: 200 }),
    );

    const res = await getContentPackProgress(MOCK_PACK_ID);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://localhost:3001/api/v1/content-packs/${MOCK_PACK_ID}/progress`,
    );
    expect(res.length).toBe(2);
  });

  it("retryContentPack POSTs to /content-packs/:id/retry", async () => {
    const mockQueuedResponse = {
      content_pack: mockQueuedPack,
      status: "queued" as const,
      correlation_id: "corr-retry",
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockQueuedResponse), { status: 202 }),
    );

    const res = await retryContentPack(MOCK_PACK_ID);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3001/api/v1/content-packs/${MOCK_PACK_ID}/retry`);
    expect(init.method).toBe("POST");
    expect(res.status).toBe("queued");
  });

  it("throws ContentCycleApiError on non-OK response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "CONTENT_WEEK_ALREADY_CLAIMED",
          message: "Week context is frozen",
        }),
        { status: 409, statusText: "Conflict" },
      ),
    );

    await expect(getContentCycle(MOCK_CYCLE_ID)).rejects.toEqual({
      status: 409,
      code: "CONTENT_WEEK_ALREADY_CLAIMED",
      message: "Week context is frozen",
    });
  });

  it("handles non-JSON error response with status text fallback", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Server Error", { status: 503, statusText: "Service Unavailable" }),
    );

    await expect(getContentCycle(MOCK_CYCLE_ID)).rejects.toEqual({
      status: 503,
      code: "api_error",
      message: "Service Unavailable",
    });
  });
});
