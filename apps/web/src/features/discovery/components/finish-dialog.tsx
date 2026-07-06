'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Dialog } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import type { DiscoveryReadiness } from '@marketmind/contracts'
import { cn } from '@/lib/utils'

function domainLabel(
  t: ReturnType<typeof useTranslations<'DiscoveryInterview'>>,
  domain: string,
): string {
  const map: Record<string, string> = {
    identity: t('domainIdentity'),
    offer: t('domainOffer'),
    customers: t('domainCustomers'),
    differentiation: t('domainDifferentiation'),
    current_marketing: t('domainCurrentMarketing'),
    goals_and_constraints: t('domainGoals'),
    market_context: t('domainMarketContext'),
  }
  return map[domain] ?? domain
}

export function FinishDialog({
  readiness,
  pending,
  onConfirm,
  disabled,
}: {
  readiness: DiscoveryReadiness
  pending: boolean
  onConfirm: () => void
  disabled?: boolean
}) {
  const t = useTranslations('DiscoveryInterview')
  const [open, setOpen] = useState(false)

  const blockingDomains = readiness.blocking_domains
  const isReady = readiness.ready

  const handleOpenChange = (nextOpen: boolean) => {
    // Opening or cancelling performs no API mutation
    setOpen(nextOpen)
  }

  const handleConfirm = () => {
    onConfirm()
    setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger render={
        <Button
          variant="outline"
          disabled={disabled || pending}
          className="w-full"
        >
          {t('finishInterview')}
        </Button>
      } />
      <Dialog.Portal>
        <Dialog.Backdrop
          className="fixed inset-0 bg-black/30 z-40"
          aria-hidden="true"
        />
        <Dialog.Popup
          className={cn(
            'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-md rounded-xl bg-card p-6 shadow-lg border border-border',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none overscroll-contain',
          )}
        >
          <Dialog.Title className="text-lg font-semibold text-navy mb-2">
            {t('finishDialogTitle')}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground mb-4">
            {isReady ? t('finishDialogReadyDescription') : t('finishDialogIncompleteDescription')}
          </Dialog.Description>

          {!isReady && blockingDomains.length > 0 && (
            <div
              className="mb-4 p-3 rounded-md bg-warning/10 text-warning border border-warning/20"
              role="status"
            >
              <p className="text-sm font-medium mb-1">{t('finishDialogBlockingDomains')}</p>
              <ul className="text-sm list-disc list-inside">
                {blockingDomains.map((domain) => (
                  <li key={domain}>{domainLabel(t, domain)}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Dialog.Close render={
              <Button variant="ghost" disabled={pending}>
                {t('cancelFinish')}
              </Button>
            } />
            <Button
              onClick={handleConfirm}
              disabled={pending}
              aria-label={t('confirmFinishLabel')}
            >
              {pending ? t('submittingLabel') : isReady ? t('finishInterview') : t('confirmFinish')}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
