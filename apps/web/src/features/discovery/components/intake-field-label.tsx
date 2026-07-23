import { CircleHelp } from 'lucide-react'
import { Label } from '@/components/ui/label'

export function IntakeFieldLabel({
  htmlFor,
  label,
  help,
  example,
  helpLabel,
  exampleLabel,
  required = false,
}: {
  readonly htmlFor: string
  readonly label: string
  readonly help: string
  readonly example: string
  readonly helpLabel: string
  readonly exampleLabel: string
  readonly required?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor} className="text-sm font-semibold text-navy">
        {label}
        {required ? <span className="ms-1 text-danger" aria-hidden="true">*</span> : null}
      </Label>
      <details className="group relative">
        <summary
          className="grid size-7 cursor-pointer list-none place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-soft-teal hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden"
          aria-label={`${helpLabel}: ${label}`}
        >
          <CircleHelp className="size-4" aria-hidden="true" />
        </summary>
        <div className="absolute left-1/2 z-30 mt-2 w-[min(18rem,calc(100vw-3rem))] -translate-x-1/2 rounded-lg border border-border bg-surface p-3 text-sm leading-6 text-ink-soft shadow-elevated">
          <p>{help}</p>
          <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
            <span className="font-semibold text-primary">{exampleLabel}:</span> {example}
          </p>
        </div>
      </details>
    </div>
  )
}
