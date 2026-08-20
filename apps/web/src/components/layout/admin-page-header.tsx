import type { ReactNode } from "react"

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <header className="relative overflow-hidden rounded-xl bg-navy px-5 py-6 text-primary-foreground shadow-elevated md:px-7 md:py-8">
      <div className="pointer-events-none absolute -top-24 end-6 h-56 w-56 rounded-full bg-primary/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 start-10 h-56 w-56 rounded-full bg-journey-mint/20 blur-3xl" />
      <div className="relative grid gap-3">
        <p className="text-xs font-semibold tracking-[0.14em] text-journey-mint uppercase">
          {eyebrow}
        </p>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-2">
            <h1 className="max-w-3xl text-3xl leading-tight font-bold text-primary-foreground md:text-4xl lg:text-5xl">
              {title}
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-primary-foreground/75 md:text-base">
              {description}
            </p>
          </div>
          {action ? (
            <div className="flex flex-col gap-2 sm:flex-row md:justify-end">
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
