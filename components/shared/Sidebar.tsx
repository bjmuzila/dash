"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getClientProxyBase, getClientWsUrl, isLiveFeedReady } from "@/lib/clientRuntime";
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
  { sym: "SPY", label: "SPY" },
  { sym: "QQQ", label: "QQQ" },
  { sym: "SPX", label: "SPX" },
  { sym: "VIX", label: "VIX" },
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
  { label: "Logs", href: "/logs" },
  { label: "Personal", href: "/personal" },
  { label: "Legacy", href: "/legacy" },
  { label: "Econ Calendar", href: "/economic-calendar" },
];

function quoteNumber(q: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const num = Number(q[key]);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function useSidebarQuotes() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pcts, setPcts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    async function connect() {
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;
      if (!(await isLiveFeedReady())) {
        reconnectTimerRef.current = setTimeout(() => { void connect(); }, 10000);
        return;
      }

      const ws = new WebSocket(getClientWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "FEED_SUBSCRIPTION",
          add: QUOTE_SYMBOLS.flatMap(({ sym }) => ([
            { type: "Quote", symbol: sym },
            { type: "Trade", symbol: sym },
            { type: "Summary", symbol: sym },
          ])),
        }));
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type !== "FEED_DATA") return;
          const next: Record<string, number | null> = {};
          (msg.data || []).forEach((e: Record<string, unknown>) => {
            const sym = String(e.eventSymbol || "");
            if (!QUOTE_SYMBOLS.some((item) => item.sym === sym)) return;
            const bid = Number(e.bidPrice ?? 0);
            const ask = Number(e.askPrice ?? 0);
            const price = Number(e.price ?? 0);
            const prev = quoteNumber(e, "prevDayClosePrice", "prevClose", "previousClose");
            const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : price;
            const last = price > 0 ? price : mid;
            const pct = prev > 0 && last > 0 ? ((last - prev) / prev) * 100 : Number(e.dayPercentChange ?? 0);
            if (Number.isFinite(pct)) next[sym] = pct;
          });
          if (Object.keys(next).length) setPcts((prev) => ({ ...prev, ...next }));
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(() => { void connect(); }, 3000);
      };

      ws.onerror = () => ws.close();
    }

    void connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return pcts;
}

export default function Sidebar() {
  const pathname = usePathname();
  const pcts = useSidebarQuotes();
  const [idleActionState, setIdleActionState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [pagesOpen, setPagesOpen] = useState(false);
  const pagesBtnRef = useRef<HTMLButtonElement | null>(null);
  const [pagesMenuPos, setPagesMenuPos] = useState<{ top: number; left: number } | null>(null);

  const isActive = (href: string) => pathname === href || (href === "/home" && pathname === "/");

  const goIntoIdle = async () => {
    setIdleActionState("busy");
    try {
      const res = await fetch(`${getClientProxyBase()}/proxy/api/idle`, { method: "POST" });
      if (!res.ok) throw new Error("Idle request failed");
      setIdleActionState("ok");
      setTimeout(() => setIdleActionState("idle"), 1800);
    } catch {
      setIdleActionState("err");
      setTimeout(() => setIdleActionState("idle"), 2200);
    }
  };

  const openPagesMenu = () => {
    if (!pagesOpen && pagesBtnRef.current) {
      const r = pagesBtnRef.current.getBoundingClientRect();
      setPagesMenuPos({ top: r.top, left: r.right + 8 });
    }
    setPagesOpen((open) => !open);
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
          onClick={openPagesMenu}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 10,
            textDecoration: "none",
            transition: "all 0.15s",
            background: pagesOpen || PAGE_SHORTCUTS.some((item) => isActive(item.href)) ? "rgba(0,229,255,0.12)" : "transparent",
            border: pagesOpen || PAGE_SHORTCUTS.some((item) => isActive(item.href)) ? "1px solid rgba(0,229,255,0.30)" : "1px solid transparent",
            color: pagesOpen || PAGE_SHORTCUTS.some((item) => isActive(item.href)) ? HOME_THEME.cyan : HOME_THEME.muted,
            boxShadow: pagesOpen || PAGE_SHORTCUTS.some((item) => isActive(item.href)) ? "0 0 12px rgba(0,229,255,0.18)" : "none",
            cursor: "pointer",
          }}
        >
          <GridIcon />
        </button>

        {pagesOpen && pagesMenuPos && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 999998 }} onClick={() => setPagesOpen(false)} />
            <div
              style={{
                position: "fixed",
                left: pagesMenuPos.left,
                top: pagesMenuPos.top,
                zIndex: 999999,
                minWidth: 180,
                maxHeight: "70vh",
                overflow: "auto",
                background: "rgba(13,17,25,0.96)",
                border: "1px solid rgba(0,229,255,0.20)",
                borderRadius: 10,
                boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.06)",
                backdropFilter: "blur(16px)",
              }}
            >
              <div style={{ padding: "8px 14px 6px", fontSize: 9, fontWeight: 700, color: HOME_THEME.muted, letterSpacing: "0.12em", textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
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
                      padding: "8px 14px",
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
          </>
        )}

        <Link
          href="/economic-calendar"
          title="Calendar"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 10,
            textDecoration: "none",
            transition: "all 0.15s",
            background: isActive("/economic-calendar") ? "rgba(0,229,255,0.12)" : "transparent",
            border: isActive("/economic-calendar") ? "1px solid rgba(0,229,255,0.30)" : "1px solid transparent",
            color: isActive("/economic-calendar") ? HOME_THEME.cyan : HOME_THEME.muted,
            boxShadow: isActive("/economic-calendar") ? "0 0 12px rgba(0,229,255,0.18)" : "none",
          }}
        >
          <CalendarIcon />
        </Link>
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 12px" }} />

      <div style={{ padding: "8px 12px 4px", fontSize: 9, fontWeight: 700, color: HOME_THEME.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
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
            const isSpx = label === "SPX";
            return (
              <div
                key={sym}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "4px 0",
                  background: isSpx ? "rgba(0,229,255,0.06)" : "transparent",
                  borderLeft: isSpx ? "2px solid rgba(0,229,255,0.40)" : "2px solid transparent",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: isSpx ? HOME_THEME.cyan : HOME_THEME.muted, letterSpacing: "0.04em" }}>{label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: "0.02em" }}>
                  {pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
                </span>
              </div>
            );
          })}
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 12px 0" }} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0 14px" }}>
        <button
          title="Settings"
          onClick={goIntoIdle}
          disabled={idleActionState === "busy"}
          style={{
            background: "none",
            border: "none",
            color: idleActionState === "err" ? "#ff4757" : idleActionState === "ok" ? "#00e676" : HOME_THEME.muted,
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

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, textAlign: "center" }}>
          <div style={{
            fontSize: 8,
            color: idleActionState === "ok" ? HOME_THEME.text : idleActionState === "err" ? HOME_THEME.red : "#ff4d4d",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}>
            {idleActionState === "busy" ? "Going live" : idleActionState === "ok" ? "Live" : idleActionState === "err" ? "Error" : "Idle"}
          </div>
          <div style={{
            fontSize: 8,
            color: idleActionState === "ok" ? HOME_THEME.green : HOME_THEME.green,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}>
            Live
          </div>
        </div>
      </div>
    </nav>
  );
}
