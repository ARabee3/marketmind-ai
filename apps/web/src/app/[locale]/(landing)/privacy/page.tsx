import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { LegalDocument } from '@/features/landing/components/LegalDocument'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Legal.privacy' })
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://marketmindai.duckdns.org'

  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `${baseUrl}/${locale}/privacy`,
      languages: {
        en: `${baseUrl}/en/privacy`,
        ar: `${baseUrl}/ar/privacy`,
      },
    },
  }
}

export default function PrivacyPage() {
  return <LegalDocument namespace="Legal.privacy" />
}
