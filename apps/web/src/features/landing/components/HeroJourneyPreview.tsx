import { useRef, type MouseEvent, type ReactNode } from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  type MotionValue
} from 'framer-motion';
import {
  ArrowLeftIcon,
  MessageCircleIcon,
  SearchIcon
} from 'lucide-react';
import { useLandingCopy } from '../landing-copy-provider';
import { EASE } from '../lib/motion';
import { Latin, StatusBadge } from './ui/Primitives';

type HeroJourneyPreviewProps = {
  readonly reduced: boolean;
};

export function HeroJourneyPreview({ reduced }: HeroJourneyPreviewProps) {
  const copy = useLandingCopy();
  const stripRef = useRef<HTMLDivElement>(null);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const badgeX = useSpring(pointerX, {
    stiffness: 90,
    damping: 20
  });
  const badgeY = useSpring(pointerY, {
    stiffness: 90,
    damping: 20
  });
  const onStripMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerX.set(((event.clientX - rect.left) / rect.width - 0.5) * 20);
    pointerY.set(((event.clientY - rect.top) / rect.height - 0.5) * 20);
  };

  return (
    <div
      ref={stripRef}
      onMouseMove={onStripMouseMove}
      className="relative mx-auto mt-[38px] max-w-[720px]">
      
      <div className="pointer-events-none absolute -right-3 -top-7 z-20 hidden md:block">
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 animate-spin-ring rounded-full border-2 border-dashed border-primary/35" />
          <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-surface">
            <SearchIcon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </div>
      <motion.div
        initial={{
          opacity: 0,
          y: 24
        }}
        animate={{
          opacity: 1,
          y: 0
        }}
        transition={{
          duration: 0.6,
          ease: EASE.decel,
          delay: 0.32
        }}
        className="grid gap-3 rounded-card border border-border bg-surface p-5 shadow-elevated md:grid-cols-4 md:gap-4">
        
        <StripStep
          step={copy.hero.preview.steps[0].step}
          title={copy.hero.preview.steps[0].title}
          kind="source"
          mono={copy.hero.preview.steps[0].mono}>
          <span>{copy.hero.preview.steps[0].text}</span>
        </StripStep>
        <StripArrow />
        <StripStep
          step={copy.hero.preview.steps[1].step}
          title={copy.hero.preview.steps[1].title}
          kind="source"
          mono={copy.hero.preview.steps[1].mono}>
          <span>{copy.hero.preview.steps[1].text}</span>
        </StripStep>
        <StripArrow />
        <StripStep
          step={copy.hero.preview.steps[2].step}
          title={copy.hero.preview.steps[2].title}
          kind="result"
          mono={copy.hero.preview.steps[2].mono}>
          
          <span>{copy.hero.preview.steps[2].text}</span>
        </StripStep>
        <StripArrow />
        <StripStep
          step={copy.hero.preview.steps[3].step}
          title={copy.hero.preview.steps[3].title}
          kind="question"
          mono={copy.hero.preview.steps[3].mono}
          icon>
          
          <span>{copy.hero.preview.steps[3].text}</span>
        </StripStep>
      </motion.div>
      <FloatingBadge
        x={badgeX}
        y={badgeY}
        reduced={reduced}
        className="-top-5 left-[7%] hidden sm:block">
        
        <StatusBadge kind="accepted" />
      </FloatingBadge>
      <FloatingBadge
        x={badgeX}
        y={badgeY}
        reduced={reduced}
        className="-bottom-5 right-[9%] hidden sm:block">
        
        <StatusBadge kind="review" />
      </FloatingBadge>
    </div>
  );
}

type FloatingBadgeProps = {
  readonly x: MotionValue<number>;
  readonly y: MotionValue<number>;
  readonly reduced: boolean;
  readonly children: ReactNode;
  readonly className: string;
};

function FloatingBadge({
  x,
  y,
  reduced,
  children,
  className
}: FloatingBadgeProps) {
  return (
    <motion.div
      style={
        reduced
          ? {}
          : {
              x,
              y
            }
      }
      className={`pointer-events-none absolute ${className}`}>
      
      <motion.div
        initial={{
          opacity: 0,
          y: 12,
          scale: 0.94
        }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1
        }}
        transition={{
          duration: 0.5,
          ease: EASE.decel,
          delay: 0.36
        }}>
        
        {children}
      </motion.div>
    </motion.div>
  );
}

type StripKind = 'source' | 'result' | 'question';

type StripStepProps = {
  readonly step: string;
  readonly title: string;
  readonly mono: string;
  readonly kind: StripKind;
  readonly icon?: boolean;
  readonly children: ReactNode;
};

const STEP_STYLES: Record<StripKind, string> = {
  source: 'border-dashed border-border bg-surface text-ink-soft',
  result: 'border-primary/15 bg-soft-teal text-primary',
  question: 'border-action/15 bg-action-soft text-action'
};

function StripStep({
  step,
  title,
  mono,
  kind,
  icon,
  children
}: StripStepProps) {
  return (
    <div className={`rounded-card border p-3 ${STEP_STYLES[kind]}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface/80 text-[11px] font-bold text-navy">
          {step}
        </span>
        {icon && <MessageCircleIcon className="h-4 w-4" aria-hidden />}
      </div>
      <p className="text-[13px] font-bold text-navy">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed">{children}</p>
      <p className="mt-2 font-latin text-[10px] opacity-70">
        <Latin>{mono}</Latin>
      </p>
    </div>
  );
}

function StripArrow() {
  return (
    <div className="flex items-center justify-center">
      <ArrowLeftIcon
        className="h-4 w-4 rotate-90 text-muted md:rotate-0"
        aria-hidden />
      
    </div>
  );
}
