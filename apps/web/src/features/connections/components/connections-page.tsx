"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Link2, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  connectMeta,
  disconnectFacebookConnection,
  getFacebookConnection,
  testFacebookConnection,
  type FacebookConnectionView,
} from "@/lib/api/facebook";

type State =
  | { readonly phase: "loading" }
  | { readonly phase: "error" }
  | { readonly phase: "ready"; readonly connection: FacebookConnectionView | null };

export function ConnectionsPage() {
  const t = useTranslations("Connections");
  const format = useFormatter();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [notice, setNotice] = useState<{
    readonly kind: "success" | "error";
    readonly text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const connection = await getFacebookConnection();
      setState({ phase: "ready", connection });
      setNotice(null);
    } catch {
      setState({ phase: "error" });
    }
  }, []);

  useEffect(() => {
    let cancelled = false
    void getFacebookConnection()
      .then((connection) => {
        if (cancelled) return
        setState({ phase: 'ready', connection })
        setNotice(null)
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleConnect() {
    setConnecting(true)
    setNotice(null)
    try {
      const payload = await connectMeta()
      setNotice({ kind: 'success', text: t('connected', { pageName: payload.pageName }) })
      await refresh()
    } catch (caught) {
      setNotice({
        kind: 'error',
        text: caught instanceof Error ? caught.message : t('connectFailed'),
      })
    } finally {
      setConnecting(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setNotice(null)
    try {
      const result = await testFacebookConnection()
      await refresh()
      if (result.success) {
        setNotice({ kind: 'success', text: t('testSucceeded') })
      } else if (result.reason === 'expired') {
        setNotice({ kind: 'error', text: t('testExpired') })
      } else {
        setNotice({ kind: 'error', text: t('testFailed') })
      }
    } catch {
      await refresh()
      setNotice({ kind: 'error', text: t('testFailed') })
    } finally {
      setTesting(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    setNotice(null)
    try {
      await disconnectFacebookConnection()
      await refresh()
      setConfirmDisconnect(false)
      setNotice({ kind: 'success', text: t('disconnected') })
    } catch {
      setNotice({ kind: 'error', text: t('disconnectFailed') })
    } finally {
      setDisconnecting(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <section className="rounded-xl border border-border bg-surface p-6 shadow-elevated">
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      </section>
    )
  }

  const busy = connecting || testing || disconnecting

  return (
    <section className="grid gap-5">
      <header className="rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <p className="text-xs font-bold tracking-[0.14em] text-journey-mint uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">
          {t('subtitle')}
        </p>
      </header>

      <div aria-live="polite">
        {notice ? (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={
              notice.kind === 'error'
                ? 'text-sm font-semibold text-danger'
                : 'text-sm font-semibold text-primary'
            }
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      {state.phase === 'error' ? (
        <section className="grid gap-4 rounded-xl border border-border bg-surface p-6 shadow-elevated">
          <p className="text-sm text-danger">{t('loadFailed')}</p>
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t('retry')}
          </Button>
        </section>
      ) : null}

      {state.phase === 'ready' && state.connection === null ? (
        <EmptyState onConnect={handleConnect} connecting={connecting} />
      ) : null}

      {state.phase === 'ready' && state.connection?.isValid ? (
        <ConnectedState
          connection={state.connection}
          busy={busy}
          confirmDisconnect={confirmDisconnect}
          onAskDisconnect={() => setConfirmDisconnect(true)}
          onCancelDisconnect={() => setConfirmDisconnect(false)}
          onTest={handleTest}
          onDisconnect={handleDisconnect}
          formatDate={(date: string) =>
            format.dateTime(new Date(date), {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          }
        />
      ) : null}

      {state.phase === 'ready' &&
      state.connection !== null &&
      !state.connection.isValid ? (
        <ExpiredState onReconnect={handleConnect} connecting={connecting} />
      ) : null}
    </section>
  )
}

function EmptyState({
  onConnect,
  connecting,
}: {
  readonly onConnect: () => void
  readonly connecting: boolean
}) {
  const t = useTranslations('Connections')
  return (
    <section className="grid gap-4 rounded-xl border border-border bg-surface p-6 shadow-elevated">
      <span className="grid size-12 place-items-center rounded-lg bg-soft-teal text-primary">
        <Link2 className="size-6" aria-hidden="true" />
      </span>
      <h2 className="text-xl font-bold text-navy md:text-2xl">{t('emptyTitle')}</h2>
      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
        {t('emptyBody')}
      </p>
      <div>
        <Button
          type="button"
          className="shadow-tactile"
          disabled={connecting}
          onClick={onConnect}
        >
          <PlugZap className="size-4" aria-hidden="true" />
          {connecting ? t('connecting') : t('connectButton')}
        </Button>
      </div>
    </section>
  )
}

function ConnectedState({
  connection,
  busy,
  confirmDisconnect,
  onAskDisconnect,
  onCancelDisconnect,
  onTest,
  onDisconnect,
  formatDate,
}: {
  readonly connection: FacebookConnectionView
  readonly busy: boolean
  readonly confirmDisconnect: boolean
  readonly onAskDisconnect: () => void
  readonly onCancelDisconnect: () => void
  readonly onTest: () => void
  readonly onDisconnect: () => void
  readonly formatDate: (date: string) => string
}) {
  const t = useTranslations('Connections')
  return (
    <section className="grid gap-4 rounded-xl border border-border bg-surface p-6 shadow-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-lg bg-soft-teal text-primary">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <span>
            <h2 className="text-xl font-bold text-navy">{connection.pageName}</h2>
            <p className="text-sm text-muted-foreground">{t('facebookProvider')}</p>
          </span>
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
          {t('statusConnected')}
        </span>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <dt className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
            {t('connectedAt')}
          </dt>
          <dd className="mt-1 font-semibold text-navy">
            {formatDate(connection.connectedAt)}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <dt className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
            {t('lastTestedAt')}
          </dt>
          <dd className="mt-1 font-semibold text-navy">
            {connection.lastTestedAt
              ? formatDate(connection.lastTestedAt)
              : t('neverTested')}
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" className="shadow-tactile" disabled={busy} onClick={onTest}>
          {t('testButton')}
        </Button>
        {confirmDisconnect ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
            <p className="text-sm font-semibold text-danger">
              {t('disconnectConfirm')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={onDisconnect}
              >
                {t('disconnectConfirmAction')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={onCancelDisconnect}
              >
                {t('cancelDisconnect')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onAskDisconnect}
          >
            {t('disconnectButton')}
          </Button>
        )}
      </div>
    </section>
  )
}

function ExpiredState({
  onReconnect,
  connecting,
}: {
  readonly onReconnect: () => void
  readonly connecting: boolean
}) {
  const t = useTranslations('Connections')
  return (
    <section className="grid gap-4 rounded-xl border border-border bg-surface p-6 shadow-elevated">
      <span className="grid size-12 place-items-center rounded-lg bg-warning/10 text-warning">
        <CircleAlert className="size-6" aria-hidden="true" />
      </span>
      <h2 className="text-xl font-bold text-navy md:text-2xl">{t('expiredTitle')}</h2>
      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
        {t('expiredBody')}
      </p>
      <div>
        <Button
          type="button"
          className="shadow-tactile"
          disabled={connecting}
          onClick={onReconnect}
        >
          <PlugZap className="size-4" aria-hidden="true" />
          {connecting ? t('connecting') : t('reconnectButton')}
        </Button>
      </div>
    </section>
  )
}
