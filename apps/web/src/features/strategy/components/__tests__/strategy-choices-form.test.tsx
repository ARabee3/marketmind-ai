import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StrategyChoicesForm } from '../strategy-choices-form'

const messages: Record<string, string> = {
  'choices.eyebrow': 'Strategy choices',
  'choices.title': 'A short planning form before any draft is written.',
  'choices.subtitle': 'These choices guide the plan.',
  'choices.save': 'Save choices',
  'choices.generate': 'Prepare draft',
  'choices.validation.required': 'This field is required',
  'choices.validation.noProfile': 'Please complete business discovery first',
  'choices.fields.objective.label': 'Main objective',
  'choices.fields.objective.help': 'Choose what the next 12 weeks should improve.',
  'choices.fields.startDate.label': 'Start date',
  'choices.fields.startDate.help': 'Pick when the plan should begin.',
  'choices.fields.language.label': 'Plan language',
  'choices.fields.language.help': 'Choose the working language.',
  'choices.fields.paidMedia.label': 'Paid media permission',
  'choices.fields.paidMedia.help': 'Say whether paid campaigns are allowed.',
  'choices.fields.budget.label': 'External budget',
  'choices.fields.budget.help': 'Give a real amount or choose organic-only.',
  'choices.fields.capacity.label': 'Team capacity',
  'choices.fields.capacity.help': 'Explain who can execute the work.',
  'choices.fields.constraints.label': 'Constraints',
  'choices.fields.constraints.help': 'Add limits such as seasonality.',
}

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => messages[key] ?? key,
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/api/journey', () => ({
  getCurrentJourney: vi.fn().mockRejectedValue(new Error('not mocked')),
}))

vi.mock('../../hooks/use-strategy-actions', () => ({
  useStrategyActions: () => ({
    create: vi.fn(),
    saveBrief: vi.fn(),
    generate: vi.fn(),
    pending: false,
    error: null,
  }),
}))

describe('StrategyChoicesForm', () => {
  it('renders an interactive form with editable fields and active buttons', () => {
    render(<StrategyChoicesForm />)

    expect(screen.getByText('Strategy choices')).toBeTruthy()
    expect(screen.getByText('These choices guide the plan.')).toBeTruthy()

    const saveButton = screen.getByRole('button', { name: 'Save choices' })
    expect(saveButton.hasAttribute('disabled')).toBe(false)

    const generateButton = screen.getByRole('button', { name: 'Prepare draft' })
    expect(generateButton.hasAttribute('disabled')).toBe(false)
  })
})
