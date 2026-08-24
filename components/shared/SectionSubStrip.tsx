"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useIsOwner } from "./useIsOwner";

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
 * Rearranging: every pill is drag-and-drop movable, within its cluster or across
 * the hairline into another one. The resulting order is per-section and sticks in
 * localStorage (cb:section-order:<key>), so Scanner and Test Lab each keep their
 * own arrangement. A ⤺ button appears at the right end once the order differs
 * from the shipped default and puts it back.
 *
 * Fitting: the row never wraps and never clips a whole item. When it runs out of
 * width, pills shed their text label right-to-left (icon + tooltip remain); if
 * even the all-icon row overflows, the row scrolls horizontally.
 */

const CYAN = HOME_THEME.cyan;
function cyanA(a: number) { return `rgba(33,158,188,${a})`; }

/**
 * Max height of the open strip. Only a cap for the expand/collapse transition —
 * actual height comes from the content — so it is set generously above the real
 * row height. It was previously tight enough that a pill's 1px accent border,
 * plus the 1px lift on hover, got shaved by the container's overflow:hidden.
 */
const STRIP_H = 76;

/** Vertical padding inside the strip. Must leave room for the hover lift. */
const PAD_TOP = 12;
const PAD_BOTTOM = 13;

// ── Ordering model ───────────────────────────────────────────────────────────
// A layout is groups-of-item-keys: string[][], mirroring section.groups but
// mutable by the user. An item key is "t:<tabId>" for an inline tab and
// "r:<href>" for a split-out route, so tabs and routes can share one list and be
// dragged past each other.

type ItemKey = string;
type Layout = ItemKey[][];

const ORDER_KEY = (sectionKey: string) => `cb:section-order:${sectionKey}`;

const tabKey = (id: string): ItemKey => `t:${id}`;
const routeKey = (href: string): ItemKey => `r:${href}`;

/** The shipped arrangement, flattened into the layout shape. */
function defaultLayout(section: SectionNav | null): Layout {
  if (!section) return [];
  return section.groups.map((g) => [
    ...g.tabs.map(tabKey),
    ...(g.routes ?? []).map(routeKey),
  ]);
}

function sameLayout(a: Layout, b: Layout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Reconcile a saved layout against the section as it exists today: drop keys for
 * views that no longer exist, de-dupe, and append anything newly shipped to the
 * cluster it defaults into (so a new tab shows up instead of silently vanishing
 * behind an old saved order). Empty clusters are dropped so the row doesn't open
 * with a stray divider.
 */
function reconcile(saved: unknown, section: SectionNav): Layout {
  const def = defaultLayout(section);
  if (!Array.isArray(saved)) return def;

  const known = new Set<ItemKey>(def.flat());
  const seen = new Set<ItemKey>();
  const groups: Layout = saved.map((g) => {
    if (!Array.isArray(g)) return [];
    const out: ItemKey[] = [];
    for (const k of g) {
      if (typeof k !== "string" || !known.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  });

  // Anything shipped but missing from the saved order joins its default cluster.
  def.forEach((g, gi) => {
    for (const k of g) {
      if (seen.has(k)) continue;
      seen.add(k);
      if (groups[gi]) groups[gi].push(k);
      else if (groups.length) groups[groups.length - 1].push(k);
      else groups.push([k]);
    }
  });

  const trimmed = groups.filter((g) => g.length > 0);
  return trimmed.length ? trimmed : def;
}

function loadLayout(section: SectionNav): Layout {
  if (typeof window === "undefined") return defaultLayout(section);
  try {
    const raw = window.localStorage.getItem(ORDER_KEY(section.key));
    if (!raw) return defaultLayout(section);
    return reconcile(JSON.parse(raw), section);
  } catch {
    return defaultLayout(section);
  }
}

function saveLayout(section: SectionNav, layout: Layout) {
  if (typeof window === "undefined") return;
  try {
    if (sameLayout(layout, defaultLayout(section))) {
      window.localStorage.removeItem(ORDER_KEY(section.key));
    } else {
      window.localStorage.setItem(ORDER_KEY(section.key), JSON.stringify(layout));
    }
  } catch {
    /* private mode / quota — the order just won't persist */
  }
}

/**
 * Pull `key` out of wherever it sits and re-insert it next to `target`.
 * `target === null` means "end of the last cluster" (the drop zone that fills
 * the row's trailing space).
 */
function moveItem(layout: Layout, key: ItemKey, target: ItemKey | null, side: "before" | "after"): Layout {
  const next: Layout = layout.map((g) => g.filter((k) => k !== key));

  if (target === null) {
    if (!next.length) next.push([]);
    next[next.length - 1].push(key);
  } else {
    let placed = false;
    for (const g of next) {
      const i = g.indexOf(target);
      if (i === -1) continue;
      g.splice(side === "before" ? i : i + 1, 0, key);
      placed = true;
      break;
    }
    if (!placed) {
      if (!next.length) next.push([]);
      next[next.length - 1].push(key);
    }
  }

  const trimmed = next.filter((g) => g.length > 0);
  return trimmed.length ? trimmed : next;
}

type PillProps = {
  href: string;
  label: string;
  short: string;
  color: string;
  icon: string;
  active: boolean;
  external?: boolean;
  onClick?: () => void;
  /** Drag wiring — see the reorder handlers on the row below. */
  itemKey: ItemKey;
  dragging: boolean;
  onDragStart: (k: ItemKey) => void;
  onDragEnd: () => void;
  onDragOverItem: (k: ItemKey, side: "before" | "after") => void;
  onDropItem: () => void;
  /** True while a drag just finished, so the trailing click can't navigate. */
  suppressClickRef: React.MutableRefObject<boolean>;
};

/**
 * One pill. Styling deliberately mirrors the tab buttons these replaced, so the
 * strip reads as the same control the pages used to render — the additions are
 * the leading icon, the collapse-to-icon behaviour (data-mini, written by the
 * fit pass below and styled by the stylesheet), and drag-to-rearrange.
 */
function Pill({
  href, label, short, color, icon, active, external, onClick,
  itemKey, dragging, onDragStart, onDragEnd, onDragOverItem, onDropItem, suppressClickRef,
}: PillProps) {
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
    transition: "opacity 0.15s, border-color 0.15s, background 0.15s, color 0.15s, transform 0.15s",
    // The dragged pill stays in place, dimmed, while the insertion bar shows
    // where it will land.
    opacity: dragging ? 0.35 : 1,
    cursor: dragging ? "grabbing" : "pointer",
  } as React.CSSProperties;

  return (
    <Link
      href={href}
      prefetch={false}
      onClick={(e) => {
        // A drag that ends on top of another pill still fires a click in some
        // browsers; swallow it so rearranging never navigates.
        if (suppressClickRef.current) { e.preventDefault(); return; }
        onClick?.();
      }}
      title={`${label} — drag to rearrange`}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-section-pill
      data-mini="0"
      className="cb-section-pill"
      style={style}
      draggable
      onDragStart={(e) => {
        // Firefox needs payload on the transfer or the drag never starts; the
        // default link drag (which would drop a URL into other apps) is replaced
        // by ours.
        try {
          e.dataTransfer.setData("text/plain", itemKey);
          e.dataTransfer.effectAllowed = "move";
        } catch { /* older browsers */ }
        onDragStart(itemKey);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "move"; } catch { /* noop */ }
        const r = e.currentTarget.getBoundingClientRect();
        onDragOverItem(itemKey, e.clientX < r.left + r.width / 2 ? "before" : "after");
      }}
      onDrop={(e) => { e.preventDefault(); onDropItem(); }}
    >
      <span aria-hidden style={{ fontSize: 12.5, lineHeight: 1 }}>{icon}</span>
      <span className="cb-section-pill-text">
        {short}
        {external && <span style={{ fontSize: 9.5, opacity: 0.65, marginLeft: 3 }}>↗</span>}
      </span>
    </Link>
  );
}

/** The bar that shows where a dragged pill will land. */
function DropMarker() {
  return (
    <span
      aria-hidden
      style={{
        width: 2,
        alignSelf: "stretch",
        minHeight: 22,
        flexShrink: 0,
        borderRadius: 2,
        background: CYAN,
        boxShadow: `0 0 8px ${cyanA(0.85)}`,
      }}
    />
  );
}

export default function SectionSubStrip({ open }: { open: boolean }) {
  const pathname = usePathname();
  // Owner-only pills are skipped for everyone else. They keep their slot in the
  // saved order (reconcile() still knows the key), so nothing reshuffles for the
  // owner and turning a tab public again puts it back where it was.
  const { isOwner } = useIsOwner();
  const section: SectionNav | null = sectionForPath(pathname);
  const sectionKey = section?.key ?? null;
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Which pill is current. On the section root that's the ?tab= value (falling
  // back to the section's default, matching what the page itself renders); on a
  // split-out route it's the route.
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // User's arrangement. Starts at the shipped default on both server and first
  // client render (localStorage is read in an effect) so hydration matches.
  const [layout, setLayout] = useState<Layout>(() => defaultLayout(section));
  const [dragKey, setDragKey] = useState<ItemKey | null>(null);
  const [dropAt, setDropAt] = useState<{ key: ItemKey | null; side: "before" | "after" } | null>(null);
  const suppressClickRef = useRef(false);

  const syncFromUrl = useCallback(() => {
    if (!section) return;
    setActiveTab(readSectionTab(section) ?? section.defaultTab);
  }, [section]);

  useEffect(() => { syncFromUrl(); }, [pathname, syncFromUrl]);

  // Load the saved order whenever the section changes (each keeps its own).
  useEffect(() => {
    if (!section) return;
    setLayout(loadLayout(section));
    setDragKey(null);
    setDropAt(null);
    // Keyed on the section id, not the object, which is a fresh lookup per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionKey]);

  // Another tab of the same app reordering the strip should be reflected here.
  useEffect(() => {
    if (!section) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ORDER_KEY(section.key)) return;
      setLayout(loadLayout(section));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [section, sectionKey]);

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
    // Note overflow-x:auto forces overflow-y off "visible", so pin it to hidden
    // in that case to avoid a phantom vertical scrollbar.
    if (over()) {
      row.style.overflowX = "auto";
      row.style.overflowY = "hidden";
    } else {
      row.style.overflow = "visible";
    }
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

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const endDrag = useCallback(() => {
    setDragKey(null);
    setDropAt(null);
  }, []);

  const commitDrop = useCallback(() => {
    if (!section || !dragKey) { endDrag(); return; }
    const target = dropAt?.key ?? null;
    const side = dropAt?.side ?? "after";
    if (target === dragKey) { endDrag(); return; }
    const next = moveItem(layout, dragKey, target, side);
    setLayout(next);
    saveLayout(section, next);
    // Swallow the click the browser fires on the pill the drag started from.
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    endDrag();
  }, [section, dragKey, dropAt, layout, endDrag]);

  const onDragOverItem = useCallback((k: ItemKey, side: "before" | "after") => {
    setDropAt((cur) => (cur && cur.key === k && cur.side === side ? cur : { key: k, side }));
  }, []);

  const resetOrder = useCallback(() => {
    if (!section) return;
    const def = defaultLayout(section);
    setLayout(def);
    saveLayout(section, def);
  }, [section]);

  const isCustom = useMemo(
    () => !!section && !sameLayout(layout, defaultLayout(section)),
    [section, layout],
  );

  // Outside a section there is nothing to show. Unmounted rather than collapsed
  // so it costs nothing on every other page.
  if (!section) return null;

  const tabById = (id: string) => section.tabs.find((t) => t.id === id);
  const routeByHref = (href: string) => section.routes.find((r) => r.href === href);
  const currentPath = normalizePath(pathname);
  const onRoot = currentPath === section.rootPath || currentPath.startsWith(section.rootPath + "/");

  const markerAt = (key: ItemKey, side: "before" | "after") =>
    !!dragKey && dragKey !== key && dropAt?.key === key && dropAt.side === side;

  /** Resolve an item key to the pill it draws, or null if it no longer exists. */
  const renderItem = (key: ItemKey) => {
    if (key.startsWith("t:")) {
      const t = tabById(key.slice(2));
      if (!t) return null;
      if (t.ownerOnly && !isOwner) return null;
      return (
        <Pill
          href={sectionTabHref(section, t.id)}
          label={t.label}
          short={t.short ?? t.label}
          color={t.color}
          icon={t.icon}
          active={onRoot && activeTab === t.id}
          onClick={() => emitSectionTab(section, t.id)}
          itemKey={key}
          dragging={dragKey === key}
          onDragStart={setDragKey}
          onDragEnd={endDrag}
          onDragOverItem={onDragOverItem}
          onDropItem={commitDrop}
          suppressClickRef={suppressClickRef}
        />
      );
    }
    const href = key.slice(2);
    const r = routeByHref(href);
    if (!r) return null;
    // Split-out routes can be owner-only too (/gex-watch). Same rule as the
    // tabs above: skip the pill, keep the key in the saved order.
    if (r.ownerOnly && !isOwner) return null;
    return (
      <Pill
        href={r.href}
        label={r.label}
        short={r.short}
        color={r.color}
        icon={r.icon}
        external
        active={currentPath === r.href || currentPath.startsWith(r.href + "/")}
        itemKey={key}
        dragging={dragKey === key}
        onDragStart={setDragKey}
        onDragEnd={endDrag}
        onDragOverItem={onDragOverItem}
        onDropItem={commitDrop}
        suppressClickRef={suppressClickRef}
      />
    );
  };

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
        padding: open ? `${PAD_TOP}px 14px ${PAD_BOTTOM}px` : "0 14px",
        border: `1px solid ${open ? HOME_THEME.border : "transparent"}`,
        borderTop: "none",
        borderRadius: "0 0 16px 16px",
        background: "rgba(10,13,20,0.94)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxSizing: "border-box",
        transition: "max-height 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.2s, padding 0.28s",
        position: "relative",
        // Must stay BELOW the pill above, which GlobalToolbar's gradient frame
        // pins at z-index 2 in this same stacking context (the toolbar band).
        // The inner z-index:1 wrappers around the user menu / NavMenu / ticker
        // do NOT settle this on their own: the pill sets `backdrop-filter`, so
        // it is its own stacking context and its dropdowns can never paint
        // higher than the pill's level — this strip only has to lose to the
        // pill, and at equal levels it would win on DOM order and cover the open
        // user menu. The strip still covers page content: the band is z-index 50.
        zIndex: 0,
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
        /* While a pill is in flight, hover lift on the others just adds noise. */
        .cb-section-row[data-dragging="1"] .cb-section-pill:hover { transform: none; }
        .cb-section-row::-webkit-scrollbar { height: 0; }
        .cb-section-row { scrollbar-width: none; }
        .cb-section-reset {
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0; width: 24px; height: 24px; padding: 0;
          border-radius: 7px; cursor: pointer; font-size: 13px; line-height: 1;
          border: 1px solid rgba(255,255,255,0.12);
          background: transparent; color: rgba(255,255,255,0.45);
          transition: all 0.15s;
        }
        .cb-section-reset:hover {
          color: #fff; border-color: ${CYAN}; background: ${cyanA(0.14)};
        }
      `}</style>

      <div
        ref={rowRef}
        className="cb-section-row"
        data-dragging={dragKey ? "1" : "0"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          flexWrap: "nowrap",
          minWidth: 0,
          // Vertically visible so a pill's border / hover lift is never shaved;
          // the fit pass flips overflowX to "auto" only when the row genuinely
          // can't fit, and restores "visible" otherwise.
          overflow: "visible",
          paddingBottom: 1,
        }}
        onDragEnd={endDrag}
      >
        {layout.map((group, gi) => (
          <Fragment key={`g${gi}`}>
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
            {group.map((key) => {
              const pill = renderItem(key);
              if (!pill) return null;
              return (
                <Fragment key={key}>
                  {markerAt(key, "before") && <DropMarker />}
                  {pill}
                  {markerAt(key, "after") && <DropMarker />}
                </Fragment>
              );
            })}
          </Fragment>
        ))}

        {/* Trailing space doubles as a drop zone: release here to send a pill to
            the end of the last cluster. */}
        <span
          style={{ flex: 1, minWidth: 0, alignSelf: "stretch" }}
          onDragOver={(e) => {
            if (!dragKey) return;
            e.preventDefault();
            try { e.dataTransfer.dropEffect = "move"; } catch { /* noop */ }
            setDropAt((cur) => (cur && cur.key === null ? cur : { key: null, side: "after" }));
          }}
          onDrop={(e) => { e.preventDefault(); commitDrop(); }}
        />
        {!!dragKey && dropAt?.key === null && <DropMarker />}

        {isCustom && (
          <button
            type="button"
            className="cb-section-reset"
            title="Reset tab order"
            aria-label="Reset tab order"
            onClick={resetOrder}
          >
            ⤺
          </button>
        )}
      </div>
    </div>
  );
}
