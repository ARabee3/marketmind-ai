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
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
        <FileText className="h-5 w-5 text-slate-500 mt-0.5 shrink-0" />
        <div>
          <h4 className="text-sm font-semibold text-slate-800">
            {t('kind.prompt_only')}
          </h4>
          <p className="text-xs text-slate-600 mt-1">
            {altText || t('promptOnlyHint')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white overflow-hidden">
      {/* Header status bar */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2 font-medium text-slate-700">
          {kind === 'owner_supplied' ? (
            <UserCheck className="h-4 w-4 text-emerald-600" />
          ) : (
            <ImageIcon className="h-4 w-4 text-teal-600" />
          )}
          <span>{t(`kind.${kind}`)}</span>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 text-xs font-semibold ${
            treatment.statusBadgeVariant === 'success'
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
              : treatment.statusBadgeVariant === 'warning'
                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                : treatment.statusBadgeVariant === 'danger'
                  ? 'bg-red-100 text-red-800 border border-red-300'
                  : 'bg-slate-200 text-slate-700 border border-slate-300'
          }`}
        >
          {treatment.iconName === 'loader' && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {t(`status.${status}`)}
        </span>
      </div>

      {/* Body preview area */}
      <div className="p-4 flex flex-col items-center justify-center min-h-[220px] bg-slate-50/50">
        {status === 'ready' && objectUrl ? (
          <div className="w-full flex flex-col items-center">
            {/* Protected blob image rendering */}
            <img
              src={objectUrl}
              alt={altText || asset?.alt_text || t('imgFallbackAlt')}
              className="max-h-[360px] w-auto rounded border border-slate-200 object-contain shadow-sm"
            />
            {asset?.width && asset?.height && (
              <span className="text-[11px] text-slate-500 mt-2">
                {t('dimensions', { width: asset.width, height: asset.height })}
              </span>
            )}
          </div>
        ) : status === 'ready' && loadStatus === 'loading' ? (
          <div className="flex flex-col items-center text-slate-500 gap-2 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
            <span className="text-xs font-medium">{t('loadingBytes')}</span>
          </div>
        ) : status === 'ready' && error ? (
          <div className="flex flex-col items-center text-red-600 gap-2 py-6 text-center">
            <XCircle className="h-8 w-8" />
            <span className="text-xs font-medium">{t('loadError')}</span>
          </div>
        ) : status === 'generating' ? (
          <div className="flex flex-col items-center text-amber-700 gap-2 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
            <span className="text-sm font-semibold">{t('status.generating')}</span>
            <p className="text-xs text-slate-500 max-w-sm">
              {t('generatingBody')}
            </p>
          </div>
        ) : status === 'failed' ? (
          <div className="flex flex-col items-center text-red-700 gap-2 py-8 text-center">
            <XCircle className="h-8 w-8 text-red-600" />
            <span className="text-sm font-bold">{t('status.failed')}</span>
            <p className="text-xs text-slate-600 max-w-sm">
              {asset?.failure_code
                ? t('failureCodeBody', { code: asset.failure_code })
                : t('failedBody')}
            </p>
          </div>
        ) : status === 'blocked' ? (
          <div className="flex flex-col items-center text-red-700 gap-2 py-8 text-center">
            <Lock className="h-8 w-8 text-red-600" />
            <span className="text-sm font-bold">{t('status.blocked')}</span>
            <p className="text-xs text-slate-600 max-w-sm">
              {t('blockedBody')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-slate-500 gap-2 py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-slate-400" />
            <span className="text-sm font-semibold">{t('status.missing')}</span>
            <p className="text-xs text-slate-500 max-w-sm">
              {t('missingBody')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
