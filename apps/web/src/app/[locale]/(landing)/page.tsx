import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { LandingPageContent } from '@/features/landing/landing-page-content'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Landing.meta' })
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://marketmind.ai'

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: `${baseUrl}/${locale}`,
      languages: {
        en: `${baseUrl}/en`,
        ar: `${baseUrl}/ar`,
      },
    },
    openGraph: {
      title: t('title'),
      description: t('description'),
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      type: 'website',
      siteName: 'MarketMind',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
    },
  }
}

export default function HomePage() {
  return <LandingPageContent />
}
