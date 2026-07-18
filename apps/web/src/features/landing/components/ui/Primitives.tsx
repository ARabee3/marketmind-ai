import type { ReactNode } from 'react';
import {
  CheckIcon,
  EyeIcon,
  XIcon,
  MessageSquareTextIcon,
  type LucideIcon } from
'lucide-react';
type StatusKind = 'accepted' | 'review' | 'discard' | 'inference';
const STATUS_MAP: Record<
  StatusKind,
  {
    icon: LucideIcon;
    className: string;
  }> =
{
  accepted: {
    icon: CheckIcon,
    className: 'border-primary/25 bg-soft-teal text-primary'
  },
  review: {
    icon: EyeIcon,
    className: 'border-warning/25 bg-warning/10 text-warning'
  },
  discard: {
    icon: XIcon,
    className: 'border-warning/30 bg-warning/10 text-warning'
  },
  inference: {
    icon: MessageSquareTextIcon,
    className: 'border-action/25 bg-action-soft text-action'
  }
};
export function StatusBadge({
  kind,
  label,
  className = ''





}: {kind: StatusKind;label: string;className?: string;}) {
  const cfg = STATUS_MAP[kind];
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${cfg.className} ${className}`}>

      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span>{label}</span>
    </span>);

}
export function Chip({
  children,
  tone = 'neutral',
  className = ''




}: {children: ReactNode;tone?: 'neutral' | 'competitor' | 'signal';className?: string;}) {
  const tones = {
    neutral: 'border-border bg-surface text-ink-soft',
    competitor: 'border-warning/30 bg-warning/10 text-warning',
    signal: 'border-primary/30 bg-soft-teal text-primary'
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 font-latin text-[11px] font-semibold ${tones[tone]} ${className}`}>
      
      {children}
    </span>);

}
export function Eyebrow({
  children,
  inverse = false



}: {children: ReactNode;inverse?: boolean;}) {
  return (
    <span
      className={`inline-block text-[12px] font-bold tracking-[0.12em] ${inverse ? 'text-journey-mint' : 'text-primary'}`}>
      
      {children}
    </span>);

}
export function Latin({ children }: {children: ReactNode;}) {
  return <span className="bidi-iso font-latin">{children}</span>;
}
type SectionTone = 'base' | 'surface' | 'soft' | 'journey';
const SECTION_BG: Record<SectionTone, string> = {
  base: 'bg-bg',
  surface: 'bg-surface',
  soft: 'bg-soft-teal',
  journey: 'bg-navy'
};
export function Section({
  id,
  tone = 'base',
  children,
  className = ''





}: {id?: string;tone?: SectionTone;children: ReactNode;className?: string;}) {
  return (
    <section
      id={id}
      className={`relative w-full scroll-mt-24 ${SECTION_BG[tone]} px-4 py-[72px] sm:px-6 md:py-[96px] ${className}`}>
      
      <div className="mx-auto w-full max-w-content">{children}</div>
    </section>);

}
