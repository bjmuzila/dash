import { Suspense, lazy, useEffect, useMemo, useState, type ComponentType } from "react"
import { CATALOG, GROUPS, findEntry, type CatalogEntry } from "./catalog"
import { ErrorBoundary } from "./components/error-boundary"
import { cn } from "./lib/utils"

/* ------------------------------------------------------------------ *
 * Demos are loaded lazily so one missing @bklit component only breaks
 * its own route instead of the whole app.
 * ------------------------------------------------------------------ */
const demoModules = import.meta.glob("./demos/*.tsx") as Record<
  string,
  () => Promise<{ default: ComponentType }>
>

/* Which chart files actually landed in src/components/charts */
const installedFiles = new Set(
  Object.keys(import.meta.glob("./components/charts/*.{ts,tsx}")).map((p) =>
    p.replace("./components/charts/", "").replace(/\.tsx?$/, ""),
  ),
)

function isInstalled(entry: CatalogEntry) {
  return entry.items.every((item) => installedFiles.has(item.replace("@bklit/", "")))
}

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(2) || "")
  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(2) || "")
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  return hash
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem("testui-theme", dark ? "dark" : "light")
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}

export default function App() {
  const route = useHashRoute()
  const { dark, toggle } = useTheme()
  const [query, setQuery] = useState("")

  const entry = route ? findEntry(route) : undefined
  const installedCount = useMemo(() => CATALOG.filter(isInstalled).length, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return CATALOG
    return CATALOG.filter(
      (c) => c.title.toLowerCase().includes(q) || c.slug.includes(q) || c.group.toLowerCase().includes(q),
    )
  }, [query])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[1600px]">
        {/* Sidebar */}
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-border/60 lg:flex">
          <div className="border-b border-border/60 px-5 py-4">
            <a href="#/" className="block">
              <div className="text-sm font-semibold tracking-tight">Bklit UI · testui</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {installedCount}/{CATALOG.length} installed
              </div>
            </a>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter components…"
              className="mt-3 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {GROUPS.map((group) => {
              const items = filtered.filter((c) => c.group === group)
              if (!items.length) return null
              return (
                <div key={group} className="mb-5">
                  <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </div>
                  {items.map((c) => (
                    <a
                      key={c.slug}
                      href={`#/${c.slug}`}
                      className={cn(
                        "flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
                        route === c.slug
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <span>{c.title}</span>
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          isInstalled(c) ? "bg-emerald-500" : "bg-border",
                        )}
                        title={isInstalled(c) ? "installed" : "not installed"}
                      />
                    </a>
                  ))}
                </div>
              )
            })}
          </nav>

          <button
            onClick={toggle}
            className="border-t border-border/60 px-5 py-3 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            {dark ? "☾ Dark" : "☀ Light"} · click to switch
          </button>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">
          {entry ? <DemoPage entry={entry} /> : <Home />}
        </main>
      </div>
    </div>
  )
}

function Home() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Bklit UI test bench</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every component from{" "}
        <a
          className="underline underline-offset-4"
          href="https://bklit.com/docs/components"
          target="_blank"
          rel="noreferrer"
        >
          bklit.com/docs/components
        </a>{" "}
        rendered against seeded sample data. Green dot = the registry item is present in{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">src/components/charts</code>.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {CATALOG.map((c) => (
          <a
            key={c.slug}
            href={`#/${c.slug}`}
            className="group rounded-xl border border-border/70 p-4 transition-colors hover:border-ring/60 hover:bg-accent/30"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isInstalled(c) ? "bg-emerald-500" : "bg-border",
                )}
              />
              <div className="text-sm font-medium">{c.title}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{c.description}</div>
            <div className="mt-2 font-mono text-[10px] text-muted-foreground/70">
              {c.items.join("  ")}
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

function DemoPage({ entry }: { entry: CatalogEntry }) {
  const loader = demoModules[`./demos/${entry.slug}.tsx`]
  const Demo = useMemo(
    () => (loader ? lazy(loader) : null),
    [loader],
  )

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{entry.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>
        </div>
        <a
          href={entry.docs}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Docs ↗
        </a>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {entry.items.map((i) => (
          <code key={i} className="rounded bg-muted px-2 py-1 font-mono text-[11px]">
            npx shadcn@latest add {i}
          </code>
        ))}
      </div>

      <div className="mt-8">
        <ErrorBoundary items={entry.items} resetKey={entry.slug}>
          <Suspense
            fallback={
              <div className="h-64 animate-pulse rounded-xl border border-border/60 bg-muted/30" />
            }
          >
            {Demo ? <Demo /> : <MissingDemo slug={entry.slug} />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}

function MissingDemo({ slug }: { slug: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
      No demo file at <code className="font-mono text-xs">src/demos/{slug}.tsx</code> yet.
    </div>
  )
}
