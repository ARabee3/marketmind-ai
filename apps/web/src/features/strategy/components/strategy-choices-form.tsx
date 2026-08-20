'use client'

import { useEffect, useState } from 'react'
import { Check, CircleAlert } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  ExternalBudgetMode,
  StrategyObjective,
} from '@marketmind/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/navigation'
import { getCurrentJourney } from '@/lib/api/journey'
import { getStrategy } from '@/lib/api/strategy'
import { cn } from '@/lib/utils'
import { useWallet } from '@/features/billing/wallet-context'
import { useStrategyActions } from '../hooks/use-strategy-actions'
import type { StrategyProfileSummary as ProfileSummary } from '../lib/strategy-fixtures'
import { StrategyProfileSummary } from './strategy-profile-summary'
import { GenerateConfirmDialog } from './generate-confirm-dialog'

const OBJECTIVES: readonly StrategyObjective[] = [
  'awareness',
  'acquisition',
  'conversion',
  'retention',
  'launch',
]

type PaidBudgetMode = Exclude<ExternalBudgetMode, 'organic_only'>

const BUDGET_MODES: readonly PaidBudgetMode[] = [
  'monthly_amount',
  'three_month_amount',
  'scenario_only',
]

type PlanLanguageValue = 'ar-EG' | 'en'
type PaidMediaValue = '' | 'yes' | 'no'
type EditableField =
  | 'objective'
  | 'startDate'
  | 'language'
  | 'paidMedia'
  | 'budgetMode'
  | 'budgetAmount'
  | 'capacity'
  | 'constraints'
  | 'clarifications'

type FormData = {
  objective: StrategyObjective | ''
  startDate: string
  language: PlanLanguageValue
  paidMedia: PaidMediaValue
  budgetMode: ExternalBudgetMode | ''
  budgetAmount: string
  capacity: string
  constraints: string
  clarifications: string
  errors: Partial<Record<EditableField | 'form', string>>
}

type LoadedContext = {
  profileVersionId: string
  strategyId: string | null
  profile: ProfileSummary
}

const CLARIFICATION_ID = '00000000-0000-4000-8000-000000000001'

function emptyForm(language: PlanLanguageValue): FormData {
  return {
    objective: '',
    startDate: '',
    language,
    paidMedia: '',
    budgetMode: '',
    budgetAmount: '',
    capacity: '',
    constraints: '',
    clarifications: '',
    errors: {},
  }
}

function toDateInput(value: string): string {
  return value.slice(0, 10)
}

function buildPayload(form: FormData, profileVersionId: string) {
  const paidMediaAllowed = form.paidMedia === 'yes'
  const externalBudgetMode = paidMediaAllowed
    ? form.budgetMode as ExternalBudgetMode
    : 'organic_only'
  const amount = Number(form.budgetAmount)

  return {
    businessProfileVersionId: profileVersionId,
    primaryObjective: form.objective as StrategyObjective,
    startDate: form.startDate,
    planLanguage: form.language,
    paidMediaAllowed,
    externalBudgetMode,
    ...(paidMediaAllowed
      && (externalBudgetMode === 'monthly_amount'
        || externalBudgetMode === 'three_month_amount')
      ? { externalBudgetEgpAmount: amount }
      : {}),
    teamCapacity: form.capacity.trim(),
    constraints: form.constraints.trim() || undefined,
    clarificationAnswers: form.clarifications.trim()
      ? [{
          question_id: CLARIFICATION_ID,
          question_text: 'Owner planning clarification',
          answer_text: form.clarifications.trim(),
          answered_at: new Date().toISOString(),
        }]
      : undefined,
  }
}

export function StrategyChoicesForm() {
  const t = useTranslations('Strategy')
  const tc = useTranslations('Common')
  const locale = useLocale()
  const router = useRouter()
  const { create, saveBrief, generate, pending, error } = useStrategyActions()
  const { refresh: refreshWallet } = useWallet()
  const [form, setForm] = useState<FormData>(() =>
    emptyForm(locale === 'ar' ? 'ar-EG' : 'en'),
  )
  const [context, setContext] = useState<LoadedContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const journey = await getCurrentJourney()
        if (
          cancelled
          || journey.journey.state !== 'discovery_confirmed'
          || !journey.journey.profile
        ) {
          return
        }

        const profile = journey.journey.profile
        const strategyId =
          journey.future_phase.availability === 'available'
            ? journey.future_phase.strategy_id ?? null
            : null
        setContext({
          profileVersionId: profile.business_profile_version_id,
          strategyId,
          profile: {
            businessName: profile.business_name,
            businessType: profile.business_type,
            location: [profile.city, profile.area].filter(Boolean).join(', '),
            confirmedAt: profile.confirmed_at,
            version: profile.version,
          },
        })

        if (strategyId) {
          const strategy = await getStrategy(strategyId)
          if (cancelled || !strategy.brief) return
          const brief = strategy.brief
          const amount =
            typeof brief.externalBudgetEgp === 'number'
              ? String(brief.externalBudgetEgp)
              : ''
          const clarificationAnswers = Array.isArray(brief.clarificationAnswers)
            ? brief.clarificationAnswers
            : []
          setForm({
            objective: OBJECTIVES.includes(brief.primaryObjective as StrategyObjective)
              ? brief.primaryObjective as StrategyObjective
              : '',
            startDate: toDateInput(brief.startDate),
            language: brief.planLanguage === 'en' ? 'en' : 'ar-EG',
            paidMedia: brief.paidMediaAllowed ? 'yes' : 'no',
            budgetMode: brief.externalBudgetMode as ExternalBudgetMode,
            budgetAmount: amount,
            capacity: brief.teamCapacity ?? '',
            constraints: brief.constraints ?? '',
            clarifications: clarificationAnswers
              .map((item) =>
                item
                && typeof item === 'object'
                && 'answer_text' in item
                  ? String(item.answer_text)
                  : '',
              )
              .filter(Boolean)
              .join('\n'),
            errors: {},
          })
        }
      } catch {
        if (!cancelled) {
          setForm((previous) => ({
            ...previous,
            errors: { form: t('choices.validation.loadFailed') },
          }))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [t])

  useEffect(() => {
    if (!dirty) return
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', protectUnsavedChanges)
    return () => window.removeEventListener('beforeunload', protectUnsavedChanges)
  }, [dirty])

  function setField(field: EditableField, value: string) {
    setSaved(false)
    setDirty(true)
    setForm((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'paidMedia' && value === 'no'
        ? { budgetMode: 'organic_only', budgetAmount: '' }
        : {}),
      errors: { ...previous.errors, [field]: undefined, form: undefined },
    }))
  }

  function validate(): boolean {
    const errors: FormData['errors'] = {}
    if (!form.objective) errors.objective = t('choices.validation.required')
    if (!form.startDate) errors.startDate = t('choices.validation.required')
    if (!form.language) errors.language = t('choices.validation.required')
    if (!form.paidMedia) errors.paidMedia = t('choices.validation.required')
    if (!form.capacity.trim()) errors.capacity = t('choices.validation.required')
    if (form.paidMedia === 'yes' && !form.budgetMode) {
      errors.budgetMode = t('choices.validation.required')
    }
    if (
      form.paidMedia === 'yes'
      && (form.budgetMode === 'monthly_amount'
        || form.budgetMode === 'three_month_amount')
      && (!form.budgetAmount || Number(form.budgetAmount) <= 0)
    ) {
      errors.budgetAmount = t('choices.validation.positiveBudget')
    }
    if (!context) errors.form = t('choices.validation.noProfile')
    setForm((previous) => ({ ...previous, errors }))
    if (Object.keys(errors).length > 0) {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus()
      })
    }
    return Object.keys(errors).length === 0
  }

  async function ensureStrategy(): Promise<string | null> {
    if (!context) return null
    if (context.strategyId) return context.strategyId
    const created = await create(context.profileVersionId)
    if (!created) return null
    setContext((previous) =>
      previous ? { ...previous, strategyId: created.id } : previous,
    )
    return created.id
  }

  async function persist(shouldGenerate: boolean) {
    if (!validate() || !context) return
    const strategyId = await ensureStrategy()
    if (!strategyId) return
    const brief = await saveBrief(
      strategyId,
      buildPayload(form, context.profileVersionId),
    )
    if (!brief) return

    setDirty(false)
    setSaved(true)
    if (shouldGenerate) {
      const started = await generate(strategyId)
      if (!started) return
      await refreshWallet()
      router.push(`/strategy/${strategyId}`)
    }
  }

  const disabled = loading || pending
  const readiness = [
    { key: 'profile', complete: context !== null },
    { key: 'objective', complete: Boolean(form.objective) },
    {
      key: 'budget',
      complete:
        form.paidMedia === 'no'
        || (
          form.paidMedia === 'yes'
          && Boolean(form.budgetMode)
          && (
            form.budgetMode === 'scenario_only'
            || Number(form.budgetAmount) > 0
          )
        ),
    },
    { key: 'capacity', complete: Boolean(form.capacity.trim()) },
  ] as const

  return (
    <section className="grid gap-5">
      <header className="rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <p className="text-xs font-bold tracking-[0.14em] text-journey-mint uppercase">
          {t('choices.eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{t('choices.title')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">
          {t('choices.subtitle')}
        </p>
      </header>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <p className="text-sm text-muted-foreground">{tc('loading')}</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
          <form
            className="rounded-xl border border-border bg-surface shadow-elevated"
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="grid gap-5 p-4 md:grid-cols-2 md:p-6">
              <FormField
                id="strategy-objective"
                label={t('choices.fields.objective.label')}
                help={t('choices.fields.objective.help')}
                error={form.errors.objective}
              >
                <select
                  id="strategy-objective"
                  name="strategy-objective"
                  autoComplete="off"
                  value={form.objective}
                  onChange={(event) => setField('objective', event.target.value)}
                  aria-describedby="strategy-objective-help"
                  aria-invalid={Boolean(form.errors.objective)}
                  className={selectClassName}
                >
                  <option value="">{t('choices.selectPlaceholder')}</option>
                  {OBJECTIVES.map((objective) => (
                    <option key={objective} value={objective}>
                      {t(`choices.fields.objective.options.${objective}`)}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                id="strategy-start-date"
                label={t('choices.fields.startDate.label')}
                help={t('choices.fields.startDate.help')}
                error={form.errors.startDate}
              >
                <Input
                  id="strategy-start-date"
                  name="strategy-start-date"
                  autoComplete="off"
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setField('startDate', event.target.value)}
                  aria-describedby="strategy-start-date-help"
                  aria-invalid={Boolean(form.errors.startDate)}
                />
              </FormField>

              <FormField
                id="strategy-language"
                label={t('choices.fields.language.label')}
                help={t('choices.fields.language.help')}
                error={form.errors.language}
              >
                <select
                  id="strategy-language"
                  name="strategy-language"
                  autoComplete="off"
                  value={form.language}
                  onChange={(event) => setField('language', event.target.value)}
                  aria-describedby="strategy-language-help"
                  className={selectClassName}
                >
                  <option value="ar-EG">
                    {t('choices.fields.language.options.arabic')}
                  </option>
                  <option value="en">
                    {t('choices.fields.language.options.english')}
                  </option>
                </select>
              </FormField>

              <FormField
                id="strategy-paid-media"
                label={t('choices.fields.paidMedia.label')}
                help={t('choices.fields.paidMedia.help')}
                error={form.errors.paidMedia}
              >
                <select
                  id="strategy-paid-media"
                  name="strategy-paid-media"
                  autoComplete="off"
                  value={form.paidMedia}
                  onChange={(event) => setField('paidMedia', event.target.value)}
                  aria-describedby="strategy-paid-media-help"
                  aria-invalid={Boolean(form.errors.paidMedia)}
                  className={selectClassName}
                >
                  <option value="">{t('choices.selectPlaceholder')}</option>
                  <option value="no">{t('choices.fields.paidMedia.options.organic')}</option>
                  <option value="yes">{t('choices.fields.paidMedia.options.allowed')}</option>
                </select>
              </FormField>

              {form.paidMedia === 'yes' ? (
                <>
                  <FormField
                    id="strategy-budget-mode"
                    label={t('choices.fields.budgetMode.label')}
                    help={t('choices.fields.budgetMode.help')}
                    error={form.errors.budgetMode}
                  >
                    <select
                      id="strategy-budget-mode"
                      name="strategy-budget-mode"
                      autoComplete="off"
                      value={form.budgetMode}
                      onChange={(event) => setField('budgetMode', event.target.value)}
                      aria-describedby="strategy-budget-mode-help"
                      aria-invalid={Boolean(form.errors.budgetMode)}
                      className={selectClassName}
                    >
                      <option value="">{t('choices.selectPlaceholder')}</option>
                      {BUDGET_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {t(`choices.fields.budgetMode.options.${mode}`)}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  {form.budgetMode === 'monthly_amount'
                    || form.budgetMode === 'three_month_amount' ? (
                      <FormField
                        id="strategy-budget-amount"
                        label={t('choices.fields.budgetAmount.label')}
                        help={t('choices.fields.budgetAmount.help')}
                        error={form.errors.budgetAmount}
                      >
                        <Input
                          id="strategy-budget-amount"
                          name="strategy-budget-amount"
                          autoComplete="off"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={form.budgetAmount}
                          onChange={(event) =>
                            setField('budgetAmount', event.target.value)
                          }
                          aria-describedby="strategy-budget-amount-help"
                          aria-invalid={Boolean(form.errors.budgetAmount)}
                        />
                      </FormField>
                    ) : null}
                </>
              ) : null}

              <FormField
                id="strategy-capacity"
                label={t('choices.fields.capacity.label')}
                help={t('choices.fields.capacity.help')}
                error={form.errors.capacity}
              >
                <Input
                  id="strategy-capacity"
                  name="strategy-capacity"
                  autoComplete="off"
                  value={form.capacity}
                  onChange={(event) => setField('capacity', event.target.value)}
                  aria-describedby="strategy-capacity-help"
                  aria-invalid={Boolean(form.errors.capacity)}
                />
              </FormField>

              <FormField
                id="strategy-constraints"
                label={t('choices.fields.constraints.label')}
                help={t('choices.fields.constraints.help')}
                error={form.errors.constraints}
                wide
              >
                <textarea
                  id="strategy-constraints"
                  name="strategy-constraints"
                  autoComplete="off"
                  value={form.constraints}
                  onChange={(event) => setField('constraints', event.target.value)}
                  className={textareaClassName}
                  aria-describedby="strategy-constraints-help"
                />
              </FormField>

              <FormField
                id="strategy-clarifications"
                label={t('choices.fields.clarifications.label')}
                help={t('choices.fields.clarifications.help')}
                error={form.errors.clarifications}
                wide
              >
                <textarea
                  id="strategy-clarifications"
                  name="strategy-clarifications"
                  autoComplete="off"
                  value={form.clarifications}
                  onChange={(event) =>
                    setField('clarifications', event.target.value)
                  }
                  className={textareaClassName}
                  aria-describedby="strategy-clarifications-help"
                />
              </FormField>
            </div>

            <div aria-live="polite">
              {form.errors.form ? (
                <p className="px-4 pb-2 text-sm text-danger md:px-6">
                  {form.errors.form}
                </p>
              ) : null}
              {error ? (
                <p className="px-4 pb-2 text-sm text-danger md:px-6">{error}</p>
              ) : null}
              {saved ? (
                <p className="px-4 pb-2 text-sm font-semibold text-primary md:px-6">
                  {t('choices.saved')}
                </p>
              ) : null}
              {dirty ? (
                <p className="px-4 pb-2 text-xs text-warning md:px-6">
                  {t('choices.unsaved')}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-border bg-background/70 p-4 sm:flex-row sm:justify-end md:p-5">
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => persist(false)}
              >
                {pending ? tc('saving') : t('choices.save')}
              </Button>
              <Button
                type="button"
                className="shadow-tactile hover:brightness-105 active:translate-y-[2px] active:shadow-tactile-pressed transition-all"
                disabled={disabled}
                onClick={() => setConfirmOpen(true)}
              >
                {pending ? tc('saving') : t('choices.generate')}
              </Button>
            </div>
          </form>

          <aside className="grid gap-5 lg:sticky lg:top-24">
            <StrategyProfileSummary profile={context?.profile ?? null} />
            <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated">
              <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
                {t('choices.readinessLabel')}
              </p>
              <ol className="mt-4 grid gap-2">
                {readiness.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-full',
                        item.complete
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-warning/10 text-warning',
                      )}
                    >
                      {item.complete ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <CircleAlert className="size-4" aria-hidden="true" />
                      )}
                    </span>
                    <span className="text-sm font-semibold text-navy">
                      {t(`choices.readiness.${item.key}`)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      )}
      <GenerateConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => {
          setConfirmOpen(false)
          void persist(true)
        }}
      />
    </section>
  )
}

const selectClassName = cn(
  'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none',
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40',
)

const textareaClassName = cn(
  'min-h-28 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none',
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40',
)

function FormField({
  id,
  label,
  help,
  error,
  wide = false,
  children,
}: {
  readonly id: string
  readonly label: string
  readonly help: string
  readonly error?: string
  readonly wide?: boolean
  readonly children: React.ReactNode
}) {
  return (
    <div className={cn('grid gap-2', wide && 'md:col-span-2')}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p
        id={`${id}-help`}
        className={cn(
          'text-xs leading-5',
          error ? 'text-danger' : 'text-muted-foreground',
        )}
      >
        {error ?? help}
      </p>
    </div>
  )
}
