import { useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeftIcon, CheckCircle2Icon, CircleIcon } from 'lucide-react';
import type { RoadmapCard } from '../lib/content';
import { useLandingCopy } from '../landing-copy-provider';
import { EASE, useReducedMotion } from '../lib/motion';
import { Eyebrow, Latin, Section } from './ui/Primitives';
type PhaseCardProps = {
  card: RoadmapCard;
  index: number;
  reduced: boolean;
  liveCta: string;
};
function PhaseCard({ card, index, reduced, liveCta }: PhaseCardProps) {
  const live = card.status === 'live';
  return (
    <motion.article
      aria-labelledby={`roadmap-phase-${card.no}`}
      initial={reduced ? false : {
        opacity: 0,
        y: 34
      }}
      whileInView={reduced ? undefined : {
        opacity: 1,
        y: 0
      }}
      viewport={{
        once: true,
        margin: '-18%'
      }}
      transition={{
        duration: 0.38,
        ease: EASE.decel
      }}
      style={{
        zIndex: index + 1
      }}
      className={`roadmap-stack-card relative flex min-h-[340px] flex-col rounded-card border p-7 shadow-[0_14px_34px_rgb(16_42_67_/_8%)] sm:min-h-[380px] md:p-9 ${live ? 'border-primary bg-primary text-white' : 'roadmap-stack-card--planned text-navy'}`}>
      
      <div className="flex items-start justify-between gap-4">
        <span
          className={`text-[42px] font-bold leading-none ${live ? 'text-white/70' : 'text-navy/20'}`}>
          
          {card.no}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${live ? 'border-white/35 bg-white/10 text-white' : 'border-border bg-surface text-muted'}`}>
          
          {live ?
          <CheckCircle2Icon className="h-3.5 w-3.5" aria-hidden /> :

          <CircleIcon className="h-3.5 w-3.5" aria-hidden />
          }
          {card.statusLabel}
        </span>
      </div>
      <h3
        id={`roadmap-phase-${card.no}`}
        className="mt-5 text-[clamp(1.7rem,3vw,2.15rem)] font-bold leading-[1.12]">
        
        {card.title}
      </h3>
      <span
        className={`mt-2 font-latin text-[13px] ${live ? 'text-white/75' : 'text-primary'}`}>
        
        <Latin>{card.en}</Latin> <span className="text-[11px]">→</span>{' '}
        <Latin>{card.output}</Latin>
      </span>
      <p
        className={`mt-4 text-[15px] leading-[1.8] ${live ? 'text-white/85' : 'text-ink-soft'}`}>
        
        {card.desc}
      </p>
      {live &&
      <a
        href="#start"
        className="cta-secondary mt-auto self-start px-4 py-2 text-[13px] font-bold">
        
          {liveCta}
          <ArrowLeftIcon className="mr-2 h-4 w-4" aria-hidden />
        </a>
      }
    </motion.article>);

}
export function Roadmap() {
  const copy = useLandingCopy();
  const trackRef = useRef<HTMLOListElement>(null);
  const reduced = useReducedMotion();
  return (
    <Section id="roadmap" tone="surface">
      <div className="mx-auto max-w-[880px] text-center">
        <Eyebrow>{copy.roadmap.eyebrow}</Eyebrow>
        <h2 className="mt-3 text-[clamp(2.3rem,6vw,4.8rem)] font-bold leading-[1.03] text-navy">
          {copy.roadmap.title}
        </h2>
        <p className="mt-4 text-[1rem] leading-[1.8] text-ink-soft">
          {copy.roadmap.body}
        </p>
      </div>

      <motion.p
        initial={{
          opacity: 0,
          y: 10
        }}
        whileInView={{
          opacity: 1,
          y: 0
        }}
        viewport={{
          once: true,
          margin: '-10%'
        }}
        transition={{
          duration: 0.3,
          ease: EASE.decel
        }}
        className="mx-auto mt-8 w-fit rounded-full border border-border bg-bg px-3 py-1.5 text-center text-[12px] font-semibold text-muted">
        
        {copy.roadmap.hint}
      </motion.p>

      <ol
        ref={trackRef}
        aria-label={copy.roadmap.aria}
        className="roadmap-stack mx-auto mt-8 max-w-[860px] list-none p-0 lg:mt-12">
        
        {copy.roadmap.cards.map((card, index) =>
        <li
          key={card.no}
          className="roadmap-stack-scene"
          style={{
            zIndex: index + 1
          }}>
          
            <PhaseCard
            card={card}
            index={index}
            reduced={reduced}
            liveCta={copy.roadmap.liveCta} />
          
          </li>
        )}
      </ol>
    </Section>);

}
