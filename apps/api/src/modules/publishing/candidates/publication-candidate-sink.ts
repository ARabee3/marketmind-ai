import type { CandidatesService } from "./candidates.service";

/**
 * Application-level handoff used when Content and Publishing run in the same
 * Nest process.
 *
 * The HTTP ingestion controller remains available for a future service split,
 * but the monorepo path must not depend on a webhook URL or an internal HTTP
 * round-trip just to move an approved candidate between modules.
 */
export interface PublicationCandidateSink {
  ingestEvent(event: unknown): ReturnType<CandidatesService["ingestEvent"]>;
}

/** Nest token for the local Content → Publishing handoff. */
export const PUBLICATION_CANDIDATE_SINK = Symbol("PUBLICATION_CANDIDATE_SINK");
