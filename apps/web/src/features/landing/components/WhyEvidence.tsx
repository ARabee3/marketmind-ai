import { motion } from 'framer-motion';
import { CheckIcon, MessageSquareTextIcon } from 'lucide-react';
import { useLandingCopy } from '../landing-copy-provider';
import { Section, Eyebrow, StatusBadge } from './ui/Primitives';
import { floatIn } from '../lib/motion';
export function WhyEvidence() {
  const copy = useLandingCopy();

  return (
    <Section tone="soft">
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
        <motion.div
          variants={floatIn}
          initial="hidden"
          whileInView="show"
          viewport={{
            once: true,
            margin: '-15%'
          }}>
          
          <Eyebrow>{copy.why.eyebrow}</Eyebrow>
          <h2 className="mt-4 max-w-read text-[clamp(2.3rem,6vw,4.4rem)] font-bold leading-[1.03] text-navy">
            {copy.why.title}
          </h2>
          <p className="mt-4 max-w-read text-[1rem] leading-[1.85] text-ink-soft">
            {copy.why.body}
          </p>
        </motion.div>
        <motion.div
          variants={floatIn}
          initial="hidden"
          whileInView="show"
          viewport={{
            once: true,
            margin: '-15%'
          }}
          className="rounded-card border border-border bg-surface p-5">
          
          <div className="space-y-4">
            <div className="rounded-card border border-action/20 bg-action-soft p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-navy">
                  {copy.why.before}
                </span>
                <StatusBadge kind="inference" />
              </div>
              <p className="flex items-center gap-2 text-[14px] text-action">
                <MessageSquareTextIcon
                  className="h-4 w-4 shrink-0"
                  aria-hidden />
                
                {copy.why.beforeText}
              </p>
            </div>
            <div className="text-center text-[12px] text-muted">
              {copy.why.transition}
            </div>
            <div className="rounded-card border border-primary/20 bg-soft-teal p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-navy">
                  {copy.why.after}
                </span>
                <StatusBadge kind="accepted" />
              </div>
              <p className="flex items-center gap-2 text-[14px] font-semibold text-primary">
                <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />
                {copy.why.afterText}
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </Section>);

}
