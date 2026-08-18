import { getTranslations } from 'next-intl/server'
import { PerformancePage } from '@/features/performance/performance-page'

export async function generateMetadata() {
  const t = await getTranslations('Performance')
  return { title: t('metadata.title') }
}

export default function PerformanceRoutePage() {
  return <PerformancePage />
}
