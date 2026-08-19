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
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      {/* Creative Brief */}
      <div>
        <h3 className="text-sm font-bold text-navy uppercase tracking-wider mb-1.5">
          {t('creativeBrief')}
        </h3>
        <p className="text-xs sm:text-sm text-navy leading-relaxed bg-muted/40 p-3 rounded border border-border">
          {creativeBrief}
        </p>
      </div>

      {/* Alt Text */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 inline-flex items-center">
          {t('altText')}
          <Tooltip content={tTooltips('altText')} />
        </h4>
        <p className="text-xs text-muted-foreground italic bg-muted/40 p-2.5 rounded border border-border">
          &quot;{altText}&quot;
        </p>
      </div>

      {/* Short Video Script section if present */}
      {videoScript && (
        <div className="pt-3 border-t border-border space-y-3">
          <div className="flex items-center gap-2 text-primary">
            <Video className="h-4 w-4" aria-hidden="true" />
            <h4 className="text-sm font-bold">{t('videoScript.title')}</h4>
          </div>

          {/* Hook */}
          <div className="bg-soft-teal p-3 rounded border border-primary/20">
            <span className="text-xs font-bold text-primary block mb-1">
              {t('videoScript.hook')}
            </span>
            <p className="text-sm font-medium text-navy">{videoScript.hook}</p>
          </div>

          {/* Scenes */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
              {t('videoScript.scenes')}
            </span>
            <ol className="space-y-2">
              {videoScript.scenes.map((scene) => (
                <li
                  key={scene.order}
                  className="bg-muted/40 p-3 rounded border border-border text-xs space-y-1"
                >
                  <div className="font-semibold text-navy">
                    {t('videoScript.scene', { order: scene.order })}:{' '}
                    {scene.visual_direction}
                  </div>
                  {scene.voiceover && (
                    <div className="text-navy">
                      <span className="font-medium text-muted-foreground">
                        {t('videoScript.voiceover')}:
                      </span>{' '}
                      &quot;{scene.voiceover}&quot;
                    </div>
                  )}
                  {scene.on_screen_text && (
                    <div className="text-navy">
                      <span className="font-medium text-muted-foreground">
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
            <div className="bg-muted p-2.5 rounded border border-border text-xs">
              <span className="font-bold text-muted-foreground block mb-0.5">
                {t('videoScript.closingCta')}
              </span>
              <p className="text-navy font-medium">{videoScript.closing_cta}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
