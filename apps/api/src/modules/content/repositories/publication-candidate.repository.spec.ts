import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { isPublicationCandidateChecksumValid } from "@marketmind/contracts";
import {
  PublicationCandidateRepository,
  CreateCandidateInput,
} from "./publication-candidate.repository";
import { ContentDecisionRow } from "./content-decision.repository";

const DECISION_ROW: ContentDecisionRow = {
  id: "decision-1",
  contentItemId: "item-1",
  contentItemVersionId: "ver-1",
  contentItemVersion: 3,
  contentItemVersionChecksum: "abc123",
  decision: "approved",
  revisionNotes: null,
  decidedByUserId: "owner-1",
  decidedAt: new Date("2026-01-01T10:00:00Z"),
  ownerUserId: "owner-1",
  idempotencyKey: "key-1",
  createdAt: new Date("2026-01-01T10:00:00Z"),
};

const ITEM_VERSION = {
  id: "ver-1",
  contentItemId: "item-1",
  contentPackId: "pack-1",
  version: 3,
  versionChecksum: "abc123",
  channel: "instagram",
  format: "static_image_post",
  languageMode: "ar",
  captionVariants: [{ locale: "ar", caption: "نص تسويقي" }],
  cta: "call",
  hashtags: ["#cairo", "#marketmind"],
  altText: "صورة تسويقية",
  recommendedPublishWindow: {
    starts_at: "2026-01-05T09:00:00Z",
    ends_at: "2026-01-05T12:00:00Z",
  },
};

const INPUT: CreateCandidateInput = {
  approval: DECISION_ROW,
  itemVersion: ITEM_VERSION,
  assets: [
    {
      assetId: "asset-1",
      kind: "generated_static",
      mimeType: "image/png",
      storageKey: "content/asset-1.png",
      checksum: "a".repeat(64),
    },
  ],
  ownerUserId: "owner-1",
};

const PACK = {
  businessId: "business-1",
  strategyId: "strategy-1",
  strategyVersion: 3,
  contentCycleId: "cycle-1",
  weekNumber: 2,
};

function makeCreateTx() {
  const packFindUniqueOrThrow = jest.fn().mockResolvedValue(PACK);
  const candidateCreate = jest.fn().mockResolvedValue({ id: "cand-row-1" });
  const statusCreate = jest.fn().mockResolvedValue({ id: 1n });
  const outboxCreate = jest.fn().mockResolvedValue({ id: 1n });

  const tx = {
    contentPack: { findUniqueOrThrow: packFindUniqueOrThrow },
    publicationCandidate: { create: candidateCreate },
    publicationCandidateStatus: { create: statusCreate },
    publicationCandidateOutbox: { create: outboxCreate },
  };

  const $transaction = jest.fn(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
  );

  return {
    repo: new PublicationCandidateRepository({
      $transaction,
    } as unknown as PrismaService),
    packFindUniqueOrThrow,
    candidateCreate,
    statusCreate,
    outboxCreate,
  };
}

describe("PublicationCandidateRepository", () => {
  describe("createCandidate", () => {
    it("persists candidate + active status v1 + created outbox atomically with a valid checksum", async () => {
      const { repo, candidateCreate, statusCreate, outboxCreate } =
        makeCreateTx();

      const result = await repo.createCandidate(INPUT);

      expect(isPublicationCandidateChecksumValid(result.candidate)).toBe(true);
      expect(result.candidate.contract_version).toBe("publication-candidate-v1");
      expect(result.candidate.candidate_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.candidate.business_id).toBe("business-1");
      expect(result.candidate.strategy_id).toBe("strategy-1");
      expect(result.candidate.strategy_version).toBe(3);
      expect(result.candidate.content_cycle_id).toBe("cycle-1");
      expect(result.candidate.strategy_week_number).toBe(2);
      expect(result.candidate.content_pack_id).toBe("pack-1");
      expect(result.candidate.content_item_id).toBe("item-1");
      expect(result.candidate.content_item_version_id).toBe("ver-1");
      expect(result.candidate.content_item_version).toBe(3);
      expect(result.candidate.content_item_version_checksum).toBe("abc123");
      expect(result.candidate.target_channel).toBe("instagram");
      expect(result.candidate.content_format).toBe("static_image_post");
      expect(result.candidate.selected_locale).toBe("ar");
      expect(result.candidate.caption).toBe("نص تسويقي");
      expect(result.candidate.cta).toBe("call");
      expect(result.candidate.hashtags).toEqual(["#cairo", "#marketmind"]);
      expect(result.candidate.alt_text).toBe("صورة تسويقية");
      expect(result.candidate.assets).toEqual([
        {
          asset_id: "asset-1",
          kind: "generated_static",
          mime_type: "image/png",
          storage_key: "content/asset-1.png",
          checksum: "a".repeat(64),
        },
      ]);
      expect(result.candidate.recommended_publish_window).toEqual({
        starts_at: "2026-01-05T09:00:00Z",
        ends_at: "2026-01-05T12:00:00Z",
        timezone: "Africa/Cairo",
      });
      expect(result.candidate.approval).toEqual({
        decision_id: "decision-1",
        decision: "approved",
        content_item_version_id: "ver-1",
        content_item_version_checksum: "abc123",
        decided_by_user_id: "owner-1",
        decided_at: "2026-01-01T10:00:00.000Z",
      });

      expect(candidateCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          candidateId: result.candidate.candidate_id,
          businessId: "business-1",
          contractVersion: "publication-candidate-v1",
          candidateChecksum: result.candidate.candidate_checksum,
          contentCycleId: "cycle-1",
          contentPackId: "pack-1",
          contentItemId: "item-1",
          contentItemVersionId: "ver-1",
          contentItemVersion: 3,
          state: "active",
        }),
      });

      expect(statusCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          candidateId: "cand-row-1",
          candidateChecksum: result.candidate.candidate_checksum,
          stateVersion: 1,
          candidateState: "active",
          replacementCandidateId: null,
          changedByUserId: "owner-1",
        }),
      });

      expect(outboxCreate).toHaveBeenCalledTimes(1);
      const outboxCall = outboxCreate.mock.calls[0][0].data;
      expect(outboxCall.eventType).toBe("content.publication_candidate.created.v1");
      expect(outboxCall.state).toBe("pending");
      expect(outboxCall.candidateId).toBe(result.candidate.candidate_id);
      expect(outboxCall.payload).toMatchObject({
        event_type: "content.publication_candidate.created.v1",
        payload: { candidate_id: result.candidate.candidate_id },
      });
    });

    it("rejects a tampered candidate and persists no rows", async () => {
      const mocks = makeCreateTx();
      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentPack: {
              findUniqueOrThrow: jest.fn().mockResolvedValue(PACK),
            },
            publicationCandidate: { create: mocks.candidateCreate },
            publicationCandidateStatus: { create: mocks.statusCreate },
            publicationCandidateOutbox: { create: mocks.outboxCreate },
          }),
      );
      const repo = new PublicationCandidateRepository({
        $transaction,
      } as unknown as PrismaService);

      await expect(
        repo.createCandidate({
          ...INPUT,
          approval: { ...DECISION_ROW, contentItemVersionChecksum: "TAMPERED" },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        repo.createCandidate({
          ...INPUT,
          approval: { ...DECISION_ROW, contentItemVersionChecksum: "TAMPERED" },
        }),
      ).rejects.toMatchObject({
        response: { code: "CONTENT_CANDIDATE_TAMPERED" },
      });

      expect(mocks.candidateCreate).not.toHaveBeenCalled();
      expect(mocks.statusCreate).not.toHaveBeenCalled();
      expect(mocks.outboxCreate).not.toHaveBeenCalled();
    });

    it("falls back to the ar caption when the language mode has no matching variant", async () => {
      const { repo } = makeCreateTx();
      const result = await repo.createCandidate({
        ...INPUT,
        itemVersion: {
          ...ITEM_VERSION,
          languageMode: "mixed",
          captionVariants: [
            { locale: "ar", caption: "نص عربي" },
            { locale: "en", caption: "English caption" },
          ],
        },
      });

      expect(result.candidate.selected_locale).toBe("ar");
      expect(result.candidate.caption).toBe("نص عربي");
    });

    it("picks the en caption when the language mode matches an en variant", async () => {
      const { repo } = makeCreateTx();
      const result = await repo.createCandidate({
        ...INPUT,
        itemVersion: {
          ...ITEM_VERSION,
          languageMode: "en",
          captionVariants: [
            { locale: "ar", caption: "نص عربي" },
            { locale: "en", caption: "English caption" },
          ],
        },
      });

      expect(result.candidate.selected_locale).toBe("en");
      expect(result.candidate.caption).toBe("English caption");
    });
  });

  describe("changeCandidateState", () => {
    function makeStateTx() {
      const candidateFindUnique = jest.fn().mockResolvedValue({
        candidateId: "cand-uuid-1",
        businessId: "business-1",
        candidateChecksum: "a".repeat(64),
        state: "active",
      });
      const statusFindFirst = jest.fn().mockResolvedValue({
        stateVersion: 1,
      });
      const statusCreate = jest.fn().mockResolvedValue({ id: 2n });
      const outboxCreate = jest.fn().mockResolvedValue({ id: 2n });
      const candidateUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

      const tx = {
        publicationCandidate: {
          findUnique: candidateFindUnique,
          updateMany: candidateUpdateMany,
        },
        publicationCandidateStatus: {
          findFirst: statusFindFirst,
          create: statusCreate,
        },
        publicationCandidateOutbox: { create: outboxCreate },
      };

      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      return {
        repo: new PublicationCandidateRepository({
          $transaction,
        } as unknown as PrismaService),
        candidateFindUnique,
        statusFindFirst,
        statusCreate,
        outboxCreate,
        candidateUpdateMany,
      };
    }

    it("appends state_version 2 + state_changed outbox and moves candidate state", async () => {
      const { repo, statusCreate, outboxCreate, candidateUpdateMany } =
        makeStateTx();

      const result = await repo.changeCandidateState(
        "cand-row-1",
        "revoked",
        "owner-1",
      );

      expect(result).toEqual({ changed: true, stateVersion: 2 });
      expect(statusCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          candidateId: "cand-row-1",
          candidateChecksum: "a".repeat(64),
          stateVersion: 2,
          candidateState: "revoked",
          replacementCandidateId: null,
          changedByUserId: "owner-1",
        }),
      });
      expect(outboxCreate).toHaveBeenCalledTimes(1);
      const outboxCall = outboxCreate.mock.calls[0][0].data;
      expect(outboxCall.eventType).toBe("content.publication_candidate.state_changed.v1");
      expect(outboxCall.state).toBe("pending");
      expect(outboxCall.payload).toMatchObject({
        event_type: "content.publication_candidate.state_changed.v1",
        payload: { candidate_state: "revoked", state_version: 2 },
      });
      expect(candidateUpdateMany).toHaveBeenCalledWith({
        where: { id: "cand-row-1", state: "active" },
        data: { state: "revoked" },
      });
    });

    it("records a replacement candidate id when replacing", async () => {
      const { repo, statusCreate } = makeStateTx();

      await repo.changeCandidateState(
        "cand-row-1",
        "replaced",
        "owner-1",
        "cand-uuid-2",
      );

      expect(statusCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          candidateState: "replaced",
          replacementCandidateId: "cand-uuid-2",
        }),
      });
    });

    it("throws when a concurrent state change matches zero rows", async () => {
      const mocks = makeStateTx();
      mocks.candidateUpdateMany.mockResolvedValue({ count: 0 });

      await expect(
        mocks.repo.changeCandidateState("cand-row-1", "revoked", "owner-1"),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("throws when the candidate does not exist", async () => {
      const mocks = makeStateTx();
      mocks.candidateFindUnique.mockResolvedValue(null);

      await expect(
        mocks.repo.changeCandidateState("missing", "revoked", "owner-1"),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("outbox queries", () => {
    it("lists pending outbox events in FIFO order up to the limit", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const repo = new PublicationCandidateRepository({
        publicationCandidateOutbox: { findMany },
      } as unknown as PrismaService);

      await repo.listOutboxPending(10);

      expect(findMany).toHaveBeenCalledWith({
        where: { state: "pending" },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
    });

    it("marks an event dispatched only while pending", async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const repo = new PublicationCandidateRepository({
        publicationCandidateOutbox: { updateMany },
      } as unknown as PrismaService);

      await repo.markOutboxDispatched("event-1");

      expect(updateMany).toHaveBeenCalledWith({
        where: { eventId: "event-1", state: "pending" },
        data: expect.objectContaining({
          state: "dispatched",
          dispatchedAt: expect.any(Date),
        }),
      });
    });

    it("marks an event failed with an error and increments attempts", async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const repo = new PublicationCandidateRepository({
        publicationCandidateOutbox: { updateMany },
      } as unknown as PrismaService);

      await repo.markOutboxFailed("event-1", "consumer boom");

      expect(updateMany).toHaveBeenCalledWith({
        where: { eventId: "event-1" },
        data: {
          state: "failed",
          lastError: "consumer boom",
          attempts: { increment: 1 },
        },
      });
    });
  });
});
