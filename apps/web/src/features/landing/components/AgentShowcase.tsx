'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CompassIcon,
  SearchIcon,
  CalendarRangeIcon,
  PenToolIcon,
  SendIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  ArrowRightIcon,
  LayersIcon,
  LockIcon,
  RadioIcon,
  TrendingUpIcon,
  FileCheckIcon,
  MessageSquareTextIcon,
  MicIcon,
  BotIcon,
  UserCheckIcon,
  RefreshCwIcon,
  UtensilsCrossedIcon,
  ShirtIcon,
  StethoscopeIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Eyebrow } from './ui/Primitives'
import { EASE, useReducedMotion } from '../lib/motion'

type AgentId = 'discovery' | 'research' | 'strategy' | 'content' | 'publishing' | 'optimization'
type SectorId = 'sweets' | 'fashion' | 'services'

const AGENT_ICONS = {
  discovery: CompassIcon,
  research: SearchIcon,
  strategy: CalendarRangeIcon,
  content: PenToolIcon,
  publishing: SendIcon,
  optimization: BarChart3Icon,
}

const SECTOR_ICONS = {
  sweets: UtensilsCrossedIcon,
  fashion: ShirtIcon,
  services: StethoscopeIcon,
}

type AgentPreviewField = {
  label: string
  value: string
}

type DiscoveryChatData = {
  question: string
  ownerAnswer: string
  nextQuestion: string
  readiness: string
  voiceLabel: string
}

type AgentPreviewData = {
  badge: string
  title: string
  fields: AgentPreviewField[]
  chat?: DiscoveryChatData
  footer: string
}

export function AgentShowcase() {
  const t = useTranslations('Landing.agents')
  const tabs = t.raw('tabs') as {
    id: AgentId
    name: string
    role: string
    desc: string
    deliverable: string
    gate: string
  }[]

  const [activeAgent, setActiveAgent] = useState<AgentId>('discovery')
  const [activeSector, setActiveSector] = useState<SectorId>('sweets')
  const reduced = useReducedMotion()

  const currentTab = tabs.find((tab) => tab.id === activeAgent) ?? tabs[0]
  const ActiveIcon = AGENT_ICONS[activeAgent] ?? SparklesIcon

  // Read full localized preview data dynamically from messages
  const previewData = t.raw(`previews.${activeSector}.${activeAgent}`) as AgentPreviewData
  const uiLabels = t.raw('uiLabels') as Record<string, string>

  return (
    <section
      id="agents"
      className="relative overflow-hidden bg-surface px-4 py-16 scroll-mt-24 sm:px-6 md:py-20"
    >
      <div className="mx-auto w-full max-w-content">
        {/* Section Header */}
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[760px]">
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h2 className="mt-3.5 text-balance text-[clamp(2.3rem,5.2vw,4.3rem)] font-bold leading-[1.02] tracking-[-0.03em] text-navy rtl:leading-[1.2] rtl:tracking-normal">
              {t('title')}
            </h2>
            <p className="mt-4 max-w-[640px] text-[15px] leading-[1.75] text-ink-soft rtl:leading-[1.9]">
              {t('body')}
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-soft-teal px-4 py-2 text-primary shadow-[0_4px_12px_rgb(11_111_113_/_10%)]">
            <ShieldCheckIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="text-[12px] font-bold">{t('controlBadge')}</span>
          </div>
        </div>

        {/* Sector Preset Selector with Category Icons */}
        <div className="mt-8 flex flex-wrap items-center gap-3 border-b border-border pb-5">
          <span className="text-[13px] font-bold text-muted">{t('sectorsLabel')}</span>
          <div className="flex flex-wrap gap-2">
            {(['sweets', 'fashion', 'services'] as const).map((sector) => {
              const label = t(`sectors.${sector}`)
              const isSelected = activeSector === sector
              const SectorIcon = SECTOR_ICONS[sector]

              return (
                <button
                  key={sector}
                  type="button"
                  onClick={() => setActiveSector(sector)}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-action',
                    isSelected
                      ? 'border-2 border-primary bg-primary text-white shadow-[0_2px_8px_rgb(11_111_113_/_25%)]'
                      : 'border border-border bg-bg text-ink-soft hover:bg-soft-teal hover:text-navy',
                  )}
                >
                  <SectorIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 6 Specialized Agent Phase Tabs */}
        <div
          role="tablist"
          aria-label={t('title')}
          className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6"
        >
          {tabs.map((tab, index) => {
            const Icon = AGENT_ICONS[tab.id] ?? SparklesIcon
            const isActive = activeAgent === tab.id

            return (
              <button
                key={tab.id}
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                type="button"
                onClick={() => setActiveAgent(tab.id)}
                className={cn(
                  'group relative flex flex-col items-start rounded-xl border p-3.5 text-start transition-all outline-none focus-visible:ring-2 focus-visible:ring-action sm:p-4',
                  isActive
                    ? 'border-primary bg-soft-teal text-navy shadow-[0_6px_0_var(--navy)]'
                    : 'border-border bg-bg text-ink-soft hover:border-primary/40 hover:bg-surface',
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                      isActive ? 'bg-primary text-white' : 'bg-surface text-muted group-hover:text-primary',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span
                    dir="ltr"
                    className="font-latin text-[10px] font-bold tracking-wider text-muted opacity-70"
                  >
                    0{index + 1}
                  </span>
                </div>
                <p className="mt-2.5 text-[13px] font-bold leading-tight text-navy">{tab.name}</p>
                <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-muted">{tab.role}</p>
              </button>
            )
          })}
        </div>

        {/* Active Phase Studio Stage */}
        <div
          role="tabpanel"
          id={`panel-${currentTab.id}`}
          aria-labelledby={`tab-${currentTab.id}`}
          className="mt-6 overflow-hidden rounded-2xl border border-border bg-bg p-5 shadow-elevated md:p-7"
        >
          <div className="grid gap-8 lg:grid-cols-[1.05fr_1.35fr] lg:items-center">
            {/* Left: Role, Responsibility & Strict Governance */}
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white shadow-[0_4px_12px_rgb(11_111_113_/_20%)]">
                  <ActiveIcon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-[20px] font-bold text-navy">{currentTab.name}</h3>
                  <p className="text-[13px] font-semibold text-primary">{currentTab.role}</p>
                </div>
              </div>

              <p className="text-[15px] leading-[1.8] text-ink-soft rtl:leading-[1.95]">
                {currentTab.desc}
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3.5">
                  <LayersIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted rtl:tracking-normal">
                      {uiLabels.deliverable}
                    </p>
                    <p className="mt-0.5 text-[13px] font-bold text-navy">{currentTab.deliverable}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-soft-teal p-3.5">
                  <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-primary rtl:tracking-normal">
                      {uiLabels.gate}
                    </p>
                    <p className="mt-0.5 text-[13px] font-semibold text-navy">{currentTab.gate}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Live Interactive Workspace Component Rendering */}
            <AnimatePresence mode="wait">
              {activeAgent === 'discovery' && previewData.chat ? (
                <DiscoveryChatCard
                  key={`discovery-${activeSector}`}
                  previewData={previewData}
                  sectorId={activeSector}
                  sectorLabel={t(`sectors.${activeSector}`)}
                  uiLabels={uiLabels}
                  reduced={reduced}
                />
              ) : (
                <GenericAgentCard
                  key={`${activeAgent}-${activeSector}`}
                  activeAgent={activeAgent}
                  previewData={previewData}
                  sectorId={activeSector}
                  sectorLabel={t(`sectors.${activeSector}`)}
                  uiLabels={uiLabels}
                  reduced={reduced}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Animated Chatbot Widget for the Discovery Agent Phase */
function DiscoveryChatCard({
  previewData,
  sectorId,
  sectorLabel,
  uiLabels,
  reduced,
}: {
  previewData: AgentPreviewData
  sectorId: SectorId
  sectorLabel: string
  uiLabels: Record<string, string>
  reduced: boolean
}) {
  const chat = previewData.chat!
  const [replayKey, setReplayKey] = useState(0)
  const SectorIcon = SECTOR_ICONS[sectorId]

  return (
    <motion.div
      key={replayKey}
      initial={reduced ? { opacity: 1 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 1 } : { opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: EASE.decel }}
      className="overflow-hidden rounded-2xl border-2 border-navy/15 bg-surface p-5 shadow-[0_12px_32px_rgb(16_42_67_/_10%)] md:p-6"
    >
      {/* Top Header with Live AI Online Badge */}
      <div className="flex items-center justify-between border-b border-border pb-3.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy rtl:tracking-normal">
            {uiLabels.chatLive}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full border border-border bg-bg px-2.5 py-0.5 text-[11px] font-bold text-navy">
            <SectorIcon className="h-3 w-3 shrink-0" aria-hidden />
            <span>{sectorLabel}</span>
          </span>
          <button
            type="button"
            onClick={() => setReplayKey((k) => k + 1)}
            title="Replay conversation"
            aria-label="Replay conversation"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-bg text-muted transition-colors hover:text-navy"
          >
            <RefreshCwIcon className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Profile Readiness Meter */}
      <div className="mt-3.5 rounded-xl border border-primary/25 bg-soft-teal p-3">
        <div className="flex items-center justify-between text-[11px] font-bold">
          <span className="text-primary">{uiLabels.readinessLabel}</span>
          <span className="text-primary">{uiLabels.readinessComplete}</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <motion.div
            initial={{ width: reduced ? '100%' : '55%' }}
            animate={{ width: '100%' }}
            transition={{ duration: 0.8, ease: EASE.decel }}
            className="h-full rounded-full bg-primary"
          />
        </div>
      </div>

      {/* Chat Messages Container */}
      <div className="mt-4 space-y-3.5 text-[13px]">
        {/* Assistant Message 1: Initial Discovery Question */}
        <motion.div
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="flex items-start gap-2.5"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-soft-teal text-primary">
            <BotIcon className="h-4 w-4" aria-hidden />
          </span>
          <div className="max-w-[85%] rounded-2xl rounded-ss-none border border-border bg-bg p-3.5 leading-[1.65] text-navy">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted rtl:tracking-normal">
              {uiLabels.agentLabel}
            </p>
            <p className="mt-1 font-semibold">{chat.question}</p>
          </div>
        </motion.div>

        {/* User Response 2: Owner Answer with Voice Note indicator */}
        <motion.div
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.22 }}
          className="flex items-start justify-end gap-2.5"
        >
          <div className="max-w-[85%] rounded-2xl rounded-se-none bg-primary p-3.5 leading-[1.65] text-white shadow-[0_4px_12px_rgb(11_111_113_/_20%)]">
            <div className="flex items-center justify-between gap-3 text-[10px] font-bold text-journey-mint">
              <span>{uiLabels.ownerLabel}</span>
              <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[9px] text-white">
                <MicIcon className="h-2.5 w-2.5" />
                <span>{uiLabels.voiceNote} ({chat.voiceLabel})</span>
              </span>
            </div>
            <p className="mt-1 font-medium text-white">{chat.ownerAnswer}</p>
          </div>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-white">
            <UserCheckIcon className="h-4 w-4" aria-hidden />
          </span>
        </motion.div>

        {/* Assistant Message 3: Natural Next Question */}
        <motion.div
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.4 }}
          className="flex items-start gap-2.5"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-soft-teal text-primary">
            <BotIcon className="h-4 w-4" aria-hidden />
          </span>
          <div className="max-w-[85%] rounded-2xl rounded-ss-none border-2 border-primary/35 bg-soft-teal/30 p-3.5 leading-[1.65] text-navy">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary rtl:tracking-normal">
              {uiLabels.nextQuestionLabel}
            </p>
            <p className="mt-1 font-semibold text-navy">{chat.nextQuestion}</p>
          </div>
        </motion.div>
      </div>

      {/* Footer Bar with Status / Owner Action */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-primary">
          <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {previewData.footer}
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-soft-teal text-primary">
          <ArrowRightIcon className="h-3 w-3 rtl:scale-x-[-1]" aria-hidden />
        </span>
      </div>
    </motion.div>
  )
}

/** Generic Workspace Card for the other Agent Phases */
function GenericAgentCard({
  activeAgent,
  previewData,
  sectorId,
  sectorLabel,
  uiLabels,
  reduced,
}: {
  activeAgent: AgentId
  previewData: AgentPreviewData
  sectorId: SectorId
  sectorLabel: string
  uiLabels: Record<string, string>
  reduced: boolean
}) {
  const SectorIcon = SECTOR_ICONS[sectorId]

  return (
    <motion.div
      initial={reduced ? { opacity: 1 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 1 } : { opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: EASE.decel }}
      className="overflow-hidden rounded-2xl border-2 border-navy/15 bg-surface p-5 shadow-[0_12px_32px_rgb(16_42_67_/_10%)] md:p-6"
    >
      {/* Header of Workspace Widget */}
      <div className="flex items-center justify-between border-b border-border pb-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-primary" />
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted rtl:tracking-normal">
            {previewData.badge}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full border border-border bg-bg px-2.5 py-0.5 text-[11px] font-bold text-navy">
          <SectorIcon className="h-3 w-3 shrink-0" aria-hidden />
          <span>{sectorLabel}</span>
        </span>
      </div>

      {/* Workspace Title & Visual Archetype */}
      <div className="mt-4 flex items-center justify-between">
        <h4 className="text-[16px] font-bold text-navy">{previewData.title}</h4>
        {activeAgent === 'research' && (
          <span className="flex items-center gap-1 rounded-full bg-soft-teal px-2.5 py-0.5 text-[11px] font-bold text-primary">
            <RadioIcon className="h-3 w-3" />
            {uiLabels.connected}
          </span>
        )}
        {activeAgent === 'strategy' && (
          <span className="flex items-center gap-1 rounded-full bg-soft-teal px-2.5 py-0.5 text-[11px] font-bold text-primary">
            <CalendarRangeIcon className="h-3 w-3" />
            {uiLabels.weeksBadge}
          </span>
        )}
        {activeAgent === 'content' && (
          <span className="flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-[11px] font-bold text-warning">
            <FileCheckIcon className="h-3 w-3" />
            {uiLabels.needsApproval}
          </span>
        )}
        {activeAgent === 'publishing' && (
          <span className="flex items-center gap-1 rounded-full bg-soft-teal px-2.5 py-0.5 text-[11px] font-bold text-primary">
            <SendIcon className="h-3 w-3" />
            {uiLabels.metaBadge}
          </span>
        )}
        {activeAgent === 'optimization' && (
          <span className="flex items-center gap-1 rounded-full bg-soft-teal px-2.5 py-0.5 text-[11px] font-bold text-primary">
            <TrendingUpIcon className="h-3 w-3" />
            {uiLabels.closedLoopBadge}
          </span>
        )}
      </div>

      {/* Fields List */}
      <div className="mt-4 space-y-2.5">
        {previewData.fields.map((field) => (
          <div
            key={field.label}
            className={cn(
              'rounded-xl border p-3 transition-colors',
              activeAgent === 'content' && field.label.includes('Hook')
                ? 'border-primary/30 bg-soft-teal/50'
                : 'border-border/80 bg-bg',
            )}
          >
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-muted">{field.label}</p>
              {activeAgent === 'content' && (field.label.includes('Action') || field.label.includes('إجراء')) ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-action">
                  <MessageSquareTextIcon className="h-3 w-3" />
                  {uiLabels.facebookCtaBadge}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] font-semibold leading-[1.65] text-navy">
              {field.value}
            </p>
          </div>
        ))}
      </div>

      {/* Footer Bar with Status / Owner Action */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-primary">
          <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {previewData.footer}
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-soft-teal text-primary">
          <ArrowRightIcon className="h-3 w-3 rtl:scale-x-[-1]" aria-hidden />
        </span>
      </div>
    </motion.div>
  )
}
