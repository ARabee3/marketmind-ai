'use client'

import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import type { LanguageMode, SocialPlatform, StartPreparedDiscoveryRequest } from '@marketmind/contracts'
import { Button } from '@/components/ui/button'
import { useRouter } from '@/i18n/navigation'
import type { TranslationKey } from '@/i18n/types'
import { startDiscovery, type ApiError } from '@/lib/api/discovery'
import { getApiErrorTranslationKey } from '@/features/discovery/lib/api-error-localization'
import { IntakeStepFields } from './intake-step-fields'
import type {
  EditableIntakeField,
  IntakeDraft,
  IntakeStep,
  SocialLinkDraft,
} from './intake-form.types'

const STEPS = [0, 1, 2] as const satisfies readonly IntakeStep[]

const STEP_CONTENT = {
  0: { title: 'step1Title', description: 'step1Description', short: 'step1Short' },
  1: { title: 'step2Title', description: 'step2Description', short: 'step2Short' },
  2: { title: 'step3Title', description: 'step3Description', short: 'step3Short' },
} as const

export function IntakeForm() {
  const t = useTranslations('DiscoveryIntake')
  const tAll = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const [step, setStep] = useState<IntakeStep>(0)
  const [highestStep, setHighestStep] = useState<IntakeStep>(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null)
  const [socialLinks, setSocialLinks] = useState<readonly SocialLinkDraft[]>([])
  const [draft, setDraft] = useState<IntakeDraft>(() => ({
    businessName: '',
    businessType: '',
    city: '',
    area: '',
    addressText: '',
    ownerGoal: '',
    competitors: '',
    targetAudience: '',
    languageMode: locale === 'ar' ? 'ar-EG' : 'en',
  }))

  function updateField(field: EditableIntakeField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function updateLanguage(languageMode: LanguageMode) {
    setDraft((current) => ({ ...current, languageMode }))
  }

  function validateBasics(): boolean {
    if (!draft.businessName.trim()) {
      setErrorKey('DiscoveryIntake.validationNameRequired')
      return false
    }
    if (!draft.businessType.trim()) {
      setErrorKey('DiscoveryIntake.validationTypeRequired')
      return false
    }
    if (!draft.city.trim()) {
      setErrorKey('DiscoveryIntake.validationCityRequired')
      return false
    }
    return true
  }

  function goNext() {
    setErrorKey(null)
    if (step === 0 && !validateBasics()) return
    const nextStep: IntakeStep = step === 0 ? 1 : 2
    setStep(nextStep)
    setHighestStep((current) => current > nextStep ? current : nextStep)
  }

  function goBack() {
    setErrorKey(null)
    setStep((current) => current === 2 ? 1 : 0)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorKey(null)
    if (!validateBasics()) {
      setStep(0)
      return
    }
    if (socialLinks.some((link) => !isHttpUrl(link.url))) {
      setErrorKey('DiscoveryIntake.validationUrlInvalid')
      return
    }

    setIsSubmitting(true)
    try {
      const payload: StartPreparedDiscoveryRequest = {
        language_mode: draft.languageMode,
        intake: {
          business_name: draft.businessName.trim(),
          business_type: draft.businessType.trim(),
          city: draft.city.trim(),
          area: optionalText(draft.area),
          address_text: optionalText(draft.addressText),
          owner_goal_text: optionalText(draft.ownerGoal),
          known_competitors_text: optionalText(draft.competitors),
          target_audience_text: optionalText(draft.targetAudience),
          social_links: socialLinks.length > 0
            ? socialLinks.map(({ platform, url }) => ({ platform, url: url.trim() }))
            : undefined,
        },
      }
      const response = await startDiscovery(payload)
      router.push(`/discovery/${response.session_id}`)
    } catch (error: unknown) {
      setErrorKey(getApiErrorTranslationKey(error as ApiError))
      setIsSubmitting(false)
    }
  }

  const progress = ((step + 1) / STEPS.length) * 100

  return (
    <section className="mx-auto w-full max-w-5xl py-3 md:py-6">
      <div className="mb-6 max-w-2xl">
        <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">{t('eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-navy md:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-ink-soft">{t('subtitle')}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <form onSubmit={handleSubmit} noValidate className="overflow-visible rounded-lg border border-border bg-surface shadow-elevated">
          <div className="border-b border-border px-4 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-4 text-xs font-semibold text-muted-foreground">
              <span>{t('stepCounter', { current: step + 1, total: STEPS.length })}</span>
              <span>{t(STEP_CONTENT[step].title)}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t('formProgressLabel')}>
              <div className="h-full origin-left rounded-full bg-primary transition-transform duration-300 rtl:origin-right" style={{ transform: `scaleX(${progress / 100})` }} />
            </div>
            <ol className="mt-4 grid grid-cols-3 gap-2">
              {STEPS.map((item) => {
                const complete = item !== step && item < highestStep
                return (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => setStep(item)}
                      disabled={item > highestStep}
                      aria-current={item === step ? 'step' : undefined}
                      className="flex w-full items-center gap-2 rounded-lg p-1 text-start text-xs font-semibold text-muted-foreground outline-none transition-colors enabled:hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className={`grid size-7 shrink-0 place-items-center rounded-full border ${item === step ? 'border-primary bg-primary text-primary-foreground' : complete ? 'border-primary bg-soft-teal text-primary' : 'border-border bg-background'}`}>
                        {complete ? <Check className="size-4" aria-hidden="true" /> : item + 1}
                      </span>
                      <span className="hidden sm:inline">{t(STEP_CONTENT[item].short)}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="min-h-[22rem] px-4 py-6 sm:px-6">
            {errorKey ? (
              <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm font-medium text-destructive" role="alert" aria-live="assertive">
                {tAll(errorKey)}
              </div>
            ) : null}
            <div className="mb-6">
              <h2 className="text-xl font-bold text-navy">{t(STEP_CONTENT[step].title)}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{t(STEP_CONTENT[step].description)}</p>
            </div>
            <IntakeStepFields
              step={step}
              draft={draft}
              socialLinks={socialLinks}
              onFieldChange={updateField}
              onLanguageChange={updateLanguage}
              onAddSocialLink={() => setSocialLinks((current) => [...current, { id: crypto.randomUUID(), platform: 'facebook', url: '' }])}
              onRemoveSocialLink={(id) => setSocialLinks((current) => current.filter((link) => link.id !== id))}
              onSocialPlatformChange={(id, platform: SocialPlatform) => setSocialLinks((current) => current.map((link) => link.id === id ? { ...link, platform } : link))}
              onSocialUrlChange={(id, url) => setSocialLinks((current) => current.map((link) => link.id === id ? { ...link, url } : link))}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border bg-background/70 px-4 py-4 sm:px-6">
            <Button type="button" variant="ghost" onClick={goBack} disabled={step === 0 || isSubmitting} className="min-h-11 px-4">
              {locale === 'ar' ? <ArrowRight aria-hidden="true" /> : <ArrowLeft aria-hidden="true" />}
              {t('previousStep')}
            </Button>
            {step < 2 ? (
              <Button key="next" type="button" onClick={goNext} className="min-h-11 px-5">
                {t('nextStep')}
                {locale === 'ar' ? <ArrowLeft aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
              </Button>
            ) : (
              <Button key="submit" type="submit" disabled={isSubmitting} className="min-h-11 px-6 shadow-tactile hover:translate-y-[3px] hover:shadow-tactile-pressed">
                {isSubmitting ? t('submitting') : t('submit')}
              </Button>
            )}
          </div>
        </form>

        <aside className="rounded-lg border border-border bg-navy p-5 text-primary-foreground lg:sticky lg:top-24">
          <ShieldCheck className="size-7 text-journey-mint" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-bold">{t('whyWeAskTitle')}</h2>
          <p className="mt-2 text-sm leading-7 text-white/75">{t('whyWeAskDescription')}</p>
          <div className="mt-5 border-t border-white/15 pt-4 text-sm leading-6 text-white/75">
            <p className="font-semibold text-journey-mint">{t('nextAfterFormTitle')}</p>
            <p className="mt-1">{t('nextAfterFormDescription')}</p>
          </div>
        </aside>
      </div>
    </section>
  )
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
