"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME, DOCK_THEME } from "@/components/shared/homeTheme";

// Same 16 symbols as the sidebar quote list, so the dropdown stays consistent
// with the rest of the app.
type QuoteSym = { sym: string; label: string; name: string };
const DEFAULT_QUOTE_SYMBOLS: QuoteSym[] = [
  { sym: "/ESU26", label: "ESU", name: "E-mini S&P 500 Future" },
  { sym: "/NQU26", label: "NQU", name: "E-mini Nasdaq-100 Future" },
  { sym: "SPX", label: "SPX", name: "S&P 500 Index" },
  { sym: "SPY", label: "SPY", name: "SPDR S&P 500 ETF" },
  { sym: "QQQ", label: "QQQ", name: "Invesco QQQ Trust" },
  { sym: "VIX", label: "VIX", name: "CBOE Volatility Index" },
  { sym: "AAPL", label: "AAPL", name: "Apple Inc." },
  { sym: "AMD", label: "AMD", name: "Advanced Micro Devices" },
  { sym: "AMZN", label: "AMZN", name: "Amazon.com Inc." },
  { sym: "GOOGL", label: "GOOGL", name: "Alphabet Inc." },
  { sym: "META", label: "META", name: "Meta Platforms Inc." },
  { sym: "MSFT", label: "MSFT", name: "Microsoft Corp." },
  { sym: "NVDA", label: "NVDA", name: "NVIDIA Corp." },
  { sym: "SPCX", label: "SPCX", name: "SPAC Index ETF" },
  { sym: "TSLA", label: "TSLA", name: "Tesla Inc." },
  { sym: "SMH", label: "SMH", name: "VanEck Semiconductor ETF" },
];

// Symbol shown in the toolbar pill itself (not rotating — fixed to NQU).
const PILL_SYMBOL = "/NQU26";

const UP = "#1FD98A";
const DOWN = "#EF4444";
const MUTED = "#5a7a99";

// Dock theme — centralized in homeTheme.ts (DOCK_THEME). cyan = #219EBC.
const DOCK_CYAN = HOME_THEME.cyan;
const DOCK_PANEL = "rgba(13,17,25,0.92)";
const DOCK_BORDER = HOME_THEME.border;
const DOCK_SHADOW = DOCK_THEME.shadow;
function cyA(a: number) { return `rgba(33,158,188,${a})`; }

type Rec = {
  sym: string;
  label: string;
  name: string;
  last: number | null;
  prev: number | null;
  pct: number | null;
  spark: number[];
  session: "REG" | "EXT";
};

function normalizeSym(sym: string) {
  if (sym.startsWith("/ES")) return "/ESU26";
  if (sym.startsWith("/NQ")) return "/NQU26";
  return sym;
}

// REG = 09:30–16:00 ET, EXT everything else. Computed from the live clock so
// the label flips at 4:00pm ET immediately, without waiting on a data refresh.
function currentEtSession(): "REG" | "EXT" {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins < 16 * 60 ? "REG" : "EXT";
}

// PRE = 00:00–09:30 ET, REG = 09:30–16:00 ET, POST = 16:00–24:00 ET.
// Distinguishing PRE from POST matters for the day-change baseline: during
// PRE (which is when options/equities start quoting again, ~4am) today's
// regular close hasn't happened yet, so the baseline must always be
// `prevClose` (yesterday's official close) — never `close`, which only
// becomes valid once RTH ends for the day. The old binary REG/EXT split
// wrongly applied the POST-market rule (prefer `close`) to PRE-market too,
// which froze the displayed change at the previous day's full-day move
// instead of today's premarket move.
function etPhase(): "PRE" | "REG" | "POST" {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = h * 60 + m;
  if (mins < 9 * 60 + 30) return "PRE";
  if (mins < 16 * 60) return "REG";
  return "POST";
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctOf(last: number | null, prev: number | null, feedPct: number | null) {
  if (last != null && prev != null && prev > 0) {
    const p = ((last - prev) / prev) * 100;
    if (Number.isFinite(p) && Math.abs(p) <= 25) return p;
  }
  if (feedPct != null && Math.abs(feedPct) <= 25) return feedPct;
  return null;
}

function fmtPrice(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtChg(last: number | null, prev: number | null) {
  if (last == null || prev == null) return "";
  const c = last - prev;
  return `${c >= 0 ? "+" : ""}${c.toFixed(2)}`;
}

// Tiny inline sparkline. `up` tints the stroke/fill green or red.
function Sparkline({ data, up, width = 88, height = 26 }: { data: number[]; up: boolean; width?: number; height?: number }) {
  if (!data || data.length < 2) {
    return <div style={{ width, height, opacity: 0.25, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: MUTED }}>—</div>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (data.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / range) * (height - pad * 2);
  const pts = data.map((v, i) => `${(pad + i * stepX).toFixed(1)},${y(v).toFixed(1)}`);
  const linePath = `M ${pts.join(" L ")}`;
  const areaPath = `${linePath} L ${(width - pad).toFixed(1)},${height - pad} L ${pad},${height - pad} Z`;
  const stroke = up ? UP : DOWN;
  const gradId = `spk-${up ? "u" : "d"}-${width}-${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function NquQuotePill({ buttonRef: externalBtnRef }: { buttonRef?: React.MutableRefObject<HTMLButtonElement | null> } = {}) {
  const [recs, setRecs] = useState<Record<string, Rec>>({});
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  // Live clock-based REG/EXT (re-checked each minute) — drives the badges so the
  // label flips at 4:00pm ET without waiting on a quotes refresh.
  const [etSession, setEtSession] = useState<"REG" | "EXT">("EXT");
  const [sortDesc, setSortDesc] = useState(true); // true = top gainers first
  // Per-user customizable quote list (seeded from defaults; merged w/ server prefs).
  const [quoteList, setQuoteList] = useState<QuoteSym[]>(DEFAULT_QUOTE_SYMBOLS);
  const [adding, setAdding] = useState(false);
  const [newSym, setNewSym] = useState("");

  // Load the user's saved quote list once on mount; fall back to defaults.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/quote-symbols", { cache: "default" });
        if (!r.ok) return;
        const j = await r.json();
        const saved: Array<{ sym: string; label: string }> = j?.symbols ?? [];
        if (cancelled || !Array.isArray(saved) || saved.length === 0) return;
        // Preserve default names where known; user-added symbols use sym as name.
        const merged: QuoteSym[] = saved.map((s) => {
          const def = DEFAULT_QUOTE_SYMBOLS.find((d) => d.sym === s.sym);
          return { sym: s.sym, label: s.label || def?.label || s.sym, name: def?.name || s.sym };
        });
        // Only swap state if the saved list actually differs from what we're
        // already showing (defaults). Setting it unconditionally re-runs the
        // quotes effect ([quoteList] dep), forcing a SECOND quotes wave ~480ms
        // after mount — the home-page load tail. When prefs == defaults, the
        // first (mount) wave already has the right symbols; skip the churn.
        const sameAsCurrent =
          merged.length === quoteList.length &&
          merged.every((m, i) => m.sym === quoteList[i]?.sym && m.label === quoteList[i]?.label);
        if (!sameAsCurrent) setQuoteList(merged);
      } catch { /* ignore — keep defaults */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist the current list to the server (best-effort).
  const saveList = (list: QuoteSym[]) => {
    fetch("/api/quote-symbols", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: list.map((q) => ({ sym: q.sym, label: q.label })) }),
    }).catch(() => { /* ignore */ });
  };

  const addTicker = () => {
    const sym = newSym.trim().toUpperCase();
    if (!sym || !/^[A-Z0-9/.^-]+$/.test(sym)) { setNewSym(""); return; }
    if (quoteList.some((q) => q.sym === sym)) { setNewSym(""); setAdding(false); return; }
    const next = [...quoteList, { sym, label: sym.replace(/^\//, "").slice(0, 6), name: sym }];
    setQuoteList(next);
    saveList(next);
    setNewSym("");
    setAdding(false);
  };

  const removeTicker = (sym: string) => {
    const next = quoteList.filter((q) => q.sym !== sym);
    setQuoteList(next);
    saveList(next);
  };
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const tick = () => setEtSession(currentEtSession());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // Fetch all symbols (with intraday spark) on mount + every 30s. Re-runs when
  // the user adds/removes a ticker so new symbols start streaming immediately.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Always include the pill symbol even if removed from the dropdown list.
        const symSet = new Set<string>([PILL_SYMBOL, ...quoteList.map((q) => q.sym)]);
        const symbols = Array.from(symSet).join(",");
        const phase = etPhase();
        // Yahoo = sparkline (+ fallback price). Broker (Tastytrade) = live price
        // & baseline that update in extended hours.
        const [yRes, bRes] = await Promise.all([
          fetch(`/api/quotes-batch?spark=1&symbols=${encodeURIComponent(symbols)}`, { cache: "no-store" }),
          fetch(`/api/tt-quotes?symbols=${encodeURIComponent(symbols)}`, { cache: "no-store" }).catch(() => null),
        ]);
        if (cancelled || !yRes.ok) return;
        const yData = await yRes.json();
        const yItems: Array<Record<string, unknown>> = yData?.data?.items ?? [];

        // Broker quotes keyed by normalized symbol (best-effort; may be absent).
        const broker = new Map<string, { last: number; mark: number; close: number; prevClose: number }>();
        if (bRes && bRes.ok) {
          try {
            const bData = await bRes.json();
            const bItems: Array<Record<string, unknown>> = bData?.data?.items ?? [];
            bItems.forEach((it) => {
              broker.set(normalizeSym(String(it.symbol ?? "")), {
                last: num(it.last) ?? 0, mark: num(it.mark) ?? 0,
                close: num(it.close) ?? 0, prevClose: num(it.prevClose) ?? 0,
              });
            });
          } catch { /* broker optional */ }
        }

        const next: Record<string, Rec> = {};
        yItems.forEach((it) => {
          const sym = normalizeSym(String(it.symbol ?? ""));
          const meta = quoteList.find((q) => q.sym === sym)
            ?? DEFAULT_QUOTE_SYMBOLS.find((q) => q.sym === sym);
          if (!meta) return;

          // Yahoo fallback values.
          let last = num(it.last);
          let prev = num(it["prev-close"]);
          const feedPct = num(it["percent-change"]);
          let pct = pctOf(last, prev, feedPct);

          // Prefer broker: live mark/last + AH-correct baseline (today's 4pm
          // close once POST starts; prior day's close through PRE + REG).
          // Falls through to Yahoo when broker is dark.
          const b = broker.get(sym);
          if (b) {
            // Futures: prefer LAST trade (matches TradingView's NQU/ESU print);
            // mark/mid can sit ~10pt off in thin hours. Equities/indices keep
            // mark-first (mid is steadier).
            const isFut = sym.startsWith("/");
            const price = isFut
              ? (b.last > 0 ? b.last : b.mark) || last || 0
              : (b.mark > 0 ? b.mark : b.last) || last || 0;
            // PRE (incl. the ~4am options/equities open) and REG both anchor to
            // prevClose — today's `close` cannot be valid yet. Only POST prefers
            // `close`, and only after today's regular session has actually ended.
            const baseline = phase === "POST"
              ? (b.close > 0 ? b.close : b.prevClose)
              : (b.prevClose > 0 ? b.prevClose : b.close);
            if (price > 0) {
              last = price;
              if (baseline > 0) { prev = baseline; pct = ((price - baseline) / baseline) * 100; }
            }
          }

          next[sym] = {
            sym,
            label: meta.label,
            name: meta.name,
            last,
            prev,
            pct,
            // API returns sparkPre/sparkRth (two legs), never a combined `spark`
            // field — reading `it.spark` was always undefined, so the pill's
            // sparkline silently rendered empty. Stitch the two legs together
            // chronologically (pre-market first, then RTH-to-now).
            spark: [
              ...(Array.isArray(it.sparkPre) ? (it.sparkPre as number[]) : []),
              ...(Array.isArray(it.sparkRth) ? (it.sparkRth as number[]) : []),
            ].filter((v) => Number.isFinite(v)),
            session: it.session === "EXT" ? "EXT" : "REG",
          };
        });
        if (Object.keys(next).length) setRecs((prev) => ({ ...prev, ...next }));
      } catch { /* ignore */ }
    };
    // Deferred off the critical path. These two calls (quotes-batch?spark=1 and
    // tt-quotes, ~16 symbols each) fired synchronously on mount and competed
    // with the page's own data for connections and main-thread time — for a
    // toolbar pill and a dropdown that starts closed. requestIdleCallback lets
    // first paint happen first; the 2s timeout keeps it prompt on a busy page.
    const idle: typeof window.requestIdleCallback | undefined =
      typeof window !== "undefined" ? window.requestIdleCallback : undefined;
    const handle = idle
      ? idle(() => { if (!cancelled) load(); }, { timeout: 2000 })
      : (setTimeout(() => { if (!cancelled) load(); }, 0) as unknown as number);

    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (idle && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(handle as number);
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    };
  }, [quoteList]);

  // Close on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      // Clicks on the VIX/ESU/SPX trigger forward to this button — let that
      // handler toggle, don't also close here (would cancel the toggle).
      if (t instanceof Element && t.closest("[data-quotes-trigger]")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // The add-ticker box starts EMPTY every time the panel opens.
  //
  // addTicker() clears it on the happy path, but abandoning a half-typed symbol
  // and closing the panel used to leave the text sitting there, so the next
  // time you opened the quotes list the footer was still in "adding" mode with
  // a stale ticker in the field waiting to be deleted.
  //
  // Reset on CLOSE rather than on open so the panel never renders one frame of
  // the stale input on the way in.
  useEffect(() => {
    if (!open) { setNewSym(""); setAdding(false); }
  }, [open]);

  const sorted = useMemo(() => {
    // Exclude only the index futures (ESU/NQU) — those stay inline in the top
    // toolbar. VIX and SPX now live here in the dropdown. NQU still drives the
    // main toolbar pill.
    return quoteList.filter((q) => q.sym !== "/ESU26" && q.sym !== "/NQU26")
      .map((q) => recs[q.sym] ?? { sym: q.sym, label: q.label, name: q.name, last: null, prev: null, pct: null, spark: [], session: "REG" as const })
      .sort((a, b) => {
        if (a.pct == null && b.pct == null) return 0;
        if (a.pct == null) return 1;
        if (b.pct == null) return -1;
        return sortDesc ? b.pct - a.pct : a.pct - b.pct;
      });
  }, [recs, sortDesc, quoteList]);

  const pill = recs[PILL_SYMBOL];
  const pillUp = (pill?.pct ?? 0) >= 0;
  const pillColor = pill?.pct == null ? MUTED : pillUp ? UP : DOWN;

  const pillChg = fmtChg(pill?.last ?? null, pill?.prev ?? null);

  return (
    <div style={{ position: "relative", flexShrink: 0, display: "flex", alignItems: "center" }}>
      <button
        ref={(el) => { btnRef.current = el; if (externalBtnRef) externalBtnRef.current = el; }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
          setOpen((v) => !v);
        }}
        title="Click to see all quotes (top gainers first)"
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "none", border: "none", padding: 0, cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {/* Text on the left — same inline style as SPX/ESU/VIX */}
        <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 14, color: "#fff", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {pill?.label ?? "NQU"}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 23, fontWeight: 800, color: "#fff" }}>
            {fmtPrice(pill?.last ?? null)}
          </span>
          <span className="ticker-chg" style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 800, color: pillColor }}>
            {pillChg && <span style={{ marginRight: 4 }}>{pillChg}</span>}({fmtPct(pill?.pct ?? null)})
          </span>
        </span>
        {/* Sparkline — right-aligned after the text */}
        <Sparkline data={pill?.spark ?? []} up={pillUp} width={56} height={22} />
      </button>

      {open && mounted && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: anchor?.top ?? 60,
            right: anchor?.right ?? 16,
            width: 320,
            maxHeight: "70vh",
            overflowY: "auto",
            background: `radial-gradient(circle at 50% 0%, ${cyA(0.07)} 0%, transparent 55%), ${DOCK_PANEL}`,
            border: `1px solid ${DOCK_BORDER}`,
            borderTop: `2px solid ${cyA(0.5)}`,
            borderRadius: 16,
            boxShadow: DOCK_SHADOW,
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            zIndex: 100000,
            padding: 8,
          }}
        >
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px 8px" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.12em", textTransform: "uppercase" }}>Quotes</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {(() => {
                const ext = etSession === "EXT";
                return (
                  <span style={{
                    padding: "3px 7px", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                    color: ext ? "#f59e0b" : DOCK_CYAN,
                    background: ext ? "rgba(245,158,11,0.1)" : cyA(0.1),
                    border: `1px solid ${ext ? "rgba(245,158,11,0.4)" : cyA(0.35)}`,
                  }}>{ext ? "Extended hrs" : "Regular hrs"}</span>
                );
              })()}
              <button
                onClick={() => setSortDesc(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "transparent", border: "none", cursor: "pointer",
                  color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                  fontFamily: "inherit",
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={e => (e.currentTarget.style.color = MUTED)}
              >
                Top gainers
                <span style={{ display: "inline-block", transition: "transform .18s", transform: sortDesc ? "none" : "rotate(180deg)" }}>↑</span>
              </button>
            </div>
          </div>
          {sorted.map((r, i) => {
            const up = (r.pct ?? 0) >= 0;
            const color = r.pct == null ? MUTED : up ? UP : DOWN;
            const chg = fmtChg(r.last, r.prev);
            const isExt = etSession === "EXT";
            return (
              <div
                key={r.sym}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "9px 10px",
                  borderRadius: 8,
                  transition: "background 0.12s",
                  borderTop: i === 0 ? "none" : `1px solid rgba(255,255,255,0.05)`,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {/* Left: line 1 = label + price; line 2 = +/- change and +/-% */}
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <span style={{ fontSize: 14, color: "#fff", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{r.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 900, color: "#fff" }}>{fmtPrice(r.last)}</span>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 800, color }}>
                    {chg && <span style={{ marginRight: 5 }}>{chg}</span>}({fmtPct(r.pct)})
                  </div>
                </div>
                {/* Right: sparkline + EXT/REG note + remove */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Sparkline data={r.spark} up={up} width={56} height={20} />
                  <span style={{
                    padding: "2px 6px", borderRadius: 5, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
                    color: isExt ? "#f59e0b" : MUTED,
                    background: isExt ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${isExt ? "rgba(245,158,11,0.35)" : "rgba(255,255,255,0.08)"}`,
                  }}>
                    {isExt ? "EXT" : "REG"}
                  </span>
                  <button
                    aria-label={`Remove ${r.label}`}
                    title={`Remove ${r.label}`}
                    onClick={(e) => { e.stopPropagation(); removeTicker(r.sym); }}
                    style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      color: MUTED, fontSize: 17, lineHeight: 1, padding: "2px 4px",
                      fontFamily: "inherit",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = DOWN)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = MUTED)}
                  >×</button>
                </div>
              </div>
            );
          })}

          {/* Add-ticker footer */}
          <div style={{ padding: "8px 6px 4px", borderTop: `1px solid rgba(255,255,255,0.06)`, marginTop: 4 }}>
            {adding ? (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  autoFocus
                  value={newSym}
                  onChange={(e) => setNewSym(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTicker();
                    if (e.key === "Escape") { setNewSym(""); setAdding(false); }
                  }}
                  placeholder="Add ticker (e.g. NFLX)"
                  style={{
                    flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 8,
                    background: "rgba(255,255,255,0.05)", color: "#fff",
                    border: `1px solid ${cyA(0.3)}`, fontSize: 14, fontWeight: 700,
                    textTransform: "uppercase", fontFamily: "inherit", outline: "none",
                  }}
                />
                <button
                  onClick={addTicker}
                  style={{
                    padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                    fontSize: 12, fontWeight: 800, color: DOCK_CYAN,
                    background: cyA(0.12), border: `1px solid ${cyA(0.4)}`,
                  }}
                >Add</button>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
                  padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                  fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: MUTED, background: "rgba(255,255,255,0.03)",
                  border: `1px dashed rgba(255,255,255,0.14)`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = DOCK_CYAN; e.currentTarget.style.borderColor = cyA(0.4); }}
                onMouseLeave={(e) => { e.currentTarget.style.color = MUTED; e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; }}
              >
                + Add ticker
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
