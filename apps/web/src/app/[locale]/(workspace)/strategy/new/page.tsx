import { getTranslations } from 'next-intl/server'
import { StrategyChoicesForm } from '@/features/strategy/components/strategy-choices-form'

export async function generateMetadata() {
  const t = await getTranslations('Strategy')
  return {
    title: t('metadata.newTitle'),
  }
}

export default function NewStrategyPage() {
  return <StrategyChoicesForm />
}
