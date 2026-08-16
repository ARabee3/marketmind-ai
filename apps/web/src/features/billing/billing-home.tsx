'use client'

import { useCallback, useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type {
  BillingCheckoutResponse,
  BillingPaymentMode,
  BillingPointBundle,
  BillingPointLedgerEntry,
  BillingTransactionResponse,
  BillingWalletResponse,
} from '@marketmind/contracts'
import { LoaderCircle, ShieldCheck, WalletCards } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  confirmSandboxCheckout,
  createBillingCheckout,
  getBillingBundles,
  getBillingLedger,
  getBillingTransactions,
  getBillingWallet,
} from '@/lib/api/billing'

type BillingData = {
  readonly wallet: BillingWalletResponse
  readonly bundles: readonly BillingPointBundle[]
  readonly ledger: readonly BillingPointLedgerEntry[]
  readonly transactions: readonly BillingTransactionResponse[]
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: BillingData }
  | { readonly status: 'error' }

type ActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'working'; readonly kind: 'checkout' | 'confirm' }
  | { readonly status: 'success'; readonly checkout: BillingCheckoutResponse }
  | { readonly status: 'error' }

export function BillingHome() {
  const t = useTranslations('Billing')
  const formatter = useFormatter()
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [action, setAction] = useState<ActionState>({ status: 'idle' })

  const fetchBilling = useCallback(async (): Promise<BillingData> => {
    const [wallet, bundles, ledger, transactions] = await Promise.all([
      getBillingWallet(),
      getBillingBundles(),
      getBillingLedger(),
      getBillingTransactions(),
    ])
    return {
      wallet,
      bundles: bundles.bundles,
      ledger: ledger.entries,
      transactions: transactions.transactions,
    }
  }, [])

  const loadBilling = useCallback(async () => {
    setLoadState({ status: 'loading' })
    try {
      setLoadState({ status: 'ready', data: await fetchBilling() })
    } catch {
      setLoadState({ status: 'error' })
    }
  }, [fetchBilling])

  useEffect(() => {
    let active = true
    void fetchBilling()
      .then((data) => {
        if (active) setLoadState({ status: 'ready', data })
      })
      .catch(() => {
        if (active) setLoadState({ status: 'error' })
      })
    return () => {
      active = false
    }
  }, [fetchBilling])

  if (loadState.status === 'loading') {
    return <BillingLoading />
  }

  if (loadState.status === 'error') {
    return (
      <section className="grid gap-4" aria-live="polite">
        <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="text-3xl font-bold text-navy">{t('title')}</h1>
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {t('loadError')}
        </div>
        <Button type="button" variant="outline" onClick={() => void loadBilling()}>
          {t('retry')}
        </Button>
      </section>
    )
  }

  return (
    <BillingReadyView
      data={loadState.data}
      action={action}
      setAction={setAction}
      reload={loadBilling}
      formatCurrency={(amount) =>
        formatter.number(amount, {
          style: 'currency',
          currency: 'EGP',
          maximumFractionDigits: 0,
        })
      }
      formatDate={(value) =>
        formatter.dateTime(new Date(value), {
          dateStyle: 'medium',
        })
      }
    />
  )
}

function BillingReadyView({
  data,
  action,
  setAction,
  reload,
  formatCurrency,
  formatDate,
}: {
  readonly data: BillingData
  readonly action: ActionState
  readonly setAction: (state: ActionState) => void
  readonly reload: () => Promise<void>
  readonly formatCurrency: (amount: number) => string
  readonly formatDate: (value: string) => string
}) {
  const t = useTranslations('Billing')
  const checkout = action.status === 'success' ? action.checkout : null
  const working = action.status === 'working'

  const runCheckout = async (bundle: BillingPointBundle) => {
    setAction({ status: 'working', kind: 'checkout' })
    try {
      const paymentMode: BillingPaymentMode = 'one_time_card'
      const result = await createBillingCheckout(
        bundle.code,
        paymentMode,
        globalThis.crypto.randomUUID(),
      )
      if (!result.sandbox) {
        globalThis.location.assign(result.checkout_url)
        return
      }
      setAction({ status: 'success', checkout: result })
    } catch {
      setAction({ status: 'error' })
    }
  }

  const confirmCheckout = async (outcome: 'paid' | 'failed') => {
    if (!checkout?.provider_checkout_ref) return
    setAction({ status: 'working', kind: 'confirm' })
    try {
      await confirmSandboxCheckout(checkout.provider_checkout_ref, outcome)
      await reload()
      setAction({ status: 'idle' })
    } catch {
      setAction({ status: 'error' })
    }
  }

  return (
    <section className="grid gap-6">
      <header className="grid gap-3 border-b border-border pb-5 md:pb-7">
        <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
          {t('eyebrow')}
        </p>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-2">
            <h1 className="max-w-3xl text-3xl leading-tight font-bold text-navy md:text-4xl">
              {t('title')}
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              {t('subtitle')}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs font-semibold text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            <span>{t('liveGate')}</span>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          {checkout ? (
            <SandboxCheckoutNotice
              action={action}
              onConfirm={() => void confirmCheckout('paid')}
              onFail={() => void confirmCheckout('failed')}
            />
          ) : null}

          <WalletBalancePanel
            wallet={data.wallet}
            onTopUp={() =>
              data.bundles[0] && void runCheckout(data.bundles[0])
            }
          />

          <BundlesPanel
            bundles={data.bundles}
            working={working}
            onBuy={(bundle) => void runCheckout(bundle)}
            formatCurrency={formatCurrency}
          />

          <LedgerPanel entries={data.ledger} formatDate={formatDate} />
          <TransactionsPanel
            transactions={data.transactions}
            formatCurrency={formatCurrency}
            formatDate={formatDate}
          />
        </div>

        <aside className="grid h-fit gap-4">
          <PriceMenu />
          {data.wallet.low_balance ? (
            <LowBalanceNudge
              balance={data.wallet.balance}
              working={working}
              onTopUp={() =>
                data.bundles[0] && void runCheckout(data.bundles[0])
              }
            />
          ) : null}
          <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted-foreground">
            <p className="font-semibold text-navy">{t('rolloverTitle')}</p>
            <p>{t('rolloverBody')}</p>
          </div>
          {action.status === 'error' ? (
            <div
              className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
              role="alert"
            >
              {t('error')}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  )
}

function WalletBalancePanel({
  wallet,
  onTopUp,
}: {
  readonly wallet: BillingWalletResponse
  readonly onTopUp: () => void
}) {
  const t = useTranslations('Billing')
  return (
    <Card className="border-navy/15 bg-navy text-primary-foreground shadow-sm">
      <CardHeader>
        <CardDescription className="text-primary-foreground/70">
          {t('balanceLabel')}
        </CardDescription>
        <CardTitle className="text-5xl font-bold text-primary-foreground tabular-nums">
          {t('balanceCount', { points: wallet.balance })}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-1 border-t border-primary-foreground/20 pt-4">
          <span className="text-primary-foreground/65">
            {t('lifetimeGranted', { points: wallet.lifetime_granted })}
          </span>
          <span className="text-primary-foreground/65">
            {t('lifetimeSpent', { points: wallet.lifetime_spent })}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onTopUp}
          className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        >
          <WalletCards aria-hidden="true" />
          {t('topUp')}
        </Button>
      </CardContent>
    </Card>
  )
}

function BundlesPanel({
  bundles,
  working,
  onBuy,
  formatCurrency,
}: {
  readonly bundles: readonly BillingPointBundle[]
  readonly working: boolean
  readonly onBuy: (bundle: BillingPointBundle) => void
  readonly formatCurrency: (amount: number) => string
}) {
  const t = useTranslations('Billing')
  return (
    <Card>
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-xl font-bold text-navy">
          <h2>{t('bundlesTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('bundlesBody')}</CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        <ul className="grid gap-3" aria-label={t('bundlesTitle')}>
          {bundles.map((bundle) => (
            <li
              key={bundle.code}
              className="grid items-center gap-3 rounded-lg border border-border px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <div className="grid gap-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-navy">
                  {bundle.code === 'pro_500' ? (
                    <span className="rounded-full bg-soft-teal px-2 py-0.5 text-xs font-semibold text-primary">
                      {t('bestValue')}
                    </span>
                  ) : null}
                  <span>{t('bundlePoints', { points: bundle.points })}</span>
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {formatCurrency(bundle.amount_egp)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {t('bundlePerPoint', {
                  perPoint: formatCurrency(bundle.amount_egp / bundle.points),
                })}
              </p>
              <Button
                type="button"
                size="sm"
                disabled={working}
                onClick={() => onBuy(bundle)}
              >
                {working ? (
                  <LoaderCircle
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                {t('bundleBuy', { amount: formatCurrency(bundle.amount_egp) })}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function PriceMenu() {
  const t = useTranslations('Billing')
  const items: ReadonlyArray<{
    readonly label: string
    readonly points: number
  }> = [
    { label: t('pricePost'), points: 2 },
    { label: t('pricePostRevision'), points: 1 },
    { label: t('priceImage'), points: 8 },
    { label: t('priceStrategy'), points: 50 },
    { label: t('priceStrategyRevision'), points: 10 },
    { label: t('priceDiscovery'), points: 0 },
  ]
  return (
    <Card>
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-lg font-bold text-navy">
          <h2>{t('priceMenuTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('priceMenuBody')}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <dl className="grid gap-3 text-sm">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-3"
            >
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="font-semibold text-navy tabular-nums">
                {item.points === 0
                  ? t('priceFree')
                  : t('pricePoints', { points: item.points })}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function LowBalanceNudge({
  balance,
  working,
  onTopUp,
}: {
  readonly balance: number
  readonly working: boolean
  readonly onTopUp: () => void
}) {
  const t = useTranslations('Billing')
  return (
    <div
      className="grid gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning"
      role="status"
      aria-live="polite"
    >
      <p className="font-bold">{t('lowBalanceTitle')}</p>
      <p>{t('lowBalanceBody', { points: balance })}</p>
      <Button type="button" size="sm" disabled={working} onClick={onTopUp}>
        {working ? (
          <LoaderCircle
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : null}
        {t('lowBalanceCta')}
      </Button>
    </div>
  )
}

function LedgerPanel({
  entries,
  formatDate,
}: {
  readonly entries: readonly BillingPointLedgerEntry[]
  readonly formatDate: (value: string) => string
}) {
  const t = useTranslations('Billing')
  return (
    <Card>
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-xl font-bold text-navy">
          <h2>{t('ledgerTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {entries.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">{t('ledgerEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={t('ledgerTitle')}>
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"
              >
                <div className="grid gap-1">
                  <span className="font-semibold text-navy">
                    {entryLabel(t, entry.reason, entry.points)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(entry.created_at)}
                  </span>
                </div>
                <div className="text-end">
                  <p className="font-semibold tabular-nums">
                    {entry.direction === 'credit' ? '+' : '−'}
                    {entry.points}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t('ledgerBalanceAfter', { points: entry.balance_after })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function entryLabel(
  t: ReturnType<typeof useTranslations<'Billing'>>,
  reason: BillingPointLedgerEntry['reason'],
  points: number,
) {
  if (reason === 'topup') return t('ledgerTopup')
  if (reason === 'trial_grant') return t('ledgerTrialGrant')
  if (reason === 'refund') return t('ledgerRefund')
  return t('ledgerSpend', { points })
}

function SandboxCheckoutNotice({
  action,
  onConfirm,
  onFail,
}: {
  readonly action: ActionState
  readonly onConfirm: () => void
  readonly onFail: () => void
}) {
  const t = useTranslations('Billing')
  const working = action.status === 'working' && action.kind === 'confirm'

  return (
    <div
      className="grid gap-3 rounded-xl border border-action/30 bg-action/5 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
      role="status"
      aria-live="polite"
    >
      <div className="grid gap-1">
        <p className="text-sm font-bold text-navy">{t('sandboxLabel')}</p>
        <p className="text-sm leading-6 text-muted-foreground">
          {t('checkoutPending')}
        </p>
        <p className="text-xs text-muted-foreground">{t('sandboxBody')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={working} onClick={onConfirm}>
          {working ? (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : null}
          {t('sandboxConfirm')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={working} onClick={onFail}>
          {t('sandboxFail')}
        </Button>
      </div>
    </div>
  )
}

function TransactionsPanel({
  transactions,
  formatCurrency,
  formatDate,
}: {
  readonly transactions: readonly BillingTransactionResponse[]
  readonly formatCurrency: (amount: number) => string
  readonly formatDate: (value: string) => string
}) {
  const t = useTranslations('Billing')
  return (
    <Card>
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-xl font-bold text-navy">
          <h2>{t('transactionsTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {transactions.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">{t('ledgerEmpty')}</p>
        ) : (
          <ul
            className="divide-y divide-border"
            aria-label={t('transactionsTitle')}
          >
            {transactions.map((transaction) => (
              <li
                key={transaction.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"
              >
                <div className="grid gap-1">
                  <span className="font-semibold text-navy">
                    {transactionLabel(t, transaction.kind)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(transaction.occurred_at)}
                  </span>
                </div>
                <div className="text-end">
                  <p className="font-semibold text-navy tabular-nums">
                    {formatCurrency(transaction.amount_egp)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {transactionStatusLabel(t, transaction.status)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function transactionLabel(
  t: ReturnType<typeof useTranslations<'Billing'>>,
  kind: BillingTransactionResponse['kind'],
) {
  if (kind === 'refund') return t('transactionRefund')
  if (kind === 'chargeback') return t('transactionChargeback')
  return t('transactionCharge')
}

function transactionStatusLabel(
  t: ReturnType<typeof useTranslations<'Billing'>>,
  status: BillingTransactionResponse['status'],
) {
  if (status === 'succeeded') return t('transactionSucceeded')
  if (status === 'failed') return t('transactionFailed')
  return t('transactionPending')
}

function BillingLoading() {
  const t = useTranslations('Billing')
  return (
    <section className="grid gap-4" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t('loading')}</span>
      <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        {t('eyebrow')}
      </p>
      <div className="h-10 w-3/4 animate-pulse motion-reduce:animate-none rounded-lg bg-muted" />
      <div className="h-5 w-full max-w-2xl animate-pulse motion-reduce:animate-none rounded bg-muted" />
      <div className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-80 animate-pulse motion-reduce:animate-none rounded-xl bg-muted" />
        <div className="h-64 animate-pulse motion-reduce:animate-none rounded-xl bg-muted" />
      </div>
    </section>
  )
}
