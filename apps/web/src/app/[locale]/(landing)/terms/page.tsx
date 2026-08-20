import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { LegalDocument } from '@/features/landing/components/LegalDocument'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Legal.terms' })
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://marketmindai.duckdns.org'

  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `${baseUrl}/${locale}/terms`,
      languages: {
        en: `${baseUrl}/en/terms`,
        ar: `${baseUrl}/ar/terms`,
      },
    },
  }
}

export default function TermsPage() {
  return <LegalDocument namespace="Legal.terms" />
}
