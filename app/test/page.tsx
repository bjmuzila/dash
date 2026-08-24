"use client";

import { useEffect, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { PageShell } from "@/components/shared/PageCard";
import { SqueezeBoard } from "@/app/squeeze/page";
import DealerGammaTab from "./DealerGammaTab";
import GexMapTab from "./GexMapTab";
// Lives in components/, not here: the same view is mounted on the PUBLIC
// /explore/seasonality page. See the header of SeasonalityView.tsx.
import SeasonalityView from "@/components/seasonality/SeasonalityView";

// ─────────────────────────────────────────────────────────────────────────────
// /test — Test Lab.
//
// This route had no page. `page.tsx` was renamed to `page.tsx.bak` at some
// point, which deleted the route from the build while leaving its tab
// components — GexMapTab.tsx, DealerGammaTab.tsx — sitting in the folder,
// tracked, compiled by nothing. The deployed image still served /test because
// it was built before the rename, so the page kept answering while every later
// edit to those tabs went nowhere. This file puts the route back.
//
// What is mounted here is what still EXISTS as a live component: the GEX Map,
// Dealer Gamma, and the Squeeze board (imported from /squeeze, the same way the
// old page did it). The Overview / GEX Levels / Flow Inventory tabs live only
// inside page.tsx.bak and are deliberately not revived here — that is 120KB of
// unreviewed code, and reviving it is a decision, not a side effect of fixing
// the route.
//
// HYDRATION: the active tab starts from a CONSTANT, never from the URL hash or
// localStorage. Seeding initial state from either makes the server render one
// tab and the client another, which is React #418 on every hard refresh. The
// hash is read in an effect, after hydration, and written on every change — so
// deep links still work and the first paint is identical on both sides.
// ─────────────────────────────────────────────────────────────────────────────

type TestTab = "gexmap" | "dealergamma" | "squeeze" | "seasonality";

const TABS: { key: TestTab; label: string; hash: string }[] = [
  { key: "gexmap", label: "GEX Map", hash: "gex-map" },
  { key: "dealergamma", label: "Dealer Gamma", hash: "dealer-gamma" },
  { key: "squeeze", label: "Squeeze", hash: "squeeze" },
  { key: "seasonality", label: "Seasonality", hash: "seasonality" },
];

const tabForHash = (h: string): TestTab | null =>
  TABS.find((t) => t.hash === h.replace(/^#/, ""))?.key ?? null;

function TestTabBar({ active, onChange }: { active: TestTab; onChange: (tab: TestTab) => void }) {
  return (
    <>
      {/* Mobile-only: a dropdown instead of the oversized button row. globals.css
          swaps which of the two is displayed (.test-tab-select / .test-tabs). */}
      <select
        className="test-tab-select"
        aria-label="Test Lab tab"
        value={active}
        onChange={(e) => onChange(e.target.value as TestTab)}
        style={{
          display: "none", width: "100%", padding: "8px 10px", borderRadius: 8,
          fontSize: 14, fontWeight: 700,
          border: `1px solid ${HOME_THEME.cyan}`,
          background: "rgba(0,0,0,0.5)", color: HOME_THEME.text,
        }}
      >
        {TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <div className="tab-strip test-tabs" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(t.key)}
              style={{
                padding: "10px 22px",
                borderRadius: 8,
                border: `1px solid ${isActive ? HOME_THEME.cyan : HOME_THEME.border}`,
                background: isActive
                  ? `linear-gradient(180deg, ${HOME_THEME.cyan}33, ${HOME_THEME.cyan}0D)`
                  : "rgba(255,255,255,0.04)",
                color: isActive ? HOME_THEME.cyan : HOME_THEME.text,
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function TestPage() {
  const [tab, setTab] = useState<TestTab>("gexmap");

  // Deep link, applied after hydration. Also follows back/forward.
  useEffect(() => {
    const apply = () => {
      const t = tabForHash(window.location.hash);
      if (t) setTab(t);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const select = (next: TestTab) => {
    setTab(next);
    const hash = TABS.find((t) => t.key === next)?.hash;
    // replaceState, not `location.hash =` — the latter pushes a history entry
    // per tab click, so Back walks the tab strip instead of leaving the page.
    if (hash && typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${hash}`);
    }
  };

  return (
    <PageShell>
      <TestTabBar active={tab} onChange={select} />
      {tab === "gexmap" ? (
        <GexMapTab />
      ) : tab === "dealergamma" ? (
        <DealerGammaTab />
      ) : tab === "seasonality" ? (
        <SeasonalityView />
      ) : (
        <SqueezeBoard />
      )}
    </PageShell>
  );
}
