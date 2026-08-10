import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approvePublishingIntent,
  getPublishingExport,
  listPublishingCandidates,
  toPublishingIntentDetail,
  toPublishingCandidate,
  toPublishingExportState,
  toPublishingIntent,
  toPublishingResult,
  toPublishingTarget,
} from "@/lib/api/publishing";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/api/client", () => ({ apiRequest }));

describe("publishing API view-model adapter", () => {
  beforeEach(() => apiRequest.mockReset());

  it("normalizes the database candidate projection into the frozen candidate summary", () => {
    const payload = {
      contract_version: "publication-candidate-v1",
      candidate_id: "candidate-1",
      business_id: "business-1",
      strategy_id: "strategy-1",
      strategy_version: 1,
      content_cycle_id: "cycle-1",
      strategy_week_number: 2,
      content_pack_id: "pack-1",
      content_item_id: "item-1",
      content_item_version_id: "item-version-1",
      content_item_version: 1,
      content_item_version_checksum: "item-checksum",
      target_channel: "facebook",
      content_format: "static_image_post",
      selected_locale: "ar",
      caption: "Caption",
      cta: null,
      hashtags: [],
      alt_text: "Alt text",
      assets: [],
      recommended_publish_window: {
        starts_at: "2026-08-10T18:00:00+03:00",
        ends_at: "2026-08-10T21:00:00+03:00",
        timezone: "Africa/Cairo",
      },
      approval: {
        decision_id: "decision-1",
        decision: "approved",
        content_item_version_id: "item-version-1",
        content_item_version_checksum: "item-checksum",
        decided_by_user_id: "owner-1",
        decided_at: "2026-08-01T10:00:00Z",
      },
      candidate_checksum: "candidate-checksum",
      created_at: "2026-08-01T10:01:00Z",
    };

    expect(
      toPublishingCandidate({
        id: "candidate-1",
        payload,
        status: "REVOKED",
        sourceStateVersion: 3,
        receivedAt: "2026-08-01T10:01:00Z",
      }),
    ).toMatchObject({
      candidate: payload,
      source_state: "revoked",
      source_state_version: 3,
    });
  });

  it("normalizes uppercase intent states and modes without exposing DTO casing", () => {
    expect(
      toPublishingIntent({
        id: "intent-1",
        version: 2,
        businessId: "business-1",
        candidateId: "candidate-1",
        candidateChecksum: "checksum",
        mode: "MANUAL_EXPORT",
        status: "DISPATCHING",
        createdByUserId: "owner-1",
        createdAt: "2026-08-01T10:00:00Z",
        updatedAt: "2026-08-01T10:00:00Z",
      }),
    ).toMatchObject({
      intent_id: "intent-1",
      mode: "manual_export",
      state: "dispatching",
    });
  });

  it("keeps newly created draft intents actionable", () => {
    expect(
      toPublishingIntent({
        id: "intent-draft",
        version: 1,
        businessId: "business-1",
        candidateId: "candidate-1",
        candidateChecksum: "checksum",
        mode: "SIMULATION",
        status: "DRAFT",
        createdByUserId: "owner-1",
        createdAt: "2026-08-01T10:00:00Z",
        updatedAt: "2026-08-01T10:00:00Z",
      }),
    ).toMatchObject({
      intent_id: "intent-draft",
      mode: "simulation",
      state: "draft",
    });
  });

  it("preserves a nested API candidate checksum in the approval request", async () => {
    const intent = toPublishingIntent({
      id: "intent-approval",
      version: 2,
      businessId: "business-1",
      candidateId: "candidate-1",
      candidate: { candidateChecksum: "a".repeat(64) },
      mode: "REAL",
      status: "AWAITING_APPROVAL",
      targetId: "target-1",
      scheduledLocalDisplay: "2099-08-12T17:00:00",
      scheduledUtcAt: "2099-08-12T14:00:00Z",
      timezone: "Africa/Cairo",
      createdByUserId: "owner-1",
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    });
    apiRequest.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          intent: {
            id: "intent-approval",
            version: 2,
            businessId: "business-1",
            candidateId: "candidate-1",
            candidateChecksum: "a".repeat(64),
            mode: "REAL",
            status: "SCHEDULED",
            createdByUserId: "owner-1",
            createdAt: "2026-08-01T10:00:00Z",
            updatedAt: "2026-08-01T10:00:00Z",
          },
        }),
        { status: 200 },
      ),
    );

    await approvePublishingIntent(intent);

    expect(intent.candidate_checksum).toBe("a".repeat(64));
    expect(apiRequest).toHaveBeenCalledWith(
      "/publication-intents/intent-approval/decisions",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          currentVersion: 2,
          candidateChecksum: "a".repeat(64),
        }),
      }),
    );
  });

  it("keeps unknown provider outcomes refresh-only and models cancelled results", () => {
    expect(
      toPublishingResult({ outcome: "UNKNOWN", mode: "REAL" }),
    ).toMatchObject({
      outcome: "unknown",
      reconciliation_required: true,
      retryable: false,
    });
    expect(
      toPublishingResult({ outcome: "CANCELLED", mode: "REAL" }),
    ).toMatchObject({
      outcome: "cancelled",
      error_code: null,
      retryable: false,
    });
    expect(
      toPublishingResult({ outcome: "not-a-real-outcome", mode: "REAL" }),
    ).toMatchObject({
      outcome: "failed",
      retryable: false,
    });
  });

  it("preserves a confirmed published provider outcome", () => {
    expect(
      toPublishingResult({
        outcome: "PUBLISHED",
        mode: "REAL",
        remotePublicationId: "page-1_post-1",
        occurredAt: "2026-08-09T13:03:00.179Z",
      }),
    ).toMatchObject({
      outcome: "published",
      remote_publication_id: "page-1_post-1",
      error_code: null,
      retryable: false,
    });
  });

  it("fails closed when a target does not advertise a supported capability", () => {
    expect(() =>
      toPublishingTarget({
        id: "target-1",
        businessId: "business-1",
        provider: "META",
        channel: "FACEBOOK",
        externalAccountId: "page-1",
        displayName: "Page",
        connectionState: "CONNECTED",
        capabilities: [],
      }),
    ).toThrow(/supported capability/);
  });

  it("keeps both Facebook text and image publishing capabilities", () => {
    expect(
      toPublishingTarget({
        id: "target-1",
        businessId: "business-1",
        provider: "META",
        channel: "FACEBOOK",
        externalAccountId: "page-1",
        displayName: "Page",
        connectionState: "CONNECTED",
        capabilities: ["static_image", "text", "text"],
      }).capabilities,
    ).toEqual(["static_image", "text"]);
  });

  it("fails closed when a target omits its channel or connection state", () => {
    expect(() =>
      toPublishingTarget({
        id: "target-1",
        businessId: "business-1",
        provider: "META",
        externalAccountId: "page-1",
        displayName: "Page",
        capabilities: ["static_image"],
      }),
    ).toThrow(/unsupported channel/);

    expect(() =>
      toPublishingTarget({
        id: "target-1",
        businessId: "business-1",
        provider: "META",
        channel: "FACEBOOK",
        externalAccountId: "page-1",
        displayName: "Page",
        connectionState: "UNKNOWN",
        capabilities: ["static_image"],
      }),
    ).toThrow(/unsupported state/);
  });

  it("does not invent target identity fields from an incomplete response", () => {
    expect(() =>
      toPublishingTarget({
        channel: "FACEBOOK",
        connectionState: "CONNECTED",
        capabilities: ["static_image"],
      }),
    ).toThrow(/missing target id/);
  });

  it("rejects a provider outside the frozen Meta target boundary", () => {
    expect(() =>
      toPublishingTarget({
        id: "target-1",
        businessId: "business-1",
        provider: "OTHER",
        channel: "FACEBOOK",
        externalAccountId: "page-1",
        displayName: "Page",
        connectionState: "CONNECTED",
        capabilities: ["static_image"],
      }),
    ).toThrow(/unsupported provider/);
  });

  it("normalizes detail arrays without losing the approval snapshot", () => {
    const detail = toPublishingIntentDetail({
      publicationIntent: {
        id: "intent-1",
        version: 2,
        businessId: "business-1",
        candidateId: "candidate-1",
        candidateChecksum: "checksum",
        mode: "REAL",
        status: "SCHEDULED",
        targetId: "target-1",
        scheduledLocalAt: "2026-08-10T18:30:00",
        scheduledUtcAt: "2026-08-10T15:30:00Z",
        timezone: "Africa/Cairo",
        approvedDecisionId: "decision-1",
        createdByUserId: "owner-1",
        createdAt: "2026-08-02T10:00:00Z",
        updatedAt: "2026-08-02T12:00:00Z",
      },
      target: {
        id: "target-1",
        businessId: "business-1",
        provider: "META",
        channel: "FACEBOOK",
        externalAccountId: "page-1",
        displayName: "Page",
        connectionState: "CONNECTED",
        capabilities: ["static_image"],
      },
      approvals: [
        {
          id: "decision-1",
          intentId: "intent-1",
          intentVersionAtDecision: 2,
          candidateId: "candidate-1",
          candidateChecksum: "checksum",
          targetId: "target-1",
          scheduledLocalAt: "2026-08-10T18:30:00",
          timezone: "Africa/Cairo",
          scheduledUtcAt: "2026-08-10T15:30:00Z",
          decision: "APPROVED",
          decidedByUserId: "owner-1",
          decidedAt: "2026-08-02T12:00:00Z",
          approvalFingerprint: "fingerprint",
        },
      ],
      attempts: [],
      results: [],
    });

    expect(detail.target?.target_id).toBe("target-1");
    expect(detail.approval).toMatchObject({
      decision_id: "decision-1",
      decided_at: "2026-08-02T12:00:00Z",
    });
    expect(detail.attempts).toEqual([]);
    expect(detail.results).toEqual([]);
  });

  it("distinguishes a pending export from a ready archive", () => {
    expect(
      toPublishingExportState({
        exportType: "manual_archive_pending",
        artifactId: "artifact-1",
      }),
    ).toEqual({
      status: "pending",
      artifactId: "artifact-1",
      checksum: null,
      expiresAt: null,
      manifest: null,
      downloadUrl: null,
    });
    expect(
      toPublishingExportState({
        exportType: "completed",
        artifactId: "artifact-1",
        downloadUrl: "/download",
      }),
    ).toMatchObject({
      status: "ready",
      artifactId: "artifact-1",
      downloadUrl: "/download",
    });
    // The exact wire shape the API returns after #123 (metadata row mapped to
    // the frozen response surface): status "ready" + persisted frozen manifest.
    expect(
      toPublishingExportState({
        id: "meta-1",
        artifactId: "artifact-1",
        checksum: "c".repeat(64),
        exportType: "manual_archive_targz",
        status: "ready",
        downloadUrl: "/publication-intents/intent-1/export/download",
        exportedAt: "2026-08-05T10:00:00Z",
        manifest: {
          contract_version: "publishing-export-manifest-v1",
          artifact_id: "artifact-1",
          label: "EXPORTED_NOT_PUBLISHED",
          generated_at: "2026-08-05T10:00:00Z",
        },
      }),
    ).toEqual({
      status: "ready",
      artifactId: "artifact-1",
      checksum: "c".repeat(64),
      expiresAt: null,
      manifest: {
        contract_version: "publishing-export-manifest-v1",
        artifact_id: "artifact-1",
        label: "EXPORTED_NOT_PUBLISHED",
        generated_at: "2026-08-05T10:00:00Z",
      },
      downloadUrl: "/publication-intents/intent-1/export/download",
    });
  });

  it("reads the owner candidate list through the authenticated client", async () => {
    apiRequest.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    await expect(listPublishingCandidates()).resolves.toEqual([]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/publication-candidates",
      undefined,
    );
  });

  it("does not turn a failed export metadata request into a fake download", async () => {
    apiRequest.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
    );
    await expect(getPublishingExport("intent-1")).rejects.toMatchObject({
      status: 404,
    });
  });
});
