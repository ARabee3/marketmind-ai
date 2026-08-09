"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ContentMediaLibraryEntryV2 } from "@marketmind/contracts";
import { getMediaFileV2 } from "@/lib/api/content-v2";
import { cn } from "@/lib/utils";

type MediaOptionProps = {
  readonly cycleId: string;
  readonly entry: ContentMediaLibraryEntryV2;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
};

export function ContentV2MediaOption({
  cycleId,
  entry,
  selected,
  disabled,
  onSelect,
}: MediaOptionProps) {
  const t = useTranslations("ContentV2.media");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const kindLabel =
    entry.kind === "generated_static"
      ? t("generatedMedia")
      : t("uploadedMedia");
  const dimensions =
    entry.width && entry.height ? `${entry.width}×${entry.height}` : "";

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void getMediaFileV2(cycleId, entry.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cycleId, entry.id]);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={t("optionLabel", {
        kind: kindLabel,
        dimensions: dimensions || t("dimensionsUnknown"),
      })}
      className={cn(
        "flex min-w-28 flex-col gap-1 rounded-lg border p-2 text-start text-xs font-semibold text-navy transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60",
        selected
          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
          : "border-border",
      )}
    >
      <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md bg-muted">
        {previewUrl ? (
          <Image
            src={previewUrl}
            alt=""
            aria-hidden="true"
            width={160}
            height={120}
            unoptimized
            className="size-full object-cover"
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">{kindLabel}</span>
        )}
      </span>
      <span className="truncate">{kindLabel}</span>
      {dimensions ? (
        <span className="font-normal text-muted-foreground">{dimensions}</span>
      ) : null}
      {selected ? (
        <span className="text-[10px] font-bold text-primary">
          {t("selected")}
        </span>
      ) : null}
    </button>
  );
}
