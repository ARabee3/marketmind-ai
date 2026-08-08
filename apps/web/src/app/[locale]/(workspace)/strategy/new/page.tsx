import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { StrategyWizard } from '@/features/strategy/components/strategy-wizard'

export async function generateMetadata() {
  const t = await getTranslations('Strategy')
  return {
    title: t('metadata.newTitle'),
  }
}

export default function NewStrategyPage() {
  return (
    <Suspense fallback={null}>
      <StrategyWizard />
    </Suspense>
  )
}
