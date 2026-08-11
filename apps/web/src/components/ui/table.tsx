import { cn } from "@/lib/utils"

export function Table({
  className,
  ...props
}: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-auto">
      <table
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

export function TableHeader({
  className,
  ...props
}: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-muted/40", className)} {...props} />
}

export function TableBody({
  className,
  ...props
}: React.ComponentProps<"tbody">) {
  return <tbody className={className} {...props} />
}

export function TableRow({
  className,
  ...props
}: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/40",
        className,
      )}
      {...props}
    />
  )
}

export function TableHead({
  className,
  ...props
}: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 px-4 text-start align-middle text-xs font-semibold text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({
  className,
  ...props
}: React.ComponentProps<"td">) {
  return (
    <td
      className={cn("px-4 py-2.5 align-middle", className)}
      {...props}
    />
  )
}
