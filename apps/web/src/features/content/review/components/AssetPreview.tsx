'use client'

/* eslint-disable @next/next/no-img-element -- Blob object URLs cannot be optimized by next/image */

import { useTranslations } from 'next-intl'
import {
  Image as ImageIcon,
  Loader2,
  AlertTriangle,
  XCircle,
  Lock,
  FileText,
  UserCheck,
} from 'lucide-react'
import type { ContentAsset, ContentAssetKind, ContentAssetStatus } from '@marketmind/contracts'
import { useAuthenticatedAsset } from '../hooks/useAuthenticatedAsset'
import { getAssetStateTreatment } from '../utils/asset-state'

type AssetPreviewProps = {
  asset?: ContentAsset | null
  assetRequired?: boolean
  altText?: string
}

export function AssetPreview({
  asset,
  assetRequired = false,
  altText = '',
}: AssetPreviewProps) {
  const t = useTranslations('ContentReview.asset')

  const kind: ContentAssetKind = asset?.kind ?? (assetRequired ? 'generated_static' : 'prompt_only')
  const status: ContentAssetStatus = asset?.status ?? (assetRequired ? 'missing' : 'ready')

  const { status: loadStatus, objectUrl, error } = useAuthenticatedAsset(
    status === 'ready' && kind !== 'prompt_only' ? asset?.id : null,
  )

  const treatment = getAssetStateTreatment(kind, status)

  // Prompt only / text script layout
  if (kind === 'prompt_only') {
    return (
      <div className="rounded-lg border border-border bg-muted/50 p-4 flex items-start gap-3">
        <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <h4 className="text-sm font-semibold text-navy">
            {t('kind.prompt_only')}
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            {altText || t('promptOnlyHint')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      {/* Header status bar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2 font-medium text-navy">
          {kind === 'owner_supplied' ? (
            <UserCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          ) : (
            <ImageIcon className="h-4 w-4 text-primary" aria-hidden="true" />
          )}
          <span>{t(`kind.${kind}`)}</span>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 text-xs font-semibold ${
            treatment.statusBadgeVariant === 'success'
              ? 'bg-primary/15 text-primary border border-primary/30'
              : treatment.statusBadgeVariant === 'warning'
                ? 'bg-warning/15 text-warning border border-warning/30'
                : treatment.statusBadgeVariant === 'danger'
                  ? 'bg-danger/15 text-danger border border-danger/30'
                  : 'bg-muted text-muted-foreground border border-border'
          }`}
        >
          {treatment.iconName === 'loader' && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          )}
          {t(`status.${status}`)}
        </span>
      </div>

      {/* Body preview area */}
      <div className="p-4 flex flex-col items-center justify-center min-h-[220px] bg-muted/20">
        {status === 'ready' && objectUrl ? (
          <div className="w-full flex flex-col items-center">
            {/* Protected blob image rendering */}
            <img
              src={objectUrl}
              alt={altText || asset?.alt_text || t('imgFallbackAlt')}
              className="max-h-[360px] w-auto rounded border border-border object-contain shadow-sm"
            />
            {asset?.width && asset?.height && (
              <span className="text-[11px] text-muted-foreground mt-2">
                {t('dimensions', { width: asset.width, height: asset.height })}
              </span>
            )}
          </div>
        ) : status === 'ready' && loadStatus === 'loading' ? (
          <div className="flex flex-col items-center text-muted-foreground gap-2 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
            <span className="text-xs font-medium">{t('loadingBytes')}</span>
          </div>
        ) : status === 'ready' && error ? (
          <div className="flex flex-col items-center text-danger gap-2 py-6 text-center">
            <XCircle className="h-8 w-8" aria-hidden="true" />
            <span className="text-xs font-medium">{t('loadError')}</span>
          </div>
        ) : status === 'generating' ? (
          <div className="flex flex-col items-center text-warning gap-2 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-warning" aria-hidden="true" />
            <span className="text-sm font-semibold">{t('status.generating')}</span>
            <p className="text-xs text-muted-foreground max-w-sm">
              {t('generatingBody')}
            </p>
          </div>
        ) : status === 'failed' ? (
          <div className="flex flex-col items-center text-danger gap-2 py-8 text-center">
            <XCircle className="h-8 w-8 text-danger" aria-hidden="true" />
            <span className="text-sm font-bold">{t('status.failed')}</span>
            <p className="text-xs text-muted-foreground max-w-sm">
              {asset?.failure_code
                ? t('failureCodeBody', { code: asset.failure_code })
                : t('failedBody')}
            </p>
          </div>
        ) : status === 'blocked' ? (
          <div className="flex flex-col items-center text-danger gap-2 py-8 text-center">
            <Lock className="h-8 w-8 text-danger" aria-hidden="true" />
            <span className="text-sm font-bold">{t('status.blocked')}</span>
            <p className="text-xs text-muted-foreground max-w-sm">
              {t('blockedBody')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-muted-foreground gap-2 py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <span className="text-sm font-semibold">{t('status.missing')}</span>
            <p className="text-xs text-muted-foreground max-w-sm">
              {t('missingBody')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
