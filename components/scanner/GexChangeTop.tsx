"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GEX Change — Hourly Top 5 (recorded history)
//
// Read-only viewer over gex_change_top: the top 5 "★ Very strong" strikes by
// combined score, captured at the top of every RTH hour by
// server-v2/gex-change-top-recorder.js. One section per hour (most recent
// first), each a ranked 5-row table — so you can scroll back through the day and
// see which strikes were building hardest, hour by hour, without a live tab.
//
// CARD FLIP: every pick is auto-probed by the recorder the moment it is captured
// (POST /api/watch → watch_options + a 60s snapshot loop), and the resulting
// watch id rides along on the row. Clicking a card flips it over to that
// contract's recorded option price / net GEX for the session — Price and Net GEX
// only, single-day lookback, which is all the small tile has room to say.
//
// Reads GET /proxy/gex-change-top?date=YYYY-MM-DD (defaults to today) and, per
// flipped card, GET /proxy/gex-change-top-history?id=<watch_id>&date=<date>.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { HOME_THEME, homeButtonStyle, classicCardAccentStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { captureAndCopy, captureToBlob, copyOrDownload, downloadBlob } from "@/lib/snapshot";

type Row = {
  slot: string; rank: number; symbol: string; expiry: string; strike: number;
  spot: number | null; latest_chg: number | null; pct_open: number | null;
  z_score: number | null; score: number | null; window_min: number;
  /** watch_options.id of the auto-probed contract — null on pre-auto-probe rows. */
  watch_id: number | null;
};
type SlotBucket = { slot: string; ts: string; rows: Row[] };

type PickPoint = { ts: number; mark: number | null; net_gex: number | null };
type PickContract = { ticker: string; expiration: string; strike: number; side: string; added_price: number | null };
type PickHist = { points: PickPoint[]; contract: PickContract | null; error?: string };
type Metric = "mark" | "net_gex";

/** One row of the EOD scorecard — /proxy/gex-change-top-results. */
type ResultRow = {
  watch_id: number; symbol: string; expiry: string; strike: number; side: string | null;
  first_slot: string | null; slots: number | null; best_rank: number | null; score: number | null;
  entry: number | null; entry_ts: number | null;
  max_mark: number | null; max_ts: number | null; max_pct: number | null;
  min_mark: number | null; min_pct: number | null;
  close_mark: number | null; close_ts: number | null; close_pct: number | null;
  samples: number | null;
};

// Theme alpha helper — colors still come from homeTheme, never a literal hex.
const tint = (hex: string, a: number): string => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

// Big Δ headline, matching the GEX Change Scanner card ("-8.6M", no $ sign).
const fmtBig = (v: number | null): string => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`;
  return `${s}${(a / 1e6).toFixed(1)}M`;
};
const fmtStrike = (v: number): string => (Number.isInteger(v) ? v.toLocaleString("en-US") : String(v));
const fmtSpot = (v: number | null): string => (v == null || !(v > 0) ? "—" : v.toFixed(2));
const fmtPx = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(2));
// Signed $ for the net-GEX axis ("+$1.20M").
const fmtGex = (v: number | null): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), sign = v >= 0 ? "+" : "−";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  return `${sign}$${(a / 1e3).toFixed(0)}K`;
};
// "HH:MM" (24h ET) → "H:MM AM/PM ET"
const slotLabel = (slot: string): string => {
  const [hStr, mStr] = slot.split(":");
  const h = Number(hStr);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${mStr ?? "00"} ${ampm} ET`;
};
// "YYYY-MM-DD" + "HH:MM" → "Jul 30 · 10:30 AM ET". Stamped on each pick card so a
// single-card screenshot carries its own capture time — the slot header above is
// data-noshot and therefore absent from the image.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const capturedLabel = (day: string, slot: string): string => {
  const time = slotLabel(slot);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
  if (!m) return time;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])} · ${time}`;
};
// Snapshots accrue around the clock; the card only charts the cash session.
/** epoch ms → "1:42 PM" ET, for the peak/close stamps in the scorecard. */
const fmtClock = (ts: number | null): string => {
  if (ts == null || !Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
  });
};
const fmtPct = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`);

const isRth = (ts: number): boolean => {
  if (!Number.isFinite(ts)) return false;
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(new Date(ts));
  const get = (k: string) => p.find((x) => x.type === k)?.value;
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
};

const METRICS: { key: Metric; label: string }[] = [
  { key: "mark", label: "Price" },
  { key: "net_gex", label: "Net GEX" },
];

// Mono numerals, matching the Probe page's --sm-mono treatment.
const MONO = "var(--font-mono)";

/** "42s ago" / "6m ago" — the Probe card's freshness stamp. */
const ago = (ts: number | null | undefined): string => {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

/**
 * The flip side's chart — a port of ProbeChart from the owner Probe page
 * (owner-vite/src/pages/Probe.tsx): same 960-wide viewBox, 5 gridlines with
 * left-hand value ticks, first/last time labels along the bottom, cyan line over
 * a fading area fill. Kept deliberately identical so the two pages read the
 * same; the only additions are the dashed entry baseline on Price and the zero
 * line on Net GEX.
 */
function PickChart({ points, metric, entry }: { points: PickPoint[]; metric: Metric; entry: number | null }) {
  // Index of the sample under the cursor — drives the crosshair readout.
  const [hover, setHover] = useState<number | null>(null);
  // The viewBox is set to the box's REAL pixel width at a FIXED pixel height, so
  // one viewBox unit == one CSS pixel: tick text renders at its literal size and
  // the chart's height never changes with the tile width (which is what let the
  // back face overflow its tile before). Callback ref so the observer attaches
  // whenever the box mounts, including after the "no history yet" state.
  const [boxW, setBoxW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const attachBox = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    setBoxW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBoxW(Math.round(cr.width));
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => { roRef.current?.disconnect(); }, []);

  const W = Math.max(160, boxW || 240), H = 96, PADL = 44, PADR = 8, PADT = 6, PADB = 16;
  const pts = points
    .map((p) => ({ ts: p.ts, v: metric === "mark" ? p.mark : p.net_gex }))
    .filter((p) => p.v != null && Number.isFinite(p.v as number)) as { ts: number; v: number }[];

  if (pts.length < 2) {
    return (
      <div ref={attachBox} style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: HOME_THEME.text, textAlign: "center", lineHeight: 1.5 }}>
          not enough history yet —<br />snapshots accrue every minute through RTH
        </span>
      </div>
    );
  }

  const showEntry = metric === "mark" && entry != null && Number.isFinite(entry);
  const xs = pts.map((p) => p.ts), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const dom = showEntry ? [...ys, entry as number] : ys;
  let minY = Math.min(...dom), maxY = Math.max(...dom);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const pad = (maxY - minY) * 0.08; minY -= pad; maxY += pad;

  const n = pts.length;
  const sx = (i: number) => PADL + (n <= 1 ? 0 : i / (n - 1)) * (W - PADL - PADR);
  const sy = (v: number) => H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(n - 1).toFixed(1)},${H - PADB} L${sx(0).toFixed(1)},${H - PADB} Z`;
  const last = pts[n - 1].v;

  const fmtY = (v: number) => (metric === "net_gex" ? fmtGex(v) : v.toFixed(2));
  const yTicks = [0, 0.5, 1].map((f) => minY + f * (maxY - minY));
  const fmtT = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const tickFill = HOME_THEME.text;

  // Hovered sample. Mouse x → nearest index, in viewBox units so it stays right
  // at any tile width. Cleared on leave, which restores the "latest" dot.
  const hi = hover != null ? Math.min(Math.max(hover, 0), n - 1) : null;
  const hp = hi != null ? pts[hi] : null;
  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    const x = ((e.clientX - box.left) / box.width) * W;
    const frac = (x - PADL) / (W - PADL - PADR);
    setHover(Math.round(Math.min(Math.max(frac, 0), 1) * (n - 1)));
  };

  // Crosshair readout boxes, clamped so they never spill outside the plot.
  const hx = hp ? sx(hi as number) : 0;
  const hy = hp ? sy(hp.v) : 0;
  const tLabel = hp ? fmtT(hp.ts) : "";
  const tW = Math.max(30, tLabel.length * 5.4 + 8);
  const tX = Math.min(Math.max(hx - tW / 2, 0), W - tW);
  const vLabel = hp ? fmtY(hp.v) : "";
  const vW = Math.min(PADL - 2, Math.max(26, vLabel.length * 5.4 + 8));
  const vY = Math.min(Math.max(hy - 6.5, 0), H - PADB - 13);

  return (
    <div ref={attachBox}>
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: H, display: "block", cursor: "crosshair" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      // Reading the chart must not flip the card back (same as the Probe page's
      // .op-chartwrap, which stops the click from reaching the card).
      onClick={(e) => e.stopPropagation()}
    >
      <defs>
        <linearGradient id="gct-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tint(HOME_THEME.cyan, 0.28)} />
          <stop offset="100%" stopColor={tint(HOME_THEME.cyan, 0)} />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} stroke={tint(HOME_THEME.text, 0.08)} strokeWidth={1} />
          <text x={PADL - 5} y={sy(v) + 3} textAnchor="end" fontSize={9} fill={tickFill} fontFamily={MONO}>{fmtY(v)}</text>
        </g>
      ))}
      <text x={PADL} y={H - 4} textAnchor="start" fontSize={9} fill={tickFill} fontFamily={MONO}>{fmtT(minX)}</text>
      <text x={W - PADR} y={H - 4} textAnchor="end" fontSize={9} fill={tickFill} fontFamily={MONO}>{fmtT(maxX)}</text>
      {metric === "net_gex" && minY < 0 && maxY > 0 && (
        <line x1={PADL} y1={sy(0)} x2={W - PADR} y2={sy(0)} stroke={tint(HOME_THEME.text, 0.2)} strokeWidth={1} />
      )}
      {showEntry && (
        <line
          x1={PADL} y1={sy(entry as number)} x2={W - PADR} y2={sy(entry as number)}
          stroke={tint(HOME_THEME.text, 0.35)} strokeWidth={1} strokeDasharray="4 4"
        />
      )}
      <path d={area} fill="url(#gct-fill)" />
      <path d={line} fill="none" stroke={HOME_THEME.cyan} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      {hp ? (
        <g>
          {/* Crosshair: time chip on the x axis, value chip on the y axis. */}
          <line x1={hx} y1={PADT} x2={hx} y2={H - PADB} stroke={tint(HOME_THEME.cyan, 0.5)} strokeWidth={1} strokeDasharray="3 3" />
          <circle cx={hx} cy={hy} r={3} fill={HOME_THEME.cyan} stroke={HOME_THEME.bg} strokeWidth={1} />
          <rect x={tX} y={H - PADB + 2} width={tW} height={13} rx={3} fill={HOME_THEME.bg} stroke={tint(HOME_THEME.cyan, 0.4)} strokeWidth={1} />
          <text x={tX + tW / 2} y={H - PADB + 11} textAnchor="middle" fontSize={9} fill={HOME_THEME.text} fontFamily={MONO}>{tLabel}</text>
          <rect x={0} y={vY} width={vW} height={13} rx={3} fill={HOME_THEME.bg} stroke={tint(HOME_THEME.cyan, 0.4)} strokeWidth={1} />
          <text x={vW / 2} y={vY + 9} textAnchor="middle" fontSize={9} fill={HOME_THEME.cyan} fontFamily={MONO}>{vLabel}</text>
        </g>
      ) : (
        <circle cx={sx(n - 1)} cy={sy(last)} r={3} fill={HOME_THEME.cyan} />
      )}
    </svg>
    </div>
  );
}

export default function GexChangeTop() {
  const [slots, setSlots] = useState<SlotBucket[]>([]);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback((d?: string) => {
    setLoading(true); setErr(null);
    const u = new URL("/proxy/gex-change-top", window.location.origin);
    if (d) u.searchParams.set("date", d);
    fetch(u.toString(), { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { setErr(j?.error || "load failed"); setSlots([]); return; }
        setSlots(j.slots || []);
        setDate(j.date || "");
      })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  // ── EOD scorecard ───────────────────────────────────────────────────────────
  // Frozen after the close by the recorder; computed live from the snapshots
  // before that, so during the session this reads "peak so far".
  const [results, setResults] = useState<ResultRow[]>([]);
  const [frozen, setFrozen] = useState(false);
  const [resErr, setResErr] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(true);

  const loadResults = useCallback((d?: string) => {
    const u = new URL("/proxy/gex-change-top-results", window.location.origin);
    if (d) u.searchParams.set("date", d);
    fetch(u.toString(), { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { setResErr(j?.error || "load failed"); setResults([]); return; }
        setResErr(null);
        setResults(Array.isArray(j.rows) ? j.rows : []);
        setFrozen(!!j.frozen);
      })
      .catch((e) => setResErr(String(e?.message || e)));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadResults(date || undefined); }, [loadResults, date]);
  useEffect(() => {
    const t = setInterval(() => {
      load(date || undefined);
      loadResults(date || undefined);
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load, loadResults, date]);

  // ── Card flip → the pick's own price/net-GEX line ───────────────────────────
  // Lazy: nothing is fetched until a card is turned over. Keyed by watch_id, so
  // the same contract appearing in several slots shares one fetch.
  const [flipped, setFlipped] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("mark");
  const [hist, setHist] = useState<Record<number, PickHist>>({});
  const [histLoading, setHistLoading] = useState<Record<number, boolean>>({});
  // Cards whose back face has ever been shown. The back face is a SECOND frosted
  // (backdrop-filter) surface, so mounting one per tile up front would double the
  // blur passes across ~65 tiles for a chart nobody has asked for yet. Only these
  // mount a back — and they stay mounted so the flip-back animates with content.
  const [opened, setOpened] = useState<Record<string, true>>({});
  // Honour the OS "reduce motion" setting — and give us a single place to kill
  // the rotation if it ever costs more than it's worth.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  const loadPick = useCallback(async (watchId: number, day: string) => {
    setHistLoading((s) => ({ ...s, [watchId]: true }));
    try {
      const u = new URL("/proxy/gex-change-top-history", window.location.origin);
      u.searchParams.set("id", String(watchId));
      if (day) u.searchParams.set("date", day);
      const j = await fetch(u.toString(), { cache: "no-store" }).then((r) => r.json());
      setHist((s) => ({
        ...s,
        [watchId]: j?.ok
          ? { points: (j.points || []).filter((p: PickPoint) => isRth(Number(p.ts))), contract: j.contract ?? null }
          : { points: [], contract: null, error: j?.error || "no history" },
      }));
    } catch (e) {
      setHist((s) => ({ ...s, [watchId]: { points: [], contract: null, error: String((e as Error)?.message || e) } }));
    } finally {
      setHistLoading((s) => ({ ...s, [watchId]: false }));
    }
  }, []);

  // The currently open card's watch id — used for the while-open refresh below.
  const openWatchId = useMemo(() => {
    if (!flipped) return null;
    for (const hb of slots) {
      for (const r of hb.rows) {
        if (`${r.symbol}-${r.strike}-${hb.slot}` === flipped) return r.watch_id;
      }
    }
    return null;
  }, [flipped, slots]);

  useEffect(() => {
    if (openWatchId == null) return;
    const t = setInterval(() => void loadPick(openWatchId, date), 60_000);
    return () => clearInterval(t);
  }, [openWatchId, date, loadPick]);

  const toggleFlip = useCallback((cid: string, watchId: number | null) => {
    if (watchId == null) return; // recorded before auto-probe existed — nothing to chart
    setOpened((s) => (s[cid] ? s : { ...s, [cid]: true }));
    setFlipped((cur) => {
      if (cur === cid) return null;
      void loadPick(watchId, date);
      return cid;
    });
  }, [date, loadPick]);

  // ── Screenshot the card ─────────────────────────────────────────────────────
  // Capture mechanics live in lib/snapshot.ts. Controls inside a card are marked
  // data-noshot="1" and the shared engine drops them from the image; the
  // clipboard-then-download fallback is shared too, so all three call sites
  // below behave identically instead of each rolling their own.
  const cardRef = useRef<HTMLDivElement>(null);
  const [shooting, setShooting] = useState<null | "download" | "copy">(null);

  const capture = useCallback(async (mode: "download" | "copy") => {
    if (!cardRef.current || shooting) return;
    setShooting(mode);
    setFlipped(null); // a mid-flip card rasterizes as both faces at once
    const fname = `gex-change-top-${date || "today"}.png`;
    try {
      const blob = await captureToBlob(cardRef.current);
      if (mode === "copy") await copyOrDownload(blob, fname);
      else downloadBlob(blob, fname);
    } catch {
      /* capture failed — nothing useful to show, the button just resets */
    } finally {
      setShooting(null);
    }
  }, [date, shooting]);

  // Per-card capture state so the 📷 gives feedback: idle → busy → "copied"/"saved".
  const [cardState, setCardState] = useState<Record<string, "busy" | "copied" | "saved">>({});

  // Capture a SINGLE pick card to PNG.
  const shotCard = useCallback(async (node: HTMLElement | null, id: string, name: string) => {
    if (!node || cardState[id] === "busy") return;
    setCardState((s) => ({ ...s, [id]: "busy" }));
    try {
      const result = await captureAndCopy(node, `${name}.png`);
      setCardState((s) => ({ ...s, [id]: result }));
      setTimeout(() => setCardState((s) => { const n = { ...s }; delete n[id]; return n; }), 1800);
    } catch {
      setCardState((s) => { const n = { ...s }; delete n[id]; return n; });
    }
  }, [cardState]);

  // Shared surface for both faces of a pick tile — classicCardAccentStyle exactly
  // as the theme defines it: flat frosted panel, hairline edge, NO radial
  // highlight and no tint wash. Do not reintroduce a glow here.
  // Both faces fill the same tile box, so the card is exactly the same size
  // whichever way up it is.
  const faceStyle: CSSProperties = {
    ...classicCardAccentStyle,
    position: "absolute",
    inset: 0,
    padding: "12px 14px",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    overflow: "hidden",
  };
  // The Probe page's .op-tgl pill: neutral when off, white-wash when on for the
  // range group, cyan for the metric group.
  const tglStyle = (on: boolean, cyan = false): CSSProperties => ({
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.02em",
    cursor: "pointer",
    padding: "3px 7px",
    borderRadius: 5,
    border: `1px solid ${on && cyan ? tint(HOME_THEME.cyan, 0.4) : HOME_THEME.border}`,
    background: on ? (cyan ? tint(HOME_THEME.cyan, 0.12) : tint(HOME_THEME.text, 0.08)) : "transparent",
    color: on ? (cyan ? HOME_THEME.cyan : HOME_THEME.text) : HOME_THEME.text,
  });
  // .op-badge — the strike+side chip next to the ticker.
  const badgeStyle = (side: "C" | "P"): CSSProperties => {
    const c = side === "P" ? HOME_THEME.orange : HOME_THEME.green;
    return {
      fontFamily: MONO, fontSize: 11, fontWeight: 700, padding: "1px 5px",
      borderRadius: 4, marginLeft: 5, color: c,
      background: tint(c, 0.12), border: `1px solid ${tint(c, 0.4)}`,
    };
  };
  const lblStyle: CSSProperties = {
    color: HOME_THEME.text, fontSize: 9,
    textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 3,
  };
  const th: CSSProperties = {
    textAlign: "right", padding: "6px 8px", fontSize: 11, fontWeight: 700,
    letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.green,
    borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap",
  };
  const td: CSSProperties = {
    textAlign: "right", padding: "6px 8px", fontFamily: MONO, fontSize: 13,
    color: HOME_THEME.text, borderBottom: `1px solid ${tint(HOME_THEME.text, 0.05)}`, whiteSpace: "nowrap",
  };

  // Scorecard summary — filter to entry > 0.5 to remove noise, then count picks that offered real exits.
  const filteredResults = results.filter((r) => r.entry != null && r.entry > 0.5);
  const withPeak = filteredResults.filter((r) => r.max_pct != null);
  const hit = (n: number) => withPeak.filter((r) => (r.max_pct as number) >= n).length;
  const avgPeak = withPeak.length ? withPeak.reduce((a, r) => a + (r.max_pct as number), 0) / withPeak.length : null;
  const greenClose = filteredResults.filter((r) => r.close_pct != null && (r.close_pct as number) > 0).length;

  return (
   <div ref={cardRef}>
    <Card
      variant="budget"
      title={<span style={{ fontSize: 17 }}>GEX Change · Hourly Top 5</span>}
      subtitle={`★ Very strong picks (|Δ| ≥ $200k & |% vs open| ≥ 30%), ranked by score · captured every 30 min during RTH${loading ? " · refreshing…" : ""}`}
    >
      <div data-noshot="1" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value); setFlipped(null); setOpened({});
            load(e.target.value || undefined); loadResults(e.target.value || undefined);
          }}
          style={{ ...homeButtonStyle, padding: "6px 10px", fontSize: 13, colorScheme: "dark" as CSSProperties["colorScheme"] }}
        />
        <button
          onClick={() => { load(date || undefined); loadResults(date || undefined); }}
          style={{ ...homeButtonStyle, padding: "6px 12px", fontSize: 13 }}
        >
          Refresh
        </button>
        <span style={{ fontSize: 12, color: HOME_THEME.text }}>click a card for its option price line</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => capture("copy")}
          disabled={shooting !== null}
          style={{ ...homeButtonStyle, padding: "6px 12px", fontSize: 13, opacity: shooting ? 0.6 : 1 }}
        >
          {shooting === "copy" ? "Copying…" : "⧉ Copy image"}
        </button>
        <button
          onClick={() => capture("download")}
          disabled={shooting !== null}
          style={{ ...homeButtonStyle, padding: "6px 12px", fontSize: 13, opacity: shooting ? 0.6 : 1, borderColor: HOME_THEME.orange, color: HOME_THEME.orange }}
        >
          {shooting === "download" ? "Saving…" : "📷 Screenshot"}
        </button>
      </div>

      {/* ── EOD scorecard ──────────────────────────────────────────────────────
          The point of auto-probing: what was the best exit on offer AFTER each
          pick was flagged, and when did it print. Peak/low/close are measured
          from the probe mark, never from the open. */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ color: HOME_THEME.orange, fontWeight: 800, fontSize: 15 }}>Scorecard</span>
          <span style={{ ...tglStyle(true), cursor: "default", fontSize: 9 }}>
            {frozen ? "EOD · final" : "live · peak so far"}
          </span>
          {filteredResults.length > 0 && (
            <span style={{ fontSize: 12, color: HOME_THEME.text }}>
              {filteredResults.length} pick{filteredResults.length === 1 ? "" : "s"} (entry &gt; $0.50) · avg peak{" "}
              <b style={{ color: avgPeak != null && avgPeak >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{fmtPct(avgPeak)}</b>
              {" · "}≥+25% <b style={{ color: HOME_THEME.text }}>{hit(25)}</b>
              {" · "}≥+50% <b style={{ color: HOME_THEME.text }}>{hit(50)}</b>
              {" · "}≥+100% <b style={{ color: HOME_THEME.text }}>{hit(100)}</b>
              {" · "}closed green <b style={{ color: HOME_THEME.text }}>{greenClose}</b>
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            data-noshot="1"
            onClick={() => setShowResults((s) => !s)}
            style={{ ...homeButtonStyle, padding: "4px 10px", fontSize: 11 }}
          >
            {showResults ? "Hide" : "Show"}
          </button>
        </div>

        {resErr && <div style={{ color: HOME_THEME.red, fontSize: 13, padding: "4px 0" }}>Scorecard error: {resErr}</div>}

        {showResults && !resErr && (
          filteredResults.length === 0 ? (
            <div style={{ color: HOME_THEME.text, fontSize: 13, padding: "8px 4px" }}>
              {results.length === 0 ? "No scored picks for this date yet — rows appear once picks have been auto-probed and snapshots start landing." : "No picks with entry > $0.50 for this date (all entries < $0.50 filtered out as noise)."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                    <th style={{ ...th, textAlign: "left" }}>Contract</th>
                    <th style={{ ...th, textAlign: "left" }}>Flagged</th>
                    <th style={th}>Entry</th>
                    <th style={th}>Peak</th>
                    <th style={{ ...th, textAlign: "left" }}>Peak at</th>
                    <th style={th}>Peak %</th>
                    <th style={th}>$/ct</th>
                    <th style={th}>Close</th>
                    <th style={th}>Close %</th>
                    <th style={th}>Low %</th>
                  </tr>
                </thead>
                <tbody>
                  {results.filter((r) => r.entry != null && r.entry > 0.5).map((r) => {
                    const sideC = r.side === "P" ? HOME_THEME.orange : HOME_THEME.green;
                    const peakDollars = r.entry != null && r.max_mark != null ? (r.max_mark - r.entry) * 100 : null;
                    return (
                      <tr key={`${r.watch_id}-${r.first_slot}`}>
                        <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>{r.symbol}</td>
                        <td style={{ ...td, textAlign: "left", color: sideC }}>
                          {fmtStrike(r.strike)}{r.side ?? ""} <span style={{ color: HOME_THEME.text }}>{r.expiry}</span>
                        </td>
                        <td style={{ ...td, textAlign: "left", color: HOME_THEME.text }}>
                          {r.first_slot ? slotLabel(r.first_slot).replace(" ET", "") : "—"}
                          {r.slots != null && r.slots > 1 && (
                            <span style={{ color: HOME_THEME.text }}> ×{r.slots}</span>
                          )}
                        </td>
                        <td style={td}>{fmtPx(r.entry)}</td>
                        <td style={td}>{fmtPx(r.max_mark)}</td>
                        <td style={{ ...td, textAlign: "left", color: HOME_THEME.text }}>{fmtClock(r.max_ts)}</td>
                        <td style={{ ...td, fontWeight: 800, color: r.max_pct == null ? HOME_THEME.text : r.max_pct >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                          {fmtPct(r.max_pct)}
                        </td>
                        <td style={{ ...td, color: HOME_THEME.text }}>
                          {peakDollars == null ? "—" : `${peakDollars >= 0 ? "+" : "−"}$${Math.abs(peakDollars).toFixed(0)}`}
                        </td>
                        <td style={td}>{fmtPx(r.close_mark)}</td>
                        <td style={{ ...td, color: r.close_pct == null ? HOME_THEME.text : r.close_pct >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                          {fmtPct(r.close_pct)}
                        </td>
                        <td style={{ ...td, color: HOME_THEME.text }}>{fmtPct(r.min_pct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 6, fontSize: 11, color: HOME_THEME.text }}>
                Entry = the auto-probe mark at the slot the strike was first flagged. Peak / Low / Close are measured from
                that entry, over snapshots taken after it — the best exit that was actually on offer, not a fill.
              </div>
            </div>
          )
        )}
      </div>

      {err && <div style={{ color: HOME_THEME.red, fontSize: 13, padding: "8px 0" }}>Error: {err}</div>}

      {!err && slots.length === 0 && (
        <div style={{ color: HOME_THEME.text, fontSize: 14, padding: "16px 4px" }}>
          {loading ? "Loading…" : "No very-strong picks recorded yet for this date. The recorder captures the top 5 every 30 min during RTH going forward."}
        </div>
      )}

      {slots.map((hb) => (
        <div key={hb.slot} style={{ marginBottom: 22 }}>
          <div data-noshot="1" style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <span style={{ color: HOME_THEME.orange, fontWeight: 800, fontSize: 15 }}>{slotLabel(hb.slot)}</span>
            <span style={{ color: HOME_THEME.text, fontSize: 12 }}>{hb.rows.length} pick{hb.rows.length === 1 ? "" : "s"}</span>
          </div>
          <div className="gct-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {hb.rows.map((r) => {
              const up = (r.latest_chg ?? 0) >= 0;
              const col = up ? HOME_THEME.green : HOME_THEME.red;
              const otmPct = r.spot && r.spot > 0 ? (Math.abs(r.strike - r.spot) / r.spot) * 100 : null;
              const cid = `${r.symbol}-${r.strike}-${hb.slot}`;
              const st = cardState[cid];
              const wid = r.watch_id;
              const isFlipped = flipped === cid;
              const hasBack = isFlipped || !!opened[cid]; // see `opened` above
              const h = wid != null ? hist[wid] : undefined;
              const pts = h?.points ?? [];
              const side = r.spot != null && r.spot > 0 && r.strike < r.spot ? "P" : "C";
              const entry = h?.contract?.added_price ?? null;
              const lastPt = [...pts].reverse().find((p) => p.mark != null) ?? null;
              const lastMark = lastPt?.mark ?? null;
              const lastTs = [...pts].reverse().find((p) => Number.isFinite(p.ts))?.ts ?? null;
              const pnlPct = entry != null && entry !== 0 && lastMark != null ? ((lastMark - entry) / entry) * 100 : null;
              const pnlDollars = entry != null && lastMark != null ? (lastMark - entry) * 100 : null;
              const pnlColor = pnlPct == null ? HOME_THEME.text : pnlPct > 0 ? HOME_THEME.green : pnlPct < 0 ? HOME_THEME.red : HOME_THEME.text;

              return (
                <div
                  key={`${r.symbol}-${r.expiry}-${r.strike}`}
                  data-card="1"
                  onClick={() => toggleFlip(cid, wid)}
                  title={wid == null ? undefined : isFlipped ? "Back to the pick" : `Chart ${r.symbol} ${fmtStrike(r.strike)}${side}`}
                  style={{
                    // Both faces live inside the tile — flipping never resizes the
                    // card or reflows the grid.
                    position: "relative",
                    // Sized for the taller of the two faces: the chart side is
                    // header + headline + toolbar + a fixed 96px chart + hint.
                    minHeight: 244,
                    perspective: 1200,
                    cursor: wid == null ? "default" : "pointer",
                  }}
                >
                  <div
                    style={{
                      // MUST be absolute+inset: both faces are absolutely
                      // positioned against THIS box, so if it is left in normal
                      // flow it has no height and the whole tile collapses.
                      position: "absolute",
                      inset: 0,
                      transformStyle: "preserve-3d",
                      // Only the transform animates (compositor-only, no layout or
                      // paint), and will-change is set ONLY on tiles that have
                      // actually been opened — leaving it on every tile would
                      // promote ~65 layers for nothing.
                      transition: reduceMotion ? "none" : "transform 0.32s ease-out",
                      transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                      willChange: hasBack ? "transform" : undefined,
                    }}
                  >
                    {/* ── Front: the recorded pick ─────────────────────────── */}
                    <div style={faceStyle}>
                      <button
                        data-noshot="1"
                        onClick={(e) => {
                          e.stopPropagation();
                          shotCard((e.currentTarget as HTMLElement).closest("[data-card]") as HTMLElement, cid, `${r.symbol}-${r.strike}-${hb.slot.replace(":", "")}`);
                        }}
                        disabled={st === "busy"}
                        title="Screenshot / copy this card"
                        style={{
                          position: "absolute", top: 6, right: 6, cursor: st === "busy" ? "default" : "pointer",
                          border: st ? `1px solid ${st === "busy" ? tint(HOME_THEME.text, 0.2) : HOME_THEME.green}` : "1px solid transparent",
                          borderRadius: 6, background: st && st !== "busy" ? tint(HOME_THEME.bg, 0.35) : "transparent",
                          fontSize: 12, lineHeight: 1, fontWeight: 700, padding: "3px 6px",
                          color: st === "busy" ? HOME_THEME.text : st ? HOME_THEME.green : HOME_THEME.text,
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}
                      >
                        {st === "busy" ? "…" : st === "copied" ? "✓ Copied" : st === "saved" ? "✓ Saved" : "📷"}
                      </button>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, paddingRight: 18 }}>
                        <span style={{ fontWeight: 800, fontSize: 17, color: HOME_THEME.text }}>
                          <span style={{ color: HOME_THEME.text, marginRight: 6 }}>{r.rank}</span>{r.symbol}
                        </span>
                        <span style={{ fontSize: 14, color: HOME_THEME.text }}>{fmtStrike(r.strike)}</span>
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: col, lineHeight: 1.2 }}>{fmtBig(r.latest_chg)}</div>
                      <div style={{ fontSize: 14, color: HOME_THEME.text, marginTop: 4 }}>
                        {r.expiry} · spot {fmtSpot(r.spot)}
                      </div>
                      <div style={{ fontSize: 12, color: HOME_THEME.text, marginTop: 2 }}>
                        captured {capturedLabel(date, hb.slot)}
                      </div>
                      <div style={{ display: "flex", gap: 10, fontSize: 14, marginTop: 6, flexWrap: "wrap" }}>
                        {otmPct != null && <span style={{ color: HOME_THEME.orange }}>OTM {otmPct.toFixed(1)}%</span>}
                        <span style={{ color: r.pct_open == null ? HOME_THEME.text : r.pct_open >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                          {r.pct_open == null ? "—" : `${r.pct_open >= 0 ? "+" : ""}${r.pct_open.toFixed(0)}% vs open`}
                        </span>
                        <span style={{ color: HOME_THEME.cyan }}>score {r.score == null ? "—" : r.score.toFixed(0)}</span>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 14, fontWeight: 800, color: HOME_THEME.orange, paddingRight: 78 }}>★ Very strong</div>
                      {wid != null && (
                        <div data-noshot="1" style={{ position: "absolute", left: 14, bottom: 8, fontSize: 11, color: tint(HOME_THEME.cyan, 0.75) }}>
                          ▸ price line
                        </div>
                      )}
                      {/* Brand mark — kept in the screenshot (not data-noshot). */}
                      <img
                        src="/cb-edge-logo.png"
                        alt="CB Edge"
                        style={{ position: "absolute", right: 10, bottom: 8, height: 32, width: "auto", opacity: 0.85, pointerEvents: "none" }}
                      />
                    </div>

                    {/* ── Back: the auto-probed contract's session line ─────── */}
                    {hasBack && (
                    <div style={{ ...faceStyle, transform: "rotateY(180deg)", padding: "10px 12px" }}>
                      {/* Header — .op-tcard-h: ticker, strike+side badge, close. */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.text }}>{r.symbol}</span>
                          <span style={badgeStyle(side)}>{fmtStrike(r.strike)}{side}</span>
                        </div>
                        <button
                          data-noshot="1"
                          onClick={(e) => { e.stopPropagation(); toggleFlip(cid, wid); }}
                          title="Back to the pick"
                          style={{
                            background: "none", border: "none", cursor: "pointer", padding: "0 2px",
                            fontSize: 15, lineHeight: 1, color: HOME_THEME.text,
                          }}
                        >
                          ×
                        </button>
                      </div>
                      {/* .op-rowsub — expiry + when this contract was flagged. */}
                      <div style={{ fontFamily: MONO, fontSize: 10, color: HOME_THEME.text, marginTop: 2 }}>
                        {r.expiry} · {capturedLabel(date, hb.slot)}
                      </div>
                      {/* .op-bigrow — the headline move off the entry basis. */}
                      <div style={{ margin: "6px 0 4px" }}>
                        <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 800, lineHeight: 1, color: pnlColor }}>
                          {pnlPct == null ? "—" : `${pnlPct >= 0 ? "▲" : "▼"} ${Math.abs(pnlPct).toFixed(1)}%`}
                        </div>
                        <div style={{ fontFamily: MONO, fontSize: 11, color: HOME_THEME.text, marginTop: 4, whiteSpace: "nowrap" }}>
                          <span style={lblStyle}>in</span>{fmtPx(entry)}
                          <span style={{ color: HOME_THEME.text, margin: "0 4px" }}>→</span>
                          <span style={lblStyle}>now</span>{fmtPx(lastMark)}
                          {pnlDollars != null && (
                            <span style={{ fontWeight: 700, color: pnlColor }}>
                              {` · ${pnlDollars >= 0 ? "+" : "−"}$${Math.abs(pnlDollars).toFixed(0)}/ct`}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* .op-toolbar — range left, metric right. 1D and Price/Net
                          GEX only: the recorder's snapshots are a session series,
                          and the other four greeks aren't what this card is for. */}
                      <div data-noshot="1" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                        <span style={{ ...tglStyle(true), cursor: "default" }}>1D</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          {METRICS.map((m) => (
                            <button
                              key={m.key}
                              onClick={(e) => { e.stopPropagation(); setMetric(m.key); }}
                              style={tglStyle(metric === m.key, true)}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {wid != null && histLoading[wid] && !pts.length ? (
                        <div style={{ fontFamily: MONO, fontSize: 10, color: HOME_THEME.text, textAlign: "center", padding: "26px 0" }}>loading history…</div>
                      ) : h?.error ? (
                        <div style={{ fontFamily: MONO, fontSize: 10, color: HOME_THEME.red, textAlign: "center", padding: "26px 0" }}>{h.error}</div>
                      ) : (
                        <PickChart points={pts} metric={metric} entry={entry} />
                      )}
                      {/* .op-charthint */}
                      <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 9, color: HOME_THEME.text, letterSpacing: "0.03em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {metric === "mark" ? "price (mark)" : "net gex @ strike"} · RTH · entry @ {fmtPx(entry)} · {ago(lastTs)}
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <style>{`
        @media (max-width: 1100px) { .gct-grid { grid-template-columns: repeat(3, 1fr) !important; } }
        @media (max-width: 720px)  { .gct-grid { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 460px)  { .gct-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: HOME_THEME.text }}>
        <span>Score = 0.6·|Δ| + 0.4·|% vs open|, normalized 0–100</span>
        <span><span style={{ color: HOME_THEME.orange }}>★ Very strong</span> = |Δ| ≥ $200k AND |% vs open| ≥ 30%</span>
        <span>Every pick is auto-probed at capture — the flip side is its recorded option price since it was flagged</span>
      </div>
    </Card>
   </div>
  );
}
