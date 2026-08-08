"use client";

import { useEffect, useState } from "react";
import { getContentPack } from "@/lib/api/content-cycle";
import { ContentReviewWorkspace } from "@/features/content/review/components/ContentReviewWorkspace";
import { ContentV2ReviewWorkspace } from "@/features/content/v2/content-v2-review";

type GateProps = {
  readonly packId: string;
};

/**
 * Routes pack review to the content-v2 post-card workspace for v2 packs and
 * the legacy workspace for content-v1 packs (issue #187). The v2 path reads
 * the real aggregate read model only — no fixture fallback.
 */
export function ContentPackReviewGate({ packId }: GateProps) {
  const [resolution, setResolution] = useState<
    | { phase: "loading" }
    | { phase: "v1" }
    | { phase: "v2" }
    | { phase: "error" }
  >({ phase: "loading" });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const pack = await getContentPack(packId);
          setResolution({
            phase:
              (pack as { contract_version?: string }).contract_version ===
              "content-v2"
                ? "v2"
                : "v1",
          });
        } catch {
          setResolution({ phase: "error" });
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [packId]);

  if (resolution.phase === "loading") {
    return (
      <div className="py-12 text-center text-sm font-semibold text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (resolution.phase === "v2") {
    return <ContentV2ReviewWorkspace packId={packId} />;
  }

  if (resolution.phase === "error") {
    // The legacy workspace keeps its clearly-labeled fixture fallback for
    // the demo pack; a real v2 pack always resolves through the aggregate.
    return <ContentReviewWorkspace packId={packId} />;
  }

  return <ContentReviewWorkspace packId={packId} />;
}
