import { Prisma } from "@prisma/client";
import { PrismaService } from "../src/common/persistence/prisma.service";
import { PublicationCandidateRepository } from "../src/modules/content/repositories/publication-candidate.repository";
import type { ContentDecisionRow } from "../src/modules/content/repositories/content-decision.repository";
import { CandidatesService } from "../src/modules/publishing/candidates/candidates.service";

const businessId = process.argv
  .find((argument) => argument.startsWith("--business-id="))
  ?.slice("--business-id=".length);
const apply = process.argv.includes("--apply");

if (!businessId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(businessId)) {
  throw new Error(
    "Usage: ts-node scripts/backfill-text-publication-candidates.ts --business-id=<uuid> [--apply]",
  );
}

const prisma = new PrismaService();
const candidateRepository = new PublicationCandidateRepository(prisma);
const publishingSink = new CandidatesService(prisma);

async function main(): Promise<void> {
  await prisma.$connect();

  const versions = await prisma.contentItemVersion.findMany({
    where: {
      format: "text_post",
      contentPack: { businessId },
      decisions: { some: { decision: "approved" } },
    },
    include: {
      contentItem: { select: { currentVersionId: true } },
      decisions: {
        where: { decision: "approved" },
        orderBy: { decidedAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ contentPackId: "asc" }, { contentItemId: "asc" }],
  });

  const currentApprovedVersions = versions.filter(
    (version) =>
      version.contentItem.currentVersionId === version.id &&
      version.decisions.length === 1,
  );
  const existing = await prisma.publicationCandidate.findMany({
    where: {
      businessId,
      contentItemVersionId: {
        in: currentApprovedVersions.map((version) => version.id),
      },
    },
    select: { contentItemVersionId: true },
  });
  const existingVersionIds = new Set(
    existing.map((candidate) => candidate.contentItemVersionId),
  );
  const missing = currentApprovedVersions.filter(
    (version) => !existingVersionIds.has(version.id),
  );

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        business_id: businessId,
        missing_count: missing.length,
        content_item_version_ids: missing.map((version) => version.id),
      },
      null,
      2,
    ),
  );
  if (!apply) return;

  for (const version of missing) {
    const decision = version.decisions[0];
    const approval: ContentDecisionRow = {
      ...decision,
      decision: "approved",
    };
    await candidateRepository.createCandidate({
      approval,
      itemVersion: {
        id: version.id,
        contentItemId: version.contentItemId,
        contentPackId: version.contentPackId,
        version: version.version,
        versionChecksum: version.versionChecksum,
        channel: version.channel,
        format: version.format,
        languageMode: version.languageMode,
        captionVariants: version.captionVariants as Prisma.InputJsonValue,
        cta: version.cta,
        hashtags: version.hashtags as Prisma.InputJsonValue,
        altText: version.altText,
        recommendedPublishWindow:
          version.recommendedPublishWindow as Prisma.InputJsonValue,
      },
      assets: [],
      ownerUserId: decision.ownerUserId,
    });
  }

  const contentCandidates = await prisma.publicationCandidate.findMany({
    where: { businessId },
    select: { candidateId: true },
  });
  const pendingEvents = await prisma.publicationCandidateOutbox.findMany({
    where: {
      candidateId: {
        in: contentCandidates.map((candidate) => candidate.candidateId),
      },
      eventType: "content.publication_candidate.created.v1",
      state: "pending",
    },
    orderBy: { createdAt: "asc" },
  });

  let dispatched = 0;
  for (const event of pendingEvents) {
    await publishingSink.ingestEvent(event.payload);
    if (await candidateRepository.markOutboxDispatched(event.eventId)) {
      dispatched += 1;
    }
  }

  const publishingCount = await prisma.publishingCandidate.count({
    where: { businessId, format: "text_post" },
  });
  console.log(
    JSON.stringify(
      {
        created_count: missing.length,
        dispatched_event_count: dispatched,
        publishing_text_candidate_count: publishingCount,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    const response =
      error &&
      typeof error === "object" &&
      "response" in error &&
      typeof error.response === "object"
        ? error.response
        : error;
    console.error(JSON.stringify(response, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
