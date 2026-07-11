import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { OAuthCallbackHandler } from '@/features/auth/oauth-callback-handler'

export async function generateMetadata() {
  const t = await getTranslations('Auth')
  return {
    title: t('oauthCallbackTitle'),
  }
}

export default async function OAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <OAuthCallbackHandler />
    </Suspense>
  )
}
