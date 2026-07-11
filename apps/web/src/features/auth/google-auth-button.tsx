'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { signInWithGoogle } from './google-auth'

export function GoogleAuthButton() {
  const t = useTranslations('Auth')

  return (
    <div className="flex flex-col gap-4">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={signInWithGoogle}
        aria-label={t('continueWithGoogle')}
      >
        {t('continueWithGoogle')}
      </Button>

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
    </div>
  )
}
