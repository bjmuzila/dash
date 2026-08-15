// /replay — the replay hub. ONE page, one tab per rewindable surface.
//
// The replays were scattered: the chain ladder lived here, the GEX-levels
// ladders inside the /analytics Ticker Lookup, the four-panel rewind inside
// /mult-greek, the full grid inside /options-chain. Each is still reachable in
// its own page (nothing was removed — rewinding in context is the point of
// having it there); this page is the place you go when replay itself is the
// thing you want, without having to remember which page hides which one.
//
// Two shapes of tab, and the difference matters:
//   • FRAMED  — a component small enough to sit in a Card inside our PageShell
//               (the chain ladder, the GEX-levels card).
//   • FULL    — a whole page component that renders its OWN PageShell
//               (Multi Greek, Options Chain). Wrapping those in a second shell
//               would double the padding and nest a scroll container inside a
//               scroll container, so they get the tab bar and the rest of the
//               viewport, nothing else.
//
// Everything except the chain ladder is lazy(): mounting this page should not
// pull Multi Greek's and Options Chain's chunks down before you pick them.

"use client";

import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";
import { HOME_THEME as HT, homeShellStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ChainReplay } from "@/components/shared/ChainReplay";

// The Ticker Lookup card — the SAME component /analytics mounts, imported not
// copied. A second copy would be a second opinion about the same walls.
const TickerLookupCard = lazy(() =>
  import("@/components/pages/Analytics").then((m) => ({ default: m.TickerLookupCard })),
);
const MultGreekClient = lazy(() =>
  import("@/app/mult-greek/MultGreekClient").then((m) => ({ default: m.MultGreekClient })),
);
const OptionsChainPage = lazy(() => import("@/components/pages/OptionsChain"));

type TabId = "chain-ladder" | "gex-levels" | "mult-greek" | "options-chain";

interface TabDef {
  id: TabId;
  label: string;
  /** Card header, framed tabs only. */
  title: string;
  /** One line under the header saying what this replay actually shows. */
  blurb: string;
  /** true = the tab renders its own PageShell and takes the whole viewport. */
  full: boolean;
}

const TABS: TabDef[] = [
  {
    id: "chain-ladder",
    label: "Chain ladder",
    title: "Option chain replay",
    blurb: "Per-strike net GEX for one expiry, played through the session. Its own symbol and date pickers.",
    full: false,
  },
  {
    id: "gex-levels",
    label: "GEX levels",
    title: "GEX levels replay",
    blurb: "The Ticker Lookup's two ladders — one expiry beside the whole board ex-0DTE — with the walls and gamma flip they imply.",
    full: false,
  },
  {
    id: "mult-greek",
    label: "Multi Greek",
    title: "Multi Greek replay",
    blurb: "Four tickers rewound off one shared clock.",
    full: true,
  },
  {
    id: "options-chain",
    label: "Options chain",
    title: "Options chain replay",
    blurb: "The full grid — every strike and column — rewound.",
    full: true,
  },
];

const DEFAULT_TAB: TabId = "chain-ladder";

/** `#tab=<id>` if it names a real tab, else null. Hash, not a route param: this
 *  page is one route in App.tsx and the tab is a view of it, not a location. */
function tabFromHash(): TabId | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#/, "");
  const id = new URLSearchParams(raw).get("tab");
  return TABS.some((t) => t.id === id) ? (id as TabId) : null;
}

const tabBtn = (active: boolean): CSSProperties => ({
  padding: "7px 14px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 800,
  fontFamily: "inherit",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: active ? "#0b0f1a" : HT.text,
  background: active ? HT.cyan : "rgba(255,255,255,0.05)",
  border: `1px solid ${active ? HT.cyan : HT.border}`,
  transition: "background 0.15s, color 0.15s",
});

const fallback = (
  <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.55)", fontSize: 13, letterSpacing: "0.08em" }}>
    LOADING REPLAY…
  </div>
);

export default function ReplayPage() {
  const [tab, setTab] = useState<TabId>(DEFAULT_TAB);

  // Read the hash AFTER mount, never in the initializer: the Next server render
  // and the first client render have to agree, and the server has no location.
  useEffect(() => {
    const fromHash = tabFromHash();
    if (fromHash) setTab(fromHash);
    const onHash = () => {
      const next = tabFromHash();
      if (next) setTab(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = useCallback((id: TabId) => {
    setTab(id);
    // Linkable and back-button-able. Assigning the same value is a no-op, so
    // the hashchange this fires lands on the state we just set.
    if (typeof window !== "undefined") window.location.hash = `tab=${id}`;
  }, []);

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  const tabBar = (
    <div
      role="tablist"
      aria-label="Replay surfaces"
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === tab}
          onClick={() => select(t.id)}
          style={tabBtn(t.id === tab)}
          title={t.blurb}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // FULL tabs: the embedded page brings its own shell, so this one contributes
  // the tab bar and then gets out of the way. `minHeight: 0` on both the column
  // and the pane is what lets the embedded page's internal scroller size itself
  // instead of pushing the tab bar off the top.
  if (active.full) {
    return (
      <div style={{ ...homeShellStyle, display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
        <div style={{ padding: "12px clamp(14px, 2vw, 24px) 0", flexShrink: 0 }}>{tabBar}</div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Suspense fallback={fallback}>
            {active.id === "mult-greek" ? <MultGreekClient /> : <OptionsChainPage />}
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <PageShell>
      {tabBar}
      <Card variant="budget" title={active.title} subtitle={active.blurb}>
        <Suspense fallback={fallback}>
          {/* No symbol prop: ChainReplay picks MSFT if it was recorded and the
              first recorded symbol otherwise, and carries its own picker. A
              hardcoded default here would just be a second place to be wrong. */}
          {active.id === "chain-ladder" ? <ChainReplay embedded /> : <TickerLookupCard embedded />}
        </Suspense>
      </Card>
    </PageShell>
  );
}
