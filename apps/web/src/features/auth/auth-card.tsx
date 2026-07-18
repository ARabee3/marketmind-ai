import type { ReactNode } from 'react'

type AuthCardProps = {
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
  readonly footer?: ReactNode
}

export function AuthCard({
  title,
  description,
  children,
  footer,
}: AuthCardProps) {
  return (
    <section className="w-full max-w-[460px] rounded-xl border border-border bg-surface p-5 shadow-elevated md:p-6">
      <header className="mb-5 grid gap-2 text-center">
        <h1 className="text-2xl leading-tight font-bold text-navy md:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>

      <div>{children}</div>

      {footer ? (
        <footer className="mt-5 border-t border-border pt-4 text-center text-sm text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </section>
  )
}
