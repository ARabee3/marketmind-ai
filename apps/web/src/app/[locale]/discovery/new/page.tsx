import { IntakeForm } from '@/features/discovery/components/intake-form'

export default function DiscoveryNewPage() {
  // Issue #19 owns authentication. The access token lives in memory and is
  // passed here once auth is wired; until then the form submits without a
  // token and the API client sends no Authorization header.
  return (
    <div className="py-8">
      <IntakeForm />
    </div>
  )
}
