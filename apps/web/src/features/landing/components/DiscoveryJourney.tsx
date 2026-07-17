import { useRef } from 'react';
import {
  motion,
  useScroll,
  useTransform,
  type MotionValue } from
'framer-motion';
import type { DiscoveryStep } from '../lib/content';
import { useLandingCopy } from '../landing-copy-provider';
import { Chip, Eyebrow, Section } from './ui/Primitives';
import { useReducedMotion } from '../lib/motion';
const STEP_ACTIVE_WINDOW = 0.055;

type DiscoveryStepItemProps = {
  step: DiscoveryStep;
  index: number;
  total: number;
  progress: MotionValue<number>;
  reduced: boolean;
};

function DiscoveryStepItem({
  step,
  index,
  total,
  progress,
  reduced
}: DiscoveryStepItemProps) {
  const position = total === 1 ? 1 : index / (total - 1);
  const start = Math.max(0, position - STEP_ACTIVE_WINDOW);
  const end = Math.min(1, position + STEP_ACTIVE_WINDOW);
  const numberColor = useTransform(progress, [start, end], [
  'rgb(142 227 213)',
  'rgb(180 255 242)']
  );
  const numberBorder = useTransform(progress, [start, end], [
  'rgb(142 227 213)',
  'rgb(180 255 242)']
  );
  const numberShadow = useTransform(progress, [start, end], [
  '0 0 0 rgb(142 227 213 / 0%)',
  '0 0 34px rgb(142 227 213 / 38%)']
  );
  const cardOpacity = useTransform(progress, [start, end], [0.78, 1]);
  const cardY = useTransform(progress, [start, end], [18, 0]);
  const numberStyle = reduced ?
  undefined :
  {
    borderColor: numberBorder,
    boxShadow: numberShadow,
    color: numberColor
  };
  const cardStyle = reduced ?
  undefined :
  {
    opacity: cardOpacity,
    y: cardY
  };

  return (
    <motion.article className="discovery-step" style={cardStyle}>
      <motion.span
        className={`discovery-step-number ${reduced ? 'is-active' : ''}`}
        style={numberStyle}>
        
        {step.no}
      </motion.span>
      <div className="discovery-step-card">
        <h3 className="text-[clamp(1.7rem,3vw,2.15rem)] font-bold leading-[1.12] text-white">
          {step.label}
        </h3>
        <p className="mt-3 text-[15px] leading-[1.8] text-white/75">
          {step.desc}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {step.chips.map((chip) =>
          <Chip
            key={chip}
            tone="signal"
            className="border-journey-mint/45 bg-journey-mint/10 text-journey-mint">
            
              {chip}
            </Chip>
          )}
        </div>
      </div>
    </motion.article>);

}

export function DiscoveryJourney() {
  const copy = useLandingCopy();
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start 72%', 'end 58%']
  });
  const lineScaleY = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <Section id="discovery" tone="journey" className="pb-10">
      <div className="mb-10 max-w-read md:mb-14">
        <Eyebrow inverse>{copy.discovery.eyebrow}</Eyebrow>
        <h2 className="mt-4 text-[clamp(2.3rem,6vw,4.8rem)] font-bold leading-[1.03] text-white">
          {copy.discovery.title}
        </h2>
        <p className="mt-4 text-[1rem] leading-[1.85] text-white/75">
          {copy.discovery.body}
        </p>
      </div>
      <div
        ref={trackRef}
        className="discovery-stepper"
        aria-label={copy.discovery.aria}>
        
        <motion.svg
          className="discovery-stepper-line"
          viewBox="0 0 100 520"
          preserveAspectRatio="none"
          aria-hidden="true">
          
          <motion.path
            d="M50 8 C20 110 82 150 50 240 C18 330 78 390 50 512"
            style={{
              pathLength: reduced ? 1 : lineScaleY
            }} />
          
        </motion.svg>
        <div className="discovery-stepper-list">
          {copy.discovery.steps.map((step, index) =>
          <DiscoveryStepItem
            key={step.no}
            step={step}
            index={index}
            total={copy.discovery.steps.length}
            progress={scrollYProgress}
            reduced={reduced} />
          )}
        </div>
      </div>
    </Section>);

}
