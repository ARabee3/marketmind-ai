'use client'

import { CapabilityMarquee } from './components/CapabilityMarquee'
import { DiscoveryJourney } from './components/DiscoveryJourney'
import { EvidenceCloud } from './components/EvidenceCloud'
import { Faq } from './components/Faq'
import { FinalCta } from './components/FinalCta'
import { Hero } from './components/Hero'
import { ResearchTimeline } from './components/ResearchTimeline'
import { Roadmap } from './components/Roadmap'
import { SampleResult } from './components/SampleResult'
import { WhyEvidence } from './components/WhyEvidence'

export function LandingPageContent() {
  return (
    <>
      <Hero />
      <CapabilityMarquee />
      <EvidenceCloud />
      <WhyEvidence />
      <Roadmap />
      <DiscoveryJourney />
      <ResearchTimeline />
      <SampleResult />
      <Faq />
      <FinalCta />
    </>
  )
}
