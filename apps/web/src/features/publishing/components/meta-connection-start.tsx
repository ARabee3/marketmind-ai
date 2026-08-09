"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Link2, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/i18n/navigation";
import { connectMeta } from "@/lib/api/facebook";

/**
 * Facebook-only publishing connection entry point. PR #193 owns the OAuth
 * popup and persists the encrypted Page connection; this page only starts it
 * and returns the owner to the publishing workspace.
 *
 * Explains what gets connected (and that MarketMind never sees a Facebook
 * password), then opens the PR #193 popup flow. The page never handles an
 * authorization code, token, or credential reference.
 */
export function MetaConnectionStart() {
  const t = useTranslations("Publishing.meta");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<boolean>(false);

  async function start() {
    setStarting(true);
    setError(false);
    try {
      await connectMeta();
      router.replace("/publishing");
    } catch {
      setError(true);
      setStarting(false);
    }
  }

  const errorTone: {
    title: "resultUnknownTitle";
    body: "resultUnknownBody";
  } | null = error
    ? { title: "resultUnknownTitle", body: "resultUnknownBody" }
    : null;

  return (
    <section className="mx-auto grid max-w-2xl gap-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold text-navy">{t("connectTitle")}</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          {t("connectBody")}
        </p>
      </header>

      <div className="grid gap-5 rounded-xl border border-border bg-surface p-6 shadow-elevated">
        <h2 className="flex items-center gap-2 text-lg font-bold text-navy">
          <Link2 className="size-5 text-primary" aria-hidden="true" />
          {t("connectListTitle")}
        </h2>
        <ul className="grid gap-2 text-sm leading-6 text-muted-foreground">
          {(
            [
              "connectItemPage",
              "connectItemFormats",
              "connectItemToken",
            ] as const
          ).map((key) => (
            <li key={key} className="flex items-start gap-2">
              <span
                className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
              />
              {t(key)}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3 rounded-xl border border-warning/25 bg-warning/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-warning">
          <ShieldAlert className="size-4" aria-hidden="true" />
          {t("prereqTitle")}
        </h2>
        <ul className="grid gap-1.5 text-sm leading-6 text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
            {t("prereqPage")}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
            {t("prereqPermissions")}
          </li>
        </ul>
      </div>

      {errorTone ? (
        <section
          role="alert"
          className="grid gap-2 rounded-xl border border-danger/20 bg-danger/5 p-5"
        >
          <h2 className="flex items-center gap-2 text-base font-bold text-danger">
            <ShieldAlert className="size-5" aria-hidden="true" />
            {t(errorTone.title)}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {t(errorTone.body)}
          </p>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void start()}
          disabled={starting}
          className="min-h-10 items-center gap-2"
        >
          {starting ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          ) : (
            <Link2 className="size-4" aria-hidden="true" />
          )}
          {starting ? tc("loading") : t("startButton")}
        </Button>
        <Link
          href="/publishing"
          className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
        >
          <ArrowLeft className="size-4 rtl:scale-x-[-1]" aria-hidden="true" />
          {t("backButton")}
        </Link>
      </div>

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        {t("connectItemToken")}
      </p>
    </section>
  );
}
