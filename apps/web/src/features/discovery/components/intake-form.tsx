'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type {
  StartPreparedDiscoveryRequest,
  LanguageMode,
  SocialPlatform,
  SocialLinkInput,
} from '@marketmind/contracts'
import { startDiscovery } from '@/lib/api/discovery'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'

const PLATFORMS: SocialPlatform[] = [
  'facebook',
  'instagram',
  'tiktok',
  'website',
  'google_maps',
  'delivery',
  'other',
]

export function IntakeForm() {
  const t = useTranslations('DiscoveryIntake')
  const tErrors = useTranslations('Errors')
  const locale = useLocale()
  const router = useRouter()
  const { token } = useAuth()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fields
  const [businessName, setBusinessName] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [city, setCity] = useState('')
  const [area, setArea] = useState('')
  const [ownerGoal, setOwnerGoal] = useState('')
  const [competitors, setCompetitors] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  
  // Default mode depends on UI locale
  const [languageMode, setLanguageMode] = useState<LanguageMode>(
    locale === 'ar' ? 'ar-EG' : 'en'
  )

  const [socialLinks, setSocialLinks] = useState<(SocialLinkInput & { _id: string })[]>([])

  function addSocialLink() {
    setSocialLinks((prev) => [...prev, { _id: crypto.randomUUID(), platform: 'facebook', url: '' }])
  }

  function removeSocialLink(id: string) {
    setSocialLinks((prev) => prev.filter((link) => link._id !== id))
  }

  function updateSocialLink(id: string, updates: Partial<SocialLinkInput>) {
    setSocialLinks((prev) =>
      prev.map((link) => (link._id === id ? { ...link, ...updates } : link))
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    
    // Basic validation
    if (!businessName.trim()) {
      setError(t('validationNameRequired'))
      return
    }
    if (!businessType.trim()) {
      setError(t('validationTypeRequired'))
      return
    }
    if (!city.trim()) {
      setError(t('validationCityRequired'))
      return
    }

    // Validate URLs
    for (const link of socialLinks) {
      if (!link.url.trim().startsWith('http://') && !link.url.trim().startsWith('https://')) {
        setError(t('validationUrlInvalid'))
        return
      }
    }

    setIsSubmitting(true)
    try {
      const payload: StartPreparedDiscoveryRequest = {
        language_mode: languageMode,
        intake: {
          business_name: businessName,
          business_type: businessType,
          city: city,
          area: area || undefined,
          owner_goal_text: ownerGoal || undefined,
          known_competitors_text: competitors || undefined,
          target_audience_text: targetAudience || undefined,
          social_links: socialLinks.length > 0 ? socialLinks.map(({ platform, url }) => ({ platform, url })) : undefined,
        }
      }

      const res = await startDiscovery(payload, token)
      router.push(`/discovery/${res.session_id}`)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || 'generic'
      setError(tErrors(code as any))
      setIsSubmitting(false)
    }
  }

  const inputClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

  return (
    <Card className="w-full max-w-2xl mx-auto border-border shadow-sm">
      <CardHeader>
        <CardTitle className="text-2xl text-navy">{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-8">
          {error && (
            <div 
              className="p-3 text-sm text-destructive bg-destructive/10 rounded-md"
              aria-live="assertive"
              role="alert"
            >
              {error}
            </div>
          )}

          {/* Identity */}
          <div className="space-y-4">
            <h3 className="font-semibold text-navy">{t('businessIdentitySection')}</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="businessName">{t('businessNameLabel')} *</Label>
                <Input
                  id="businessName"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder={t('businessNamePlaceholder')}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessType">{t('businessTypeLabel')} *</Label>
                <Input
                  id="businessType"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  placeholder={t('businessTypePlaceholder')}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">{t('cityLabel')} *</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder={t('cityPlaceholder')}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="area">{t('areaLabel')}</Label>
                <Input
                  id="area"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder={t('areaPlaceholder')}
                />
              </div>
            </div>
          </div>

          {/* Context */}
          <div className="space-y-4">
            <h3 className="font-semibold text-navy">{t('contextSection')}</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ownerGoal">{t('ownerGoalLabel')}</Label>
                <Input
                  id="ownerGoal"
                  value={ownerGoal}
                  onChange={(e) => setOwnerGoal(e.target.value)}
                  placeholder={t('ownerGoalPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="competitors">{t('competitorsLabel')}</Label>
                <Input
                  id="competitors"
                  value={competitors}
                  onChange={(e) => setCompetitors(e.target.value)}
                  placeholder={t('competitorsPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetAudience">{t('targetAudienceLabel')}</Label>
                <Input
                  id="targetAudience"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder={t('targetAudiencePlaceholder')}
                />
              </div>
            </div>
          </div>

          {/* Language Mode */}
          <div className="space-y-4">
            <h3 className="font-semibold text-navy">{t('languageModeSection')}</h3>
            <p className="text-sm text-muted-foreground">{t('languageModeHint')}</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="languageMode"
                  value="ar-EG"
                  checked={languageMode === 'ar-EG'}
                  onChange={() => setLanguageMode('ar-EG')}
                  className="accent-primary h-4 w-4"
                />
                {t('languageModeAr')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="languageMode"
                  value="en"
                  checked={languageMode === 'en'}
                  onChange={() => setLanguageMode('en')}
                  className="accent-primary h-4 w-4"
                />
                {t('languageModeEn')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="languageMode"
                  value="mixed"
                  checked={languageMode === 'mixed'}
                  onChange={() => setLanguageMode('mixed')}
                  className="accent-primary h-4 w-4"
                />
                {t('languageModeMixed')}
              </label>
            </div>
          </div>

          {/* Social Links */}
          <div className="space-y-4">
            <h3 className="font-semibold text-navy">{t('socialLinksSection')}</h3>
            <p className="text-sm text-muted-foreground">{t('socialLinksHint')}</p>
            
            <div className="space-y-3">
              {socialLinks.map((link) => (
                <div key={link._id} className="flex flex-col md:flex-row gap-3 p-3 border border-border rounded-md bg-muted/20">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor={`social-platform-${link._id}`}>{t('socialLinkPlatformLabel')}</Label>
                    <select
                      id={`social-platform-${link._id}`}
                      value={link.platform}
                      onChange={(e) => updateSocialLink(link._id, { platform: e.target.value as SocialPlatform })}
                      className={inputClass}
                      aria-label={t('socialLinkPlatformLabel')}
                    >
                      {PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {p === 'facebook' ? t('platformFacebook') :
                           p === 'instagram' ? t('platformInstagram') :
                           p === 'tiktok' ? t('platformTiktok') :
                           p === 'website' ? t('platformWebsite') :
                           p === 'google_maps' ? t('platformGoogleMaps') :
                           p === 'delivery' ? t('platformDelivery') :
                           t('platformOther')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-[2] space-y-1.5">
                    <Label htmlFor={`social-url-${link._id}`}>{t('socialLinkUrlLabel')}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`social-url-${link._id}`}
                        value={link.url}
                        onChange={(e) => updateSocialLink(link._id, { url: e.target.value })}
                        placeholder={t('socialLinkUrlPlaceholder')}
                        type="url"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeSocialLink(link._id)}
                        aria-label={t('removeSocialLink')}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {socialLinks.length < 8 && (
              <Button
                type="button"
                variant="outline"
                onClick={addSocialLink}
                className="mt-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="me-2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                {t('addSocialLink')}
              </Button>
            )}
          </div>
        </CardContent>

        <CardFooter className="bg-muted/30 pt-4 rounded-b-xl border-t border-border">
          <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto px-8">
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
