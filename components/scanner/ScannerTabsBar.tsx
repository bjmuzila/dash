"use client";

/**
 * ScannerTabsBar — the /scanner top tab strip, extracted so routes that were
 * split out of /scanner (currently /forward-build) can render the same bar and
 * jump straight back to any scanner tab.
 *
 * Two modes:
 *   onSelect given  → <button>s that flip local tab state (used on /scanner).
 *   onSelect absent → <Link>s to /scanner?tab=<id> (used on standalone routes,
 *                     where there is no local tab state to flip).
 * Forward Build is always a link to /forward-build in either mode.
 *
 * The mobile <select> (globals.css .scanner-tab-select / .scanner-tabs swap one
 * for the other by viewport) travels with the bar so both pages get it.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";

/** Tabs that render inline on /scanner. */
export type ScannerTabId =
  | "overview" | "gex" | "strike" | "watch" | "marketquality"
  | "tpo" | "ibstats" | "statprompter" | "gexchangetop" | "gexpct";

/** What the bar can mark as current: a /scanner tab, or a split-out route. */
export type ScannerBarActive = ScannerTabId | "forwardbuild" | null;

type TabDef = { id: ScannerTabId; label: string; color: string };

/** Bar order + per-tab accent, matching the original inline markup. */
export const SCANNER_TABS: TabDef[] = [
  { id: "overview",     label: "Overview",       color: HOME_THEME.cyan },
  { id: "gex",          label: "GEX Scanner",    color: HOME_THEME.cyan },
  { id: "strike",       label: "Strike Query",   color: HOME_THEME.cyan },
  { id: "watch",        label: "Watch This",     color: LIGHT_BLUE },
  { id: "marketquality",label: "Market Quality", color: HOME_THEME.orange },
  { id: "tpo",          label: "TPO Structures", color: LIGHT_BLUE },
  { id: "ibstats",      label: "IB Stats",       color: HOME_THEME.green },
  { id: "statprompter", label: "Stat Prompter",  color: LIGHT_BLUE },
  { id: "gexchangetop", label: "GEX Change Top", color: HOME_THEME.orange },
  { id: "gexpct",       label: "GEX%",           color: LIGHT_BLUE },
];

/** Route for a tab when the bar is rendered off /scanner. */
export const scannerTabHref = (id: ScannerTabId) => `/scanner?tab=${id}`;

export function isScannerTabId(v: string | null | undefined): v is ScannerTabId {
  return !!v && SCANNER_TABS.some((t) => t.id === v);
}

/**
 * Reads ?tab= off the current URL without next/navigation's useSearchParams,
 * which would force the whole page under a Suspense boundary at build time.
 * Call from an effect (window is undefined during SSR/prerender).
 */
export function readTabFromUrl(): ScannerTabId | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("tab");
  return isScannerTabId(v) ? v : null;
}

export default function ScannerTabsBar({
  active,
  onSelect,
}: {
  active: ScannerBarActive;
  /** Provide on /scanner to switch tabs in place; omit to navigate instead. */
  onSelect?: (t: ScannerTabId) => void;
}) {
  const router = useRouter();

  const tabStyle = (isActive: boolean, color: string): React.CSSProperties => ({
    padding: "8px 20px", borderRadius: 8, fontSize: 14, cursor: "pointer", fontWeight: 700,
    border: `1px solid ${isActive ? color : "rgba(255,255,255,0.1)"}`,
    background: isActive
      ? (color === HOME_THEME.cyan ? "rgba(33,158,188,0.15)" : `${color}22`)
      : "transparent",
    color: isActive ? HOME_THEME.text : "rgba(255,255,255,0.55)",
    transition: "all 0.15s",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  });

  const go = (value: string) => {
    if (value === "forwardbuild") { router.push("/forward-build"); return; }
    if (!isScannerTabId(value)) return;
    if (onSelect) onSelect(value);
    else router.push(scannerTabHref(value));
  };

  return (
    <>
      {/* Mobile-only: the tab buttons take half the screen on a phone, so swap
          them for a single dropdown (CSS shows exactly one of the two). */}
      <select
        className="scanner-tab-select"
        value={active ?? "gex"}
        onChange={(e) => go(e.target.value)}
        style={{
          display: "none", width: "100%", padding: "8px 10px", borderRadius: 8,
          fontSize: 14, fontWeight: 700, marginBottom: 4,
          border: `1px solid ${HOME_THEME.cyan}`,
          background: "rgba(0,0,0,0.5)", color: HOME_THEME.text,
        }}
      >
        {SCANNER_TABS.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
        <option value="forwardbuild">Forward Build</option>
      </select>

      {/* Top-level tabs */}
      <div className="scanner-tabs" style={{ display: "flex", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        {SCANNER_TABS.map((t) => {
          const isActive = active === t.id;
          return onSelect ? (
            <button key={t.id} onClick={() => onSelect(t.id)} style={tabStyle(isActive, t.color)}>
              {t.label}
            </button>
          ) : (
            <Link key={t.id} href={scannerTabHref(t.id)} prefetch={false} style={tabStyle(isActive, t.color)}>
              {t.label}
            </Link>
          );
        })}
        {/* Forward Build lives on its own route (/forward-build); this tab-styled
            link navigates there instead of rendering inline. */}
        <Link
          href="/forward-build"
          prefetch={false}
          style={{
            ...tabStyle(true, HOME_THEME.orange),
            color: HOME_THEME.text,
            opacity: active === "forwardbuild" ? 1 : 0.95,
          }}
        >
          Forward Build
          {active === "forwardbuild"
            ? null
            : <span style={{ fontSize: 11, opacity: 0.8 }}>↗</span>}
        </Link>
      </div>
    </>
  );
}
