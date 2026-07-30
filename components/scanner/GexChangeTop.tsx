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
import type { CSSProperties } from "react";
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
  const W = 960, H = 300, PADL = 64, PADR = 16, PADT = 16, PADB = 28;
  const pts = points
    .map((p) => ({ ts: p.ts, v: metric === "mark" ? p.mark : p.net_gex }))
    .filter((p) => p.v != null && Number.isFinite(p.v as number)) as { ts: number; v: number }[];

  if (pts.length < 2) {
    return (
      <div style={{ fontFamily: MONO, fontSize: 12, color: tint(HOME_THEME.text, 0.5), textAlign: "center", padding: "48px 0" }}>
        Not enough history yet — snapshots accrue every minute through RTH, server-side.
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
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + f * (maxY - minY));
  const fmtT = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const tickFill = tint(HOME_THEME.text, 0.75);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="gct-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tint(HOME_THEME.cyan, 0.28)} />
          <stop offset="100%" stopColor={tint(HOME_THEME.cyan, 0)} />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} stroke={tint(HOME_THEME.text, 0.08)} strokeWidth={1} />
          <text x={PADL - 6} y={sy(v) + 3} textAnchor="end" fontSize={11} fill={tickFill} fontFamily={MONO}>{fmtY(v)}</text>
        </g>
      ))}
      <text x={PADL} y={H - 6} textAnchor="start" fontSize={11} fill={tickFill} fontFamily={MONO}>{fmtT(minX)}</text>
      <text x={W - PADR} y={H - 6} textAnchor="end" fontSize={11} fill={tickFill} fontFamily={MONO}>{fmtT(maxX)}</text>
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
      <circle cx={sx(n - 1)} cy={sy(last)} r={3} fill={HOME_THEME.cyan} />
    </svg>
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

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(date || undefined), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load, date]);

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
  // One face is in normal flow (it sets the tile's height) and the other is laid
  // over it — which one flips with the card, so the expanded chart side can be as
  // tall as it needs while the pick side stays a compact tile.
  const faceStyle = (inFlow: boolean): CSSProperties => ({
    ...classicCardAccentStyle,
    position: inFlow ? "relative" : "absolute",
    inset: inFlow ? undefined : 0,
    padding: "12px 14px",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    overflow: "hidden",
  });
  // The Probe page's .op-tgl pill: neutral when off, white-wash when on for the
  // range group, cyan for the metric group.
  const tglStyle = (on: boolean, cyan = false): CSSProperties => ({
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.03em",
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${on && cyan ? tint(HOME_THEME.cyan, 0.4) : HOME_THEME.border}`,
    background: on ? (cyan ? tint(HOME_THEME.cyan, 0.12) : tint(HOME_THEME.text, 0.08)) : "transparent",
    color: on ? (cyan ? HOME_THEME.cyan : HOME_THEME.text) : tint(HOME_THEME.text, 0.55),
  });
  // .op-badge — the strike+side chip next to the ticker.
  const badgeStyle = (side: "C" | "P"): CSSProperties => {
    const c = side === "P" ? HOME_THEME.orange : HOME_THEME.green;
    return {
      fontFamily: MONO, fontSize: 12, fontWeight: 700, padding: "1px 6px",
      borderRadius: 4, marginLeft: 6, color: c,
      background: tint(c, 0.12), border: `1px solid ${tint(c, 0.4)}`,
    };
  };
  const lblStyle: CSSProperties = {
    color: tint(HOME_THEME.text, 0.55), fontSize: 10,
    textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 4,
  };

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
          onChange={(e) => { setDate(e.target.value); setFlipped(null); setOpened({}); load(e.target.value || undefined); }}
          style={{ ...homeButtonStyle, padding: "6px 10px", fontSize: 13, colorScheme: "dark" as CSSProperties["colorScheme"] }}
        />
        <button onClick={() => load(date || undefined)} style={{ ...homeButtonStyle, padding: "6px 12px", fontSize: 13 }}>
          Refresh
        </button>
        <span style={{ fontSize: 12, color: tint(HOME_THEME.text, 0.5) }}>click a card for its option price line</span>
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

      {err && <div style={{ color: HOME_THEME.red, fontSize: 13, padding: "8px 0" }}>Error: {err}</div>}

      {!err && slots.length === 0 && (
        <div style={{ color: tint(HOME_THEME.text, 0.6), fontSize: 14, padding: "16px 4px" }}>
          {loading ? "Loading…" : "No very-strong picks recorded yet for this date. The recorder captures the top 5 every 30 min during RTH going forward."}
        </div>
      )}

      {slots.map((hb) => (
        <div key={hb.slot} style={{ marginBottom: 22 }}>
          <div data-noshot="1" style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <span style={{ color: HOME_THEME.orange, fontWeight: 800, fontSize: 15 }}>{slotLabel(hb.slot)}</span>
            <span style={{ color: tint(HOME_THEME.text, 0.5), fontSize: 12 }}>{hb.rows.length} pick{hb.rows.length === 1 ? "" : "s"}</span>
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
              const pnlColor = pnlPct == null ? tint(HOME_THEME.text, 0.55) : pnlPct > 0 ? HOME_THEME.green : pnlPct < 0 ? HOME_THEME.red : tint(HOME_THEME.text, 0.55);

              return (
                <div
                  key={`${r.symbol}-${r.expiry}-${r.strike}`}
                  data-card="1"
                  onClick={() => toggleFlip(cid, wid)}
                  title={wid == null ? undefined : isFlipped ? "Back to the pick" : `Chart ${r.symbol} ${fmtStrike(r.strike)}${side}`}
                  style={{
                    position: "relative",
                    minHeight: 196,
                    perspective: 1600,
                    cursor: wid == null ? "default" : "pointer",
                    // Open card takes the whole row, exactly like the Probe page's
                    // expanded tracked card (gridColumn: 1 / -1) — the axis-ticked
                    // chart needs the width to be readable.
                    gridColumn: isFlipped ? "1 / -1" : undefined,
                  }}
                >
                  <div
                    style={{
                      position: "relative",
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
                    <div style={{ ...faceStyle(!isFlipped), minHeight: 196 }}>
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
                          color: st === "busy" ? tint(HOME_THEME.text, 0.5) : st ? HOME_THEME.green : tint(HOME_THEME.text, 0.45),
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}
                      >
                        {st === "busy" ? "…" : st === "copied" ? "✓ Copied" : st === "saved" ? "✓ Saved" : "📷"}
                      </button>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, paddingRight: 18 }}>
                        <span style={{ fontWeight: 800, fontSize: 17, color: HOME_THEME.text }}>
                          <span style={{ color: tint(HOME_THEME.text, 0.35), marginRight: 6 }}>{r.rank}</span>{r.symbol}
                        </span>
                        <span style={{ fontSize: 14, color: tint(HOME_THEME.text, 0.6) }}>{fmtStrike(r.strike)}</span>
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: col, lineHeight: 1.2 }}>{fmtBig(r.latest_chg)}</div>
                      <div style={{ fontSize: 14, color: tint(HOME_THEME.text, 0.6), marginTop: 4 }}>
                        {r.expiry} · spot {fmtSpot(r.spot)}
                      </div>
                      <div style={{ fontSize: 12, color: tint(HOME_THEME.text, 0.42), marginTop: 2 }}>
                        captured {capturedLabel(date, hb.slot)}
                      </div>
                      <div style={{ display: "flex", gap: 10, fontSize: 14, marginTop: 6, flexWrap: "wrap" }}>
                        {otmPct != null && <span style={{ color: HOME_THEME.orange }}>OTM {otmPct.toFixed(1)}%</span>}
                        <span style={{ color: r.pct_open == null ? tint(HOME_THEME.text, 0.4) : r.pct_open >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
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
                    <div style={{ ...faceStyle(isFlipped), minHeight: 196, transform: "rotateY(180deg)", padding: 16 }}>
                      {/* Header — .op-tcard-h: ticker, strike+side badge, close. */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div>
                          <span style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.text }}>{r.symbol}</span>
                          <span style={badgeStyle(side)}>{fmtStrike(r.strike)}{side}</span>
                        </div>
                        <button
                          data-noshot="1"
                          onClick={(e) => { e.stopPropagation(); toggleFlip(cid, wid); }}
                          title="Back to the pick"
                          style={{
                            background: "none", border: "none", cursor: "pointer", padding: "0 2px",
                            fontSize: 17, lineHeight: 1, color: tint(HOME_THEME.text, 0.55),
                          }}
                        >
                          ×
                        </button>
                      </div>
                      {/* .op-rowsub — expiry + why this contract is here. */}
                      <div style={{ fontFamily: MONO, fontSize: 12, color: tint(HOME_THEME.text, 0.55), marginTop: 3 }}>
                        {r.expiry} · auto-probed from GEX change top · {capturedLabel(date, hb.slot)}
                      </div>
                      {/* .op-bigrow — the headline move off the entry basis. */}
                      <div style={{ margin: "10px 0 8px" }}>
                        <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, lineHeight: 1, color: pnlColor }}>
                          {pnlPct == null ? "—" : `${pnlPct >= 0 ? "▲" : "▼"} ${Math.abs(pnlPct).toFixed(1)}%`}
                        </div>
                        <div style={{ fontFamily: MONO, fontSize: 14, color: HOME_THEME.text, marginTop: 6 }}>
                          <span style={lblStyle}>in</span>{fmtPx(entry)}
                          <span style={{ color: tint(HOME_THEME.text, 0.55), margin: "0 6px" }}>→</span>
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
                      <div data-noshot="1" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <span style={{ ...tglStyle(true), cursor: "default" }}>1D</span>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
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
                        <div style={{ fontFamily: MONO, fontSize: 12, color: tint(HOME_THEME.text, 0.5), textAlign: "center", padding: "48px 0" }}>Loading history…</div>
                      ) : h?.error ? (
                        <div style={{ fontFamily: MONO, fontSize: 12, color: HOME_THEME.red, textAlign: "center", padding: "48px 0" }}>{h.error}</div>
                      ) : (
                        <PickChart points={pts} metric={metric} entry={entry} />
                      )}
                      {/* .op-charthint */}
                      <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 12, color: tint(HOME_THEME.text, 0.55), letterSpacing: "0.04em" }}>
                        {metric === "mark" ? "Option price (mark)" : "Net GEX @ strike"} · RTH only · entry @ {fmtPx(entry)} · {ago(lastTs)}
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

      <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: tint(HOME_THEME.text, 0.55) }}>
        <span>Score = 0.6·|Δ| + 0.4·|% vs open|, normalized 0–100</span>
        <span><span style={{ color: HOME_THEME.orange }}>★ Very strong</span> = |Δ| ≥ $200k AND |% vs open| ≥ 30%</span>
        <span>Every pick is auto-probed at capture — the flip side is its recorded option price since it was flagged</span>
      </div>
    </Card>
   </div>
  );
}
