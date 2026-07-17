import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import type { EvidenceTag } from '../lib/content';
import { useLandingCopy } from '../landing-copy-provider';
import { Latin } from './ui/Primitives';
import { EASE, useReducedMotion } from '../lib/motion';
const SCATTER = [
{
  x: -120,
  y: -60,
  r: -8
},
{
  x: 140,
  y: -40,
  r: 6
},
{
  x: -80,
  y: 70,
  r: 5
},
{
  x: 110,
  y: 80,
  r: -6
},
{
  x: -150,
  y: 10,
  r: 4
},
{
  x: 160,
  y: 30,
  r: -5
},
{
  x: -40,
  y: -90,
  r: 7
},
{
  x: 60,
  y: 100,
  r: -4
}];

function tagClass(type: EvidenceTag['type']) {
  if (type === 'known') return 'border-primary/25 bg-soft-teal text-primary';
  if (type === 'review') return 'border-warning/25 bg-warning/10 text-warning';
  return 'border-border bg-surface text-ink-soft';
}
export function EvidenceCloud() {
  const copy = useLandingCopy();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, {
    once: true,
    margin: '-20%'
  });
  return (
    <section className="relative flex min-h-[58vh] w-full items-center overflow-hidden bg-bg px-4 py-16 sm:px-6 md:min-h-[74vh] md:py-[82px]">
      <div ref={ref} className="mx-auto w-full max-w-content text-center">
        <motion.h2
          initial={{
            opacity: 0.18,
            y: 24
          }}
          animate={
          inView ?
          {
            opacity: 1,
            y: 0
          } :
          {}
          }
          transition={{
            duration: 0.8,
            ease: EASE.decel
          }}
          className="mx-auto max-w-5xl text-[clamp(2.3rem,12vw,5.6rem)] font-bold leading-[1.03] text-navy">
          
          {copy.evidence.title}
        </motion.h2>
        <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-3">
          {copy.evidence.tags.map((tag, index) => {
            const scatter = SCATTER[index];
            return (
              <motion.span
                key={tag.label}
                initial={
                reduced ?
                {
                  opacity: 0
                } :
                {
                  opacity: 0,
                  x: scatter.x,
                  y: scatter.y,
                  rotate: scatter.r,
                  scale: 0.9
                }
                }
                animate={
                inView ?
                reduced ?
                {
                  opacity: 1
                } :
                {
                  opacity: 1,
                  x: 0,
                  y: 0,
                  rotate: 0,
                  scale: 1
                } :
                {}
                }
                transition={{
                  duration: 0.7,
                  ease: EASE.spring,
                  delay: 0.2 + index * 0.06
                }}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[14px] font-semibold ${tagClass(tag.type)}`}>
                
                {tag.label}
                {tag.latin && <Latin>{`(${tag.latin})`}</Latin>}
              </motion.span>);

          })}
        </div>
        <p className="mx-auto mt-10 max-w-read text-[15px] leading-[1.8] text-ink-soft">
          {copy.evidence.body}
        </p>
      </div>
    </section>);

}
