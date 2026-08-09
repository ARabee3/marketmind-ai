"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getContentPack } from "@/lib/api/content-cycle";
import { ContentV2ReviewWorkspace } from "@/features/content/v2/content-v2-review";

type GateProps = {
  readonly packId: string;
};

/**
 * Routes pack review to the content-v2 post-card workspace for v2 packs and
 * a recovery notice for historical content-v1 packs (issue #187). The active
 * path reads the real v2 aggregate only — no fixture fallback or legacy
 * workspace routing.
 */
export function ContentPackReviewGate({ packId }: GateProps) {
  const tReview = useTranslations("ContentV2.review");
  const tErrors = useTranslations("ContentV2.errors");
  const [resolution, setResolution] = useState<
    | { phase: "loading" }
    | { phase: "legacy" }
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
                : "legacy",
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
        {tReview("loading")}
      </div>
    );
  }

  if (resolution.phase === "v2") {
    return <ContentV2ReviewWorkspace packId={packId} />;
  }

  if (resolution.phase === "error") {
    return (
      <div className="mx-auto max-w-xl py-12 text-center space-y-4">
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-danger space-y-3">
          <p className="text-sm font-bold">{tErrors("loadFailed")}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white"
          >
            {tErrors("refresh")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-12 text-center space-y-4">
      <div className="rounded-xl border border-warning/30 bg-warning/10 p-6 text-warning space-y-3">
        <p className="text-sm font-bold">{tErrors("legacyCycle")}</p>
        <Link
          href="/content"
          className="inline-flex rounded-lg bg-action px-4 py-2 text-xs font-bold text-white"
        >
          {tErrors("backToContent")}
        </Link>
      </div>
    </div>
  );
}
