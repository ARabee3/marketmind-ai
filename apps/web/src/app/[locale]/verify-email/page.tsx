import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { VerifyEmailHandler } from '@/features/auth/verify-email-handler'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth')
  return { title: t('verifyEmailTitle') }
}

export default async function VerifyEmailPage() {
  const t = await getTranslations('Auth')

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-sm items-center justify-center px-4">
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle>{t('verifyEmailTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <VerifyEmailHandler />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}