import { ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { MarketingKnowledgeEntryRepository } from "../marketing-knowledge-entry.repository";
import { MarketingKnowledgeVersionRepository } from "../marketing-knowledge-version.repository";
import { MarketingKnowledgeSourceRepository } from "../marketing-knowledge-source.repository";
import { MarketingKnowledgeIngestionRunRepository } from "../marketing-knowledge-ingestion-run.repository";
import { KnowledgeLibraryAdminService } from "./knowledge-library-admin.service";

const ACTOR = { id: "admin-id", email: "admin@example.com" };

function validVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    entryId: "entry-1",
    version: 1,
    kind: "framework",
    title: "Title",
    summary: "Summary",
    body: "Body",
    locale: "en",
    markets: ["egypt"],
    industries: ["retail"],
    businessModels: [],
    objectives: ["awareness"],
    funnelStages: ["awareness"],
    channels: ["facebook"],
    seasons: [],
    budgetModes: ["organic_only"],
    evidenceTier: "contextual_note",
    reviewStatus: "draft",
    effectiveAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: null,
    author: "author",
    reviewer: null,
    reviewedAt: null,
    checksum: "chk",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    sources: [],
    ...overrides,
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    slug: "entry/slug",
    latestVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    versions: [],
    ...overrides,
  };
}

function prismaMock() {
  return {
    marketingKnowledgeEntry: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    marketingKnowledgeEntryVersion: {
      findFirst: jest.fn(),
    },
    marketingKnowledgeIngestionRun: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  } as unknown as PrismaService;
}

const entryRepo = {
  findBySlug: jest.fn(),
} as unknown as MarketingKnowledgeEntryRepository;

const versionRepo = {
  createNewVersion: jest.fn(),
  retire: jest.fn(),
} as unknown as MarketingKnowledgeVersionRepository;

const sourceRepo = {} as unknown as MarketingKnowledgeSourceRepository;

const ingestionRunRepo = {
  start: jest.fn(),
} as unknown as MarketingKnowledgeIngestionRunRepository;

const auditService = {
  record: jest.fn(),
} as unknown as AuditService;

describe("KnowledgeLibraryAdminService", () => {
  let service: KnowledgeLibraryAdminService;
  let prisma: PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = prismaMock();
    service = new KnowledgeLibraryAdminService(
      prisma,
      entryRepo,
      versionRepo,
      sourceRepo,
      ingestionRunRepo,
      auditService,
    );
  });

  describe("approveDraft", () => {
    it("promotes a draft to an approved version with reviewer metadata", async () => {
      const draft = validVersion({ sources: [{ reference: "https://example.com", note: "n" }] });
      (entryRepo.findBySlug as jest.Mock).mockResolvedValue(entry());
      (prisma.marketingKnowledgeEntryVersion.findFirst as jest.Mock).mockResolvedValue(draft);
      (versionRepo.createNewVersion as jest.Mock).mockResolvedValue({
        id: "version-2",
        entryId: "entry-1",
        version: 2,
        reviewStatus: "approved",
        createdAt: new Date(),
      });

      const result = await service.approveDraft("entry/slug", ACTOR);

      expect(versionRepo.createNewVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: "entry/slug",
          reviewStatus: "approved",
          reviewer: "admin@example.com",
          reviewedAt: expect.any(String),
          kind: "framework",
        }),
      );
      expect(result.reviewStatus).toBe("approved");
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorEmail: "admin@example.com",
          action: "knowledge.approve",
          targetId: "entry-1",
        }),
      );
    });

    it("throws NotFoundException for a missing entry", async () => {
      (entryRepo.findBySlug as jest.Mock).mockResolvedValue(null);

      await expect(service.approveDraft("missing", ACTOR)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ConflictException when the latest version is not draft", async () => {
      (entryRepo.findBySlug as jest.Mock).mockResolvedValue(entry());
      (prisma.marketingKnowledgeEntryVersion.findFirst as jest.Mock).mockResolvedValue(
        validVersion({ reviewStatus: "approved" }),
      );

      await expect(service.approveDraft("entry/slug", ACTOR)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("rejectDraft", () => {
    it("retires the current draft", async () => {
      const draft = validVersion();
      (entryRepo.findBySlug as jest.Mock).mockResolvedValue(entry());
      (prisma.marketingKnowledgeEntryVersion.findFirst as jest.Mock).mockResolvedValue(draft);

      const result = await service.rejectDraft("entry/slug", ACTOR);

      expect(versionRepo.retire).toHaveBeenCalledWith("version-1");
      expect(result.reviewStatus).toBe("retired");
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "knowledge.reject",
          targetId: "entry-1",
        }),
      );
    });

    it("throws NotFoundException for a missing entry", async () => {
      (entryRepo.findBySlug as jest.Mock).mockResolvedValue(null);

      await expect(service.rejectDraft("missing", ACTOR)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ConflictException when the latest version is not draft", async () => {
      (entryRepo.findBySlug as jest.Mock).mockResolvedValue(entry());
      (prisma.marketingKnowledgeEntryVersion.findFirst as jest.Mock).mockResolvedValue(
        validVersion({ reviewStatus: "retired" }),
      );

      await expect(service.rejectDraft("entry/slug", ACTOR)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("triggerIngestion", () => {
    it("records a run with the actor email and audits it", async () => {
      (ingestionRunRepo.start as jest.Mock).mockResolvedValue({
        id: "run-1",
        actor: "admin@example.com",
        status: "running",
      });

      const result = await service.triggerIngestion(ACTOR);

      expect(ingestionRunRepo.start).toHaveBeenCalledWith({
        actor: "admin@example.com",
        configuration: { triggeredBy: "admin-console", source: "corpus" },
      });
      expect(result.id).toBe("run-1");
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "knowledge.ingest",
          targetId: "run-1",
        }),
      );
    });
  });

  describe("listEntries", () => {
    it("filters by latest version status and paginates after filtering", async () => {
      const entries = [
        entry({ id: "e1", slug: "a/draft", versions: [validVersion({ reviewStatus: "draft" })] }),
        entry({ id: "e2", slug: "b/approved", versions: [validVersion({ reviewStatus: "approved" })] }),
      ];
      (prisma.marketingKnowledgeEntry.findMany as jest.Mock).mockResolvedValue(entries);

      const result = await service.listEntries({ status: "approved" } as never);

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].entry.slug).toBe("b/approved");
    });
  });
});