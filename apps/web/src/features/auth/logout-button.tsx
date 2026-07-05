'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useSession } from './session-provider'
import { Button } from '@/components/ui/button'

export function LogoutButton() {
  const t = useTranslations('Auth')
  const tCommon = useTranslations('Common')
  const { logout } = useSession()
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)

  const handleLogout = useCallback(async () => {
    setIsPending(true)
    try {
      await logout()
      router.replace('/login')
    } finally {
      setIsPending(false)
    }
  }, [logout, router])

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleLogout}
      disabled={isPending}
    >
      {isPending ? tCommon('loading') : t('logout')}
    </Button>
  )
}
