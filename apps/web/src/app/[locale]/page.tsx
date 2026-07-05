import { getTranslations } from 'next-intl/server'

export default async function HomePage() {
  const t = await getTranslations('Common')

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 flex flex-col items-center justify-center gap-8 px-6 py-16">
        <section className="max-w-lg text-center">
          <h2 className="text-3xl font-bold text-navy mb-4">
            {t('appName')}
          </h2>
          <p className="text-lg text-gray-600">
            AI-powered marketing for small and medium businesses.
          </p>
        </section>
      </main>

      <footer className="border-t border-border bg-surface py-6 text-center text-sm text-gray-500">
        &copy; {new Date().getFullYear()} MarketMind AI
      </footer>
    </div>
  )
}
