export const authStyles = {
  form: 'flex flex-col gap-4',
  field: 'flex flex-col gap-2',
  input: 'h-11 rounded-lg bg-background px-3 text-[15px]',
  primaryButton:
    'mt-2 h-11 w-full border-2 border-navy shadow-tactile transition hover:translate-y-px hover:shadow-tactile-pressed active:translate-y-px active:shadow-tactile-pressed',
  outlineButton: 'h-11 w-full bg-surface',
  alert:
    'rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-3 text-sm text-destructive',
  success:
    'flex flex-col gap-3 rounded-lg border border-primary/20 bg-soft-teal px-3 py-3 text-sm text-primary',
  quietLink: 'text-center text-sm text-muted-foreground hover:text-primary hover:underline',
  actionLink: 'font-semibold text-action hover:underline',
} as const
