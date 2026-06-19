"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { HOME_THEME } from "./homeTheme";

const HomeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const GridIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const UserIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21a8 8 0 0 0-16 0" />
    <circle cx="12" cy="7" r="4" />
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

const PAGE_SHORTCUTS = [
  { label: "Overview", href: "/overview" },
  { label: "Premarket", href: "/premarket" },
  { label: "Database", href: "/database" },
  { label: "Insights", href: "/insights" },
  { label: "Est. Move", href: "/estimated-move" },
  { label: "Options Chain", href: "/options-chain" },
  { label: "Multi Greek", href: "/mult-greek" },
  { label: "Trading", href: "/trading" },
  { label: "Budget", href: "/budget" },
  { label: "Logs", href: "/logs" },
  { label: "Personal", href: "/personal" },
  { label: "Legacy", href: "/legacy" },
  { label: "Changelog", href: "/changelog" },
  { label: "Econ Calendar", href: "/economic-calendar" },
];

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

export default function Sidebar() {
  const pathname = usePathname();
  const pcts = useSidebarQuotes();
  const [idleActionState, setIdleActionState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [isIdle, setIsIdle] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const pagesBtnRef = useRef<HTMLButtonElement | null>(null);
  const pagesMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const isActive = (href: string) => pathname === href || (href === "/home" && pathname === "/");

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!pagesBtnRef.current?.contains(target) && !pagesMenuRef.current?.contains(target)) setPagesOpen(false);
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
        overflow: "visible",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 0 8px" }}>
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

        <button
          ref={pagesBtnRef}
          title="Overview"
          onClick={() => setPagesOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 10,
            textDecoration: "none",
            transition: "all 0.15s",
            background: PAGE_SHORTCUTS.some((item) => isActive(item.href)) ? "rgba(0,229,255,0.12)" : "transparent",
            border: PAGE_SHORTCUTS.some((item) => isActive(item.href)) ? "1px solid rgba(0,229,255,0.30)" : "1px solid transparent",
            color: PAGE_SHORTCUTS.some((item) => isActive(item.href)) ? HOME_THEME.cyan : HOME_THEME.muted,
            boxShadow: PAGE_SHORTCUTS.some((item) => isActive(item.href)) ? "0 0 12px rgba(0,229,255,0.18)" : "none",
            cursor: "pointer",
            backgroundColor: pagesOpen ? "rgba(0,229,255,0.12)" : undefined,
          }}
        >
          <GridIcon />
        </button>

        {pagesOpen && (
          <div
            ref={pagesMenuRef}
            style={{
              position: "absolute",
              left: 84,
              top: 12,
              zIndex: 10001,
              minWidth: 180,
              background: "rgba(13,17,25,0.96)",
              border: "1px solid rgba(0,229,255,0.20)",
              borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              backdropFilter: "blur(16px)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "8px 12px", fontSize: 9, fontWeight: 700, color: HOME_THEME.muted, letterSpacing: "0.12em", textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              Pages
            </div>
            {PAGE_SHORTCUTS.map(({ label, href }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setPagesOpen(false)}
                  style={{
                    display: "block",
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    color: active ? HOME_THEME.cyan : HOME_THEME.muted,
                    textDecoration: "none",
                    background: active ? "rgba(0,229,255,0.08)" : "transparent",
                    borderLeft: active ? "2px solid #00e5ff" : "2px solid transparent",
                    letterSpacing: "0.02em",
                  }}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        )}

        <Link
          href="/dev"
          title="Dev"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 10,
            textDecoration: "none",
            transition: "all 0.15s",
            background: isActive("/dev") ? "rgba(0,229,255,0.12)" : "transparent",
            border: isActive("/dev") ? "1px solid rgba(0,229,255,0.30)" : "1px solid transparent",
            color: isActive("/dev") ? HOME_THEME.cyan : HOME_THEME.muted,
            boxShadow: isActive("/dev") ? "0 0 12px rgba(0,229,255,0.18)" : "none",
          }}
        >
          <CalendarIcon />
        </Link>
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 12px" }} />

      <div style={{ padding: "8px 12px 4px", fontSize: 11, fontWeight: 700, color: HOME_THEME.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Quotes
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, scrollbarWidth: "none" }}>
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

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0 14px" }}>
        <div style={{ position: "relative" }}>
          <button
            ref={settingsBtnRef}
            title="Settings"
            onClick={() => setSettingsOpen((v) => !v)}
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

          {settingsOpen && (
            <div
              ref={settingsMenuRef}
              style={{
                position: "absolute",
                left: 52,
                bottom: 0,
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
          )}
        </div>

        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            overflow: "hidden",
            background: "#0b1220",
            boxShadow: "0 0 12px rgba(0,229,255,0.35)",
            flexShrink: 0,
            border: "1px solid rgba(0,229,255,0.35)",
          }}
        >
          <img
            src="/sidebar-logo.jpg"
            alt="Logo"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
