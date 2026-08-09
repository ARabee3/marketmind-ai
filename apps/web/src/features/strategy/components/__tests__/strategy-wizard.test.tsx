import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategyWizard } from '../strategy-wizard'

const journeyMock = vi.hoisted(() => vi.fn())
const actionMocks = vi.hoisted(() => ({
  create: vi.fn(),
  saveBrief: vi.fn(),
  generate: vi.fn(),
}))
const pushMock = vi.hoisted(() => vi.fn())
const replaceMock = vi.hoisted(() => vi.fn())
const listTargetsMock = vi.hoisted(() => vi.fn())

const messages: Record<string, string> = {
  'choices.selectPlaceholder': 'Choose…',
  'choices.fields.objective.label': 'Main objective',
  'choices.fields.objective.help': 'Choose what the next 12 weeks should improve.',
  'choices.fields.objective.options.awareness': 'Get known',
  'choices.fields.objective.options.conversion': 'Increase sales',
  'choices.fields.objective.options.acquisition': 'Attract customers',
  'choices.fields.startDate.label': 'Start date',
  'choices.fields.startDate.help': 'Pick when the plan should begin.',
  'choices.fields.language.label': 'Plan language',
  'choices.fields.language.help': 'Choose the working language.',
  'choices.fields.language.options.arabic': 'Arabic Egyptian',
  'choices.fields.language.options.english': 'English',
  'choices.readinessLabel': 'Ready to plan?',
  'wizard.eyebrow': 'Build your Strategy',
  'wizard.title': 'Three quick choices.',
  'wizard.subtitle': 'You decide.',
  'wizard.steps.goal': 'Your goal',
  'wizard.steps.channels': 'Where you will show up',
  'wizard.steps.realistic': 'What is realistic',
  'wizard.stepOf': 'Step {current} of {total}',
  'wizard.next': 'Continue',
  'wizard.back': 'Back',
  'wizard.generate': 'Generate plan',
  'wizard.generatePending': 'Saving and generating…',
  'wizard.save': 'Save draft and leave',
  'wizard.saved': 'Draft saved.',
  'wizard.unsaved': 'You have unsaved Strategy choices.',
  'wizard.primaryHelp': 'Choose one main focus.',
  'wizard.supportingHelp': 'Choose up to two supporting channels.',
  'wizard.meta.connectSoon': 'Meta connection is coming soon.',
  'wizard.meta.metaTargetBlocked': 'Real publishing stays blocked until verified.',
  'wizard.meta.addLink': 'Add existing link',
  'wizard.meta.setUpLater': 'Set up later',
  'wizard.meta.publicUrlLabel': 'Public URL',
  'wizard.meta.publicUrlPlaceholder': 'https://…',
  'wizard.capacity.label': 'Weekly capacity',
  'wizard.capacity.help': 'How much time each week?',
  'wizard.capacity.options.one_to_two_hours': '1–2 hours a week',
  'wizard.capacity.options.three_to_five_hours': '3–5 hours a week',
  'wizard.capacity.options.half_day': 'About half a day a week',
  'wizard.capacity.options.full_day_plus': 'A full day or more a week',
  'wizard.capacityNote.label': 'Anything else about your time?',
  'wizard.capacityNote.help': 'Optional note.',
  'wizard.paidMedia.label': 'Paid media',
  'wizard.paidMedia.help': 'Are you open to paid promotion?',
  'wizard.paidMedia.organic': 'Organic only — no paid ads',
  'wizard.paidMedia.allowed': 'Yes, within a budget',
  'wizard.budgetAmount.label': 'Monthly budget (EGP)',
  'wizard.budgetAmount.help': 'The maximum per month.',
  'wizard.constraints.label': 'Anything else?',
  'wizard.constraints.help': 'Optional note.',
  'wizard.validation.required': 'This is required.',
  'wizard.validation.primaryChannel': 'Choose one main channel.',
  'wizard.validation.supportingLimit': 'Up to two supporting channels.',
  'wizard.validation.publicUrl': 'Add the existing link URL.',
  'wizard.validation.loadFailed': 'Could not load.',
  'wizard.readiness.goal': 'Your goal is set',
  'wizard.readiness.channels': 'Channels chosen',
  'wizard.readiness.realistic': 'Capacity and budget set',
  'channels.label': 'Channels',
  'channels.facebook': 'Facebook Page',
  'channels.instagram': 'Instagram Professional',
  'channels.tiktok': 'TikTok',
  'channels.google_business_profile': 'Google Business Profile',
  'channels.delivery_platforms': 'Delivery platforms',
  'channels.website': 'Website',
  'channels.roles.primary': 'Main focus',
  'channels.roles.supporting': 'Supporting',
  'channels.setupStates.connected': 'Connected',
  'channels.setupStates.existing_link': 'Existing link',
  'channels.setupStates.setup_later': 'Set up later',
  'Common.loading': 'Loading…',
  'Common.saving': 'Saving…',
}

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => messages[key] ?? key,
  useLocale: () => 'en',
  useFormatter: () => ({
    dateTime: () => 'Aug 3, 2026',
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api/journey', () => ({
  getCurrentJourney: journeyMock,
}))

const getStrategyMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/strategy', () => ({
  getStrategy: getStrategyMock,
}))

vi.mock('@/lib/api/publishing', () => ({
  listPublishingTargets: listTargetsMock,
  connectMetaPublishingTarget: vi.fn(),
  getMetaPendingSelection: vi.fn(),
  selectMetaTargets: vi.fn(),
}))

const connectMetaMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/facebook', () => ({
  connectMeta: connectMetaMock,
}))

vi.mock('../../hooks/use-strategy-actions', () => ({
  useStrategyActions: () => ({
    ...actionMocks,
    pending: false,
    error: null,
  }),
}))

describe('StrategyWizard', () => {
  beforeEach(() => {
    getStrategyMock.mockReset().mockResolvedValue({ brief: null })
    listTargetsMock.mockReset().mockResolvedValue([])
    journeyMock.mockReset()
    journeyMock.mockResolvedValue({
      journey: {
        state: 'discovery_confirmed',
        profile: {
          business_name: 'Koshary Corner',
          business_type: 'dessert shop',
          city: 'Assiut',
          area: 'Downtown',
          confirmed_at: '2026-07-17T10:05:00.000Z',
          version: 1,
          business_profile_version_id: 'prof-1',
        },
      },
      future_phase: { availability: 'available', strategy_id: null },
    })
    actionMocks.create.mockReset().mockResolvedValue({ id: 'strat-1' })
    actionMocks.saveBrief.mockReset().mockResolvedValue({ id: 'brief-1' })
    actionMocks.generate.mockReset().mockResolvedValue({ status: 'queued' })
    pushMock.mockReset()
  })

  it('walks through goal → channels → realistic and generates a v2 brief', async () => {
    render(<StrategyWizard />)

    await screen.findByLabelText('Main objective')
    fireEvent.change(screen.getByLabelText('Main objective'), {
      target: { value: 'acquisition' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.click(
      screen.getAllByRole('radio', { name: 'Main focus' })[0] as never,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.click(screen.getByLabelText('3–5 hours a week'))
    fireEvent.change(screen.getByLabelText('Paid media'), {
      target: { value: 'organic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate plan' }))

    await waitFor(() => {
      expect(actionMocks.create).toHaveBeenCalledWith('prof-1')
    })
    expect(actionMocks.saveBrief).toHaveBeenCalledWith(
      'strat-1',
      expect.objectContaining({
        weeklyCapacity: 'three_to_five_hours',
        channelChoices: expect.arrayContaining([
          expect.objectContaining({
            channel: 'facebook',
            role: 'primary',
            setupState: 'setup_later',
          }),
        ]),
      }),
    )
    expect(actionMocks.generate).toHaveBeenCalledWith('strat-1')
    expect(pushMock).toHaveBeenCalledWith('/strategy/strat-1')
  })

  it('blocks channels step until exactly one primary is chosen', async () => {
    render(<StrategyWizard />)

    await screen.findByLabelText('Main objective')
    fireEvent.change(screen.getByLabelText('Main objective'), {
      target: { value: 'conversion' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Choose one main channel.')).toBeTruthy()
    expect(actionMocks.saveBrief).not.toHaveBeenCalled()
  })

  it('requires the existing link URL for an existing_link choice', async () => {
    render(<StrategyWizard />)

    await screen.findByLabelText('Main objective')
    fireEvent.change(screen.getByLabelText('Main objective'), {
      target: { value: 'conversion' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.click(
      screen.getAllByRole('radio', { name: 'Main focus' })[0] as never,
    )
    fireEvent.click(
      screen.getAllByRole('radio', { name: 'Add existing link' })[0] as never,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText('Add the existing link URL.'),
    ).toBeTruthy()
  })

  it('hydrates an existing v2 brief when revisiting the wizard', async () => {
    vi.mocked(journeyMock).mockResolvedValue({
      journey: {
        state: 'discovery_confirmed',
        profile: {
          business_name: 'Koshary Corner',
          business_type: 'dessert shop',
          city: 'Assiut',
          area: 'Downtown',
          confirmed_at: '2026-07-17T10:05:00.000Z',
          version: 1,
          business_profile_version_id: 'prof-1',
        },
      },
      future_phase: { availability: 'available', strategy_id: 'strat-1' },
    })
    getStrategyMock.mockResolvedValue({
      brief: {
        businessProfileVersionId: 'prof-1',
        businessProfileVersion: {
          id: 'prof-1',
          confirmedAt: '2026-07-17T10:05:00.000Z',
          version: 1,
        },
        primaryObjective: 'acquisition',
        startDate: '2026-08-03',
        planLanguage: 'ar-EG',
        paidMediaAllowed: false,
        externalBudgetMode: 'organic_only',
        externalBudgetEgp: null,
        teamCapacity: '',
        weeklyCapacity: 'three_to_five_hours',
        channelChoices: [
          {
            channel: 'facebook',
            role: 'primary',
            setupState: 'setup_later',
          },
        ],
        constraints: null,
        clarificationAnswers: [],
        createdAt: '2026-07-28T09:00:00.000Z',
        updatedAt: '2026-07-28T09:00:00.000Z',
      },
    })

    render(<StrategyWizard />)

    await waitFor(() => {
      expect(
        (screen.getByLabelText('Main objective') as HTMLSelectElement).value,
      ).toBe('acquisition')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(
        (
          screen.getAllByRole('radio', { name: 'Main focus' })[0] as HTMLInputElement
        ).checked,
      ).toBe(true)
    })
  })
})

  it('demotes the previous primary when a new main focus is chosen', async () => {
    render(<StrategyWizard />)

    await screen.findByLabelText('Main objective')
    fireEvent.change(screen.getByLabelText('Main objective'), {
      target: { value: 'conversion' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const primaryRadios = screen.getAllByRole('radio', {
      name: 'Main focus',
    })
    fireEvent.click(primaryRadios[0] as never)
    fireEvent.click(primaryRadios[2] as never)

    // Exactly one primary remains — the old one was demoted.
    expect(
      screen
        .getAllByRole('radio', { name: 'Main focus' })
        .filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // Step 3 renders without a "Choose one main channel" validation error.
    expect(screen.queryByText('Choose one main channel.')).toBeNull()
  })
