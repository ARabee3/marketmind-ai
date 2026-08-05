import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "good" | "warning" | "danger" | "neutral";

export function PublishingBadge({
  tone = "neutral",
  children,
}: {
  readonly tone?: Tone;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-[0.08em] uppercase",
        tone === "good" && "border-primary/20 bg-soft-teal text-primary",
        tone === "warning" && "border-warning/25 bg-warning/10 text-warning",
        tone === "danger" && "border-danger/20 bg-danger/10 text-danger",
        tone === "neutral" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
