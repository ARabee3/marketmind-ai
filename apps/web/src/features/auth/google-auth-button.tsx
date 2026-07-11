'use client'

import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { API_BASE_URL } from '@/lib/api/config'
import { cn } from '@/lib/utils'

export function GoogleAuthButton({ showDivider = true }: { showDivider?: boolean }) {
  const t = useTranslations('Auth')
  const href = `${API_BASE_URL}/auth/google`

  return (
    <div className="flex flex-col gap-4">
      <a
        href={href}
        className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
      >
        {t('continueWithGoogle')}
      </a>

      {showDivider ? (
        <div className="relative" role="separator" aria-label={t('orDivider')}>
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">
              {t('orDivider')}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
