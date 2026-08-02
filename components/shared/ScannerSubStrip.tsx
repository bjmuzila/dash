"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HOME_THEME } from "./homeTheme";
import {
  SCANNER_GROUPS,
  SCANNER_ROUTES,
  SCANNER_TABS,
  SCANNER_TAB_EVENT,
  emitScannerTab,
  isScannerSectionPath,
  readTabFromUrl,
  scannerTabHref,
  type ScannerTabId,
} from "@/components/scanner/scannerNav";

/**
 * ScannerSubStrip — the Scanner section's tab bar, promoted into the app chrome.
 *
 * A single non-wrapping row welded to the bottom edge of the GlobalToolbar pill.
 * It exists only while the user is inside the Scanner section (/scanner and its
 * split-out sibling routes) and is collapsed/expanded by clicking the Scanner
 * circle in the toolbar nav strip.
 *
 * Layout, left → right:
 *   [🧭 Overview] │ gamma pills │ structure pills │ watch + split-out routes ↗
 *
 * Fitting: the row never wraps and never clips a whole item. When it runs out of
 * width, pills shed their text label right-to-left (icon + tooltip remain). If
 * even the all-icon row overflows, the row becomes horizontally scrollable
 * rather than hiding anything.
 *
 * Everything here is driven by components/scanner/scannerNav — the same list the
 * on-page ScannerTabsBar renders — so the two can never drift.
 */

const CYAN = HOME_THEME.cyan;
function cyanA(a: number) { return `rgba(33,158,188,${a})`; }

/** Pixel height of the open strip's content row (pills + vertical padding). */
const STRIP_H = 58;

type PillProps = {
  href: string;
  label: string;
  short: string;
  color: string;
  icon: string;
  active: boolean;
  external?: boolean;
  onClick?: () => void;
};

/**
 * One pill. Styling intentionally mirrors ScannerTabsBar's `tabStyle()` so the
 * strip and the on-page bar read as the same control — the only additions are
 * the leading icon and the collapse-to-icon behaviour (data-mini, set by the
 * fit pass in the parent and styled by the stylesheet below).
 */
function Pill({ href, label, short, color, icon, active, external, onClick }: PillProps) {
  // Cast at the end so the CSS custom property (read by the :hover rule below,
  // which is how each pill hovers in its own accent without a per-pill JS
  // handler) doesn't trip CSSProperties' excess-property check.
  const style = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    padding: "6px 11px",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 700,
    whiteSpace: "nowrap",
    textDecoration: "none",
    border: `1px solid ${active ? color : "rgba(255,255,255,0.1)"}`,
    background: active ? (color === CYAN ? cyanA(0.15) : `${color}22`) : "transparent",
    color: active ? HOME_THEME.text : "rgba(255,255,255,0.55)",
    "--pill-accent": color,
    transition: "all 0.15s",
  } as React.CSSProperties;

  return (
    <Link
      href={href}
      prefetch={false}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-scanner-pill
      data-mini="0"
      className="cb-scanner-pill"
      style={style}
    >
      <span aria-hidden style={{ fontSize: 12.5, lineHeight: 1 }}>{icon}</span>
      <span className="cb-scanner-pill-text">
        {short}
        {external && <span style={{ fontSize: 9.5, opacity: 0.65, marginLeft: 3 }}>↗</span>}
      </span>
    </Link>
  );
}

export default function ScannerSubStrip({ open }: { open: boolean }) {
  const pathname = usePathname();
  const inSection = isScannerSectionPath(pathname);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Which pill is current. On /scanner that's the ?tab= value (defaulting to
  // "gex", matching ScannerPage's initial state); on a split-out route it's the
  // route itself.
  const [activeTab, setActiveTab] = useState<ScannerTabId>("gex");

  const syncFromUrl = useCallback(() => {
    setActiveTab(readTabFromUrl() ?? "gex");
  }, []);

  useEffect(() => { syncFromUrl(); }, [pathname, syncFromUrl]);

  // Pills fire this on click so the highlight moves immediately, even when the
  // query-string-only navigation doesn't remount anything.
  useEffect(() => {
    const onTab = (e: Event) => {
      const id = (e as CustomEvent<ScannerTabId>).detail;
      if (id) setActiveTab(id);
    };
    window.addEventListener(SCANNER_TAB_EVENT, onTab);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener(SCANNER_TAB_EVENT, onTab);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, [syncFromUrl]);

  /**
   * Fit pass: shed pill labels from the right until the row stops overflowing.
   * Done by writing data-mini directly on the nodes rather than through state —
   * it is a pure measure-then-adjust loop, and routing it through React would
   * mean a render per shed pill (and a measurement feedback loop).
   */
  const fit = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const pills = Array.from(row.querySelectorAll<HTMLElement>("[data-scanner-pill]"));
    if (!pills.length) return;
    pills.forEach((p) => { p.dataset.mini = "0"; });
    const over = () => row.scrollWidth > row.clientWidth + 1;
    for (let i = pills.length - 1; i >= 0 && over(); i--) {
      pills[i].dataset.mini = "1";
    }
    // Still too wide even all-icon (very narrow window): let it scroll instead
    // of clipping a pill in half.
    row.style.overflowX = over() ? "auto" : "hidden";
  }, []);

  // Re-measure after every render (pill set / labels can change), on resize, and
  // once the expand transition has finished changing the row's width.
  useLayoutEffect(() => { fit(); });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", fit);
    const t = window.setTimeout(fit, 320);
    return () => {
      window.removeEventListener("resize", fit);
      window.clearTimeout(t);
    };
  }, [fit, open]);

  // Off the Scanner section there is nothing to show. Unmounted rather than
  // collapsed so it costs nothing on every other page.
  if (!inSection) return null;

  const overviewActive = activeTab === "overview";
  const tabById = (id: ScannerTabId) => SCANNER_TABS.find((t) => t.id === id);
  const routeByHref = (href: string) => SCANNER_ROUTES.find((r) => r.href === href);
  const currentPath = (pathname || "").replace(/^\/app(?=\/|$)/, "") || "/";

  return (
    <div
      aria-hidden={!open}
      style={{
        // Inset so it reads as hanging off the pill above rather than a second
        // full-width bar.
        margin: "0 18px",
        overflow: "hidden",
        maxHeight: open ? STRIP_H : 0,
        opacity: open ? 1 : 0,
        padding: open ? "9px 14px 10px" : "0 14px",
        border: `1px solid ${open ? HOME_THEME.border : "transparent"}`,
        borderTop: "none",
        borderRadius: "0 0 16px 16px",
        background: "rgba(10,13,20,0.94)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxSizing: "border-box",
        transition: "max-height 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.2s, padding 0.28s",
        position: "relative",
        zIndex: 49,
      }}
    >
      <style>{`
        .cb-scanner-pill[data-mini="1"] .cb-scanner-pill-text { display: none; }
        .cb-scanner-pill[data-mini="1"] { padding-left: 8px; padding-right: 8px; gap: 0; }
        .cb-scanner-pill:hover {
          color: #fff !important;
          border-color: var(--pill-accent) !important;
          background: color-mix(in srgb, var(--pill-accent) 14%, transparent) !important;
          transform: translateY(-1px);
        }
        .cb-scanner-row::-webkit-scrollbar { height: 0; }
        .cb-scanner-row { scrollbar-width: none; }
      `}</style>

      <div
        ref={rowRef}
        className="cb-scanner-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          flexWrap: "nowrap",
          minWidth: 0,
          overflowX: "hidden",
          overflowY: "hidden",
        }}
      >
        {/* Overview is pinned first and styled solid: the "just open the page"
            target should never be one of the things that collapses to an icon. */}
        <Link
          href={scannerTabHref("overview")}
          prefetch={false}
          onClick={() => emitScannerTab("overview")}
          title="Scanner overview"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            padding: "6px 12px",
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 800,
            whiteSpace: "nowrap",
            textDecoration: "none",
            border: `1px solid ${CYAN}`,
            background: cyanA(overviewActive ? 0.28 : 0.15),
            color: HOME_THEME.text,
          }}
        >
          <span aria-hidden>🧭</span>
          <span>Overview</span>
        </Link>

        {SCANNER_GROUPS.map((g, gi) => (
          <Fragment key={g.key}>
            <span
              aria-hidden
              style={{
                width: 1,
                height: 20,
                background: HOME_THEME.border,
                flexShrink: 0,
                margin: "0 4px",
              }}
            />
            {g.tabs.map((id) => {
              const t = tabById(id);
              if (!t) return null;
              return (
                <Pill
                  key={id}
                  href={scannerTabHref(id)}
                  label={t.label}
                  short={t.short ?? t.label}
                  color={t.color}
                  icon={t.icon}
                  active={activeTab === id && currentPath.startsWith("/scanner")}
                  onClick={() => emitScannerTab(id)}
                />
              );
            })}
            {(g.routes ?? []).map((href) => {
              const r = routeByHref(href);
              if (!r) return null;
              return (
                <Pill
                  key={href}
                  href={href}
                  label={r.label}
                  short={r.short}
                  color={r.color}
                  icon={r.icon}
                  external
                  active={currentPath === href || currentPath.startsWith(href + "/")}
                />
              );
            })}
            {gi === SCANNER_GROUPS.length - 1 && <span style={{ flex: 1, minWidth: 0 }} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
