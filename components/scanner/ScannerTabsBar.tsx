"use client";

/**
 * ScannerTabsBar — the /scanner top tab strip, extracted so routes that were
 * split out of /scanner (currently /strike-history) can render the same bar and
 * jump straight back to any scanner tab.
 *
 * Two modes:
 *   onSelect given  → <button>s that flip local tab state (used on /scanner).
 *   onSelect absent → <Link>s to /scanner?tab=<id> (used on standalone routes,
 *                     where there is no local tab state to flip).
 * Strike History is always a link to its own route in either mode — it is a
 * split-out page, not an inline tab.
 *
 * The mobile <select> (globals.css .scanner-tab-select / .scanner-tabs swap one
 * for the other by viewport) travels with the bar so both pages get it.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { useIsOwner } from "@/components/shared/useIsOwner";
import {
  SCANNER_TABS,
  isScannerTabId,
  scannerTabHref,
  type ScannerTabId,
  type ScannerBarActive,
} from "./scannerNav";

// The tab list, ids and helpers moved to ./scannerNav — a plain data module with
// no React / next imports — so the GlobalToolbar's ScannerSubStrip can share the
// exact same list without pulling this component (and next/navigation) into
// every page bundle. Re-exported here so all existing
// `from "@/components/scanner/ScannerTabsBar"` imports keep working unchanged.
export {
  SCANNER_TABS,
  SCANNER_ROUTES,
  SCANNER_GROUPS,
  SCANNER_SECTION_PATHS,
  SCANNER_TAB_EVENT,
  emitScannerTab,
  isScannerSectionPath,
  isScannerTabId,
  scannerTabHref,
  readTabFromUrl,
} from "./scannerNav";
export type { ScannerTabId, ScannerBarActive, TabDef, ScannerRouteDef } from "./scannerNav";

export default function ScannerTabsBar({
  active,
  onSelect,
}: {
  active: ScannerBarActive;
  /** Provide on /scanner to switch tabs in place; omit to navigate instead. */
  onSelect?: (t: ScannerTabId) => void;
}) {
  const router = useRouter();
  // Owner-only tabs (scannerNav's `ownerOnly`) are dropped for everyone else,
  // in both the desktop row and the phone <select>. Same rule SectionSubStrip
  // applies — this bar is legacy, but it must not be the one place a hidden tab
  // still shows.
  const { isOwner } = useIsOwner();
  const tabs = SCANNER_TABS.filter((t) => !t.ownerOnly || isOwner);

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
    if (value === "strikehistory") { router.push("/strike-history"); return; }
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
        {tabs.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
        <option value="strikehistory">Strike History</option>
      </select>

      {/* Top-level tabs */}
      <div className="scanner-tabs" style={{ display: "flex", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        {tabs.map((t) => {
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
        {/* Strike History is its own route (/strike-history) — per-strike net
            GEX + IV skew over time. Split out of /scanner: a tab-styled link,
            never an inline tab. */}
        <Link
          href="/strike-history"
          prefetch={false}
          style={{
            ...tabStyle(true, LIGHT_BLUE),
            color: HOME_THEME.text,
            opacity: active === "strikehistory" ? 1 : 0.95,
          }}
        >
          Strike History
          {active === "strikehistory"
            ? null
            : <span style={{ fontSize: 11, opacity: 0.8 }}>↗</span>}
        </Link>
      </div>
    </>
  );
}
