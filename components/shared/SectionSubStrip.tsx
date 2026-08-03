"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HOME_THEME } from "./homeTheme";
import {
  emitSectionTab,
  normalizePath,
  readSectionTab,
  sectionForPath,
  sectionTabHref,
  type SectionNav,
} from "./sectionNav";

/**
 * SectionSubStrip — a section's tab bar, promoted into the app chrome.
 *
 * A single non-wrapping row welded to the bottom edge of the GlobalToolbar pill.
 * It appears only while the user is inside a section that declares one (see
 * sectionNav: Scanner and Test Lab today) and is collapsed/expanded by clicking
 * that section's circle in the toolbar nav strip.
 *
 * Layout, left → right: cluster │ cluster │ cluster, split-out routes marked ↗.
 *
 * This is the ONLY tab bar for the sections that use it — their on-page tab
 * strips were removed, along with their "Overview" landing tabs, whose only job
 * was linking to the other tabs. Each section opens straight on its real default.
 *
 * Fitting: the row never wraps and never clips a whole item. When it runs out of
 * width, pills shed their text label right-to-left (icon + tooltip remain); if
 * even the all-icon row overflows, the row scrolls horizontally.
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
 * One pill. Styling deliberately mirrors the tab buttons these replaced, so the
 * strip reads as the same control the pages used to render — the additions are
 * the leading icon and the collapse-to-icon behaviour (data-mini, written by the
 * fit pass below and styled by the stylesheet).
 */
function Pill({ href, label, short, color, icon, active, external, onClick }: PillProps) {
  // Cast at the end so the CSS custom property (read by the :hover rule, which
  // is how each pill hovers in its own accent without a per-pill JS handler)
  // doesn't trip CSSProperties' excess-property check.
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
      data-section-pill
      data-mini="0"
      className="cb-section-pill"
      style={style}
    >
      <span aria-hidden style={{ fontSize: 12.5, lineHeight: 1 }}>{icon}</span>
      <span className="cb-section-pill-text">
        {short}
        {external && <span style={{ fontSize: 9.5, opacity: 0.65, marginLeft: 3 }}>↗</span>}
      </span>
    </Link>
  );
}

export default function SectionSubStrip({ open }: { open: boolean }) {
  const pathname = usePathname();
  const section: SectionNav | null = sectionForPath(pathname);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Which pill is current. On the section root that's the ?tab= value (falling
  // back to the section's default, matching what the page itself renders); on a
  // split-out route it's the route.
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const syncFromUrl = useCallback(() => {
    if (!section) return;
    setActiveTab(readSectionTab(section) ?? section.defaultTab);
  }, [section]);

  useEffect(() => { syncFromUrl(); }, [pathname, syncFromUrl]);

  // Pills fire the section event on click so the highlight moves immediately,
  // even when a query-string-only navigation remounts nothing.
  useEffect(() => {
    if (!section) return;
    const onTab = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setActiveTab(id);
    };
    window.addEventListener(section.event, onTab);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener(section.event, onTab);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, [section, syncFromUrl]);

  /**
   * Fit pass: shed pill labels from the right until the row stops overflowing.
   * Written straight onto the nodes rather than through state — it's a pure
   * measure-then-adjust loop, and routing it through React would mean a render
   * per shed pill (and a measurement feedback loop).
   */
  const fit = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const pills = Array.from(row.querySelectorAll<HTMLElement>("[data-section-pill]"));
    if (!pills.length) return;
    pills.forEach((p) => { p.dataset.mini = "0"; });
    const over = () => row.scrollWidth > row.clientWidth + 1;
    for (let i = pills.length - 1; i >= 0 && over(); i--) {
      pills[i].dataset.mini = "1";
    }
    // Still too wide even all-icon (phone): scroll rather than clip a pill.
    row.style.overflowX = over() ? "auto" : "hidden";
  }, []);

  // Re-measure after every render (the pill set changes with the section), on
  // resize, and once the expand transition has finished changing the row width.
  useLayoutEffect(() => { fit(); });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", fit);
    const t = window.setTimeout(fit, 320);
    return () => {
      window.removeEventListener("resize", fit);
      window.clearTimeout(t);
    };
  }, [fit, open, pathname]);

  // Outside a section there is nothing to show. Unmounted rather than collapsed
  // so it costs nothing on every other page.
  if (!section) return null;

  const tabById = (id: string) => section.tabs.find((t) => t.id === id);
  const routeByHref = (href: string) => section.routes.find((r) => r.href === href);
  const currentPath = normalizePath(pathname);
  const onRoot = currentPath === section.rootPath || currentPath.startsWith(section.rootPath + "/");

  return (
    <div
      aria-hidden={!open}
      style={{
        // Inset so it reads as hanging off the pill above rather than as a
        // second full-width bar.
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
        .cb-section-pill[data-mini="1"] .cb-section-pill-text { display: none; }
        .cb-section-pill[data-mini="1"] { padding-left: 8px; padding-right: 8px; gap: 0; }
        .cb-section-pill:hover {
          color: #fff !important;
          border-color: var(--pill-accent) !important;
          background: color-mix(in srgb, var(--pill-accent) 14%, transparent) !important;
          transform: translateY(-1px);
        }
        .cb-section-row::-webkit-scrollbar { height: 0; }
        .cb-section-row { scrollbar-width: none; }
      `}</style>

      <div
        ref={rowRef}
        className="cb-section-row"
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
        {section.groups.map((g, gi) => (
          <Fragment key={g.key}>
            {/* Hairline between clusters — skipped before the first so the row
                doesn't open with a stray divider. */}
            {gi > 0 && (
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
            )}
            {g.tabs.map((id) => {
              const t = tabById(id);
              if (!t) return null;
              return (
                <Pill
                  key={id}
                  href={sectionTabHref(section, id)}
                  label={t.label}
                  short={t.short ?? t.label}
                  color={t.color}
                  icon={t.icon}
                  active={onRoot && activeTab === id}
                  onClick={() => emitSectionTab(section, id)}
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
            {gi === section.groups.length - 1 && <span style={{ flex: 1, minWidth: 0 }} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
