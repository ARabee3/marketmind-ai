import React from 'react';
import { motion } from 'framer-motion';
import { CheckIcon, TargetIcon, XIcon } from 'lucide-react';
import { useLandingCopy } from '../landing-copy-provider';
import { Chip, Eyebrow, Section, StatusBadge } from './ui/Primitives';
import { floatIn } from '../lib/motion';
const SHOP_IMG = "/63d36b5c-0e3c-405d-a588-dfb4af2f657c.jpg";

export function SampleResult() {
  const copy = useLandingCopy();

  return (
    <Section id="sample" tone="base">
      <div className="mb-8 text-center">
        <Eyebrow>{copy.sample.eyebrow}</Eyebrow>
        <h2 className="mt-3 text-[clamp(2.3rem,6vw,4.6rem)] font-bold text-navy">
          {copy.sample.name}
        </h2>
        <p className="mt-2 text-[15px] text-ink-soft">
          {copy.sample.meta}{' '}
          <span className="font-semibold text-warning">{copy.sample.metaEmphasis}</span>
        </p>
      </div>
      <motion.div
        variants={floatIn}
        initial="hidden"
        whileInView="show"
        viewport={{
          once: true,
          margin: '-10%'
        }}
        className="sample-board overflow-hidden rounded-card border border-border shadow-elevated">
        
        <div className="grid md:grid-cols-[0.92fr,1.28fr]">
          <div className="bg-primary p-6 text-white md:p-8">
            <span className="rounded-full border border-white/35 bg-white/10 px-3 py-1 text-[12px] font-bold">
              {copy.sample.fileLabel}
            </span>
            <img
              src={SHOP_IMG}
              alt={copy.sample.imageAlt}
              className="mt-6 h-52 w-full rounded-card object-cover md:h-64" />
            
            <p className="mt-5 text-[15px] leading-[1.8] text-white/85">
              {copy.sample.sourceNote}
            </p>
          </div>
          <div className="p-5 md:p-8">
            <div className="rounded-card border border-primary/20 bg-soft-teal p-4 shadow-sticker">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-navy">
                  {copy.sample.acceptedTitle}
                </span>
                <StatusBadge kind="accepted" />
              </div>
              <p className="flex items-start gap-2 text-[14px] leading-relaxed text-ink-soft">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {copy.sample.acceptedText}
              </p>
            </div>
            <div className="mt-5 rounded-card border border-warning/25 bg-warning/10 p-4 shadow-sticker-warning">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-navy">
                  {copy.sample.discardedTitle}
                </span>
                <StatusBadge kind="discard" />
              </div>
              <p className="flex items-start gap-2 text-[14px] leading-relaxed text-ink-soft">
                <XIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                {copy.sample.discardedText}
              </p>
            </div>
            <div className="mt-5">
              <span className="text-[12px] font-semibold text-muted">
                {copy.sample.competitorTitle}
              </span>
              <div className="mt-2">
                <Chip tone="competitor">{copy.sample.competitorName}</Chip>
              </div>
            </div>
            <div className="mt-5 rounded-card border border-border bg-surface p-4">
                <p className="mb-3 text-[12px] font-bold text-muted">
                {copy.sample.chatTitle}
              </p>
              <div className="space-y-3">
                <ChatBubble side="ai">
                  {copy.sample.aiQuestion}
                </ChatBubble>
                <div className="flex flex-wrap gap-2 pt-1">
                  {copy.sample.suggested.map((answer) =>
                  <AssistedReply key={answer}>{answer}</AssistedReply>
                  )}
                </div>
                <AnswerComposer
                  label={copy.sample.inputLabel}
                  value={copy.sample.inputValue}
                  placeholder={copy.sample.inputPlaceholder}
                  send={copy.sample.send}
                />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <TargetIcon className="h-4 w-4 text-muted" />
              {copy.sample.sourceNotes.map((note) =>
              <span
                key={note}
                className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-ink-soft">
                
                  {note}
                </span>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </Section>);

}
function ChatBubble({
  side,
  children



}: {side: 'ai' | 'owner';children: React.ReactNode;}) {
  const ai = side === 'ai';
  return (
    <div className={`flex ${ai ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-card px-3 py-2 text-[13px] leading-relaxed ${ai ? 'bg-action-soft text-action' : 'bg-soft-teal text-primary'}`}>
        
        {children}
      </div>
    </div>);

}
function AssistedReply({ children }: {children: React.ReactNode;}) {
  return (
    <button
      type="button"
      className="rounded-full border border-primary/25 bg-soft-teal px-3 py-1.5 text-[12px] font-semibold text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
      
      {children}
    </button>);

}
function AnswerComposer({
  label,
  value,
  placeholder,
  send
}: {label: string;value: string;placeholder: string;send: string;}) {
  return (
    <div className="rounded-card border border-border bg-bg p-2">
      <label className="sr-only" htmlFor="sample-answer">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="sample-answer"
          type="text"
          readOnly
          value={value}
          placeholder={placeholder}
          className="min-h-10 flex-1 rounded-card border border-border bg-surface px-3 text-[12px] text-ink-soft outline-none placeholder:text-muted focus:ring-2 focus:ring-action"
        />
        <button
          type="button"
          className="rounded-full bg-primary px-4 py-2 text-[12px] font-bold text-white">
          
          {send}
        </button>
      </div>
    </div>);

}
