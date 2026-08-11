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
    <header className="border-b border-border/80 pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.18em] text-primary uppercase">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            {eyebrow}
          </p>
          <h1 className="mt-2 text-balance text-2xl font-bold tracking-tight text-navy md:text-3xl">
            {title}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {action}
      </div>
    </header>
  )
}
