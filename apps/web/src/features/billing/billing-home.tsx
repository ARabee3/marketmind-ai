'use client'

import { useCallback, useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type {
  BillingCatalogPrice,
  BillingCheckoutResponse,
  BillingPaymentMode,
  BillingSubscriptionResponse,
  BillingSubscriptionState,
  BillingTransactionResponse,
  BillingUsageMetric,
} from '@marketmind/contracts'
import { Check, LoaderCircle, ShieldCheck, WalletCards } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  cancelBillingSubscription,
  confirmSandboxCheckout,
  createBillingCheckout,
  getBillingPrices,
  getBillingSubscription,
  getBillingTransactions,
  getBillingUsage,
  resumeBillingSubscription,
} from '@/lib/api/billing'

type BillingData = {
  readonly prices: readonly BillingCatalogPrice[]
  readonly subscription: BillingSubscriptionResponse
  readonly usage: readonly BillingUsageMetric[]
  readonly transactions: readonly BillingTransactionResponse[]
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: BillingData }
  | { readonly status: 'error' }

type ActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'working'; readonly kind: 'checkout' | 'confirm' | 'cancel' | 'resume' }
  | { readonly status: 'success'; readonly checkout: BillingCheckoutResponse }
  | { readonly status: 'error' }

const STATUS_KEYS: Record<
  BillingSubscriptionState,
  `status.${BillingSubscriptionState}`
> = {
  trialing: 'status.trialing',
  checkout_pending: 'status.checkout_pending',
  active: 'status.active',
  past_due: 'status.past_due',
  paused: 'status.paused',
  cancel_at_period_end: 'status.cancel_at_period_end',
  expired: 'status.expired',
  refunded: 'status.refunded',
}

const METRIC_KEYS: Record<BillingUsageMetric['metric'], string> = {
  discovery: 'discovery',
  strategy_cycle: 'strategyCycle',
  strategy_revision: 'strategyRevision',
  content_item: 'contentItems',
  content_revision: 'contentRevisions',
  static_image: 'staticImages',
  publication_target: 'connectedTargets',
}

export function BillingHome() {
  const t = useTranslations('Billing')
  const formatter = useFormatter()
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [action, setAction] = useState<ActionState>({ status: 'idle' })

  const fetchBilling = useCallback(async (): Promise<BillingData> => {
    const [prices, subscription, usage, transactions] = await Promise.all([
      getBillingPrices(),
      getBillingSubscription(),
      getBillingUsage(),
      getBillingTransactions(),
    ])
    return {
      prices: prices.prices,
      subscription,
      usage: usage.metrics,
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
  const [selectedInterval, setSelectedInterval] = useState<'monthly' | 'yearly'>('monthly')
  const monthly = data.prices.find((price) => price.interval === 'monthly')
  const yearly = data.prices.find((price) => price.interval === 'yearly')
  const selectedPrice = selectedInterval === 'monthly' ? monthly : yearly
  const subscription = data.subscription
  const checkout = action.status === 'success' ? action.checkout : null
  const working = action.status === 'working'
  const planBadge = subscription.state === 'trialing'
    ? t('trialLabel')
    : t(STATUS_KEYS[subscription.state])

  const runCheckout = async (price: BillingCatalogPrice) => {
    setAction({ status: 'working', kind: 'checkout' })
    try {
      const paymentMode: BillingPaymentMode = 'one_time_card'
      const result = await createBillingCheckout(
        price.code,
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

  const changeRenewal = async (kind: 'cancel' | 'resume') => {
    setAction({ status: 'working', kind })
    try {
      if (kind === 'cancel') {
        await cancelBillingSubscription()
      } else {
        await resumeBillingSubscription()
      }
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

          <Card className="overflow-visible border-primary/20 shadow-sm">
            <CardHeader className="gap-3 border-b border-border/80 pb-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <CardTitle className="text-xl font-bold text-navy">
                    <h2>{t('growthLabel')}</h2>
                  </CardTitle>
                  <CardDescription>{t('finalPriceNote')}</CardDescription>
                </div>
                <div className="rounded-full bg-soft-teal px-3 py-1 text-xs font-semibold text-primary">
                  {planBadge}
                </div>
              </div>
              <div className="inline-flex w-fit rounded-lg border border-border bg-background p-1" role="group" aria-label={t('growthLabel')}>
                <IntervalButton
                  active={selectedInterval === 'monthly'}
                  label={t('monthly')}
                  onClick={() => setSelectedInterval('monthly')}
                />
                <IntervalButton
                  active={selectedInterval === 'yearly'}
                  label={t('yearly')}
                  onClick={() => setSelectedInterval('yearly')}
                />
              </div>
            </CardHeader>
            <CardContent className="grid gap-6 pt-5">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div className="grid gap-2">
                  <p className="text-4xl font-bold tracking-tight text-navy tabular-nums md:text-5xl">
                    {selectedPrice ? formatCurrency(selectedPrice.amount_egp) : t('notAvailable')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedInterval === 'monthly' ? t('perMonth') : t('perYear')}
                    {selectedInterval === 'yearly' ? ` · ${t('saveTwoMonths')}` : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  size="lg"
                  disabled={!selectedPrice || working}
                  onClick={() => selectedPrice && void runCheckout(selectedPrice)}
                >
                  {working && action.status === 'working' && action.kind === 'checkout' ? (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <WalletCards aria-hidden="true" />
                  )}
                  {selectedInterval === 'monthly' ? t('chooseMonthly') : t('chooseYearly')}
                </Button>
              </div>
              <ul className="grid gap-3 border-t border-border/80 pt-5 text-sm text-muted-foreground sm:grid-cols-3">
                <IncludedItem>{t('includedContent')}</IncludedItem>
                <IncludedItem>{t('includedImages')}</IncludedItem>
                <IncludedItem>{t('includedRevisions')}</IncludedItem>
              </ul>
              <p className="text-sm leading-6 text-muted-foreground">{t('paymentMethods')}</p>
            </CardContent>
          </Card>

          <UsagePanel metrics={data.usage} />
          <TransactionsPanel transactions={data.transactions} formatCurrency={formatCurrency} formatDate={formatDate} />
        </div>

        <aside className="grid h-fit gap-4">
          <Card className="border-navy/15 bg-navy text-primary-foreground shadow-sm">
            <CardHeader>
              <CardDescription className="text-primary-foreground/70">{t('statusLabel')}</CardDescription>
              <CardTitle className="text-2xl text-primary-foreground">
                <h2>{t(STATUS_KEYS[subscription.state])}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="grid gap-1 border-t border-primary-foreground/20 pt-4">
                <span className="text-primary-foreground/65">{t('renewal')}</span>
                <span className="font-semibold">
                  {subscription.renewal_mode === 'recurring_card'
                    ? t('monthly')
                    : t('renewalNone')}
                </span>
              </div>
              {subscription.trial_ends_at ? (
                <p className="text-primary-foreground/80">
                  {t('trialEnds', { date: formatDate(subscription.trial_ends_at) })}
                </p>
              ) : null}
              {subscription.paid_through_at ? (
                <p className="text-primary-foreground/80">
                  {t('paidThrough', { date: formatDate(subscription.paid_through_at) })}
                </p>
              ) : null}
              {subscription.grace_ends_at ? (
                <p className="text-primary-foreground/80">
                  {t('graceEnds', { date: formatDate(subscription.grace_ends_at) })}
                </p>
              ) : null}
              {subscription.cancel_at_period_end && subscription.paid_through_at ? (
                <p className="rounded-lg bg-primary-foreground/10 px-3 py-2 text-primary-foreground/85">
                  {t('cancelled', { date: formatDate(subscription.paid_through_at) })}
                </p>
              ) : null}
              {subscription.state === 'cancel_at_period_end' ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={working}
                  onClick={() => void changeRenewal('resume')}
                  className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                >
                  {t('resume')}
                </Button>
              ) : subscription.state === 'active' || subscription.state === 'past_due' ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={working}
                  onClick={() => void changeRenewal('cancel')}
                  className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                >
                  {t('cancel')}
                </Button>
              ) : null}
            </CardContent>
          </Card>
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning">
            {t('trialNote')}
          </div>
          {action.status === 'error' ? (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
              {t('error')}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  )
}

function IntervalButton({
  active,
  label,
  onClick,
}: {
  readonly active: boolean
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={active
        ? 'touch-manipulation rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:outline-none'
        : 'touch-manipulation rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:outline-none'}
    >
      {label}
    </button>
  )
}

function IncludedItem({ children }: { readonly children: string }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
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
    <div className="grid gap-3 rounded-xl border border-action/30 bg-action/5 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" role="status" aria-live="polite">
      <div className="grid gap-1">
        <p className="text-sm font-bold text-navy">{t('sandboxLabel')}</p>
        <p className="text-sm leading-6 text-muted-foreground">{t('checkoutPending')}</p>
        <p className="text-xs text-muted-foreground">{t('sandboxBody')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={working} onClick={onConfirm}>
          {working ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          {t('sandboxConfirm')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={working} onClick={onFail}>
          {t('sandboxFail')}
        </Button>
      </div>
    </div>
  )
}

function UsagePanel({ metrics }: { readonly metrics: readonly BillingUsageMetric[] }) {
  const t = useTranslations('Billing')
  return (
    <Card>
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-xl font-bold text-navy">
          <h2>{t('usageTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.metric} className="grid gap-2 border-s border-border ps-3">
            <p className="text-sm font-semibold text-navy">{metricLabel(t, METRIC_KEYS[metric.metric])}</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {t('usedOf', { used: metric.used, limit: metric.limit })}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.min(100, metric.limit === 0 ? 0 : (metric.used / metric.limit) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">{t('remaining', { remaining: metric.remaining })}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function metricLabel(t: ReturnType<typeof useTranslations<'Billing'>>, key: string) {
  const labels: Record<string, string> = {
    discovery: t('metricDiscovery'),
    strategyCycle: t('metricStrategyCycle'),
    strategyRevision: t('metricStrategyRevision'),
    contentItems: t('metricContentItems'),
    contentRevisions: t('metricContentRevisions'),
    staticImages: t('metricStaticImages'),
    connectedTargets: t('metricConnectedTargets'),
  }
  return labels[key] ?? t('metricContentItems')
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
          <p className="py-5 text-sm text-muted-foreground">{t('usageEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={t('transactionsTitle')}>
            {transactions.map((transaction) => (
              <li key={transaction.id} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
                <div className="grid gap-1">
                  <span className="font-semibold text-navy">{transactionLabel(t, transaction.kind)}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(transaction.occurred_at)}</span>
                </div>
                <div className="text-end">
                  <p className="font-semibold text-navy tabular-nums">{formatCurrency(transaction.amount_egp)}</p>
                  <p className="text-xs text-muted-foreground">{transactionStatusLabel(t, transaction.status)}</p>
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
      <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">{t('eyebrow')}</p>
      <div className="h-10 w-3/4 animate-pulse motion-reduce:animate-none rounded-lg bg-muted" />
      <div className="h-5 w-full max-w-2xl animate-pulse motion-reduce:animate-none rounded bg-muted" />
      <div className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-80 animate-pulse motion-reduce:animate-none rounded-xl bg-muted" />
        <div className="h-64 animate-pulse motion-reduce:animate-none rounded-xl bg-muted" />
      </div>
    </section>
  )
}
