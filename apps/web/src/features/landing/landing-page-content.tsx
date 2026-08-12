import { Faq } from './components/Faq'
import { FinalCta } from './components/FinalCta'
import { Hero } from './components/Hero'
import { OwnerDecisionTrail } from './components/OwnerDecisionTrail'
import { SampleResult } from './components/SampleResult'

export async function LandingPageContent() {
  return (
    <>
      <Hero />
      <OwnerDecisionTrail />
      <SampleResult />
      <Faq />
      <FinalCta />
    </>
  )
}
