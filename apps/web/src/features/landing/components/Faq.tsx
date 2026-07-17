import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { useLandingCopy } from '../landing-copy-provider';
import { Eyebrow, Section } from './ui/Primitives';
export function Faq() {
  const copy = useLandingCopy();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section id="faq" tone="base">
      <div className="mx-auto max-w-[860px]">
        <div className="mb-8 text-center">
          <Eyebrow>{copy.faq.eyebrow}</Eyebrow>
          <h2 className="mt-3 text-[clamp(2.3rem,6vw,4.4rem)] font-bold text-navy">
            {copy.faq.title}
          </h2>
        </div>
        <div className="space-y-3">
          {copy.faq.items.map((item, index) => {
            const isOpen = open === index;
            return (
              <div
                key={item.q}
                className="rounded-card border border-border bg-surface px-[18px] shadow-faq">
                
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    className="flex min-h-[56px] w-full items-center justify-between gap-4 rounded text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
                    
                    <span className="text-[16px] font-bold text-navy">
                      {item.q}
                    </span>
                    <span className="shrink-0 text-primary">
                      {isOpen ?
                      <MinusIcon className="h-5 w-5" /> :

                      <PlusIcon className="h-5 w-5" />
                      }
                    </span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen &&
                  <motion.div
                    initial={{
                      height: 0,
                      opacity: 0
                    }}
                    animate={{
                      height: 'auto',
                      opacity: 1
                    }}
                    exit={{
                      height: 0,
                      opacity: 0
                    }}
                    transition={{
                      duration: 0.22,
                      ease: [0, 0, 0.2, 1]
                    }}
                    className="overflow-hidden">
                    
                      <p className="max-w-read pb-5 text-[15px] leading-[1.9] text-ink-soft">
                        {item.a}
                      </p>
                    </motion.div>
                  }
                </AnimatePresence>
              </div>);

          })}
        </div>
      </div>
    </Section>);

}
