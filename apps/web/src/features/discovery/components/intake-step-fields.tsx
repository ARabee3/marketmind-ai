'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { LanguageMode, SocialPlatform } from '@marketmind/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IntakeFieldLabel } from './intake-field-label'
import type {
  EditableIntakeField,
  IntakeDraft,
  IntakeStep,
  SocialLinkDraft,
} from './intake-form.types'

const PLATFORMS = [
  'facebook',
  'instagram',
  'tiktok',
  'website',
  'google_maps',
  'delivery',
  'other',
] as const satisfies readonly SocialPlatform[]

const PLATFORM_LABELS = {
  facebook: 'platformFacebook',
  instagram: 'platformInstagram',
  tiktok: 'platformTiktok',
  website: 'platformWebsite',
  google_maps: 'platformGoogleMaps',
  delivery: 'platformDelivery',
  other: 'platformOther',
} as const

const BASIC_FIELDS = [
  ['businessName', true],
  ['businessType', true],
  ['city', true],
  ['area', false],
  ['addressText', false],
] as const satisfies readonly (readonly [EditableIntakeField, boolean])[]

const CONTEXT_FIELDS = [
  ['ownerGoal', false],
  ['targetAudience', false],
  ['competitors', false],
] as const satisfies readonly (readonly [EditableIntakeField, boolean])[]

const FIELD_KEYS = {
  businessName: ['businessNameLabel', 'businessNamePlaceholder', 'businessNameHelp', 'businessNameExample'],
  businessType: ['businessTypeLabel', 'businessTypePlaceholder', 'businessTypeHelp', 'businessTypeExample'],
  city: ['cityLabel', 'cityPlaceholder', 'cityHelp', 'cityExample'],
  area: ['areaLabel', 'areaPlaceholder', 'areaHelp', 'areaExample'],
  addressText: ['addressLabel', 'addressPlaceholder', 'addressHelp', 'addressExample'],
  ownerGoal: ['ownerGoalLabel', 'ownerGoalPlaceholder', 'ownerGoalHelp', 'ownerGoalExample'],
  targetAudience: ['targetAudienceLabel', 'targetAudiencePlaceholder', 'targetAudienceHelp', 'targetAudienceExample'],
  competitors: ['competitorsLabel', 'competitorsPlaceholder', 'competitorsHelp', 'competitorsExample'],
} as const

export function IntakeStepFields({
  step,
  draft,
  socialLinks,
  onFieldChange,
  onLanguageChange,
  onAddSocialLink,
  onRemoveSocialLink,
  onSocialPlatformChange,
  onSocialUrlChange,
}: {
  readonly step: IntakeStep
  readonly draft: IntakeDraft
  readonly socialLinks: readonly SocialLinkDraft[]
  readonly onFieldChange: (field: EditableIntakeField, value: string) => void
  readonly onLanguageChange: (languageMode: LanguageMode) => void
  readonly onAddSocialLink: () => void
  readonly onRemoveSocialLink: (id: string) => void
  readonly onSocialPlatformChange: (id: string, platform: SocialPlatform) => void
  readonly onSocialUrlChange: (id: string, url: string) => void
}) {
  const t = useTranslations('DiscoveryIntake')

  if (step === 0) {
    return <TextFields fields={BASIC_FIELDS} draft={draft} onFieldChange={onFieldChange} />
  }

  if (step === 1) {
    return <TextFields fields={CONTEXT_FIELDS} draft={draft} onFieldChange={onFieldChange} />
  }

  return (
    <div className="space-y-8">
      <fieldset className="space-y-3">
        <legend className="text-base font-bold text-navy">{t('languageModeSection')}</legend>
        <p className="text-sm leading-6 text-muted-foreground">{t('languageModeHint')}</p>
        <div className="grid gap-3 lg:grid-cols-3">
          {(['ar-EG', 'en', 'mixed'] as const).map((mode) => (
            <label
              key={mode}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-navy transition-colors has-[:checked]:border-primary has-[:checked]:bg-soft-teal"
            >
              <input
                type="radio"
                name="languageMode"
                value={mode}
                checked={draft.languageMode === mode}
                onChange={() => onLanguageChange(mode)}
                className="size-4 accent-primary"
              />
              {mode === 'ar-EG' ? t('languageModeAr') : mode === 'en' ? t('languageModeEn') : t('languageModeMixed')}
            </label>
          ))}
        </div>
      </fieldset>

      <section className="space-y-4" aria-labelledby="social-links-title">
        <div>
          <h3 id="social-links-title" className="text-base font-bold text-navy">{t('socialLinksSection')}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('socialLinksHint')}</p>
        </div>
        <div className="space-y-3">
          {socialLinks.map((link) => (
            <div key={link.id} className="grid gap-3 rounded-lg border border-border bg-background p-3 lg:grid-cols-[10rem_1fr_auto] lg:items-end">
              <div className="space-y-2">
                <label htmlFor={`social-platform-${link.id}`} className="text-sm font-semibold text-navy">
                  {t('socialLinkPlatformLabel')}
                </label>
                <select
                  id={`social-platform-${link.id}`}
                  name={`socialLinks.${link.id}.platform`}
                  autoComplete="off"
                  value={link.platform}
                  onChange={(event) => {
                    const platform = PLATFORMS.find((item) => item === event.target.value)
                    if (platform) onSocialPlatformChange(link.id, platform)
                  }}
                  className="h-12 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  {PLATFORMS.map((platform) => (
                    <option key={platform} value={platform}>{t(PLATFORM_LABELS[platform])}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor={`social-url-${link.id}`} className="text-sm font-semibold text-navy">
                  {t('socialLinkUrlLabel')}
                </label>
                <Input
                  id={`social-url-${link.id}`}
                  name={`socialLinks.${link.id}.url`}
                  type="url"
                  autoComplete="url"
                  value={link.url}
                  onChange={(event) => onSocialUrlChange(link.id, event.target.value)}
                  placeholder={t('socialLinkUrlPlaceholder')}
                  className="h-12 bg-surface px-4"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                onClick={() => onRemoveSocialLink(link.id)}
                aria-label={t('removeSocialLink')}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
        {socialLinks.length < 8 ? (
          <Button type="button" variant="outline" onClick={onAddSocialLink} className="min-h-11 px-4">
            <Plus aria-hidden="true" />
            {t('addSocialLink')}
          </Button>
        ) : null}
      </section>
    </div>
  )
}

function TextFields({
  fields,
  draft,
  onFieldChange,
}: {
  readonly fields: readonly (readonly [EditableIntakeField, boolean])[]
  readonly draft: IntakeDraft
  readonly onFieldChange: (field: EditableIntakeField, value: string) => void
}) {
  const t = useTranslations('DiscoveryIntake')

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {fields.map(([field, required]) => {
        const [labelKey, placeholderKey, helpKey, exampleKey] = FIELD_KEYS[field]
        const wide = field === 'addressText' || field === 'ownerGoal' || field === 'targetAudience' || field === 'competitors'
        return (
          <div key={field} className={`space-y-2 ${wide ? 'lg:col-span-2' : ''}`}>
            <IntakeFieldLabel
              htmlFor={field}
              label={t(labelKey)}
              help={t(helpKey)}
              example={t(exampleKey)}
              helpLabel={t('fieldHelpLabel')}
              exampleLabel={t('exampleLabel')}
              required={required}
            />
            <Input
              id={field}
              name={field}
              autoComplete="off"
              value={draft[field]}
              onChange={(event) => onFieldChange(field, event.target.value)}
              placeholder={t(placeholderKey)}
              required={required}
              className="h-12 bg-surface px-4 text-base"
            />
          </div>
        )
      })}
    </div>
  )
}
