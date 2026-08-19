'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, CircleAlert, Globe, Link2, PlugZap, Store } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  ChannelSetupState,
  PublishingTargetPublicV1,
  StrategyObjective,
  StrategyV2Channel,
} from '@marketmind/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/navigation'
import { getCurrentJourney } from '@/lib/api/journey'
import { getStrategy } from '@/lib/api/strategy'
import type { UpsertBriefPayload } from '@/lib/api/strategy'
import {
  connectMetaPublishingTarget,
  listPublishingTargets,
  type PublishingApiError,
} from '@/lib/api/publishing'
import {
  connectMeta as connectFacebookPage,
  getFacebookConnection,
} from '@/lib/api/facebook'
import {
  PublishingMetaCallbackResult,
  type MetaConnectionCompleteContext,
} from '@/features/publishing/components/meta-connection-result'
import { getConnectionFingerprint } from '@/features/publishing/lib/publishing-state'
import { cn } from '@/lib/utils'
import { useStrategyActions } from '../hooks/use-strategy-actions'
import type { StrategyProfileSummary as ProfileSummary } from '../lib/strategy-fixtures'
import { StrategyChoicesForm } from './strategy-choices-form'
import { GenerateConfirmDialog } from './generate-confirm-dialog'
import { StrategyProfileSummary } from './strategy-profile-summary'

const OBJECTIVES: readonly StrategyObjective[] = [
  'awareness',
  'acquisition',
  'conversion',
  'retention',
  'launch',
]

const CATALOG: readonly {
  readonly channel: StrategyV2Channel
  readonly meta: boolean
  readonly icon: 'social' | 'store' | 'globe'
}[] = [
  { channel: 'facebook', meta: true, icon: 'social' },
  { channel: 'instagram', meta: true, icon: 'social' },
  { channel: 'tiktok', meta: false, icon: 'social' },
  { channel: 'google_business_profile', meta: false, icon: 'store' },
  { channel: 'delivery_platforms', meta: false, icon: 'store' },
  { channel: 'website', meta: false, icon: 'globe' },
]

const CAPACITY_PRESETS = [
  'one_to_two_hours',
  'three_to_five_hours',
  'half_day',
  'full_day_plus',
] as const

const STEPS = [
  { id: 'goal', required: 'objective' as const },
  { id: 'channels', required: 'channels' as const },
  { id: 'realistic', required: 'realistic' as const },
] as const

type StepId = (typeof STEPS)[number]['id']
type EditableField = 'objective' | 'startDate' | 'language' | 'weeklyCapacity'
  | 'weeklyCapacityNote' | 'paidMedia' | 'budgetAmount' | 'constraints'

type WizardChoice = {
  channel: StrategyV2Channel
  role: 'primary' | 'supporting' | null
  setupState: ChannelSetupState
  publicUrl: string
  publishingTargetId?: string
}

type FormData = {
  objective: StrategyObjective | ''
  startDate: string
  language: 'ar-EG' | 'en'
  weeklyCapacity: string
  weeklyCapacityNote: string
  paidMedia: '' | 'organic' | 'budget'
  budgetAmount: string
  constraints: string
  choices: WizardChoice[]
  errors: Partial<Record<EditableField | 'channels' | 'form', string>>
}

type LoadedContext = {
  profileVersionId: string
  strategyId: string | null
  profile: ProfileSummary
}

const CLARIFICATION_ID = '00000000-0000-4000-8000-000000000001'
const META_DRAFT_PREFIX = 'marketmind.strategy.meta.v1:'
const META_LATEST_DRAFT_KEY = `${META_DRAFT_PREFIX}latest`

function emptyChoices(): WizardChoice[] {
  return CATALOG.map(({ channel }) => ({
    channel,
    role: null,
    setupState: 'setup_later',
    publicUrl: '',
  }))
}

function followingMondayInCairo(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const now = new Date()
  const parts = formatter.formatToParts(now)
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const cairoToday = new Date(
    Date.UTC(read('year'), read('month') - 1, read('day')),
  )
  const day = cairoToday.getUTCDay()
  const daysUntilMonday = (8 - day) % 7 || 7
  const nextMonday = new Date(cairoToday)
  nextMonday.setUTCDate(cairoToday.getUTCDate() + daysUntilMonday)
  return nextMonday.toISOString().slice(0, 10)
}

function emptyForm(language: 'ar-EG' | 'en'): FormData {
  return {
    objective: '',
    startDate: followingMondayInCairo(),
    language,
    weeklyCapacity: '',
    weeklyCapacityNote: '',
    paidMedia: '',
    budgetAmount: '',
    constraints: '',
    choices: emptyChoices(),
    errors: {},
  }
}

function metaDraftKey(connectionId: string): string {
  return `${META_DRAFT_PREFIX}${connectionId}`
}

function isUsablePublishingTarget(
  target: PublishingTargetPublicV1,
  channel: StrategyV2Channel,
): boolean {
  return (
    target.channel === channel
    && target.connection_state === 'connected'
    && target.capabilities.includes('static_image')
  )
}

function readMetaDraft(connectionId: string | null): {
  strategyId: string | null
  requestedChannel: 'facebook' | 'instagram'
  form: FormData
  step: StepId
} | null {
  if (typeof window === 'undefined') return null
  try {
    const id = connectionId || window.sessionStorage.getItem(META_LATEST_DRAFT_KEY)
    if (!id) return null
    const raw = window.sessionStorage.getItem(metaDraftKey(id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      strategyId?: unknown
      requestedChannel?: unknown
      form?: FormData
      step?: unknown
    }
    if (
      (parsed.requestedChannel !== 'facebook' && parsed.requestedChannel !== 'instagram')
      || !parsed.form
      || !Array.isArray(parsed.form.choices)
      || !STEPS.some((entry) => entry.id === parsed.step)
    ) {
      return null
    }
    return {
      strategyId: typeof parsed.strategyId === 'string' ? parsed.strategyId : null,
      requestedChannel: parsed.requestedChannel,
      form: {
        ...parsed.form,
        errors: {},
        choices: emptyChoices().map((choice) => {
          const saved = parsed.form?.choices.find(
            (entry) => entry.channel === choice.channel,
          )
          if (!saved) return choice
          return {
            ...choice,
            role: saved.role,
            setupState: saved.setupState,
            publicUrl: typeof saved.publicUrl === 'string' ? saved.publicUrl : '',
            publishingTargetId:
              typeof saved.publishingTargetId === 'string'
                ? saved.publishingTargetId
                : undefined,
          }
        }),
      },
      step: parsed.step as StepId,
    }
  } catch {
    return null
  }
}

function toDateInput(value: string): string {
  return value.slice(0, 10)
}

function buildPayload(
  form: FormData,
  profileVersionId: string,
): UpsertBriefPayload {
  const paidMediaAllowed = form.paidMedia === 'budget'
  return {
    businessProfileVersionId: profileVersionId,
    primaryObjective: form.objective as StrategyObjective,
    startDate: form.startDate,
    planLanguage: form.language,
    paidMediaAllowed,
    externalBudgetMode: paidMediaAllowed ? 'monthly_amount' : 'organic_only',
    ...(paidMediaAllowed
      ? { externalBudgetEgpAmount: Number(form.budgetAmount) || undefined }
      : {}),
    weeklyCapacity: form.weeklyCapacity,
    weeklyCapacityNote: form.weeklyCapacityNote.trim() || undefined,
    channelChoices: form.choices
      .filter((choice) => choice.role !== null)
      .map((choice) => ({
        channel: choice.channel,
        role: choice.role as 'primary' | 'supporting',
        setupState: choice.setupState,
        ...(choice.publicUrl.trim()
          ? { publicUrl: choice.publicUrl.trim() }
          : {}),
        ...(choice.publishingTargetId
          ? { publishingTargetId: choice.publishingTargetId }
          : {}),
      })),
    constraints: form.constraints.trim() || undefined,
    clarificationAnswers: form.constraints.trim()
      ? [{
          question_id: CLARIFICATION_ID,
          question_text: 'Owner planning clarification',
          answer_text: form.constraints.trim(),
          answered_at: new Date().toISOString(),
        }]
      : undefined,
  }
}

export function StrategyWizard() {
  const t = useTranslations('Strategy')
  const tc = useTranslations('Common')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const metaResult = searchParams.get('meta_result')
  const metaConnectionId = searchParams.get('meta_connection')
  const { create, saveBrief, generate, pending, error } = useStrategyActions()
  const [step, setStep] = useState<StepId>('goal')
  const [form, setForm] = useState<FormData>(() =>
    emptyForm(locale === 'ar' ? 'ar-EG' : 'en'),
  )
  const [context, setContext] = useState<LoadedContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [legacyV1, setLegacyV1] = useState(false)
  const [targets, setTargets] = useState<readonly PublishingTargetPublicV1[]>([])
  const [metaPending, setMetaPending] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [facebookPending, setFacebookPending] = useState(false)
  const [facebookConnected, setFacebookConnected] = useState<string | null>(null)
  const [facebookError, setFacebookError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const metaResumeRef = useRef(false)

  const stepIndex = useMemo(() => STEPS.findIndex((entry) => entry.id === step), [step])

  useEffect(() => {
    if (!metaConnectionId && metaResumeRef.current) return
    let cancelled = false

    async function load() {
      try {
        const [journey, availableTargets, facebookConnection] = await Promise.all([
          getCurrentJourney(),
          listPublishingTargets().catch(() => []),
          getFacebookConnection().catch(() => null),
        ])
        if (!cancelled) setTargets(availableTargets)
        if (!cancelled && facebookConnection?.isValid && facebookConnection.pageName) {
          setFacebookConnected(facebookConnection.pageName)
        }
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

        const draft = readMetaDraft(metaConnectionId)
        const draftMatches =
          draft && (!draft.strategyId || draft.strategyId === strategyId)

        if (strategyId) {
          const strategy = await getStrategy(strategyId)
          const brief = strategy.brief
          if (cancelled) return
          if (!brief) {
            if (draftMatches) {
              setForm(draft.form)
              setStep(draft.step)
              setDirty(true)
            }
            return
          }
          const choices = Array.isArray(brief.channelChoices)
            ? brief.channelChoices
            : []
          if (choices.length === 0) {
            if (draftMatches) {
              setForm(draft.form)
              setStep(draft.step)
              setDirty(true)
            } else {
              // Legacy strategy-v1 strategy: keep the original choices form.
              setLegacyV1(true)
            }
            return
          }
          const capacity = brief.weeklyCapacity ?? ''
          const amount =
            typeof brief.externalBudgetEgp === 'number'
              ? String(brief.externalBudgetEgp)
              : ''
          setForm({
            objective: OBJECTIVES.includes(brief.primaryObjective as StrategyObjective)
              ? brief.primaryObjective as StrategyObjective
              : '',
            startDate: toDateInput(brief.startDate),
            language: brief.planLanguage === 'en' ? 'en' : 'ar-EG',
            weeklyCapacity: capacity,
            weeklyCapacityNote: brief.weeklyCapacityNote ?? '',
            paidMedia: brief.paidMediaAllowed ? 'budget' : 'organic',
            budgetAmount: amount,
            constraints:
              typeof brief.constraints === 'string'
                ? brief.constraints
                : (brief.constraints ?? []).join('\n'),
            choices: emptyChoices().map((choice) => {
              const saved = choices.find(
                (entry) => entry.channel === choice.channel,
              )
              if (!saved) return choice
              return {
                channel: choice.channel,
                role: saved.role as WizardChoice['role'],
                setupState: (saved.setupState ?? saved.setup_state) as ChannelSetupState,
                publicUrl:
                  typeof (saved.publicUrl ?? saved.public_url) === 'string'
                    ? (saved.publicUrl ?? saved.public_url) as string
                    : '',
                publishingTargetId:
                  typeof (saved.publishingTargetId ?? saved.publishing_target_id) === 'string'
                    ? (saved.publishingTargetId ?? saved.publishing_target_id) as string
                    : undefined,
              }
            }),
            errors: {},
          })
        }

        if (draftMatches && !cancelled) {
          setForm(draft.form)
          setStep(draft.step)
          setDirty(true)
        }
      } catch {
        if (!cancelled) {
          setForm((previous) => ({
            ...previous,
            errors: { form: t('wizard.validation.loadFailed') },
          }))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [metaConnectionId, t])

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
      errors: { ...previous.errors, [field]: undefined, form: undefined },
    }))
  }

  function updateChoice(
    channel: StrategyV2Channel,
    patch: Partial<WizardChoice>,
  ) {
    setSaved(false)
    setDirty(true)
    setForm((previous) => {
      const normalizedPatch =
        patch.setupState && patch.setupState !== 'connected'
          ? { ...patch, publishingTargetId: undefined }
          : patch
      let choices = previous.choices.map((choice) =>
        choice.channel === channel ? { ...choice, ...normalizedPatch } : choice,
      )
      // Selecting a new primary demotes the previous primary so there is
      // always exactly one main focus.
      if (patch.role === 'primary') {
        choices = choices.map((choice) =>
          choice.role === 'primary' && choice.channel !== channel
            ? { ...choice, role: null }
            : choice,
        )
      }
      const primaryCount = choices.filter(
        (choice) => choice.role === 'primary',
      ).length
      const supportingCount = choices.filter(
        (choice) => choice.role === 'supporting',
      ).length
      return {
        ...previous,
        choices,
        errors: {
          ...previous.errors,
          channels:
            primaryCount !== 1
              ? t('wizard.validation.primaryChannel')
              : supportingCount > 2
                ? t('wizard.validation.supportingLimit')
                : undefined,
          form: undefined,
        },
      }
    })
  }

  function validateStep(target: StepId): boolean {
    const errors: FormData['errors'] = {}
    if (target === 'goal') {
      if (!form.objective) errors.objective = t('wizard.validation.required')
      if (!form.startDate) errors.startDate = t('wizard.validation.required')
      if (!form.language) errors.language = t('wizard.validation.required')
    } else if (target === 'channels') {
      const primaryCount = form.choices.filter(
        (choice) => choice.role === 'primary',
      ).length
      const supportingCount = form.choices.filter(
        (choice) => choice.role === 'supporting',
      ).length
      if (primaryCount !== 1) errors.channels = t('wizard.validation.primaryChannel')
      else if (supportingCount > 2) {
        errors.channels = t('wizard.validation.supportingLimit')
      } else {
        const badLink = form.choices.find(
          (choice) =>
            choice.role !== null
            && choice.setupState === 'existing_link'
            && !choice.publicUrl.trim(),
        )
        if (badLink) errors.channels = t('wizard.validation.publicUrl')
        const missingTarget = form.choices.find(
          (choice) =>
            choice.role !== null
            && choice.setupState === 'connected'
            && !choice.publishingTargetId,
        )
        if (missingTarget) errors.channels = t('wizard.meta.connectRequired')
      }
    } else {
      if (!form.weeklyCapacity) {
        errors.weeklyCapacity = t('wizard.validation.required')
      }
      if (!form.paidMedia) errors.paidMedia = t('wizard.validation.required')
      if (
        form.paidMedia === 'budget'
        && (!form.budgetAmount || Number(form.budgetAmount) <= 0)
      ) {
        errors.budgetAmount = t('wizard.validation.required')
      }
      if (!context) errors.form = t('wizard.validation.loadFailed')
    }
    setForm((previous) => ({ ...previous, errors }))
    if (Object.keys(errors).length > 0) {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus()
      })
      return false
    }
    return true
  }

  function goNext() {
    if (!validateStep(step)) return
    setStep(STEPS[stepIndex + 1].id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function goBack() {
    setStep(STEPS[stepIndex - 1].id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
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

  async function connectMeta(channel: 'facebook' | 'instagram') {
    if (!context) return
    setMetaError(null)
    setMetaPending(true)
    try {
      const strategyId = await ensureStrategy()
      if (!strategyId) return
      const connection = await connectMetaPublishingTarget({
        channel,
        locale,
        returnPath: '/strategy/new',
        fingerprint: getConnectionFingerprint(),
      })
      window.sessionStorage.setItem(
        metaDraftKey(connection.connection_id),
        JSON.stringify({
          strategyId,
          requestedChannel: channel,
          form,
          step,
        }),
      )
      window.sessionStorage.setItem(
        META_LATEST_DRAFT_KEY,
        connection.connection_id,
      )
      window.location.assign(connection.authorization_url)
    } catch (caught) {
      const apiError = caught as Partial<PublishingApiError>
      setMetaError(
        apiError.code === 'PUBLISHING_META_NOT_CONFIGURED'
          ? t('wizard.meta.connectUnavailable')
          : t('wizard.meta.connectFailed'),
      )
    } finally {
      setMetaPending(false)
    }
  }

  async function handleConnectFacebookPage() {
    setFacebookError(null)
    setFacebookPending(true)
    try {
      const payload = await connectFacebookPage()
      setFacebookConnected(payload.pageName)
    } catch (caught) {
      setFacebookError(
        caught instanceof Error
          ? caught.message
          : t('wizard.facebookPage.failed'),
      )
    } finally {
      setFacebookPending(false)
    }
  }

  async function handleMetaComplete(
    connectionId: string | null,
    selectedTargets: readonly PublishingTargetPublicV1[],
    selection: MetaConnectionCompleteContext,
  ) {
    const draft = readMetaDraft(connectionId)
    const sourceForm = draft?.form ?? form
    const targetByChannel = new Map(
      selectedTargets.map((target) => [target.channel, target]),
    )
    const nextForm: FormData = {
      ...sourceForm,
      errors: {},
      choices: sourceForm.choices.map((choice) => {
        if (choice.role === null) return choice
        const target =
          choice.channel === 'facebook' || choice.channel === 'instagram'
            ? targetByChannel.get(choice.channel)
            : undefined
        const canBindInstagram =
          choice.channel !== 'instagram'
          || selection.includeInstagram
          || selection.requestedChannel === 'instagram'
        if (!target || !canBindInstagram || !isUsablePublishingTarget(target, choice.channel)) {
          return choice
        }
        return {
          ...choice,
          setupState: 'connected',
          publishingTargetId: target.target_id,
          publicUrl: '',
        }
      }),
    }
    setForm(nextForm)
    setStep(draft?.step ?? 'channels')
    setDirty(true)
    setSaved(false)
    setMetaError(null)
    setTargets((previous) => {
      const merged = new Map(previous.map((target) => [target.target_id, target]))
      selectedTargets.forEach((target) => merged.set(target.target_id, target))
      return [...merged.values()]
    })
    if (typeof window !== 'undefined') {
      if (connectionId) window.sessionStorage.removeItem(metaDraftKey(connectionId))
      window.sessionStorage.removeItem(META_LATEST_DRAFT_KEY)
    }
    const refreshed = await listPublishingTargets().catch(() => null)
    if (refreshed) setTargets(refreshed)
    metaResumeRef.current = true
    router.replace('/strategy/new')
  }

  async function persist(shouldGenerate: boolean) {
    if (!validateStep(step) || !context) return
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
      router.push(`/strategy/${strategyId}`)
    } else {
      router.push('/strategy')
    }
  }

  if (metaResult || metaConnectionId) {
    return (
      <section className="grid gap-5 rounded-xl border border-border bg-background p-4 md:p-6">
        <PublishingMetaCallbackResult
          backHref="/strategy/new"
          retryHref="/strategy/new"
          successHref="/strategy/new"
          onComplete={(selectedTargets, selection) =>
            handleMetaComplete(metaConnectionId, selectedTargets, selection)
          }
        />
      </section>
    )
  }

  if (legacyV1) {
    return <StrategyChoicesForm />
  }

  const disabled = loading || pending
  const readiness = [
    { key: 'goal', complete: Boolean(form.objective) },
    {
      key: 'channels',
      complete: form.choices.some((choice) => choice.role !== null),
    },
    {
      key: 'realistic',
      complete: Boolean(form.weeklyCapacity) && Boolean(form.paidMedia),
    },
  ] as const

  return (
    <section className="grid gap-5">
      <header className="rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <p className="text-xs font-bold tracking-[0.14em] text-journey-mint uppercase">
          {t('wizard.eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{t('wizard.title')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">
          {t('wizard.subtitle')}
        </p>
      </header>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <p className="text-sm text-muted-foreground">{tc('loading')}</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
          <div className="grid gap-5">
            <nav
              aria-label={t('wizard.eyebrow')}
              className="rounded-xl border border-border bg-surface p-4 shadow-elevated"
            >
              <ol className="grid gap-3 sm:grid-cols-3">
                {STEPS.map((entry, index) => {
                  const active = entry.id === step
                  const complete = index < stepIndex || readiness[index].complete
                  return (
                    <li key={entry.id} className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold',
                          active
                            ? 'bg-primary text-primary-foreground'
                            : complete
                              ? 'bg-journey-mint/20 text-primary'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {complete && !active ? (
                          <Check className="size-4" aria-hidden="true" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span
                        className={cn(
                          'text-sm font-semibold',
                          active ? 'text-navy' : 'text-muted-foreground',
                        )}
                      >
                        {t(`wizard.steps.${entry.id}`)}
                      </span>
                    </li>
                  )
                })}
              </ol>
              <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
                {t('wizard.stepOf', { current: stepIndex + 1, total: STEPS.length })}
              </p>
            </nav>

            {step === 'goal' ? (
              <GoalStep form={form} setField={setField} />
            ) : null}
            {step === 'channels' ? (
              <ChannelsStep
                choices={form.choices}
                errors={form.errors.channels}
                onChange={updateChoice}
                targets={targets}
                metaPending={metaPending}
                metaError={metaError}
                onConnect={connectMeta}
                facebookPending={facebookPending}
                facebookConnected={facebookConnected}
                facebookError={facebookError}
                onConnectFacebook={handleConnectFacebookPage}
              />
            ) : null}
            {step === 'realistic' ? (
              <RealisticStep form={form} setField={setField} />
            ) : null}

            <div aria-live="polite">
              {form.errors.form ? (
                <p className="text-sm text-danger">{form.errors.form}</p>
              ) : null}
              {error ? (
                <p className="text-sm text-danger">{error}</p>
              ) : null}
              {saved ? (
                <p className="text-sm font-semibold text-primary">
                  {t('wizard.saved')}
                </p>
              ) : null}
              {dirty ? (
                <p className="text-xs text-warning">{t('wizard.unsaved')}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-elevated sm:flex-row sm:justify-between md:p-5">
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || stepIndex === 0}
                onClick={goBack}
              >
                {t('wizard.back')}
              </Button>
              <div className="flex flex-col gap-3 sm:flex-row">
                {stepIndex === STEPS.length - 1 ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => void persist(false)}
                    >
                      {pending ? tc('saving') : t('wizard.save')}
                    </Button>
                    <Button
                      type="button"
                      className="shadow-tactile"
                      disabled={disabled}
                      onClick={() => setConfirmOpen(true)}
                    >
                      {pending
                        ? t('wizard.generatePending')
                        : t('wizard.generate')}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    className="shadow-tactile"
                    disabled={disabled}
                    onClick={goNext}
                  >
                    {t('wizard.next')}
                  </Button>
                )}
              </div>
            </div>
          </div>

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
                      {t(`wizard.readiness.${item.key}`)}
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

function GoalStep({
  form,
  setField,
}: {
  readonly form: FormData
  readonly setField: (field: EditableField, value: string) => void
}) {
  const t = useTranslations('Strategy')
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-6">
      <h2 className="text-xl font-bold text-navy md:text-2xl">
        {t('wizard.steps.goal')}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {t('wizard.steps.goalBody')}
      </p>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <WizardField
          id="wizard-objective"
          label={t('choices.fields.objective.label')}
          help={t('choices.fields.objective.help')}
          error={form.errors.objective}
        >
          <select
            id="wizard-objective"
            name="wizard-objective"
            autoComplete="off"
            value={form.objective}
            onChange={(event) => setField('objective', event.target.value)}
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
        </WizardField>

        <WizardField
          id="wizard-start-date"
          label={t('choices.fields.startDate.label')}
          help={t('choices.fields.startDate.help')}
          error={form.errors.startDate}
        >
          <Input
            id="wizard-start-date"
            name="wizard-start-date"
            autoComplete="off"
            type="date"
            value={form.startDate}
            onChange={(event) => setField('startDate', event.target.value)}
            aria-invalid={Boolean(form.errors.startDate)}
          />
        </WizardField>

        <WizardField
          id="wizard-language"
          label={t('choices.fields.language.label')}
          help={t('choices.fields.language.help')}
          error={form.errors.language}
        >
          <select
            id="wizard-language"
            name="wizard-language"
            autoComplete="off"
            value={form.language}
            onChange={(event) => setField('language', event.target.value)}
            aria-invalid={Boolean(form.errors.language)}
            className={selectClassName}
          >
            <option value="ar-EG">
              {t('choices.fields.language.options.arabic')}
            </option>
            <option value="en">
              {t('choices.fields.language.options.english')}
            </option>
          </select>
        </WizardField>
      </div>
    </section>
  )
}

function ChannelsStep({
  choices,
  errors,
  onChange,
  targets,
  metaPending,
  metaError,
  onConnect,
  facebookPending,
  facebookConnected,
  facebookError,
  onConnectFacebook,
}: {
  readonly choices: readonly WizardChoice[]
  readonly errors?: string
  readonly onChange: (
    channel: StrategyV2Channel,
    patch: Partial<WizardChoice>,
  ) => void
  readonly targets: readonly PublishingTargetPublicV1[]
  readonly metaPending: boolean
  readonly metaError: string | null
  readonly onConnect: (channel: 'facebook' | 'instagram') => void
  readonly facebookPending: boolean
  readonly facebookConnected: string | null
  readonly facebookError: string | null
  readonly onConnectFacebook: () => void
}) {
  const t = useTranslations('Strategy')
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-6">
      <h2 className="text-xl font-bold text-navy md:text-2xl">
        {t('wizard.steps.channels')}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {t('wizard.steps.channelsBody')}
      </p>
      <p className="mt-3 text-sm font-semibold text-navy">
        {t('wizard.primaryHelp')}
      </p>

      <fieldset className="mt-4 grid gap-3 md:grid-cols-2">
        <legend className="sr-only">{t('channels.label')}</legend>
        {choices.map((choice) => {
          const meta = CATALOG.find((entry) => entry.channel === choice.channel)!
          return (
            <div
              key={choice.channel}
              className={cn(
                'grid gap-3 rounded-xl border p-4',
                choice.role !== null
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-background',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-3">
                  <ChannelIcon channel={choice.channel} meta={meta.meta} />
                  <span className="font-bold text-navy">
                    {t(`channels.${choice.channel}`)}
                  </span>
                </span>
                <span className="flex items-center gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-navy">
                    <input
                      type="radio"
                      name="primary-channel"
                      className="size-4 accent-[var(--color-primary)]"
                      checked={choice.role === 'primary'}
                      onChange={() =>
                        onChange(choice.channel, { role: 'primary' })
                      }
                    />
                    {t('channels.roles.primary')}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-navy">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--color-primary)]"
                      checked={choice.role === 'supporting'}
                      onChange={(event) =>
                        onChange(choice.channel, {
                          role: event.target.checked ? 'supporting' : null,
                        })
                      }
                    />
                    {t('channels.roles.supporting')}
                  </label>
                </span>
              </div>

              {choice.role !== null ? (
                <div className="grid gap-2">
                  {meta.meta ? (
                    <div className="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      {targets
                        .filter((target) => target.channel === choice.channel)
                        .map((target) => (
                          <label
                            key={target.target_id}
                            className={cn(
                              'flex cursor-pointer items-start gap-2 text-sm font-semibold text-navy',
                              target.connection_state !== 'connected' && 'text-muted-foreground',
                            )}
                          >
                            <input
                              type="radio"
                              name={`setup-${choice.channel}`}
                              checked={
                                choice.setupState === 'connected'
                                && choice.publishingTargetId === target.target_id
                              }
                              disabled={!isUsablePublishingTarget(target, choice.channel)}
                              onChange={() =>
                                onChange(choice.channel, {
                                  setupState: 'connected',
                                  publishingTargetId: target.target_id,
                                  publicUrl: '',
                                })
                              }
                            />
                            <span>
                              {isUsablePublishingTarget(target, choice.channel)
                                ? `${t('wizard.meta.connectedTarget')}: ${target.display_name}`
                                : `${target.display_name} — ${t('wizard.meta.targetUnavailable')}`}
                            </span>
                          </label>
                        ))}
                      <Button
                        type="button"
                        variant="outline"
                        className="w-fit"
                        disabled={metaPending}
                        onClick={() =>
                          onConnect(choice.channel as 'facebook' | 'instagram')
                        }
                      >
                        <PlugZap className="size-4" aria-hidden="true" />
                        {metaPending
                          ? t('wizard.meta.connecting')
                          : targets.some(
                              (target) =>
                                target.channel === choice.channel
                                && target.connection_state !== 'connected',
                            )
                            ? t('wizard.meta.reconnect')
                            : t('wizard.meta.connect')}
                      </Button>
                    </div>
                  ) : null}
                  {meta.meta && choice.channel === 'facebook' ? (
                    <div className="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <p className="text-sm font-semibold text-navy">
                        {t('wizard.facebookPage.label')}
                      </p>
                      {facebookConnected ? (
                        <p className="text-sm font-semibold text-primary">
                          {t('wizard.facebookPage.connected', {
                            pageName: facebookConnected,
                          })}
                        </p>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        className="w-fit"
                        disabled={facebookPending}
                        onClick={onConnectFacebook}
                      >
                        <PlugZap className="size-4" aria-hidden="true" />
                        {facebookPending
                          ? t('wizard.facebookPage.connecting')
                          : facebookConnected
                            ? t('wizard.facebookPage.reconnect')
                            : t('wizard.facebookPage.connect')}
                      </Button>
                      {facebookError ? (
                        <p
                          className="text-sm font-semibold text-danger"
                          role="alert"
                        >
                          {facebookError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-navy">
                    <input
                      type="radio"
                      name={`setup-${choice.channel}`}
                      checked={choice.setupState === 'existing_link'}
                      onChange={() =>
                        onChange(choice.channel, {
                          setupState: 'existing_link',
                        })
                      }
                    />
                    {t('wizard.meta.addLink')}
                  </label>
                  {choice.setupState === 'existing_link' ? (
                    <div className="grid gap-1 ps-7">
                      <Label htmlFor={`url-${choice.channel}`}>
                        {t('wizard.meta.publicUrlLabel')}
                      </Label>
                      <Input
                        id={`url-${choice.channel}`}
                        name={`url-${choice.channel}`}
                        type="url"
                        dir="ltr"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder={t('wizard.meta.publicUrlPlaceholder')}
                        value={choice.publicUrl}
                        onChange={(event) =>
                          onChange(choice.channel, {
                            publicUrl: event.target.value,
                          })
                        }
                        aria-invalid={Boolean(errors && !choice.publicUrl.trim())}
                      />
                    </div>
                  ) : null}
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-navy">
                    <input
                      type="radio"
                      name={`setup-${choice.channel}`}
                      checked={choice.setupState === 'setup_later'}
                      onChange={() =>
                        onChange(choice.channel, {
                          setupState: 'setup_later',
                          publicUrl: '',
                        })
                      }
                    />
                    {t('wizard.meta.setUpLater')}
                  </label>
                </div>
              ) : null}
            </div>
          )
        })}
      </fieldset>

      <div aria-live="polite">
        {metaError ? (
          <p className="mt-3 text-sm font-semibold text-danger" role="alert">
            {metaError}
          </p>
        ) : null}
        {errors ? (
          <p className="mt-3 text-sm font-semibold text-danger" role="alert">
            {errors}
          </p>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {t('wizard.supportingHelp')}
      </p>
    </section>
  )
}

function RealisticStep({
  form,
  setField,
}: {
  readonly form: FormData
  readonly setField: (field: EditableField, value: string) => void
}) {
  const t = useTranslations('Strategy')
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-6">
      <h2 className="text-xl font-bold text-navy md:text-2xl">
        {t('wizard.steps.realistic')}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {t('wizard.steps.realisticBody')}
      </p>

      <fieldset className="mt-5 grid gap-3">
        <legend className="text-sm font-bold text-navy">
          {t('wizard.capacity.label')}
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {t('wizard.capacity.help')}
          </span>
        </legend>
        {CAPACITY_PRESETS.map((preset) => (
          <label
            key={preset}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-semibold',
              form.weeklyCapacity === preset
                ? 'border-primary/40 bg-primary/5 text-navy'
                : 'border-border bg-background text-navy',
            )}
          >
            <input
              type="radio"
              name="weekly-capacity"
              className="size-4 accent-[var(--color-primary)]"
              checked={form.weeklyCapacity === preset}
              onChange={() => setField('weeklyCapacity', preset)}
            />
            {t(`wizard.capacity.options.${preset}`)}
          </label>
        ))}
      </fieldset>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <WizardField
          id="wizard-capacity-note"
          label={t('wizard.capacityNote.label')}
          help={t('wizard.capacityNote.help')}
        >
          <Input
            id="wizard-capacity-note"
            name="wizard-capacity-note"
            autoComplete="off"
            value={form.weeklyCapacityNote}
            onChange={(event) =>
              setField('weeklyCapacityNote', event.target.value)
            }
          />
        </WizardField>

        <WizardField
          id="wizard-paid-media"
          label={t('wizard.paidMedia.label')}
          help={t('wizard.paidMedia.help')}
          error={form.errors.paidMedia}
        >
          <select
            id="wizard-paid-media"
            name="wizard-paid-media"
            autoComplete="off"
            value={form.paidMedia}
            onChange={(event) => setField('paidMedia', event.target.value)}
            aria-invalid={Boolean(form.errors.paidMedia)}
            className={selectClassName}
          >
            <option value="">{t('choices.selectPlaceholder')}</option>
            <option value="organic">{t('wizard.paidMedia.organic')}</option>
            <option value="budget">{t('wizard.paidMedia.allowed')}</option>
          </select>
        </WizardField>

        {form.paidMedia === 'budget' ? (
          <WizardField
            id="wizard-budget-amount"
            label={t('wizard.budgetAmount.label')}
            help={t('wizard.budgetAmount.help')}
            error={form.errors.budgetAmount}
          >
            <Input
              id="wizard-budget-amount"
              name="wizard-budget-amount"
              autoComplete="off"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={form.budgetAmount}
              onChange={(event) => setField('budgetAmount', event.target.value)}
              aria-invalid={Boolean(form.errors.budgetAmount)}
            />
          </WizardField>
        ) : null}

        <WizardField
          id="wizard-constraints"
          label={t('wizard.constraints.label')}
          help={t('wizard.constraints.help')}
          wide
        >
          <textarea
            id="wizard-constraints"
            name="wizard-constraints"
            autoComplete="off"
            value={form.constraints}
            onChange={(event) => setField('constraints', event.target.value)}
            className={textareaClassName}
          />
        </WizardField>
      </div>
    </section>
  )
}

function ChannelIcon({
  channel,
  meta,
}: {
  readonly channel: StrategyV2Channel
  readonly meta: boolean
}) {
  if (channel === 'website') {
    return <Globe className="size-5 text-primary" aria-hidden="true" />
  }
  if (channel === 'delivery_platforms') {
    return <Store className="size-5 text-primary" aria-hidden="true" />
  }
  if (meta) {
    return <PlugZap className="size-5 text-primary" aria-hidden="true" />
  }
  return <Link2 className="size-5 text-primary" aria-hidden="true" />
}

const selectClassName = cn(
  'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none',
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40',
)

const textareaClassName = cn(
  'min-h-28 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none',
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40',
)

function WizardField({
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
