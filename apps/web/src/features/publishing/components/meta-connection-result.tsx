"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PublishingTargetPublicV1 } from "@marketmind/contracts";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Link2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/i18n/navigation";
import {
  getMetaPendingSelection,
  selectMetaTargets,
  type PublishingMetaPendingSelection,
  type PublishingMetaAccountOption,
} from "@/lib/api/publishing";

export type MetaConnectionResultCode =
  | "success"
  | "cancelled"
  | "expired"
  | "denied"
  | "unknown";

const RESULT_CODES: readonly MetaConnectionResultCode[] = [
  "success",
  "cancelled",
  "expired",
  "denied",
  "unknown",
];

export type MetaConnectionCompleteContext = {
  readonly requestedChannel: "facebook" | "instagram" | null;
  readonly includeInstagram: boolean;
};

export type MetaConnectionResultProps = {
  readonly onComplete?: (
    targets: readonly PublishingTargetPublicV1[],
    context: MetaConnectionCompleteContext,
  ) => Promise<void> | void;
  readonly backHref?: string;
  readonly retryHref?: string;
  readonly successHref?: string;
  readonly requiredChannel?: "facebook" | "instagram" | null;
};

/** Reads the API callback redirect params (sanitized codes only) through the
 * Next navigation boundary and renders the connection journey state. */
export function PublishingMetaCallbackResult(
  props: MetaConnectionResultProps = {},
) {
  const searchParams = useSearchParams();
  const raw = searchParams.get("meta_result");
  const code: MetaConnectionResultCode = RESULT_CODES.includes(raw as never)
    ? (raw as MetaConnectionResultCode)
    : "unknown";
  const connectionId = searchParams.get("meta_connection");

  if (!raw && !connectionId) return null;
  return (
    <MetaConnectionResult
      code={code}
      connectionId={connectionId}
      {...props}
    />
  );
}

type State =
  | { readonly phase: "result"; readonly code: MetaConnectionResultCode }
  | { readonly phase: "loading"; readonly code: "success" }
  | { readonly phase: "choose"; readonly selection: PublishingMetaPendingSelection }
  | { readonly phase: "selecting"; readonly selection: PublishingMetaPendingSelection }
  | { readonly phase: "done" };

const SELECT_ERROR_KEYS = {
  conflict: "disconnectConfirm",
  blocked: "noOptionsBody",
  unknown: "resultUnknownBody",
} as const;

type MetaMessageKey =
  | "blockerNoPagePrivilege"
  | "blockerPagePublishCapabilityMissing"
  | "blockerInstagramNotLinked"
  | "blockerInstagramNotProfessional"
  | "blockerInstagramPublishCapabilityMissing"
  | "blockerAuthorizationExpired"
  | "blockerUnknown";

const BLOCKER_KEYS: Record<string, MetaMessageKey> = {
  no_page_privilege: "blockerNoPagePrivilege",
  page_publish_capability_missing: "blockerPagePublishCapabilityMissing",
  instagram_not_linked: "blockerInstagramNotLinked",
  instagram_not_professional: "blockerInstagramNotProfessional",
  instagram_publish_capability_missing: "blockerInstagramPublishCapabilityMissing",
  authorization_expired: "blockerAuthorizationExpired",
};

/**
 * Issue #175 — steps 2-3 of the guided Meta connection journey (the return
 * landing page after the API-owned callback).
 *
 * The URL carries only `meta_result` (success | cancelled | expired | denied |
 * unknown) and `meta_connection` (connection id). For a successful
 * authorization this page fetches the SAFE pending-account selection
 * (display metadata + capability status + blockers — never tokens), lets the
 * owner pick the Page and optional linked Instagram Professional account, and
 * creates verified targets.
 */
export function MetaConnectionResult({
  code,
  connectionId,
  onComplete,
  backHref = "/publishing",
  retryHref = "/publishing/meta/connect",
  successHref = "/publishing",
  requiredChannel = null,
}: {
  readonly code: MetaConnectionResultCode;
  readonly connectionId: string | null;
} & MetaConnectionResultProps) {
  const t = useTranslations("Publishing.meta");
  const [state, setState] = useState<State>(
    code === "success" ? { phase: "loading", code } : { phase: "result", code },
  );
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [includeInstagram, setIncludeInstagram] = useState(false);
  const [selectError, setSelectError] = useState<
    "conflict" | "blocked" | "unknown" | null
  >(null);

  const loadSelection = useCallback(async () => {
    if (!connectionId) {
      setState({ phase: "result", code: "unknown" });
      return;
    }
    try {
      const selection = await getMetaPendingSelection(connectionId);
      const supported = selection.options.find(
        (option) => option.page.capability_status === "supported",
      );
      setSelectedPageId(supported?.page.account_id ?? null);
      setState({ phase: "choose", selection });
    } catch {
      setState({ phase: "result", code: "unknown" });
    }
  }, [connectionId]);

  useEffect(() => {
    if (code !== "success") return;

    let active = true;
    if (!connectionId) {
      void Promise.resolve().then(() => {
        if (active) setState({ phase: "result", code: "unknown" });
      });
      return () => {
        active = false;
      };
    }

    void getMetaPendingSelection(connectionId)
      .then((selection) => {
        if (!active) return;
        const requestedChannel = requiredChannel ?? selection.requested_channel;
        const supported = selection.options.find(
          (option) => option.page.capability_status === "supported",
        );
        setSelectedPageId(supported?.page.account_id ?? null);
        setIncludeInstagram(requestedChannel === "instagram");
        setState({ phase: "choose", selection });
      })
      .catch(() => {
        if (active) setState({ phase: "result", code: "unknown" });
      });

    return () => {
      active = false;
    };
  }, [code, connectionId, requiredChannel]);

  async function confirmSelection() {
    if (!connectionId || !selectedPageId) return;
    if (state.phase !== "choose") return;
    const selection = state.selection;
    const requestedChannel = requiredChannel ?? selection.requested_channel;
    const shouldIncludeInstagram =
      requestedChannel === "instagram" || includeInstagram;
    setState({ phase: "selecting", selection });
    setSelectError(null);
    try {
      const targets = await selectMetaTargets({
        connectionId,
        pageId: selectedPageId,
        includeInstagram: shouldIncludeInstagram,
      });
      await onComplete?.(targets, {
        requestedChannel,
        includeInstagram: shouldIncludeInstagram,
      });
      setState({ phase: "done" });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? "";
      setSelectError(
        /PUBLISHING_TARGET_CONFLICT/.test(message)
          ? "conflict"
          : /PUBLISHING_TARGET_BLOCKED/.test(message)
            ? "blocked"
            : "unknown",
      );
      setState({ phase: "choose", selection });
    }
  }

  if (state.phase === "result") {
    return (
      <ResultState
        code={state.code}
        onRetry={() => {
          setState({ phase: "loading", code: "success" });
          void loadSelection();
        }}
        retryHref={retryHref}
        backHref={backHref}
      />
    );
  }

  if (state.phase === "loading") {
    return (
      <section className="mx-auto grid max-w-xl gap-4 rounded-xl border border-border bg-surface p-8 text-center shadow-elevated">
        <RefreshCw
          className="mx-auto size-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <p className="text-sm leading-6 text-muted-foreground">
          {t("loadingOptions")}
        </p>
      </section>
    );
  }

  if (state.phase === "done") {
    return (
      <section
        className="mx-auto grid max-w-xl gap-4 rounded-xl border border-primary/25 bg-primary/5 p-8 text-center shadow-elevated"
        role="status"
      >
        <CheckCircle2 className="mx-auto size-10 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-navy">{t("selectDoneTitle")}</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("selectDoneBody")}
        </p>
        <Link
          href={successHref}
          className={cn(buttonVariants({}), "mx-auto")}
        >
          {t("selectDoneAction")}
        </Link>
      </section>
    );
  }

  const selection = state.selection;
  const options = selection.options;
  const instagramRequired =
    (requiredChannel ?? selection.requested_channel) === "instagram";

  if (options.length === 0) {
    return (
      <section className="mx-auto grid max-w-xl gap-4 rounded-xl border border-warning/25 bg-warning/5 p-8 text-center shadow-elevated">
        <ShieldAlert className="mx-auto size-10 text-warning" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-navy">{t("noOptionsTitle")}</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("noOptionsBody")}
        </p>
        <Link
          href={backHref}
          className={cn(buttonVariants({ variant: "outline" }), "mx-auto")}
        >
          {t("resultBack")}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto grid max-w-2xl gap-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold text-navy">{t("resultSuccessTitle")}</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          {t("resultSuccessBody")}
        </p>
      </header>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-bold text-navy">
          {t("selectPage")}
        </legend>
        {options.map((option) => (
          <AccountOption
            key={option.page.account_id}
            option={option}
            selected={selectedPageId === option.page.account_id}
            onSelect={(pageId, instagram) => {
              setSelectedPageId(pageId);
              setIncludeInstagram(instagramRequired || instagram);
            }}
          />
        ))}
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-elevated">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--color-primary)]"
          checked={includeInstagram}
          onChange={(event) => setIncludeInstagram(event.target.checked)}
          disabled={instagramRequired}
          aria-describedby={instagramRequired ? "meta-instagram-required" : undefined}
        />
        <span className="text-sm leading-6 text-muted-foreground">
          {t("includeInstagram")}
        </span>
        {instagramRequired ? (
          <span id="meta-instagram-required" className="sr-only">
            {t("instagramRequired")}
          </span>
        ) : null}
      </label>

      {selectError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm text-danger"
        >
          {t(SELECT_ERROR_KEYS[selectError])}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void confirmSelection()}
          disabled={state.phase === "selecting" || !selectedPageId}
          className="min-h-10 items-center gap-2"
        >
          {state.phase === "selecting" ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          ) : (
            <Link2 className="size-4" aria-hidden="true" />
          )}
          {state.phase === "selecting" ? t("selecting") : t("selectButton")}
        </Button>
        <Link
          href={backHref}
          className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
        >
          <ArrowLeft className="size-4 rtl:scale-x-[-1]" aria-hidden="true" />
          {t("resultBack")}
        </Link>
      </div>
    </section>
  );
}

function AccountOption({
  option,
  selected,
  onSelect,
}: {
  readonly option: PublishingMetaAccountOption;
  readonly selected: boolean;
  readonly onSelect: (pageId: string, includeInstagram: boolean) => void;
}) {
  const t = useTranslations("Publishing.meta");
  const pageBlocked = option.page.capability_status !== "supported";

  return (
    <label
      className={`grid gap-3 rounded-xl border bg-surface p-4 shadow-elevated ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="meta-page"
          className="mt-1 size-4 accent-[var(--color-primary)]"
          checked={selected}
          disabled={pageBlocked}
          onChange={() => onSelect(option.page.account_id, false)}
        />
        <div className="grid gap-1">
          <p className="text-sm font-bold text-navy">
            {t("optionPageLabel")} — {option.page.display_name}
          </p>
          {pageBlocked ? (
            <p className="text-xs text-danger">
              {t("optionBlocked", {
                blocker: t(blockerLabel(option.page.blockers[0] ?? "blockerUnknown")),
              })}
            </p>
          ) : (
            <p className="text-xs text-primary">{t("optionSupported")}</p>
          )}
          {option.instagram ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("optionInstagramLabel")} — {option.instagram.display_name}
              {option.instagram.capability_status !== "supported" ? (
                <span className="block text-danger">
                  {t("optionBlocked", {
                    blocker: t(
                      blockerLabel(option.instagram.blockers[0] ?? "blockerUnknown"),
                    ),
                  })}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </label>
  );
}

function blockerLabel(code: string): MetaMessageKey {
  return BLOCKER_KEYS[code] ?? "blockerUnknown";
}

function ResultState({
  code,
  onRetry,
  backHref,
  retryHref,
}: {
  readonly code: MetaConnectionResultCode;
  readonly onRetry: () => void;
  readonly backHref: string;
  readonly retryHref: string;
}) {
  const t = useTranslations("Publishing.meta");
  const router = useRouter();

  function retry() {
    if (code === "success") {
      onRetry();
      return;
    }
    // Direct recovery action: start a brand-new connection journey.
    router.push(retryHref);
  }

  const content: Record<
    MetaConnectionResultCode,
    {
      title:
        | "resultSuccessTitle"
        | "resultCancelledTitle"
        | "resultExpiredTitle"
        | "resultDeniedTitle"
        | "resultUnknownTitle";
      body:
        | "resultSuccessBody"
        | "resultCancelledBody"
        | "resultExpiredBody"
        | "resultDeniedBody"
        | "resultUnknownBody";
      icon: "ok" | "warn" | "bad" | "clock";
    }
  > = {
    success: { title: "resultSuccessTitle", body: "resultSuccessBody", icon: "ok" },
    cancelled: { title: "resultCancelledTitle", body: "resultCancelledBody", icon: "clock" },
    expired: { title: "resultExpiredTitle", body: "resultExpiredBody", icon: "clock" },
    denied: { title: "resultDeniedTitle", body: "resultDeniedBody", icon: "warn" },
    unknown: { title: "resultUnknownTitle", body: "resultUnknownBody", icon: "bad" },
  };
  const item = content[code];

  const Icon =
    item.icon === "ok"
      ? CheckCircle2
      : item.icon === "warn"
        ? ShieldAlert
        : item.icon === "bad"
          ? XCircle
          : Clock;
  const tone =
    item.icon === "ok"
      ? "text-primary"
      : item.icon === "warn" || item.icon === "clock"
        ? "text-warning"
        : "text-danger";

  return (
    <section
      className="mx-auto grid max-w-xl gap-4 rounded-xl border border-border bg-surface p-8 text-center shadow-elevated"
      role="status"
    >
      <Icon className={`mx-auto size-10 ${tone}`} aria-hidden="true" />
      <h1 className="text-2xl font-bold text-navy">{t(item.title)}</h1>
      <p className="text-sm leading-6 text-muted-foreground">{t(item.body)}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {code !== "success" ? (
          <Button type="button" onClick={retry} className="gap-2">
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("resultRetry")}
          </Button>
        ) : null}
        <Link href={backHref} className={buttonVariants({ variant: "outline" })}>
          {t("resultBack")}
        </Link>
      </div>
    </section>
  );
}
