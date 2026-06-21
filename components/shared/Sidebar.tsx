"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { UserButton, useUser } from "@clerk/nextjs";

import { HOME_THEME } from "./homeTheme";

const HomeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const QUOTE_SYMBOLS = [
  { sym: "/ESU26", label: "ESU" },
  { sym: "/NQU26", label: "NQU" },
  { sym: "SPX", label: "SPX" },
  { sym: "SPY", label: "SPY" },
  { sym: "QQQ", label: "QQQ" },
  { sym: "VIX", label: "VIX" },
  { sym: "AAPL", label: "AAPL" },
  { sym: "AMD", label: "AMD" },
  { sym: "AMZN", label: "AMZN" },
  { sym: "GOOGL", label: "GOOGL" },
  { sym: "META", label: "META" },
  { sym: "MSFT", label: "MSFT" },
  { sym: "NVDA", label: "NVDA" },
  { sym: "SPCX", label: "SPCX" },
  { sym: "TSLA", label: "TSLA" },
  { sym: "SMH", label: "SMH" },
];

type NavItem = { label: string; href: string };
type NavGroup = { id: string; label: string; emoji: string; devOnly?: boolean; items: NavItem[] };

// Seeded from the prior flat PAGE_SHORTCUTS list. Item order within each group
// is user-reorderable at runtime (drag) and persisted to localStorage.
const NAV_GROUPS: NavGroup[] = [
  {
    id: "gex",
    label: "Gex",
    emoji: "📊",
    items: [
      { label: "Overview", href: "/overview" },
      { label: "Est. Move", href: "/em" },
      { label: "Est. Move (BE)", href: "/estimated-move" },
      { label: "Options Chain", href: "/options-chain" },
      { label: "Multi Greek", href: "/mult-greek" },
      { label: "Insights", href: "/insights" },
      { label: "Confidence", href: "/confidence-score" },
    ],
  },
  {
    id: "footprint",
    label: "Footprint",
    emoji: "👣",
    items: [
      { label: "Big Orders", href: "/footprint" },
    ],
  },
  {
    id: "stock-market",
    label: "Stock Market",
    emoji: "📈",
    items: [
      { label: "Premarket", href: "/premarket" },
      { label: "Database", href: "/database" },
      { label: "Econ Calendar", href: "/economic-calendar" },
    ],
  },
  {
    id: "personal",
    label: "Personal",
    emoji: "🧑",
    items: [
      { label: "Trading", href: "/trading" },
      { label: "Budget", href: "/budget" },
    ],
  },
  {
    id: "dev",
    label: "Dev",
    emoji: "🛠️",
    devOnly: true,
    items: [
      { label: "Owner", href: "/dev/owner" },
      { label: "Admin", href: "/dev/admin" },
      { label: "Dev", href: "/dev" },
      { label: "Logs", href: "/logs" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
];

const ORDER_STORAGE_KEY = "sidebar-nav-order-v1";

function quoteNumber(q: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const num = Number(q[key]);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function normalizeSym(sym: string) {
  if (sym.startsWith("/ES")) return "/ESU26";
  if (sym.startsWith("/NQ")) return "/NQU26";
  return sym;
}

function rawNum(q: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const n = Number(q[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pctFromQuote(q: Record<string, unknown>) {
  // Prefer recomputing from last vs prev-close so the % always matches the
  // displayed price (avoids stale/percentless feed fields). The quotes-batch
  // API already returns correct Yahoo last + prev-close.
  const last = quoteNumber(q, "last", "lastPrice", "mark", "mark-price", "price", "close", "closePrice");
  const prev = quoteNumber(q, "prev-close", "prevClose", "previousClose", "prevDayClosePrice", "close-price", "closePrice");
  if (last > 0 && prev > 0) {
    const pct = ((last - prev) / prev) * 100;
    if (Number.isFinite(pct)) return pct;
  }

  // Fall back to a feed-supplied percent. Guard against fractional (0.0108)
  // vs whole-number (1.08) conventions: scale up if it looks fractional.
  let directPct = rawNum(q, "percent-change", "changePercent", "netPercentChange", "netPercentChangeInDouble", "pctChange", "dayPercentChange");
  if (directPct !== null && directPct !== 0) {
    if (Math.abs(directPct) < 1 && Math.abs(directPct) > 0) directPct *= 100;
    return directPct;
  }

  const change = rawNum(q, "change", "netChange", "dayChange", "tradeChange");
  if (change !== null && change !== 0 && prev > 0) {
    return (change / prev) * 100;
  }

  return null;
}

function fmtPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function useSidebarQuotes() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pcts, setPcts] = useState<Record<string, number | null>>({});

  const refreshQuotes = async () => {
    try {
      const symbols = QUOTE_SYMBOLS.map((item) => item.sym).join(",");
      const res = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(symbols)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const items: Array<Record<string, unknown>> = data?.data?.items || [];
      const next: Record<string, number | null> = {};
      items.forEach((item) => {
        const sym = normalizeSym(String(item.symbol || item.eventSymbol || ""));
        if (!QUOTE_SYMBOLS.some((entry) => entry.sym === sym)) return;
        const pct = pctFromQuote(item);
        if (pct !== null) next[sym] = pct;
      });
      if (Object.keys(next).length) setPcts((prev) => ({ ...prev, ...next }));
    } catch {
      // ignore fallback failures
    }
  };

  useEffect(() => {
    void refreshQuotes();
    const fallbackTimer = setInterval(() => {
      void refreshQuotes();
    }, 30000);

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      clearInterval(fallbackTimer);
    };
  }, []);

  return pcts;
}

// Returns per-group item lists ordered by the user's saved preference, plus a
// reorder callback that persists the new order to localStorage.
function useNavOrder() {
  const [order, setOrder] = useState<Record<string, string[]>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORDER_STORAGE_KEY);
      if (raw) setOrder(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const orderedItems = (group: NavGroup): NavItem[] => {
    const saved = order[group.id];
    if (!saved?.length) return group.items;
    const byHref = new Map(group.items.map((i) => [i.href, i]));
    const result: NavItem[] = [];
    saved.forEach((href) => {
      const it = byHref.get(href);
      if (it) {
        result.push(it);
        byHref.delete(href);
      }
    });
    // Append any new items not yet in the saved order.
    byHref.forEach((it) => result.push(it));
    return result;
  };

  const reorder = (groupId: string, fromHref: string, toHref: string) => {
    setOrder((prev) => {
      const group = NAV_GROUPS.find((g) => g.id === groupId);
      if (!group) return prev;
      const current = (prev[groupId]?.length
        ? prev[groupId].filter((h) => group.items.some((i) => i.href === h))
        : group.items.map((i) => i.href)
      ).slice();
      group.items.forEach((i) => {
        if (!current.includes(i.href)) current.push(i.href);
      });
      const from = current.indexOf(fromHref);
      const to = current.indexOf(toHref);
      if (from === -1 || to === -1 || from === to) return prev;
      current.splice(to, 0, current.splice(from, 1)[0]);
      const next = { ...prev, [groupId]: current };
      try {
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return { orderedItems, reorder };
}

export default function Sidebar() {
  const pathname = usePathname();
  const pcts = useSidebarQuotes();
  const { isSignedIn } = useUser();
  const { orderedItems, reorder } = useNavOrder();
  const [idleActionState, setIdleActionState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [isIdle, setIsIdle] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [groupAnchor, setGroupAnchor] = useState<{ top: number; left: number } | null>(null);
  const [settingsAnchor, setSettingsAnchor] = useState<{ bottom: number; left: number } | null>(null);
  const [dragHref, setDragHref] = useState<string | null>(null);
  const groupBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const groupMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const isActive = (href: string) => pathname === href || (href === "/home" && pathname === "/");

  const visibleGroups = NAV_GROUPS.filter((g) => !g.devOnly || isSignedIn);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inBtn = Object.values(groupBtnRefs.current).some((el) => el?.contains(target));
      const inMenu = Object.values(groupMenuRefs.current).some((el) => el?.contains(target));
      if (!inBtn && !inMenu) setOpenGroup(null);
      if (!settingsBtnRef.current?.contains(target) && !settingsMenuRef.current?.contains(target)) setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Reflect current idle state on mount.
  useEffect(() => {
    fetch("/proxy/idle").then(r => r.ok ? r.json() : null).then(j => {
      if (j && typeof j.idle === "boolean") setIsIdle(j.idle);
    }).catch(() => {});
  }, []);

  const toggleIdle = async () => {
    const next = !isIdle;
    setIdleActionState("busy");
    try {
      const r = await fetch("/proxy/idle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idle: next }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setIsIdle(typeof j.idle === "boolean" ? j.idle : next);
      setIdleActionState("ok");
    } catch {
      setIdleActionState("err");
    } finally {
      setTimeout(() => setIdleActionState("idle"), 1500);
      setSettingsOpen(false);
    }
  };

  return (
    <nav
      onScroll={() => { setOpenGroup(null); setSettingsOpen(false); }}
      style={{
        width: 76,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
        zIndex: 10000,
        background: "rgba(13,17,25,0.62)",
        backdropFilter: "blur(16px)",
        borderRight: `1px solid ${HOME_THEME.border}`,
        overflowX: "visible",
        overflowY: "auto",
        scrollbarWidth: "none",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 0 8px", flexShrink: 0 }}>
        <Link
          href="/home"
          title="Home"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 10,
            textDecoration: "none",
            transition: "all 0.15s",
            background: isActive("/home") ? "rgba(0,229,255,0.12)" : "transparent",
            border: isActive("/home") ? "1px solid rgba(0,229,255,0.30)" : "1px solid transparent",
            color: isActive("/home") ? HOME_THEME.cyan : HOME_THEME.muted,
            boxShadow: isActive("/home") ? "0 0 12px rgba(0,229,255,0.18)" : "none",
          }}
        >
          <HomeIcon />
        </Link>

        {visibleGroups.map((group) => {
          const groupActive = group.items.some((item) => isActive(item.href));
          const isOpen = openGroup === group.id;
          return (
            <div key={group.id} style={{ position: "relative", display: "flex", justifyContent: "center", width: "100%" }}>
              <button
                ref={(el) => { groupBtnRefs.current[group.id] = el; }}
                title={group.label}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setGroupAnchor({ top: r.top, left: r.right + 8 });
                  setOpenGroup((v) => (v === group.id ? null : group.id));
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  fontSize: 18,
                  lineHeight: 1,
                  transition: "all 0.15s",
                  background: groupActive || isOpen ? "rgba(0,229,255,0.12)" : "transparent",
                  border: groupActive ? "1px solid rgba(0,229,255,0.30)" : "1px solid transparent",
                  boxShadow: groupActive ? "0 0 12px rgba(0,229,255,0.18)" : "none",
                  cursor: "pointer",
                }}
              >
                <span role="img" aria-label={group.label}>{group.emoji}</span>
              </button>

              {isOpen && mounted && createPortal((
                <div
                  ref={(el) => { groupMenuRefs.current[group.id] = el; }}
                  style={{
                    position: "fixed",
                    left: groupAnchor?.left ?? 52,
                    top: groupAnchor?.top ?? 0,
                    zIndex: 10001,
                    width: 240,
                    background: "rgba(13,17,25,0.96)",
                    border: "1px solid rgba(0,229,255,0.20)",
                    borderRadius: 10,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                    backdropFilter: "blur(16px)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ padding: "8px 12px", fontSize: 9, fontWeight: 700, color: HOME_THEME.muted, letterSpacing: "0.12em", textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    {group.label}
                  </div>
                  {group.items.length === 0 && (
                    <div style={{ padding: "20px 12px", textAlign: "center", fontSize: 12, fontWeight: 600, color: HOME_THEME.muted, letterSpacing: "0.04em" }}>
                      Coming soon
                    </div>
                  )}
                  <div style={{ display: group.items.length === 0 ? "none" : "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: 8 }}>
                    {orderedItems(group).map((item) => {
                      const active = isActive(item.href);
                      const isDragging = dragHref === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          draggable
                          onDragStart={() => setDragHref(item.href)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragHref && dragHref !== item.href) reorder(group.id, dragHref, item.href);
                            setDragHref(null);
                          }}
                          onDragEnd={() => setDragHref(null)}
                          onClick={() => setOpenGroup(null)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                            minHeight: 44,
                            padding: "8px 6px",
                            fontSize: 12,
                            fontWeight: active ? 700 : 500,
                            color: "#fff",
                            textDecoration: "none",
                            background: active ? "rgba(0,229,255,0.14)" : "rgba(255,255,255,0.04)",
                            border: active ? "1px solid rgba(0,229,255,0.35)" : "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 8,
                            letterSpacing: "0.02em",
                            cursor: "grab",
                            opacity: isDragging ? 0.4 : 1,
                            transition: "opacity 0.12s",
                          }}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ), document.body)}
            </div>
          );
        })}
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 12px" }} />

      <div style={{ padding: "8px 12px 4px", fontSize: 11, fontWeight: 700, color: HOME_THEME.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Quotes
      </div>

      <div style={{ flex: "1 1 0", overflowY: "auto", minHeight: 40, scrollbarWidth: "none" }}>
        {[...QUOTE_SYMBOLS]
          .sort((a, b) => {
            const pa = pcts[a.sym] ?? null;
            const pb = pcts[b.sym] ?? null;
            if (pa === null && pb === null) return 0;
            if (pa === null) return 1;
            if (pb === null) return -1;
            return pb - pa;
          })
          .map(({ sym, label }) => {
            const pct = pcts[sym] ?? null;
            const color = pct === null ? HOME_THEME.muted : pct < -0.01 ? "#ff4757" : "#00e676";
            const isCore = label === "SPX" || label === "ESU" || label === "NQU";
            return (
              <div
                key={sym}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "4px 0",
                  background: isCore ? "rgba(0,229,255,0.06)" : "transparent",
                  borderLeft: isCore ? "2px solid rgba(0,229,255,0.40)" : "2px solid transparent",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: isCore ? HOME_THEME.cyan : HOME_THEME.muted, letterSpacing: "0.04em" }}>{label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: "0.02em" }}>
                  {fmtPct(pct)}
                </span>
              </div>
            );
          })}
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 12px 0" }} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0 14px", paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <button
            ref={settingsBtnRef}
            title="Settings"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setSettingsAnchor({ bottom: window.innerHeight - r.bottom, left: r.right + 8 });
              setSettingsOpen((v) => !v);
            }}
            disabled={idleActionState === "busy"}
            style={{
              background: "none",
              border: "none",
              // Red when idle is active; otherwise muted (or status color while busy).
              color: isIdle ? "#ff4757"
                : idleActionState === "err" ? "#ff4757"
                : idleActionState === "ok" ? "#00e676"
                : HOME_THEME.muted,
              cursor: idleActionState === "busy" ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 6,
              borderRadius: 8,
              transition: "color 0.15s",
            }}
          >
            <SettingsIcon />
          </button>

          {settingsOpen && mounted && createPortal((
            <div
              ref={settingsMenuRef}
              style={{
                position: "fixed",
                left: settingsAnchor?.left ?? 52,
                bottom: settingsAnchor?.bottom ?? 0,
                zIndex: 10001,
                minWidth: 160,
                background: "rgba(13,17,25,0.96)",
                border: "1px solid rgba(0,229,255,0.20)",
                borderRadius: 10,
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                backdropFilter: "blur(16px)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "8px 12px", fontSize: 9, fontWeight: 700, color: HOME_THEME.muted, letterSpacing: "0.12em", textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                Settings
              </div>
              <button
                onClick={toggleIdle}
                disabled={idleActionState === "busy"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: isIdle ? "#ff4757" : "#fff",
                  background: isIdle ? "rgba(255,71,87,0.08)" : "transparent",
                  border: "none",
                  borderLeft: isIdle ? "2px solid #ff4757" : "2px solid transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span>Idle Proxy</span>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
                  padding: "2px 6px", borderRadius: 3,
                  background: isIdle ? "#ff4757" : "rgba(255,255,255,0.08)",
                  color: isIdle ? "#05080d" : HOME_THEME.muted,
                }}>
                  {idleActionState === "busy" ? "…" : isIdle ? "ON" : "OFF"}
                </span>
              </button>
            </div>
          ), document.body)}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <UserButton
            afterSignOutUrl="/"
            appearance={{ elements: { avatarBox: { width: 32, height: 32 } } }}
          />
        </div>

        <div style={{
          fontSize: 8,
          color: isIdle || idleActionState === "err" ? HOME_THEME.red : HOME_THEME.muted,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          textAlign: "center",
        }}>
          {idleActionState === "busy" ? "Working" : isIdle ? "Idle" : "Ready"}
        </div>
      </div>
    </nav>
  );
}
