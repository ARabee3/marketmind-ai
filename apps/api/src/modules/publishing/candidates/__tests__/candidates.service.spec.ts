import { CandidatesService } from "../candidates.service";
import { PrismaService } from "../../../../common/persistence/prisma.service";
import {
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PublishingErrorCode } from "../../common/errors/publishing-error-codes";
import { PublishingCandidate } from "@prisma/client";

describe("CandidatesService", () => {
  let service: CandidatesService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(() => {
    prisma = {
      publishingCandidate: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      } as any,
      publishingIntent: {
        updateMany: jest.fn(),
      } as any,
      $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
    };
    service = new CandidatesService(prisma as any);

    // Silence logger
    jest.spyOn(service["logger"], "debug").mockImplementation(() => {});
  });

  describe("ingestCandidate (Idempotency and deduplication)", () => {
    const dto = {
      businessId: "biz-1",
      externalContentId: "ext-1",
      candidateChecksum: "hash123",
      eventFingerprint: "fp-1",
      payload: {},
      channel: "facebook",
      format: "POST",
      strategyWeekNumber: 1,
    };

    it("creates a new candidate when no duplicates exist", async () => {
      (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.publishingCandidate!.findFirst as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.publishingCandidate!.create as jest.Mock).mockResolvedValue({
        id: "new-cand",
      });

      const result = await service.ingestCandidate(dto);
      expect(result.id).toBe("new-cand");
      expect(prisma.publishingCandidate!.create).toHaveBeenCalled();
    });

    it("returns the existing candidate on identical event replay (idempotent)", async () => {
      const existing = { id: "cand-1", candidateChecksum: "hash123" };
      (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue(
        existing,
      );

      const result = await service.ingestCandidate(dto);
      expect(result).toBe(existing);
      expect(prisma.publishingCandidate!.create).not.toHaveBeenCalled();
    });

    it("throws CANDIDATE_TAMPERED if fingerprint exists but checksum differs", async () => {
      const existing = { id: "cand-1", candidateChecksum: "different-hash" };
      (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue(
        existing,
      );

      await expect(service.ingestCandidate(dto)).rejects.toThrowError(
        new ConflictException(PublishingErrorCode.CANDIDATE_TAMPERED),
      );
    });

    it("throws CANDIDATE_TAMPERED if externalContentId exists but checksum differs (content drift)", async () => {
      (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      const existing = { id: "cand-1", candidateChecksum: "different-hash" };
      (prisma.publishingCandidate!.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );

      await expect(service.ingestCandidate(dto)).rejects.toThrowError(
        new ConflictException(PublishingErrorCode.CANDIDATE_TAMPERED),
      );
    });
  });

  describe("updateCandidateState (Revocation cascade)", () => {
    it("revokes the candidate and cascades cancellation to draft/scheduled intents", async () => {
      const existing: PublishingCandidate = {
        id: "cand-1",
        status: "ACTIVE",
        version: 1,
        sourceStateVersion: 1,
      } as any;
      (
        prisma.publishingCandidate!.findUniqueOrThrow as jest.Mock
      ).mockResolvedValue(existing);
      (prisma.publishingCandidate!.update as jest.Mock).mockResolvedValue({
        status: "REVOKED",
      });

      await service.updateCandidateState("cand-1", {
        newStatus: "REVOKED",
        sourceStateVersion: 2,
        currentVersion: 1,
      });

      // Assert candidate was updated
      expect(prisma.publishingCandidate!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "REVOKED" }),
        }),
      );

      // Assert intents were cancelled
      expect(prisma.publishingIntent!.updateMany).toHaveBeenCalledWith({
        where: {
          candidateId: "cand-1",
          status: { in: ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED"] },
        },
        data: { status: "CANCELLED" },
      });
    });
  });

  describe("assertCandidateActive (Revalidation checklist)", () => {
    it("passes if candidate is ACTIVE and checksum matches", async () => {
      (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue({
        status: "ACTIVE",
        candidateChecksum: "hash123",
      });
      await expect(
        service.assertCandidateActive("cand-1", "hash123"),
      ).resolves.not.toThrow();
    });

    it("throws CANDIDATE_REVOKED if status is not ACTIVE", async () => {
      (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue({
        status: "REVOKED",
        candidateChecksum: "hash123",
      });
      await expect(
        service.assertCandidateActive("cand-1", "hash123"),
      ).rejects.toThrowError(
        new UnprocessableEntityException(PublishingErrorCode.CANDIDATE_REVOKED),
      );
    });

    it("throws ASSET_TAMPERED if checksum does not match", async () => {
      (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue({
        status: "ACTIVE",
        candidateChecksum: "hash123",
      });
      await expect(
        service.assertCandidateActive("cand-1", "different-hash"),
      ).rejects.toThrowError(
        new UnprocessableEntityException(PublishingErrorCode.ASSET_TAMPERED),
      );
    });
  });
});
