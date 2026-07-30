'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useStrategyActions } from '../hooks/use-strategy-actions'
import { getCurrentJourney } from '@/lib/api/journey'
import { cn } from '@/lib/utils'

const FIELDS = ['objective', 'startDate', 'language', 'paidMedia', 'budget', 'capacity'] as const

type PlanLanguageValue = 'ar-EG' | 'en'

type FormData = {
  objective: string
  startDate: string
  language: PlanLanguageValue
  paidMedia: string
  budget: string
  capacity: string
  constraints: string
  errors: Partial<Record<(typeof FIELDS)[number] | 'constraints', string>>
}

const PLAN_LANGUAGE_OPTIONS: ReadonlyArray<{ value: PlanLanguageValue; labelKey: 'arabic' | 'english' }> = [
  { value: 'ar-EG', labelKey: 'arabic' },
  { value: 'en', labelKey: 'english' },
]

function buildPayload(form: FormData, versionId: string) {
  return {
    businessProfileVersionId: versionId,
    primaryObjective: form.objective,
    startDate: form.startDate,
    planLanguage: form.language as 'ar-EG' | 'en' | 'mixed',
    paidMediaAllowed: form.paidMedia !== 'Organic only',
    externalBudgetMode: form.budget ? 'monthly_amount' : 'scenario_only',
    teamCapacity: form.capacity,
    constraints: form.constraints || undefined,
  }
}

export function StrategyChoicesForm() {
  const t = useTranslations('Strategy')
  const tc = useTranslations('Common')
  const locale = useLocale()
  const router = useRouter()
  const { create, saveBrief, generate, pending, error } = useStrategyActions()
  const [form, setForm] = useState<FormData>(() => ({
    objective: '',
    startDate: '',
    // Default the plan language to the UI route locale so Arabic routes
    // produce an Arabic plan unless the owner explicitly chooses English.
    language: locale === 'ar' ? 'ar-EG' : 'en',
    paidMedia: '',
    budget: '',
    capacity: '',
    constraints: '',
    errors: {},
  }))
  const [saving, setSaving] = useState(false)

  function setField(field: keyof FormData['errors'], value: string) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      errors: { ...prev.errors, [field]: undefined },
    }))
  }

  function hasErrors(): boolean {
    const errors: FormData['errors'] = {}
    if (!form.objective.trim()) errors.objective = t('choices.validation.required')
    if (!form.startDate.trim()) errors.startDate = t('choices.validation.required')
    if (!form.language.trim()) errors.language = t('choices.validation.required')
    if (!form.paidMedia.trim()) errors.paidMedia = t('choices.validation.required')
    if (!form.budget.trim()) errors.budget = t('choices.validation.required')
    if (!form.capacity.trim()) errors.capacity = t('choices.validation.required')
    setForm((prev) => ({ ...prev, errors }))
    return Object.keys(errors).length > 0
  }

  function profileVersionId(journey: Awaited<ReturnType<typeof getCurrentJourney>>): string | null {
    return journey.journey.state === 'discovery_confirmed' ? journey.journey.profile!.business_profile_version_id : null
  }

  async function handleSave() {
    if (hasErrors()) return
    setSaving(true)
    try {
      const journey = await getCurrentJourney()
      if (journey.future_phase.availability === 'available' && journey.future_phase.strategy_id) {
        const pid = profileVersionId(journey)
        if (!pid) return
        await saveBrief(journey.future_phase.strategy_id, buildPayload(form, pid))
        router.push(`/strategy/${journey.future_phase.strategy_id}`)
        return
      }
      const pid = profileVersionId(journey)
      if (!pid) { setForm((prev) => ({ ...prev, errors: { objective: t('choices.validation.noProfile') } })); return }
      const created = await create(pid)
      if (!created) return
      await saveBrief(created.id, buildPayload(form, pid))
      router.push(`/strategy/${created.id}`)
    } catch {
      // error state handled by useStrategyActions
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerate() {
    if (hasErrors()) return
    setSaving(true)
    try {
      const journey = await getCurrentJourney()
      if (journey.future_phase.availability === 'available' && journey.future_phase.strategy_id) {
        const pid = profileVersionId(journey)
        if (!pid) return
        await saveBrief(journey.future_phase.strategy_id, buildPayload(form, pid))
        await generate(journey.future_phase.strategy_id)
        router.push(`/strategy/${journey.future_phase.strategy_id}`)
        return
      }
      const pid = profileVersionId(journey)
      if (!pid) { setForm((prev) => ({ ...prev, errors: { objective: t('choices.validation.noProfile') } })); return }
      const created = await create(pid)
      if (!created) return
      await saveBrief(created.id, buildPayload(form, pid))
      await generate(created.id)
      router.push(`/strategy/${created.id}`)
    } catch {
      // error state handled by useStrategyActions
    } finally {
      setSaving(false)
    }
  }

  const disabled = saving || pending

  return (
    <section className="grid gap-5">
      <header className="rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <p className="text-xs font-bold tracking-[0.14em] text-journey-mint uppercase">
          {t('choices.eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{t('choices.title')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">{t('choices.subtitle')}</p>
      </header>

      <form className="rounded-xl border border-border bg-surface shadow-elevated" onSubmit={(e) => e.preventDefault()}>
        <div className="grid gap-5 p-4 md:grid-cols-2 md:p-6">
          {FIELDS.map((field) => {
            const error = form.errors[field]
            const helpId = `strategy-${field}-help`
            return (
              <div key={field} className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`strategy-${field}`}>{t(`choices.fields.${field}.label`)}</Label>
                  <span
                    className="inline-flex size-6 items-center justify-center rounded-full border border-border text-xs font-bold text-primary"
                    title={t(`choices.fields.${field}.help`)}
                  >
                    ?
                  </span>
                </div>
                {field === 'language' ? (
                  <select
                    id={`strategy-${field}`}
                    name={`strategy-${field}`}
                    value={form.language}
                    onChange={(e) => setField('language', e.target.value)}
                    aria-describedby={helpId}
                    aria-invalid={!!error}
                    className={cn(
                      'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none',
                      'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40',
                    )}
                  >
                    {PLAN_LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(`choices.fields.language.options.${option.labelKey}`)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`strategy-${field}`}
                    value={form[field]}
                    onChange={(e) => setField(field, e.target.value)}
                    aria-describedby={helpId}
                    aria-invalid={!!error}
                  />
                )}
                {error ? (
                  <p className="text-xs text-danger">{error}</p>
                ) : (
                  <p id={helpId} className="text-xs leading-5 text-muted-foreground">
                    {t(`choices.fields.${field}.help`)}
                  </p>
                )}
              </div>
            )
          })}
          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="strategy-constraints">{t('choices.fields.constraints.label')}</Label>
            <textarea
              id="strategy-constraints"
              value={form.constraints}
              onChange={(e) => setField('constraints', e.target.value)}
              className="min-h-28 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              aria-describedby="strategy-constraints-help"
            />
            {form.errors.constraints ? (
              <p className="text-xs text-danger">{form.errors.constraints}</p>
            ) : (
              <p id="strategy-constraints-help" className="text-xs leading-5 text-muted-foreground">
                {t('choices.fields.constraints.help')}
              </p>
            )}
          </div>
        </div>
        {error ? <p className="px-4 pb-2 text-xs text-danger md:px-6">{error}</p> : null}
        <div className="flex flex-col gap-3 border-t border-border bg-background/70 p-4 sm:flex-row sm:justify-end md:p-5">
          <Button type="button" variant="outline" disabled={disabled} onClick={handleSave}>
            {disabled ? tc('saving') : t('choices.save')}
          </Button>
          <Button type="button" className="shadow-tactile" disabled={disabled} onClick={handleGenerate}>
            {disabled ? tc('saving') : t('choices.generate')}
          </Button>
        </div>
      </form>
    </section>
  )
}
