import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Frame({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("mb-8 rounded-xl border border-border/70 bg-card/40", className)}>
      <header className="flex items-baseline justify-between gap-4 border-b border-border/60 px-4 py-2.5">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>
}
