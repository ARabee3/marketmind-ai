import type { LanguageMode, SocialLinkInput } from '@marketmind/contracts'

export type IntakeDraft = {
  readonly businessName: string
  readonly businessType: string
  readonly city: string
  readonly area: string
  readonly addressText: string
  readonly ownerGoal: string
  readonly competitors: string
  readonly targetAudience: string
  readonly languageMode: LanguageMode
}

export type EditableIntakeField = Exclude<keyof IntakeDraft, 'languageMode'>

export type SocialLinkDraft = SocialLinkInput & { readonly id: string }

export type IntakeStep = 0 | 1 | 2
