import { getTranslations } from 'next-intl/server'
import { DashboardHome } from '@/features/dashboard/dashboard-home'

export async function generateMetadata() {
  const t = await getTranslations('Common')
  return {
    title: t('appName'),
  }
}

export default async function DashboardPage() {
  return <DashboardHome />
}
