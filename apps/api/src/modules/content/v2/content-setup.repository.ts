import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ContentCtaLibraryEntry } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { ContentCtaDestination } from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";

function defaultVoiceForPreset(preset: string | undefined): string {
  switch (preset) {
    case "friendly_local":
      return "Friendly and local, while staying practical and truthful.";
    case "clear_professional":
      return "Clear and professional, with concise grounded language.";
    case "warm_reassuring":
      return "Warm and reassuring, without making unsupported promises.";
    case "direct_confident":
      return "Direct and confident, while staying grounded in confirmed facts.";
    default:
      return "Practical, clear, and trustworthy; use only confirmed business facts.";
  }
}

export type UpsertEditorialProfileInput = {
  readonly contentCycleId: string;
  readonly audienceNuance?: string;
  readonly voice?: string;
  readonly language: string;
  readonly writingGuardrails: readonly string[];
  readonly defaultVisualGuidance: string | null;
  readonly tonePreset?: string;
  readonly lengthPreset?: string;
};

export type CreateCtaEntryInput = {
  readonly contentCycleId: string;
  readonly label: string;
  readonly destination: ContentCtaDestination;
  readonly campaignContext: string | null;
  readonly active: boolean;
};

/**
 * Content v2 setup-domain persistence (issue #187).
 *
 * Every read is owner-scoped through the cycle: a cycle that is not owned by
 * the caller is treated as absent (404). Writes are idempotent where the
 * request carries an idempotency key and conflict otherwise.
 */
@Injectable()
export class ContentSetupRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCycleOwned(
    tx: Prisma.TransactionClient,
    contentCycleId: string,
    ownerUserId: string,
  ): Promise<void> {
    const cycle = await tx.contentCycle.findFirst({
      where: { id: contentCycleId, ownerUserId },
      select: { id: true },
    });
    if (!cycle) {
      throw new NotFoundException("Content cycle not found");
    }
  }

  // -------------------------------------------------------------------------
  // Editorial profile
  // -------------------------------------------------------------------------

  async upsertEditorialProfile(
    input: UpsertEditorialProfileInput,
    ownerUserId: string,
  ): Promise<Prisma.ContentEditorialProfileGetPayload<Record<string, never>>> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, input.contentCycleId, ownerUserId);
      const existing = await tx.contentEditorialProfile.findUnique({
        where: { contentCycleId: input.contentCycleId },
      });
      if (existing) {
        return tx.contentEditorialProfile.update({
          where: { id: existing.id },
          data: {
            audienceNuance:
              input.audienceNuance?.trim() ||
              "Use the confirmed audience facts from the business profile.",
            voice: input.voice?.trim() || defaultVoiceForPreset(input.tonePreset),
            language: input.language,
            writingGuardrails:
              input.writingGuardrails as unknown as Prisma.InputJsonValue,
            defaultVisualGuidance: input.defaultVisualGuidance,
            tonePreset: input.tonePreset ?? "recommended",
            lengthPreset: input.lengthPreset ?? "balanced",
          },
        });
      }
      return tx.contentEditorialProfile.create({
        data: {
          contentCycleId: input.contentCycleId,
          audienceNuance:
            input.audienceNuance?.trim() ||
            "Use the confirmed audience facts from the business profile.",
          voice: input.voice?.trim() || defaultVoiceForPreset(input.tonePreset),
          language: input.language,
          writingGuardrails:
            input.writingGuardrails as unknown as Prisma.InputJsonValue,
          defaultVisualGuidance: input.defaultVisualGuidance,
          tonePreset: input.tonePreset ?? "recommended",
          lengthPreset: input.lengthPreset ?? "balanced",
        },
      });
    });
  }

  async deleteEditorialProfile(
    contentCycleId: string,
    ownerUserId: string,
  ): Promise<{ reset: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      const result = await tx.contentEditorialProfile.deleteMany({
        where: { contentCycleId },
      });
      return { reset: result.count === 1 };
    });
  }

  async getEditorialProfile(
    contentCycleId: string,
    ownerUserId: string,
  ): Promise<Prisma.ContentEditorialProfileGetPayload<
    Record<string, never>
  > | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      return tx.contentEditorialProfile.findUnique({
        where: { contentCycleId },
      });
    });
  }

  // -------------------------------------------------------------------------
  // CTA library
  // -------------------------------------------------------------------------

  async createCtaEntry(
    input: CreateCtaEntryInput,
    ownerUserId: string,
  ): Promise<ContentCtaLibraryEntry> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, input.contentCycleId, ownerUserId);
      return tx.contentCtaLibraryEntry.create({
        data: {
          contentCycleId: input.contentCycleId,
          label: input.label,
          destination: input.destination as unknown as Prisma.InputJsonValue,
          campaignContext: input.campaignContext,
          active: input.active,
        },
      });
    });
  }

  async listCtaEntries(
    contentCycleId: string,
    ownerUserId: string,
  ): Promise<ContentCtaLibraryEntry[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      return tx.contentCtaLibraryEntry.findMany({
        where: { contentCycleId },
        orderBy: { createdAt: "asc" },
      });
    });
  }

  async updateCtaEntry(
    contentCycleId: string,
    entryId: string,
    ownerUserId: string,
    changes: Partial<{
      label: string;
      destination: ContentCtaDestination;
      campaignContext: string | null;
      active: boolean;
    }>,
  ): Promise<ContentCtaLibraryEntry> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      const entry = await tx.contentCtaLibraryEntry.findFirst({
        where: { id: entryId, contentCycleId },
      });
      if (!entry) {
        throw new NotFoundException("CTA library entry not found");
      }
      return tx.contentCtaLibraryEntry.update({
        where: { id: entryId },
        data: {
          ...(changes.label !== undefined ? { label: changes.label } : {}),
          ...(changes.destination !== undefined
            ? {
                destination:
                  changes.destination as unknown as Prisma.InputJsonValue,
              }
            : {}),
          ...(changes.campaignContext !== undefined
            ? { campaignContext: changes.campaignContext }
            : {}),
          ...(changes.active !== undefined ? { active: changes.active } : {}),
        },
      });
    });
  }

  /** Soft deactivate: frozen snapshots keep the entry as it was used. */
  async deactivateCtaEntry(
    contentCycleId: string,
    entryId: string,
    ownerUserId: string,
  ): Promise<ContentCtaLibraryEntry> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      const updated = await tx.contentCtaLibraryEntry.updateMany({
        where: { id: entryId, contentCycleId, active: true },
        data: { active: false },
      });
      if (updated.count === 0) {
        const exists = await tx.contentCtaLibraryEntry.findFirst({
          where: { id: entryId, contentCycleId },
        });
        if (!exists) {
          throw new NotFoundException("CTA library entry not found");
        }
        throw new ConflictException("CTA library entry is already inactive");
      }
      return tx.contentCtaLibraryEntry.findUniqueOrThrow({
        where: { id: entryId },
      });
    });
    return result;
  }
}

/** New v2 CTA entry id helper (kept here to avoid scattering id sources). */
export function newCtaEntryId(): string {
  return randomUUID();
}
