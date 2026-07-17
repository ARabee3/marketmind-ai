import { useRef, type PointerEvent } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownIcon } from 'lucide-react';
import { useLandingCopy } from '../landing-copy-provider';
import { EASE, useReducedMotion } from '../lib/motion';
import {
  HeroPointerEffect,
  type HeroPointerEffectHandle } from
'./HeroPointerEffect';
import { HeroJourneyPreview } from './HeroJourneyPreview';
export function Hero() {
  const copy = useLandingCopy();
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const effectRef = useRef<HeroPointerEffectHandle>(null);
  const onHeroPointerMove = (event: PointerEvent<HTMLElement>) => {
    const rect = sectionRef.current?.getBoundingClientRect();
    if (rect)
    effectRef.current?.move(
      event.clientX - rect.left,
      event.clientY - rect.top
    );
  };
  return (
    <section
      ref={sectionRef}
      id="top"
      onPointerMove={onHeroPointerMove}
      onPointerLeave={() => effectRef.current?.leave()}
      className="hero-workspace hero-grid relative w-full overflow-hidden px-4 pb-9 pt-[104px] sm:px-6 md:pb-[54px] md:pt-[120px]">
      
      <HeroPointerEffect ref={effectRef} />
      <div className="relative z-10 mx-auto w-full max-w-content">
        <motion.div
          initial={{
            opacity: 0,
            y: 12
          }}
          animate={{
            opacity: 1,
            y: 0
          }}
          transition={{
            duration: 0.4,
            ease: EASE.decel
          }}
          className="mx-auto flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-surface px-4 py-1.5 text-primary">
          
          <span className="relative flex h-2.5 w-2.5">
            {!reduced &&
            <span className="absolute h-full w-full animate-ping-soft rounded-full bg-primary" />
            }
            <span className="relative h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <span className="text-[13px] font-bold">{copy.hero.badge}</span>
        </motion.div>
        <motion.h1
          initial={{
            opacity: 0,
            y: 20
          }}
          animate={{
            opacity: 1,
            y: 0
          }}
          transition={{
            duration: 0.6,
            ease: EASE.decel,
            delay: 0.06
          }}
          className="mx-auto mt-[22px] max-w-[920px] text-center text-[clamp(2.9rem,11vw,7.5rem)] font-bold leading-[0.95] text-navy">
          
          {copy.hero.title}
        </motion.h1>
        <motion.p
          initial={{
            opacity: 0,
            y: 16
          }}
          animate={{
            opacity: 1,
            y: 0
          }}
          transition={{
            duration: 0.5,
            ease: EASE.decel,
            delay: 0.12
          }}
          className="mx-auto mt-5 max-w-read text-center text-[clamp(1.05rem,2vw,1.25rem)] leading-[1.9] text-ink-soft">
          
          {copy.hero.body}
        </motion.p>
        <p className="mx-auto mt-4 max-w-read text-center text-[13px] leading-[1.8] text-muted">
          {copy.hero.note}{' '}
          <a
            href="#roadmap"
            className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline">
            
            {copy.hero.noteLink}
            <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden />
          </a>
        </p>
        <motion.div
          initial={{
            opacity: 0,
            y: 16
          }}
          animate={{
            opacity: 1,
            y: 0
          }}
          transition={{
            duration: 0.5,
            ease: EASE.decel,
            delay: 0.26
          }}
          className="mt-7 flex flex-col items-center justify-center gap-4 sm:flex-row">
          
          <a
            href="#start"
            className="cta-solid w-full px-7 py-3 text-[15px] font-bold sm:w-auto">
            
            {copy.hero.primary}
          </a>
          <a
            href="#roadmap"
            className="cta-secondary w-full px-7 py-3 text-[15px] font-bold sm:w-auto">
            
            {copy.hero.secondary}
          </a>
        </motion.div>
        <HeroJourneyPreview reduced={reduced} />
      </div>
    </section>);

}
