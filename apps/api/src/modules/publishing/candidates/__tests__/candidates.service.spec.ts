import { readFileSync } from "fs";
import { join } from "path";
import { CandidatesService } from "../candidates.service";
import { PrismaService } from "../../../../common/persistence/prisma.service";
import {
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { computePublishingSha256 } from "@marketmind/contracts";

/** Path to the frozen contract example fixtures (relative to the apps/api cwd). */
const examplesDir = join(
  process.cwd(),
  "..",
  "..",
  "packages",
  "contracts",
  "examples",
);
function loadExample(name: string): unknown {
  return JSON.parse(
    readFileSync(join(examplesDir, name), "utf8") as unknown as string,
  );
}

/** Full valid active PublicationCandidateStatusV1 (v1) used to rehydrate a
 *  valid authoritative record so the frozen reducer passes its strict
 *  existing-record validation. */
const ACTIVE_STATUS_V1 = {
  contract_version: "publication-candidate-status-v1",
  candidate_id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
  business_id: "11111111-1111-4111-8111-111111111111",
  candidate_checksum:
    "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
  state_version: 1,
  candidate_state: "active",
  replacement_candidate_id: null,
  changed_by_user_id: null,
  changed_at: "2026-08-01T11:01:01+03:00",
};

describe("CandidatesService (reducer-based ingestion — P1 #119)", () => {
  let service: CandidatesService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  const createdEvent = loadExample(
    "publication-candidate-created-event.example.json",
  );
  const stateChangedEvent = loadExample(
    "publication-candidate-state-changed-event.example.json",
  );

  beforeEach(() => {
    prisma = {
      publishingCandidate: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      } as any,
      publishingIntent: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      } as any,
      $transaction: jest.fn().mockImplementation(async (cb: (tx: any) => any) =>
        cb({
          publishingCandidate: {
            update: (prisma as any).publishingCandidate.update,
          },
          publishingIntent: {
            updateMany: (prisma as any).publishingIntent.updateMany,
          },
        }),
      ),
    } as any;
    service = new CandidatesService(prisma as any);
    jest.spyOn(service["logger"], "log").mockImplementation(() => {});
    jest.spyOn(service["logger"], "warn").mockImplementation(() => {});
    jest.spyOn(service["logger"], "debug").mockImplementation(() => {});
    jest.spyOn(service["logger"], "error").mockImplementation(() => {});
  });

  it("applies a fresh content-service created event and persists it as ACTIVE", async () => {
    (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.publishingCandidate!.create as jest.Mock).mockResolvedValue({
      id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
      status: "ACTIVE",
    });

    const result = await service.ingestEvent(createdEvent);

    expect(result.disposition).toBe("applied");
    expect(prisma.publishingCandidate!.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
          businessId: "11111111-1111-4111-8111-111111111111",
          status: "ACTIVE",
          externalContentId: "99999999-9999-4999-8999-999999999999",
        }),
      }),
    );
  });

  it("returns the existing candidate on an identical created-event replay (no write)", async () => {
    const fingerprint = computePublishingSha256(createdEvent);
    const existing = {
      id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
      businessId: "11111111-1111-4111-8111-111111111111",
      candidateChecksum: "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
      eventFingerprint: fingerprint,
      eventId: "edededed-eded-4ede-8ede-edededededed",
      status: "ACTIVE",
      sourceStateVersion: 1,
      sourceStatus: ACTIVE_STATUS_V1,
      payload: (createdEvent as { payload: unknown }).payload,
      receivedAt: new Date(),
    };
    (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue(
      existing,
    );

    const result = await service.ingestEvent(createdEvent);

    expect(result.disposition).toBe("identical_replay");
    expect(result.candidate).toBe(existing);
    expect(prisma.publishingCandidate!.create).not.toHaveBeenCalled();
  });

  it("applies a state-changed (revoke) event and cascades cancellation to in-flight intents", async () => {
    const fingerprint = computePublishingSha256(createdEvent);
    const existingRow = {
      id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
      businessId: "11111111-1111-4111-8111-111111111111",
      candidateChecksum: "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
      eventFingerprint: fingerprint,
      eventId: "edededed-eded-4ede-8ede-edededededed",
      status: "ACTIVE",
      sourceStateVersion: 1,
      sourceStatus: {
        contract_version: "publication-candidate-status-v1",
        candidate_id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
        business_id: "11111111-1111-4111-8111-111111111111",
        candidate_checksum:
          "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
        state_version: 1,
        candidate_state: "active",
        replacement_candidate_id: null,
        changed_by_user_id: null,
        changed_at: "2026-08-01T11:01:01+03:00",
      },
      payload: (createdEvent as { payload: unknown }).payload,
      receivedAt: new Date(),
    };
    (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue(
      existingRow,
    );
    (prisma.publishingCandidate!.update as jest.Mock).mockResolvedValue({
      ...existingRow,
      status: "REVOKED",
      sourceStateVersion: 2,
    });

    const result = await service.ingestEvent(stateChangedEvent);

    expect(result.disposition).toBe("applied");
    expect(prisma.publishingCandidate!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "REVOKED",
          sourceStateVersion: 2,
        }),
      }),
    );
    // Revocation cascades cancellation to non-dispatched intents.
    expect(prisma.publishingIntent!.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          candidateId: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
          status: { in: ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED"] },
        }),
        data: { status: "CANCELLED" },
      }),
    );
  });

  it("rejects a second created event for an active record under a different event fingerprint (CANDIDATE_TAMPERED)", async () => {
    // A valid ACTIVE authoritative record at state version 1 with a DIFFERENT
    // event fingerprint than the incoming created event → the reducer treats it
    // as a conflicting replay of the created event → CANDIDATE_TAMPERED.
    const existingRow = {
      id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
      businessId: "11111111-1111-4111-8111-111111111111",
      candidateChecksum: "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
      eventFingerprint:
        "0000000000000000000000000000000000000000000000000000000000000000",
      eventId: "eded0000-0000-4000-8000-000000000000",
      status: "ACTIVE",
      sourceStateVersion: 1,
      sourceStatus: ACTIVE_STATUS_V1,
      payload: (createdEvent as { payload: unknown }).payload,
      receivedAt: new Date(),
    };
    (prisma.publishingCandidate!.findUnique as jest.Mock).mockResolvedValue(
      existingRow,
    );

    await expect(service.ingestEvent(createdEvent)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.publishingCandidate!.create).not.toHaveBeenCalled();
    expect(prisma.publishingCandidate!.update).not.toHaveBeenCalled();
  });

  it("rejects a created event whose candidate payload fails validation (CANDIDATE_INVALID)", async () => {
    // Valid envelope shape but a payload missing required candidate fields →
    // validatePublicationCandidateV1 fails → rejected_invalid → 422.
    const badCreatedEvent = {
      event_id: "edededed-eded-4ede-8ede-edededededed",
      event_type: "content.publication_candidate.created.v1",
      occurred_at: "2026-08-01T11:01:01+03:00",
      correlation_id: "fafafafa-fafa-4afa-8afa-fafafafafafa",
      payload: { contract_version: "publication-candidate-v1" },
    };
    await expect(service.ingestEvent(badCreatedEvent)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(prisma.publishingCandidate!.create).not.toHaveBeenCalled();
  });
});