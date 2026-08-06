'use client'

import { useTranslations } from 'next-intl'
import { Video } from 'lucide-react'
import type { ContentShortVideoScript } from '@marketmind/contracts'
import { Tooltip } from '@/components/ui/tooltip'

type CreativeBriefPanelProps = {
  creativeBrief: string
  altText: string
  videoScript?: ContentShortVideoScript | null
}

export function CreativeBriefPanel({
  creativeBrief,
  altText,
  videoScript,
}: CreativeBriefPanelProps) {
  const t = useTranslations('ContentReview.proof')
  const tTooltips = useTranslations('ContentReview.tooltips')

  return (
    <div className="space-y-4 rounded-lg border border-[var(--color-border)] bg-white p-4 sm:p-5">
      {/* Creative Brief */}
      <div>
        <h3 className="text-sm font-bold text-[var(--color-navy)] uppercase tracking-wider mb-1.5">
          {t('creativeBrief')}
        </h3>
        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-slate-50 p-3 rounded border border-slate-200">
          {creativeBrief}
        </p>
      </div>

      {/* Alt Text */}
      <div>
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 inline-flex items-center">
          {t('altText')}
          <Tooltip content={tTooltips('altText')} />
        </h4>
        <p className="text-xs text-slate-600 italic bg-slate-50 p-2.5 rounded border border-slate-200">
          &quot;{altText}&quot;
        </p>
      </div>

      {/* Short Video Script section if present */}
      {videoScript && (
        <div className="pt-3 border-t border-slate-200 space-y-3">
          <div className="flex items-center gap-2 text-teal-800">
            <Video className="h-4 w-4" />
            <h4 className="text-sm font-bold">{t('videoScript.title')}</h4>
          </div>

          {/* Hook */}
          <div className="bg-teal-50/70 p-3 rounded border border-teal-200">
            <span className="text-xs font-bold text-teal-900 block mb-1">
              {t('videoScript.hook')}
            </span>
            <p className="text-sm font-medium text-teal-950">{videoScript.hook}</p>
          </div>

          {/* Scenes */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
              {t('videoScript.scenes')}
            </span>
            <ol className="space-y-2">
              {videoScript.scenes.map((scene) => (
                <li
                  key={scene.order}
                  className="bg-slate-50 p-3 rounded border border-slate-200 text-xs space-y-1"
                >
                  <div className="font-semibold text-slate-900">
                    {t('videoScript.scene', { order: scene.order })}:{' '}
                    {scene.visual_direction}
                  </div>
                  {scene.voiceover && (
                    <div className="text-slate-700">
                      <span className="font-medium text-slate-500">
                        {t('videoScript.voiceover')}:
                      </span>{' '}
                      &quot;{scene.voiceover}&quot;
                    </div>
                  )}
                  {scene.on_screen_text && (
                    <div className="text-slate-700">
                      <span className="font-medium text-slate-500">
                        {t('videoScript.onScreenText')}:
                      </span>{' '}
                      {scene.on_screen_text}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* Closing CTA */}
          {videoScript.closing_cta && (
            <div className="bg-slate-100 p-2.5 rounded border border-slate-200 text-xs">
              <span className="font-bold text-slate-700 block mb-0.5">
                {t('videoScript.closingCta')}
              </span>
              <p className="text-slate-800 font-medium">{videoScript.closing_cta}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
