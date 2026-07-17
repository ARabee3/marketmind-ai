import { motion } from 'framer-motion';
import { ArrowLeftIcon } from 'lucide-react';
import { useLandingCopy } from '../landing-copy-provider';
import { floatIn } from '../lib/motion';
export function FinalCta() {
  const copy = useLandingCopy();

  return (
    <section
      id="start"
      className="w-full bg-primary px-4 py-24 sm:px-6 md:pb-[110px] md:pt-[96px]">
      
      <motion.div
        variants={floatIn}
        initial="hidden"
        whileInView="show"
        viewport={{
          once: true,
          margin: '-15%'
        }}
        className="mx-auto max-w-content text-center">
        
        <h2 className="text-[clamp(2.3rem,6vw,4.8rem)] font-bold leading-[1.03] text-navy">
          {copy.finalCta.title}
        </h2>
        <p className="mx-auto mt-4 max-w-read text-[16px] leading-[1.9] text-white/80">
          {copy.finalCta.body}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="#start"
            className="cta-solid-dark w-full gap-2 px-7 py-3 text-[15px] font-bold sm:w-auto">
            
            {copy.finalCta.primary}
            <ArrowLeftIcon className="h-4 w-4" />
          </a>
          <a
            href="#sample"
            className="cta-secondary w-full px-7 py-3 text-[15px] font-bold sm:w-auto">
            
            {copy.finalCta.secondary}
          </a>
        </div>
      </motion.div>
    </section>);

}
