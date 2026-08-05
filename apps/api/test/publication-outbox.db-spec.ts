import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "../src/common/persistence/prisma.service";
import { PublicationCandidateRepository } from "../src/modules/content/repositories/publication-candidate.repository";

const prisma = new PrismaClient();
const eventId = randomUUID();
const candidateId = randomUUID();

describe("Publication candidate outbox lease recovery", () => {
  let repository: PublicationCandidateRepository;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PublicationCandidateRepository(
      prisma as unknown as PrismaService,
    );
    await prisma.publicationCandidateOutbox.create({
      data: {
        eventId,
        eventType: "content.publication_candidate.created.v1",
        correlationId: randomUUID(),
        candidateId,
        payload: { event_id: eventId, candidate_id: candidateId },
        state: "pending",
      },
    });
  });

  afterAll(async () => {
    await prisma.publicationCandidateOutbox.deleteMany({ where: { eventId } });
    await prisma.$disconnect();
  });

  it("allows one live claimant, recovers an expired lease, and preserves event identity", async () => {
    const [first, second] = await Promise.all([
      repository.claimOutboxByEventId(eventId, "worker-a"),
      repository.claimOutboxByEventId(eventId, "worker-b"),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const owner = first ? "worker-a" : "worker-b";
    const claimed = first ?? second;
    expect(claimed?.eventId).toBe(eventId);

    await prisma.publicationCandidateOutbox.update({
      where: { eventId },
      data: { leaseExpiresAt: new Date(0) },
    });
    const recovered = await repository.claimOutboxByEventId(
      eventId,
      "worker-recovery",
    );
    expect(recovered?.eventId).toBe(eventId);
    expect(recovered?.candidateId).toBe(candidateId);

    await expect(
      repository.releaseOutboxClaim(eventId, "worker-recovery", "webhook down"),
    ).resolves.toBe(true);
    const pending = await prisma.publicationCandidateOutbox.findUniqueOrThrow({
      where: { eventId },
    });
    expect(pending.state).toBe("pending");
    expect(pending.attempts).toBe(1);
    expect(pending.nextAttemptAt).not.toBeNull();

    await prisma.publicationCandidateOutbox.update({
      where: { eventId },
      data: { nextAttemptAt: new Date(0) },
    });
    const dispatchedClaim = await repository.claimOutboxByEventId(
      eventId,
      "worker-final",
    );
    expect(dispatchedClaim?.eventId).toBe(eventId);
    await expect(
      repository.markOutboxDispatched(eventId, "worker-final"),
    ).resolves.toBe(true);
    const dispatched =
      await prisma.publicationCandidateOutbox.findUniqueOrThrow({
        where: { eventId },
      });
    expect(dispatched.state).toBe("dispatched");
    expect(dispatched.eventId).toBe(eventId);
    expect(dispatched.candidateId).toBe(candidateId);
    expect(owner).toMatch(/^worker-[ab]$/);
  });
});
