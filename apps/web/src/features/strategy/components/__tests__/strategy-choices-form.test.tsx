import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategyChoicesForm } from '../strategy-choices-form'

const journeyMock = vi.hoisted(() => vi.fn())
const actionMocks = vi.hoisted(() => ({
  create: vi.fn(),
  saveBrief: vi.fn(),
  generate: vi.fn(),
}))

const messages: Record<string, string> = {
  'choices.eyebrow': 'Strategy choices',
  'choices.title': 'A short planning form before any draft is written.',
  'choices.subtitle': 'These choices guide the plan.',
  'choices.save': 'Save choices',
  'choices.generate': 'Prepare draft',
  'wizard.confirmTitle': 'Confirm point usage',
  'wizard.confirmBody': 'This will use {points} points. You have {balance} points.',
  'wizard.confirmBodyNoBalance': 'This will use {points} points.',
  'wizard.confirmInsufficient': 'You need {points} points but you have {balance}. Top up to continue.',
  'wizard.confirmTopUp': 'Top up points',
  'wizard.confirmCta': 'Confirm and generate',
  'wizard.confirmCancel': 'Cancel',
  'choices.validation.required': 'This field is required',
  'choices.validation.noProfile': 'Please complete business discovery first',
  'choices.fields.objective.label': 'Main objective',
  'choices.fields.objective.help': 'Choose what the next 12 weeks should improve.',
  'choices.fields.startDate.label': 'Start date',
  'choices.fields.startDate.help': 'Pick when the plan should begin.',
  'choices.fields.language.label': 'Plan language',
  'choices.fields.language.help': 'Choose the working language.',
  'choices.fields.language.options.arabic': 'Arabic Egyptian',
  'choices.fields.language.options.english': 'English',
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
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const template = messages[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
      params && name in params ? String(params[name]) : `{${name}}`,
    )
  },
  useLocale: () => 'en',
  useFormatter: () => ({
    dateTime: () => 'Jul 17, 2026',
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({
    href,
    children,
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>,
}))

vi.mock('@/lib/api/journey', () => ({
  getCurrentJourney: journeyMock,
}))

vi.mock('@/lib/api/strategy', () => ({
  getStrategy: vi.fn().mockResolvedValue({ brief: null }),
}))

vi.mock('../../hooks/use-strategy-actions', () => ({
  useStrategyActions: () => ({
    ...actionMocks,
    pending: false,
    error: null,
  }),
}))

const walletState = vi.hoisted(() => ({
  wallet: null as {
    balance: number
    billing_account_id: string
    lifetime_granted: number
    lifetime_spent: number
    low_balance: boolean
  } | null,
}))

vi.mock('@/features/billing/wallet-context', () => ({
  useWallet: () => ({
    wallet: walletState.wallet,
    loading: false,
    error: false,
    refresh: vi.fn(),
  }),
}))

describe('StrategyChoicesForm', () => {
  beforeEach(() => {
    journeyMock.mockReset()
    journeyMock.mockResolvedValue({
      journey: { state: 'discovery_not_started' },
      future_phase: { availability: 'blocked' },
    })
    actionMocks.create.mockReset()
    actionMocks.saveBrief.mockReset()
    actionMocks.generate.mockReset()
    walletState.wallet = {
      billing_account_id: 'acc-1',
      balance: 215,
      lifetime_granted: 365,
      lifetime_spent: 150,
      low_balance: false,
    }
  })

  it('renders an interactive form with editable fields and active buttons', async () => {
    render(<StrategyChoicesForm />)

    expect(screen.getByText('Strategy choices')).toBeTruthy()
    expect(screen.getByText('These choices guide the plan.')).toBeTruthy()

    const saveButton = await screen.findByRole('button', { name: 'Save choices' })
    expect(saveButton.hasAttribute('disabled')).toBe(false)

    const generateButton = screen.getByRole('button', { name: 'Prepare draft' })
    expect(generateButton.hasAttribute('disabled')).toBe(false)
  })

  it('defaults the plan language to the UI route locale (en here)', async () => {
    render(<StrategyChoicesForm />)

    const languageSelect = await screen.findByLabelText('Plan language') as HTMLSelectElement
    // The mock's useLocale returns 'en', so the default plan language is 'en'.
    expect(languageSelect.value).toBe('en')
    // Both options are available so the owner can explicitly choose Arabic.
    expect(screen.getByText('Arabic Egyptian')).toBeTruthy()
    expect(screen.getByText('English')).toBeTruthy()
  })

  it('sends a valid paid-media budget payload before explicit generation', async () => {
    journeyMock.mockResolvedValue({
      journey: {
        state: 'discovery_confirmed',
        profile: {
          business_profile_version_id: '44444444-4444-4444-8444-444444444444',
          business_name: 'Nile Sweets',
          business_type: 'dessert shop',
          city: 'Assiut',
          area: 'Assiut City',
          confirmed_at: '2026-07-17T10:05:00.000Z',
          version: 2,
        },
      },
      future_phase: {
        availability: 'available',
        strategy_id: '11111111-1111-4111-8111-111111111111',
      },
    })
    actionMocks.saveBrief.mockResolvedValue({ id: 'brief-1' })
    actionMocks.generate.mockResolvedValue({
      status: 'queued',
      correlationId: 'corr-1',
    })

    render(<StrategyChoicesForm />)

    fireEvent.change(await screen.findByLabelText('Main objective'), {
      target: { value: 'conversion' },
    })
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-08-01' },
    })
    fireEvent.change(screen.getByLabelText('Paid media permission'), {
      target: { value: 'yes' },
    })
    fireEvent.change(screen.getByLabelText('choices.fields.budgetMode.label'), {
      target: { value: 'monthly_amount' },
    })
    fireEvent.change(screen.getByLabelText('choices.fields.budgetAmount.label'), {
      target: { value: '5000' },
    })
    fireEvent.change(screen.getByLabelText('Team capacity'), {
      target: { value: 'Owner plus one helper' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }))
    // The confirmation dialog appears; confirm the 50-point spend.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm and generate' }),
    )

    await waitFor(() => expect(actionMocks.saveBrief).toHaveBeenCalledOnce())
    expect(actionMocks.saveBrief).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        paidMediaAllowed: true,
        externalBudgetMode: 'monthly_amount',
        externalBudgetEgpAmount: 5000,
      }),
    )
    expect(actionMocks.generate).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    )
  })
})
