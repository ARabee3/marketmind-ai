import { useEffect, useState, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { CheckIcon, ChevronDownIcon, RadioIcon } from 'lucide-react';
import { useLandingCopy } from '../landing-copy-provider';
import { Eyebrow, Section } from './ui/Primitives';
import { useReducedMotion } from '../lib/motion';
export function ResearchTimeline() {
  const copy = useLandingCopy();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, {
    once: false,
    margin: '-25%'
  });
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const displayedActive = reduced ? copy.research.stages.length : active;
  useEffect(() => {
    if (!inView || reduced) return;
    const resetTimer = window.setTimeout(() => setActive(0), 0);
    const timer = window.setInterval(
      () =>
      setActive((current) =>
      current >= copy.research.stages.length ? 0 : current + 1
      ),
      900
    );
    return () => {
      window.clearTimeout(resetTimer);
      window.clearInterval(timer);
    };
  }, [copy.research.stages.length, inView, reduced]);
  return (
    <Section tone="journey" className="pt-8 md:pt-10">
      <div ref={ref} className="grid gap-10 md:grid-cols-[1fr,1.4fr] md:gap-16">
        <div className="min-w-0">
          <Eyebrow inverse>{copy.research.eyebrow}</Eyebrow>
          <h2 className="mt-4 text-[clamp(2.3rem,6vw,4.4rem)] font-bold leading-[1.03] text-white">
            {copy.research.title}
          </h2>
          <p className="mt-4 max-w-read text-[1rem] leading-[1.85] text-white/75">
            {copy.research.body}
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-journey-mint/40 bg-white/[0.06] px-3 py-1.5 text-[12px] font-bold text-journey-mint">
            <span className="relative flex h-2 w-2">
              {!reduced &&
              <span className="absolute h-full w-full animate-ping-soft rounded-full bg-journey-mint" />
              }
              <span className="relative h-2 w-2 rounded-full bg-journey-mint" />
            </span>
            {copy.research.status}
          </div>
        </div>
        <ol className="relative min-w-0 pr-6">
          <span
            className="absolute bottom-2 right-[7px] top-2 w-px bg-white/20"
            aria-hidden />
          
          {copy.research.stages.map((stage, index) => {
            const reached = index <= displayedActive - 1;
            const current =
            index === displayedActive - 1 || displayedActive === 0 && index === 0 && inView;
            return (
              <li key={stage.label} className="relative mb-4 last:mb-0">
                <span
                  className={`absolute right-0 top-1 flex h-4 w-4 -translate-x-[1.5px] items-center justify-center rounded-full border ${reached ? 'border-journey-mint bg-journey-mint' : 'border-white/35 bg-navy'}`}>
                  
                  {reached && <CheckIcon className="h-2.5 w-2.5 text-navy" />}
                </span>
                <div
                  className={`mr-2 rounded-card border p-3 transition-colors duration-300 ${current ? 'border-journey-mint/55 bg-white/[0.1]' : reached ? 'border-white/[0.14] bg-white/[0.06]' : 'border-white/[0.14] bg-transparent'}`}>
                  
                  <button
                    type="button"
                    onClick={() => setOpen(open === index ? null : index)}
                    className="flex w-full items-center justify-between gap-2 rounded text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-journey-mint">
                    
                    <span className="flex items-center gap-2">
                      {current &&
                      <RadioIcon className="h-3.5 w-3.5 text-journey-mint" />
                      }
                      <span
                        className={`text-[14px] font-semibold ${reached ? 'text-white' : 'text-white/65'}`}>
                        
                        {stage.label}
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={`h-4 w-4 text-white/55 transition-transform ${open === index ? 'rotate-180' : ''}`} />
                    
                  </button>
                  <motion.p
                    initial={false}
                    animate={{
                      height: open === index ? 'auto' : 0,
                      opacity: open === index ? 1 : 0
                    }}
                    transition={{
                      duration: 0.22,
                      ease: [0, 0, 0.2, 1]
                    }}
                    className="overflow-hidden text-[12px] leading-relaxed text-white/65">
                    
                    <span className="block pt-2">{stage.detail}</span>
                  </motion.p>
                </div>
              </li>);

          })}
        </ol>
      </div>
    </Section>);

}
