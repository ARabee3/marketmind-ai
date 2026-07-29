import { getTranslations } from 'next-intl/server'
import { StrategyHome } from '@/features/strategy/components/strategy-home'

export async function generateMetadata() {
  const t = await getTranslations('Strategy')
  return {
    title: t('metadata.homeTitle'),
  }
}

export default function StrategyPage() {
  return <StrategyHome />
}
