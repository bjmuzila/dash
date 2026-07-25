import { Suspense, lazy, useMemo, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell, Card } from "../components/PageCard";
import { OWNER_THEME, TYPE, ownerRgba } from "../lib/theme";
import { CATALOG, GROUPS, findEntry, type CatalogEntry } from "./charts-ui/catalog";
import { ChartErrorBoundary } from "./charts-ui/ErrorBoundary";
import "./charts-ui/charts-ui.css";

/**
 * /owner/charts-ui — Bklit UI test bench.
 *
 * Every component from bklit.com/docs/components rendered against seeded sample
 * data, in CB Edge colours. This is a look-at-it page: nothing here touches app
 * state or the backend. Use it to decide what's worth pulling into a real page.
 *
 * The Bklit source is vendored into src/components/charts by the shadcn CLI —
 * see scripts/add-charts.mjs (`npm run charts:add`). Demos are lazy-loaded, so a
 * component that isn't installed only breaks its own tab.
 */

const demoModules = import.meta.glob("./charts-ui/demos/*.tsx") as Record<
  string,
  () => Promise<{ default: ComponentType }>
>;

const installedFiles = new Set(
  Object.keys(import.meta.glob("../components/charts/*.{ts,tsx}")).map((p) =>
    p.replace("../components/charts/", "").replace(/\.tsx?$/, ""),
  ),
);

function isInstalled(entry: CatalogEntry) {
  return entry.items.every((item) => installedFiles.has(item.replace("@bklit/", "")));
}

export default function ChartsUI() {
  const [params, setParams] = useSearchParams();
  const slug = params.get("c") || CATALOG[0].slug;
  const entry = findEntry(slug) ?? CATALOG[0];

  const installedCount = useMemo(() => CATALOG.filter(isInstalled).length, []);
  const loader = demoModules[`./charts-ui/demos/${entry.slug}.tsx`];
  const Demo = useMemo(() => (loader ? lazy(loader) : null), [loader]);

  const select = (next: string) => setParams({ c: next }, { replace: true });

  return (
    <PageShell>
      <Card
        variant="classic"
        padding={20}
        style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div
              style={{
                fontSize: TYPE.micro,
                fontWeight: 800,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: OWNER_THEME.lightBlue,
              }}
            >
              Component bench
            </div>
            <div style={{ fontSize: TYPE.display, fontWeight: 800, lineHeight: 1.1, marginTop: 4 }}>
              Charts UI
            </div>
            <div style={{ fontSize: TYPE.label, opacity: 0.7, marginTop: 6 }}>
              Bklit UI rendered in owner colours · {installedCount}/{CATALOG.length} installed
            </div>
          </div>

          <a
            href={entry.docs}
            target="_blank"
            rel="noreferrer"
            style={{
              border: `1px solid ${OWNER_THEME.border}`,
              borderRadius: 10,
              padding: "6px 12px",
              fontSize: TYPE.label,
              color: OWNER_THEME.lightBlue,
            }}
          >
            Docs ↗
          </a>
        </div>

        {/* picker */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {GROUPS.map((group) => (
            <div key={group} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: TYPE.micro,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  opacity: 0.45,
                  minWidth: 92,
                }}
              >
                {group}
              </span>
              {CATALOG.filter((c) => c.group === group).map((c) => {
                const active = c.slug === entry.slug;
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => select(c.slug)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      border: `1px solid ${active ? ownerRgba(OWNER_THEME.cyan, 0.55) : OWNER_THEME.border}`,
                      background: active ? ownerRgba(OWNER_THEME.cyan, 0.14) : "transparent",
                      color: active ? "#fff" : "rgba(255,255,255,0.72)",
                      borderRadius: 999,
                      padding: "4px 11px",
                      fontSize: TYPE.label,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "background 0.14s ease, border-color 0.14s ease",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: isInstalled(c) ? OWNER_THEME.green : "rgba(255,255,255,0.18)",
                      }}
                    />
                    {c.title}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* install hint */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {entry.items.map((i) => (
            <code
              key={i}
              style={{
                fontSize: TYPE.micro,
                fontFamily: "var(--font-mono)",
                background: "rgba(0,0,0,0.3)",
                border: `1px solid ${OWNER_THEME.border}`,
                borderRadius: 7,
                padding: "3px 8px",
                opacity: 0.75,
              }}
            >
              npx shadcn@latest add {i}
            </code>
          ))}
        </div>

        {/* the demo — everything Bklit renders lives under .charts-ui-root */}
        <div className="charts-ui-root dark" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div style={{ fontSize: TYPE.label, opacity: 0.7, marginBottom: 14 }}>{entry.description}</div>
          <ChartErrorBoundary items={entry.items} resetKey={entry.slug}>
            <Suspense
              fallback={
                <div
                  style={{
                    height: 260,
                    borderRadius: 14,
                    border: `1px solid ${OWNER_THEME.border}`,
                    background: "rgba(0,0,0,0.2)",
                  }}
                />
              }
            >
              {Demo ? (
                <Demo />
              ) : (
                <div style={{ opacity: 0.6, fontSize: TYPE.label }}>
                  No demo file at src/pages/charts-ui/demos/{entry.slug}.tsx
                </div>
              )}
            </Suspense>
          </ChartErrorBoundary>
        </div>
      </Card>
    </PageShell>
  );
}
