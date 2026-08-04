import { getTranslations } from 'next-intl/server'
import { BillingHome } from '@/features/billing/billing-home'

export default async function BillingPage() {
  const t = await getTranslations('Billing')

  return (
    <div className="grid gap-1">
      <BillingHome />
      <p className="sr-only">{t('liveGate')}</p>
    </div>
  )
}
