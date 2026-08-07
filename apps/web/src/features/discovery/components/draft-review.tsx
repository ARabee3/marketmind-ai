'use client'

import { useState, type ReactNode } from 'react'
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  ChevronDown,
  Globe,
  Layers,
  Megaphone,
  NotebookPen,
  Package,
  Pencil,
  Store,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useTranslations, useFormatter } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  BusinessProfileDraft,
  DiscoveryProfileDomain,
  DiscoveryStatusResponse,
  MarketAwareBusinessFacts,
  SourceRef,
  SourceType,
  MarketEvidence,
  ResearchObservation,
  Uncertainty,
} from '@marketmind/contracts'
import { cn } from '@/lib/utils'

const FACT_DOMAINS = [
  'identity',
  'offer',
  'customers',
  'differentiation',
  'current_marketing',
  'goals_and_constraints',
  'market_context',
] as const

type EditableDomain = Exclude<DiscoveryProfileDomain, 'market_context'>

type FieldSpec =
  | { kind: 'value'; label: string; value?: string; fieldKey?: string }
  | { kind: 'list'; label: string; list?: string[]; fieldKey?: string }

function cloneFacts(facts: MarketAwareBusinessFacts): MarketAwareBusinessFacts {
  return JSON.parse(JSON.stringify(facts)) as MarketAwareBusinessFacts
}

function readFactsField(
  facts: MarketAwareBusinessFacts,
  domain: EditableDomain,
  fieldKey: string,
): string | string[] {
  const value = (facts[domain] as unknown as Record<string, string | string[] | undefined>)[fieldKey]
  if (value === undefined) return ''
  return Array.isArray(value) ? value : value
}

function writeFactsField(
  facts: MarketAwareBusinessFacts,
  domain: EditableDomain,
  fieldKey: string,
  value: string | string[],
): MarketAwareBusinessFacts {
  return {
    ...facts,
    [domain]: {
      ...(facts[domain] as object),
      [fieldKey]: value,
    },
  } as MarketAwareBusinessFacts
}

function isFieldPopulated(field: FieldSpec): boolean {
  return field.kind === 'value' ? Boolean(field.value) : Boolean(field.list && field.list.length > 0)
}

function NotProvided() {
  const t = useTranslations('DiscoveryReview')
  return <span className="text-sm italic text-muted-foreground">{t('notProvided')}</span>
}

function FactList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return <NotProvided />
  return (
    <ul className="list-inside list-disc space-y-0.5 text-sm">
      {items.map((item, idx) => (
        <li key={idx} className="break-words">
          <bdi>{item}</bdi>
        </li>
      ))}
    </ul>
  )
}

function FactValue({ value }: { value?: string }) {
  if (!value) return <NotProvided />
  return (
    <p className="text-sm break-words">
      <bdi>{value}</bdi>
    </p>
  )
}

function FieldRow(field: FieldSpec) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{field.label}</dt>
      <dd className="mt-1">
        {field.kind === 'value' ? <FactValue value={field.value} /> : <FactList items={field.list} />}
      </dd>
    </div>
  )
}

function EditableField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1.5"
      />
    </div>
  )
}

function TagEditor({
  id,
  label,
  items,
  onAdd,
  onRemove,
  disabled,
}: {
  id: string
  label: string
  items: string[]
  onAdd: (value: string) => void
  onRemove: (value: string) => void
  disabled?: boolean
}) {
  const t = useTranslations('DiscoveryReview')
  const [draftValue, setDraftValue] = useState('')

  const add = () => {
    const trimmed = draftValue.trim()
    if (!trimmed) return
    if (items.some((item) => item.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return
    onAdd(trimmed)
    setDraftValue('')
  }

  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {items.length === 0 && (
          <span className="text-sm italic text-muted-foreground">{t('notProvided')}</span>
        )}
        {items.map((item, idx) => (
          <span
            key={`${item}-${idx}`}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-sm text-navy"
          >
            <bdi>{item}</bdi>
            <button
              type="button"
              aria-label={t('removeItem', { value: item })}
              onClick={() => onRemove(item)}
              disabled={disabled}
              className="grid size-4 place-items-center rounded text-muted-foreground outline-none transition-colors hover:text-danger focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Input
          id={id}
          type="text"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          disabled={disabled}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 text-primary"
          onClick={add}
          disabled={disabled}
        >
          {t('addItem')}
        </Button>
      </div>
    </div>
  )
}

function EmptyStateRow({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  )
}

function IncompleteBadge() {
  const t = useTranslations('DiscoveryReview')
  return (
    <span className="inline-flex items-center rounded-md bg-warning/10 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-warning uppercase">
      {t('incomplete')}
    </span>
  )
}

function ProfileSectionCard({
  title,
  icon: Icon,
  incomplete = false,
  empty = false,
  actions,
  children,
}: {
  title: string
  icon: LucideIcon
  incomplete?: boolean
  empty?: boolean
  actions?: ReactNode
  children?: ReactNode
}) {
  const t = useTranslations('DiscoveryReview')
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-6">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-border pb-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h2 className="text-balance text-lg font-bold text-navy">{title}</h2>
        {actions}
        {incomplete && (
          <span className="ms-auto">
            <IncompleteBadge />
          </span>
        )}
      </header>
      <div className="mt-4">
        {empty ? <EmptyStateRow>{t('emptySection')}</EmptyStateRow> : children}
      </div>
    </section>
  )
}

function FactSection({
  title,
  icon,
  fields,
  grid = false,
  incomplete = false,
  domain,
  editing = false,
  editFacts,
  canEdit = false,
  pending = false,
  disabled = false,
  onEdit,
  onSave,
  onCancel,
  onChangeField,
}: {
  title: string
  icon: LucideIcon
  fields: FieldSpec[]
  grid?: boolean
  incomplete?: boolean
  domain?: EditableDomain
  editing?: boolean
  editFacts?: MarketAwareBusinessFacts | null
  canEdit?: boolean
  pending?: boolean
  disabled?: boolean
  onEdit?: () => void
  onSave?: () => void
  onCancel?: () => void
  onChangeField?: (fieldKey: string, value: string | string[]) => void
}) {
  const t = useTranslations('DiscoveryReview')
  const populated = fields.some(isFieldPopulated)
  const controlsDisabled = pending || disabled

  return (
    <ProfileSectionCard
      title={title}
      icon={icon}
      incomplete={incomplete}
      empty={!populated && !editing}
      actions={
        !editing && canEdit && onEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-primary"
            onClick={onEdit}
            disabled={controlsDisabled}
          >
            <Pencil aria-hidden="true" />
            {t('editSection', { section: title })}
          </Button>
        ) : undefined
      }
    >
      {editing && domain && editFacts && onChangeField ? (
        <div className="space-y-4">
          {fields.map((field) => {
            if (!field.fieldKey) return null
            const fieldKey = field.fieldKey
            const current = readFactsField(editFacts, domain, fieldKey)
            const fieldId = `edit-${domain}-${fieldKey}`
            if (field.kind === 'value') {
              return (
                <EditableField
                  key={fieldKey}
                  id={fieldId}
                  label={field.label}
                  value={typeof current === 'string' ? current : ''}
                  onChange={(value) => onChangeField(fieldKey, value)}
                  disabled={controlsDisabled}
                />
              )
            }
            const list = Array.isArray(current) ? current : []
            return (
              <TagEditor
                key={fieldKey}
                id={fieldId}
                label={field.label}
                items={list}
                onAdd={(value) => onChangeField(fieldKey, [...list, value])}
                onRemove={(value) =>
                  onChangeField(
                    fieldKey,
                    list.filter((item) => item !== value),
                  )
                }
                disabled={controlsDisabled}
              />
            )
          })}
          <div className="flex items-center gap-2 border-t border-border pt-4">
            <Button type="button" variant="default" size="sm" onClick={onSave} disabled={controlsDisabled}>
              {t('saveEdits')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={controlsDisabled}>
              {t('cancelEdits')}
            </Button>
          </div>
        </div>
      ) : (
        <dl className={cn('grid gap-x-4 gap-y-5', grid && 'grid-cols-1 sm:grid-cols-2')}>
          {fields.map((field) => (
            <FieldRow key={field.label} {...field} />
          ))}
        </dl>
      )}
    </ProfileSectionCard>
  )
}

function isValidHttpUrl(url: string | undefined): url is string {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

type EvidenceItem = { id: string; statement: string; source_ref_id?: string }

function toEvidenceItem(ev: MarketEvidence): EvidenceItem {
  return { id: ev.observation_id, statement: ev.statement, source_ref_id: ev.source_ref_id }
}

function toObservationItem(obs: ResearchObservation): EvidenceItem {
  return { id: obs.id, statement: obs.statement, source_ref_id: obs.source_ref_id }
}

function EvidenceSourceCard({
  statement,
  source,
  sourceTypeLabel,
}: {
  statement: string
  source: SourceRef | undefined
  sourceTypeLabel: (sourceType: SourceType) => string
}) {
  const t = useTranslations('DiscoveryReview')
  const fmt = useFormatter()
  const hasValidUrl = Boolean(source && isValidHttpUrl(source.url))
  const label =
    source?.title ??
    (hasValidUrl && source?.url ? getHostname(source.url) : null) ??
    (source ? sourceTypeLabel(source.source_type) : '')

  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-3">
      <p className="text-sm break-words">
        <bdi>{statement}</bdi>
      </p>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {source && hasValidUrl && source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex break-all font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
          >
            {label}
          </a>
        ) : (
          label && <span className="break-words">{label}</span>
        )}
        {source?.snippet && (
          <p className="border-s-2 border-border ps-2 italic break-words">
            <bdi>{source.snippet}</bdi>
          </p>
        )}
        {source?.fetched_at && (
          <p>{t('evidenceRetrievedOn', { date: fmt.dateTime(new Date(source.fetched_at), { dateStyle: 'medium' }) })}</p>
        )}
      </div>
    </div>
  )
}

function EvidenceGroup({
  title,
  items,
  sourceMap,
  sourceTypeLabel,
}: {
  title: string
  items: EvidenceItem[]
  sourceMap: Map<string, SourceRef>
  sourceTypeLabel: (sourceType: SourceType) => string
}) {
  if (items.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((ev) => (
          <EvidenceSourceCard
            key={ev.id}
            statement={ev.statement}
            source={ev.source_ref_id ? sourceMap.get(ev.source_ref_id) : undefined}
            sourceTypeLabel={sourceTypeLabel}
          />
        ))}
      </div>
    </section>
  )
}

function SeverityBadge({ severity }: { severity: Uncertainty['severity'] }) {
  const t = useTranslations('DiscoveryReview')
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-xs font-bold uppercase',
        severity === 'high'
          ? 'bg-destructive/10 text-destructive'
          : severity === 'medium'
            ? 'bg-warning/10 text-warning'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {t(`severity_${severity}`)}
    </span>
  )
}

function UncertaintyGroup({
  severity,
  items,
  domainLabels,
  open = false,
}: {
  severity: Uncertainty['severity']
  items: Uncertainty[]
  domainLabels: Record<string, string>
  open?: boolean
}) {
  const t = useTranslations('DiscoveryReview')
  return (
    <details className="group rounded-lg border border-border bg-background" open={open}>
      <summary
        id={`uncertainty-summary-${severity}`}
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-navy outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden"
      >
        <SeverityBadge severity={severity} />
        <span className="text-xs font-medium text-muted-foreground">
          {t('uncertaintyGroupCount', { count: items.length })}
        </span>
        <ChevronDown
          className="ms-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ul className="space-y-3 border-t border-border p-3">
        {items.map((u) => (
          <li key={u.field_key} className="text-sm">
            <p className="text-xs text-muted-foreground">
              {domainLabels[u.domain] ?? u.domain}
              <span className="mx-1" aria-hidden="true">
                ·
              </span>
              {t('sourceLabel')}: {t(`source_${u.source}`)}
            </p>
            <p className="mt-1 break-words">
              <bdi>{u.description}</bdi>
            </p>
          </li>
        ))}
      </ul>
    </details>
  )
}

function ResolvedGroup({
  items,
  domainLabels,
}: {
  items: Uncertainty[]
  domainLabels: Record<string, string>
}) {
  const t = useTranslations('DiscoveryReview')
  return (
    <details className="group rounded-lg border border-border bg-background">
      <summary
        id="uncertainty-summary-resolved"
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-navy outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden"
      >
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary uppercase">
          {t('resolved')}
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {t('uncertaintyGroupCount', { count: items.length })}
        </span>
        <ChevronDown
          className="ms-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ul className="space-y-3 border-t border-border p-3">
        {items.map((u) => (
          <li key={u.field_key} className="text-sm">
            <p className="text-xs text-muted-foreground">
              {domainLabels[u.domain] ?? u.domain}
              <span className="mx-1" aria-hidden="true">
                ·
              </span>
              {t('sourceLabel')}: {t(`source_${u.source}`)}
            </p>
            <p className="mt-1 break-words">
              <bdi>{u.description}</bdi>
            </p>
          </li>
        ))}
      </ul>
    </details>
  )
}

function UncertaintiesSection({
  uncertainties,
  domainLabels,
}: {
  uncertainties: Uncertainty[]
  domainLabels: Record<string, string>
}) {
  const t = useTranslations('DiscoveryReview')
  const unresolved = uncertainties.filter((u) => !u.resolved)
  const resolved = uncertainties.filter((u) => u.resolved)
  const high = unresolved.filter((u) => u.severity === 'high')
  const medium = unresolved.filter((u) => u.severity === 'medium')
  const low = unresolved.filter((u) => u.severity === 'low')

  return (
    <ProfileSectionCard title={t('uncertaintiesTitle')} icon={CircleQuestionMark}>
      {unresolved.length === 0 && resolved.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-primary">
          <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
          <p className="font-medium">{t('uncertaintyNone')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {high.length > 0 && (
            <UncertaintyGroup severity="high" items={high} domainLabels={domainLabels} open />
          )}
          {medium.length > 0 && (
            <UncertaintyGroup severity="medium" items={medium} domainLabels={domainLabels} />
          )}
          {low.length > 0 && (
            <UncertaintyGroup severity="low" items={low} domainLabels={domainLabels} />
          )}
          {resolved.length > 0 && <ResolvedGroup items={resolved} domainLabels={domainLabels} />}
        </div>
      )}
    </ProfileSectionCard>
  )
}

function IncompleteProfileNotice({
  acknowledged,
  onToggle,
  disabled,
}: {
  acknowledged: boolean
  onToggle: (checked: boolean) => void
  disabled?: boolean
}) {
  const t = useTranslations('DiscoveryReview')
  return (
    <div className="rounded-lg border border-warning/20 bg-warning/10 p-4" role="note">
      <h3 className="text-sm font-semibold text-warning">{t('incompleteTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('incompleteBody')}</p>
      <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onToggle(e.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="break-words font-normal">{t('acknowledgeIncomplete')}</span>
      </label>
    </div>
  )
}

function ConfirmActionBar({
  pending,
  disabled,
  canConfirm,
  onConfirm,
}: {
  pending: boolean
  disabled?: boolean
  canConfirm: boolean
  onConfirm: () => void
}) {
  const t = useTranslations('DiscoveryReview')
  return (
    <Button
      onClick={onConfirm}
      disabled={disabled || pending || !canConfirm}
      className="w-full"
      size="lg"
    >
      {pending ? t('confirmingLabel') : t('confirmProfile')}
    </Button>
  )
}

function DomainReadinessMeter({
  domains,
  blockingDomains,
  domainLabels,
}: {
  domains: readonly string[]
  blockingDomains: readonly string[]
  domainLabels: Record<string, string>
}) {
  const t = useTranslations('DiscoveryReview')
  const blocked = new Set(blockingDomains)
  const completedCount = domains.length - blocked.size
  return (
    <ul
      aria-label={t('completenessSummary', { completed: String(completedCount), total: String(domains.length) })}
      className="flex items-center gap-1"
    >
      {domains.map((domain) => (
        <li
          key={domain}
          title={domainLabels[domain] ?? domain}
          aria-label={domainLabels[domain] ?? domain}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            blocked.has(domain) ? 'bg-border' : 'bg-primary',
          )}
        />
      ))}
    </ul>
  )
}

function DraftReviewHeader({
  isComplete,
  completionReason,
  readiness,
  completedDomains,
  blockingDomains,
  domainLabels,
  readOnly = false,
}: {
  isComplete: boolean
  completionReason: string
  readiness: BusinessProfileDraft['readiness']
  completedDomains: number
  blockingDomains: readonly string[]
  domainLabels: Record<string, string>
  readOnly?: boolean
}) {
  const t = useTranslations('DiscoveryReview')
  const fmt = useFormatter()

  if (readOnly) {
    return (
      <header className="space-y-4">
        <div className="space-y-1.5">
          <h1 className="text-balance text-2xl font-bold text-navy">{t('confirmedTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('confirmedDescription')}</p>
          <span aria-hidden="true" className="mt-3 block h-1 w-14 rounded-full bg-primary" />
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4">
          <CircleCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-primary">{t('profileConfirmedStatus')}</p>
            <p className="text-xs text-muted-foreground">
              {t('completenessSummary', {
                completed: fmt.number(completedDomains),
                total: fmt.number(FACT_DOMAINS.length),
              })}
              {' · '}
              {t('readinessLabel')}: {fmt.number(readiness.profile_readiness, { style: 'percent' })}
            </p>
          </div>
        </div>

        {blockingDomains.length > 0 && (
          <div className="rounded-md border border-warning/20 bg-warning/10 p-4 text-warning" role="status">
            <p className="text-sm font-medium">{t('blockingDomainsLabel')}</p>
            <ul className="mt-1 list-inside list-disc text-sm">
              {blockingDomains.map((domain) => (
                <li key={domain}>{domainLabels[domain] ?? domain}</li>
              ))}
            </ul>
          </div>
        )}
      </header>
    )
  }

  return (
    <header className="space-y-4">
      <div className="space-y-1.5">
        <h1 className="text-balance text-2xl font-bold text-navy">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <span aria-hidden="true" className="mt-3 block h-1 w-14 rounded-full bg-primary" />
      </div>

      <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="text-sm text-muted-foreground">
            {t('completenessLabel')}:{' '}
            <span
              className={cn(
                'inline-flex items-center gap-1.5 font-semibold',
                isComplete ? 'text-primary' : 'text-warning',
              )}
            >
              {isComplete ? (
                <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              )}
              {isComplete ? t('complete') : t('incomplete')}
            </span>
            <span className="mx-2 text-border" aria-hidden="true">
              ·
            </span>
            {t('completionReasonLabel')}: {completionReason}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('readinessLabel')}:{' '}
            <span className="font-semibold text-navy">
              {fmt.number(readiness.profile_readiness, { style: 'percent' })}
            </span>
            <span className="mx-2 text-border" aria-hidden="true">
              ·
            </span>
            {t('turnCountLabel')}:{' '}
            <span className="font-semibold text-navy tabular-nums">
              {fmt.number(readiness.owner_turn_count)} / {fmt.number(readiness.max_owner_turns)}
            </span>
          </p>
        </div>

        <div className="mt-4">
          <DomainReadinessMeter
            domains={FACT_DOMAINS}
            blockingDomains={blockingDomains}
            domainLabels={domainLabels}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t('completenessSummary', {
              completed: fmt.number(completedDomains),
              total: fmt.number(FACT_DOMAINS.length),
            })}
          </p>
        </div>
      </div>

      {blockingDomains.length > 0 && (
        <div className="rounded-md border border-warning/20 bg-warning/10 p-4 text-warning" role="status">
          <p className="text-sm font-medium">{t('blockingDomainsLabel')}</p>
          <ul className="mt-1 list-inside list-disc text-sm">
            {blockingDomains.map((domain) => (
              <li key={domain}>{domainLabels[domain] ?? domain}</li>
            ))}
          </ul>
        </div>
      )}
    </header>
  )
}

export function DraftReview({
  status,
  draft,
  pending,
  onConfirm,
  disabled,
  readOnly = false,
}: {
  status: DiscoveryStatusResponse
  draft: BusinessProfileDraft
  pending: boolean
  onConfirm: (acknowledgeIncomplete: boolean, confirmedFacts?: MarketAwareBusinessFacts) => void
  disabled?: boolean
  readOnly?: boolean
}) {
  const t = useTranslations('DiscoveryReview')
  const fmt = useFormatter()
  const [acknowledged, setAcknowledged] = useState(false)
  const [editingDomain, setEditingDomain] = useState<EditableDomain | null>(null)
  const [editedFacts, setEditedFacts] = useState<MarketAwareBusinessFacts | null>(null)
  const [editBaseline, setEditBaseline] = useState<MarketAwareBusinessFacts | null>(null)

  const isComplete = draft.completeness === 'complete'
  const readiness = draft.readiness

  const facts = editedFacts ?? draft.confirmed_facts

  const hasEdits =
    editedFacts !== null &&
    JSON.stringify(editedFacts) !== JSON.stringify(draft.confirmed_facts)

  const openEdit = (domain: EditableDomain) => {
    setEditBaseline(cloneFacts(facts))
    setEditingDomain(domain)
  }

  const cancelEdit = () => {
    if (editBaseline) setEditedFacts(editBaseline)
    setEditBaseline(null)
    setEditingDomain(null)
  }

  const saveEdit = () => {
    setEditBaseline(null)
    setEditingDomain(null)
  }

  const changeField = (domain: EditableDomain, fieldKey: string, value: string | string[]) => {
    setEditedFacts((prev) => writeFactsField(prev ?? draft.confirmed_facts, domain, fieldKey, value))
  }

  const canEditDomain = (domain: EditableDomain) =>
    !readOnly && (editingDomain === null || editingDomain === domain)

  const domainLabels: Record<string, string> = {
    identity: t('domainIdentity'),
    offer: t('domainOffer'),
    customers: t('domainCustomers'),
    differentiation: t('domainDifferentiation'),
    current_marketing: t('domainCurrentMarketing'),
    goals_and_constraints: t('domainGoals'),
    market_context: t('domainMarketContext'),
  }
  const sourceTypeLabel = (sourceType: SourceType) => t(`citationSource_${sourceType}`)

  const sourceRefs = status.intelligence.source_refs

  const canConfirm = isComplete || acknowledged
  const blockedSet = new Set(readiness.blocking_domains)
  const completedDomains = Math.max(0, FACT_DOMAINS.length - readiness.blocking_domains.length)
  const unresolvedCount = draft.uncertainties.filter((u) => !u.resolved).length

  // Deduplicate research_observations against market_context evidence
  const marketEvidenceIds = new Set<string>()
  Object.values(draft.market_context).forEach((group: MarketEvidence[]) => {
    group.forEach((ev) => marketEvidenceIds.add(ev.observation_id))
  })

  const visibleObservations = draft.research_observations.filter(
    (obs) =>
      obs.status === 'accepted' &&
      obs.visibility === 'owner_visible' &&
      !marketEvidenceIds.has(obs.id),
  )

  const hasAnyEvidence =
    draft.market_context.competitor_landscape.length > 0 ||
    draft.market_context.local_demand_signals.length > 0 ||
    draft.market_context.digital_presence_signals.length > 0 ||
    draft.market_context.other_signals.length > 0 ||
    visibleObservations.length > 0

  const sourceMap = new Map(sourceRefs.map((s) => [s.id, s]))

  const identityFields: FieldSpec[] = [
    { kind: 'value', label: t('businessName'), value: facts.identity.business_name, fieldKey: 'business_name' },
    { kind: 'value', label: t('businessType'), value: facts.identity.business_type, fieldKey: 'business_type' },
    { kind: 'value', label: t('city'), value: facts.identity.city, fieldKey: 'city' },
    { kind: 'value', label: t('area'), value: facts.identity.area, fieldKey: 'area' },
  ]
  const offerFields: FieldSpec[] = [
    { kind: 'list', label: t('coreOfferings'), list: facts.offer.core_offerings, fieldKey: 'core_offerings' },
    { kind: 'list', label: t('bestSellers'), list: facts.offer.best_sellers, fieldKey: 'best_sellers' },
    { kind: 'value', label: t('priceRange'), value: facts.offer.price_range, fieldKey: 'price_range' },
    { kind: 'list', label: t('purchaseOccasions'), list: facts.offer.purchase_occasions, fieldKey: 'purchase_occasions' },
  ]
  const customersFields: FieldSpec[] = [
    { kind: 'list', label: t('primarySegments'), list: facts.customers.primary_segments, fieldKey: 'primary_segments' },
    { kind: 'list', label: t('visitOrOrderOccasions'), list: facts.customers.visit_or_order_occasions, fieldKey: 'visit_or_order_occasions' },
    { kind: 'list', label: t('peakPeriods'), list: facts.customers.peak_periods, fieldKey: 'peak_periods' },
    { kind: 'list', label: t('customerNeeds'), list: facts.customers.customer_needs, fieldKey: 'customer_needs' },
  ]
  const differentiationFields: FieldSpec[] = [
    { kind: 'list', label: t('ownerClaimedStrengths'), list: facts.differentiation.owner_claimed_strengths, fieldKey: 'owner_claimed_strengths' },
    { kind: 'list', label: t('customerChoiceReasons'), list: facts.differentiation.customer_choice_reasons, fieldKey: 'customer_choice_reasons' },
    { kind: 'list', label: t('proofPoints'), list: facts.differentiation.proof_points, fieldKey: 'proof_points' },
  ]
  const marketingFields: FieldSpec[] = [
    { kind: 'list', label: t('activeChannels'), list: facts.current_marketing.active_channels, fieldKey: 'active_channels' },
    { kind: 'list', label: t('currentActivities'), list: facts.current_marketing.current_activities, fieldKey: 'current_activities' },
    { kind: 'list', label: t('deliveryPlatforms'), list: facts.current_marketing.delivery_platforms, fieldKey: 'delivery_platforms' },
    { kind: 'list', label: t('availableAssets'), list: facts.current_marketing.available_assets, fieldKey: 'available_assets' },
  ]
  const goalsFields: FieldSpec[] = [
    { kind: 'list', label: t('growthGoals'), list: facts.goals_and_constraints.growth_goals, fieldKey: 'growth_goals' },
    { kind: 'value', label: t('timeframe'), value: facts.goals_and_constraints.timeframe, fieldKey: 'timeframe' },
    { kind: 'value', label: t('marketingBudgetRange'), value: facts.goals_and_constraints.marketing_budget_range, fieldKey: 'marketing_budget_range' },
    { kind: 'value', label: t('teamCapacity'), value: facts.goals_and_constraints.team_capacity, fieldKey: 'team_capacity' },
    { kind: 'list', label: t('operationalConstraints'), list: facts.goals_and_constraints.operational_constraints, fieldKey: 'operational_constraints' },
  ]

  const evidenceGroups = [
    { title: t('competitorLandscape'), items: draft.market_context.competitor_landscape.map(toEvidenceItem) },
    { title: t('localDemandSignals'), items: draft.market_context.local_demand_signals.map(toEvidenceItem) },
    { title: t('digitalPresenceSignals'), items: draft.market_context.digital_presence_signals.map(toEvidenceItem) },
    { title: t('otherSignals'), items: draft.market_context.other_signals.map(toEvidenceItem) },
    { title: t('observationsTitle'), items: visibleObservations.map(toObservationItem) },
  ]

  const showOwnerNotes = draft.owner_goals.length > 0 || draft.strategy_relevant_notes.length > 0

  return (
    <div className="space-y-6">
      <DraftReviewHeader
        isComplete={isComplete}
        completionReason={t(`reason_${draft.completion_reason}`)}
        readiness={readiness}
        completedDomains={completedDomains}
        blockingDomains={readiness.blocking_domains}
        domainLabels={domainLabels}
        readOnly={readOnly}
      />

      <FactSection
        title={t('domainIdentity')}
        icon={Store}
        fields={identityFields}
        grid
        incomplete={blockedSet.has('identity')}
        domain="identity"
        editing={editingDomain === 'identity'}
        editFacts={facts}
        canEdit={canEditDomain('identity')}
        pending={pending}
        disabled={disabled}
        onEdit={() => openEdit('identity')}
        onSave={saveEdit}
        onCancel={cancelEdit}
        onChangeField={(fieldKey, value) => changeField('identity', fieldKey, value)}
      />
      <FactSection
        title={t('domainOffer')}
        icon={Package}
        fields={offerFields}
        incomplete={blockedSet.has('offer')}
        domain="offer"
        editing={editingDomain === 'offer'}
        editFacts={facts}
        canEdit={canEditDomain('offer')}
        pending={pending}
        disabled={disabled}
        onEdit={() => openEdit('offer')}
        onSave={saveEdit}
        onCancel={cancelEdit}
        onChangeField={(fieldKey, value) => changeField('offer', fieldKey, value)}
      />
      <FactSection
        title={t('domainCustomers')}
        icon={Users}
        fields={customersFields}
        incomplete={blockedSet.has('customers')}
        domain="customers"
        editing={editingDomain === 'customers'}
        editFacts={facts}
        canEdit={canEditDomain('customers')}
        pending={pending}
        disabled={disabled}
        onEdit={() => openEdit('customers')}
        onSave={saveEdit}
        onCancel={cancelEdit}
        onChangeField={(fieldKey, value) => changeField('customers', fieldKey, value)}
      />
      <FactSection
        title={t('domainDifferentiation')}
        icon={Layers}
        fields={differentiationFields}
        incomplete={blockedSet.has('differentiation')}
        domain="differentiation"
        editing={editingDomain === 'differentiation'}
        editFacts={facts}
        canEdit={canEditDomain('differentiation')}
        pending={pending}
        disabled={disabled}
        onEdit={() => openEdit('differentiation')}
        onSave={saveEdit}
        onCancel={cancelEdit}
        onChangeField={(fieldKey, value) => changeField('differentiation', fieldKey, value)}
      />
      <FactSection
        title={t('domainCurrentMarketing')}
        icon={Megaphone}
        fields={marketingFields}
        incomplete={blockedSet.has('current_marketing')}
        domain="current_marketing"
        editing={editingDomain === 'current_marketing'}
        editFacts={facts}
        canEdit={canEditDomain('current_marketing')}
        pending={pending}
        disabled={disabled}
        onEdit={() => openEdit('current_marketing')}
        onSave={saveEdit}
        onCancel={cancelEdit}
        onChangeField={(fieldKey, value) => changeField('current_marketing', fieldKey, value)}
      />
      <FactSection
        title={t('domainGoals')}
        icon={Target}
        fields={goalsFields}
        incomplete={blockedSet.has('goals_and_constraints')}
        domain="goals_and_constraints"
        editing={editingDomain === 'goals_and_constraints'}
        editFacts={facts}
        canEdit={canEditDomain('goals_and_constraints')}
        pending={pending}
        disabled={disabled}
        onEdit={() => openEdit('goals_and_constraints')}
        onSave={saveEdit}
        onCancel={cancelEdit}
        onChangeField={(fieldKey, value) => changeField('goals_and_constraints', fieldKey, value)}
      />

      <ProfileSectionCard
        title={t('marketEvidenceTitle')}
        icon={Globe}
        incomplete={blockedSet.has('market_context')}
        empty={!hasAnyEvidence}
      >
        <div className="space-y-5">
          {evidenceGroups.map((group) => (
            <EvidenceGroup
              key={group.title}
              title={group.title}
              items={group.items}
              sourceMap={sourceMap}
              sourceTypeLabel={sourceTypeLabel}
            />
          ))}
        </div>
      </ProfileSectionCard>

      <UncertaintiesSection uncertainties={draft.uncertainties} domainLabels={domainLabels} />

      {showOwnerNotes && (
        <ProfileSectionCard title={t('ownerGoalsAndNotes')} icon={NotebookPen}>
          <div className="space-y-4">
            {draft.owner_goals.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-navy">{t('ownerGoals')}</h3>
                <FactList items={draft.owner_goals} />
              </div>
            )}
            {draft.strategy_relevant_notes.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-navy">{t('strategyNotes')}</h3>
                <div className="space-y-1">
                  {draft.strategy_relevant_notes.map((note, idx) => (
                    <p key={idx} className="text-sm text-muted-foreground break-words">
                      <bdi>{note}</bdi>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ProfileSectionCard>
      )}

      <div className="space-y-4 border-t border-border pt-4">
        {readOnly ? (
          <>
          <div className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-muted-foreground">
            <p>
              <bdi>{facts.identity.business_name || t('notProvided')}</bdi>
              {facts.identity.city && (
                <span>
                  {' · '}
                  <bdi>{facts.identity.city}</bdi>
                </span>
              )}
            </p>
            <p className="mt-1 text-xs">
              {t('completenessSummary', {
                completed: fmt.number(completedDomains),
                total: fmt.number(FACT_DOMAINS.length),
              })}
              {unresolvedCount > 0 && (
                <span className="text-warning">
                  {' · '}
                  {t('unresolvedUncertainties')}: {unresolvedCount}
                </span>
              )}
            </p>
          </div>
          <Link
            href="/strategy"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('goToStrategy')}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          </>
        ) : (
          <>
            {!isComplete && (
              <IncompleteProfileNotice
                acknowledged={acknowledged}
                onToggle={setAcknowledged}
                disabled={disabled || pending}
              />
            )}
            <ConfirmActionBar
              pending={pending}
              disabled={disabled}
              canConfirm={canConfirm}
              onConfirm={() => onConfirm(!isComplete && acknowledged, hasEdits ? editedFacts ?? undefined : undefined)}
            />
          </>
        )}
      </div>
    </div>
  )
}
