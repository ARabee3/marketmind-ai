'use client'

import { useTranslations } from 'next-intl'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { usePackWorkspace } from '../hooks/usePackWorkspace'
import { PackHeader } from './PackHeader'
import { ItemAgenda } from './ItemAgenda'
import { SelectedItemProof } from './SelectedItemProof'
import { ProvenanceMargin } from './ProvenanceMargin'
import { VersionHistory } from './VersionHistory'
import { DecisionRail } from './DecisionRail'
import { BulkApprovalBar } from './BulkApprovalBar'
import { PublicationHandoffBanner } from './PublicationHandoffBanner'

type ContentReviewWorkspaceProps = {
  packId: string
}

export function ContentReviewWorkspace({ packId }: ContentReviewWorkspaceProps) {
  const t = useTranslations('ContentReview.header')

  const {
    status,
    workspace,
    isFixture,
    selectedItem,
    selectedItemId,
    setSelectedItemId,
    refetch,
  } = usePackWorkspace(packId)

  if (status === 'loading' && !workspace) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)] mb-3" />
        <p className="text-sm font-medium">{t('loading')}</p>
      </div>
    )
  }

  if (status === 'error' || !workspace) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
        <AlertCircle className="h-10 w-10 text-[var(--color-danger)] mb-3" />
        <h2 className="text-lg font-bold text-[var(--color-navy)]">
          {t('loadError')}
        </h2>
        <p className="text-xs text-slate-500 max-w-md mt-1 mb-4">
          {t('loadErrorBody')}
        </p>
        <button
          type="button"
          onClick={refetch}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        >
          <RefreshCw className="h-4 w-4" />
          <span>{t('retry')}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-16">
      {/* Contract-Aligned Fixture Notice Banner while the workspace API is unavailable */}
      {isFixture && (
        <div
          role="status"
          className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-center text-xs font-semibold text-amber-900"
        >
          {t('fixtureNotice')}
        </div>
      )}

      {/* Workspace Header */}
      <PackHeader pack={workspace.pack} weekContext={workspace.week_context} />

      {/* Container Layout (max-w 1200px centered per design system) */}
      <main className="mx-auto max-w-[1200px] px-4 sm:px-6">
        {/* Ordered Item Agenda */}
        <ItemAgenda
          items={workspace.items}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
        />

        {/* Bulk Approval Bar */}
        <BulkApprovalBar
          packId={packId}
          items={workspace.items}
          onBulkComplete={refetch}
        />

        {/* Main Editorial Proof & Decision Layout */}
        {selectedItem ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Proof Document & Timeline (7 cols on desktop) */}
            <div className="lg:col-span-7 space-y-6">
              {/* Publication Candidate Handoff Status */}
              <PublicationHandoffBanner
                candidate={selectedItem.publication_candidate}
              />

              {/* Selected Content Proof ("The Document") */}
              <SelectedItemProof item={selectedItem} />

              {/* Immutable Version History */}
              <VersionHistory
                versionHistory={selectedItem.version_history}
                decisions={selectedItem.decisions}
                currentVersionId={selectedItem.current_version.id}
              />
            </div>

            {/* Right Column: Decision Rail & Provenance Margin (5 cols on desktop) */}
            <div className="lg:col-span-5 space-y-6">
              {/* Exact-Version Decision Panel */}
              <DecisionRail
                packId={packId}
                item={selectedItem}
                onDecisionComplete={refetch}
              />

              {/* Provenance Margin */}
              <ProvenanceMargin
                version={selectedItem.current_version}
                weekContext={workspace.week_context}
              />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
