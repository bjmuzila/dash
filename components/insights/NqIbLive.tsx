"use client";

/**
 * NqIbLive — quote-sampled Initial Balance tracker for /NQU26.
 *
 * The backend feeds true 5m OHLCV candles only for ES. For NQ we approximate:
 * poll the live NQU price from /api/tt-quotes every SAMPLE_MS and bucket samples
 * into client-side 5m OHLC bars. From those bars we compute the 9:30–10:30 ET
 * Initial Balance high/low/mid/range, formed-first, and live break state — the
 * same reads the ES LiveIb shows, but sourced from quote snapshots.
 *
 * Caveats vs. the ES tracker: bars are built from price snapshots (no volume,
 * resolution limited by the poll rate), and the in-memory bar set resets on
 * reload — there is no DB lock. Treat the levels as approximate.
 */

import { useEffect, useRef, useState } from "react";

const NQ_SYMBOL = "/NQU26";
const SAMPLE_MS = 20_000;        // poll cadence
const IB_OPEN = 9 * 60 + 30;     // 09:30 ET
const IB_CLOSE = 10 * 60 + 30;   // 10:30 ET

// One-off manual IB seed: live quote-sampling missed today's 9:30–10:30 window,
// so the IB high/low were entered by hand. Only applies on SEED_DATE (ET); from
// the next session on, the tracker builds the IB live from quote samples.
// Remove after the date passes (harmless, but keeps the file clean).
const SEED_DATE = "2026-06-25";
const SEED_IB = { high: 30193, low: 29295.75, lowFirst: false }; // high formed first

interface Bar { slot: number; open: number; high: number; low: number; close: number; mins: number; }

function etParts(): { mins: number; date: string } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  p.forEach((x) => { m[x.type] = x.value; });
  const h = Number(m.hour) % 24;
  return { mins: h * 60 + Number(m.minute), date: `${m.year}-${m.month}-${m.day}` };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface IbState {
  hasData: boolean;
  done: boolean;
  high: number; low: number; mid: number; range: number; rangePct: number;
  lowFirst: boolean | null;
  last: number;
  brokeHigh: boolean; brokeLow: boolean; doubleBreak: boolean;
  firstBreak: "high" | "low" | null;
  aboveMid: boolean | null;
}

function computeIb(bars: Bar[], nowMins: number, seed: { high: number; low: number; lowFirst: boolean | null } | null): IbState {
  const empty: IbState = {
    hasData: false, done: false, high: 0, low: 0, mid: 0, range: 0, rangePct: 0,
    lowFirst: null, last: 0, brokeHigh: false, brokeLow: false, doubleBreak: false,
    firstBreak: null, aboveMid: null,
  };

  // Seed path: IB high/low entered manually for today. Still track the live
  // price + break state against the seeded levels (any sampled bar counts, since
  // the IB window itself was missed). lowFirst is unknown for a seeded IB.
  let high: number, low: number, lowFirst: boolean | null;
  let breakBars: Bar[];
  if (seed) {
    high = seed.high; low = seed.low; lowFirst = seed.lowFirst;
    breakBars = bars.slice().sort((a, b) => a.slot - b.slot);
  } else {
    const ib = bars.filter((b) => b.mins >= IB_OPEN && b.mins < IB_CLOSE).sort((a, b) => a.slot - b.slot);
    if (!ib.length) return empty;
    let h = -Infinity, l = Infinity, highAt = Infinity, lowAt = Infinity;
    for (const b of ib) {
      if (b.high > h) { h = b.high; highAt = b.slot; }
      if (b.low < l) { l = b.low; lowAt = b.slot; }
    }
    high = h; low = l;
    lowFirst = lowAt !== highAt ? lowAt < highAt : null;
    breakBars = bars.filter((b) => b.mins >= IB_CLOSE).sort((a, b) => a.slot - b.slot);
  }

  const mid = (high + low) / 2;
  const range = high - low;
  const done = seed ? true : nowMins >= IB_CLOSE;

  let brokeHigh = false, brokeLow = false, firstBreak: "high" | "low" | null = null;
  for (const b of breakBars) {
    if (!brokeHigh && b.high > high) { brokeHigh = true; if (!firstBreak) firstBreak = "high"; }
    if (!brokeLow && b.low < low) { brokeLow = true; if (!firstBreak) firstBreak = "low"; }
  }
  const lastBar = breakBars[breakBars.length - 1] ?? bars[bars.length - 1];
  const last = lastBar ? lastBar.close : 0;

  return {
    hasData: true, done,
    high, low, mid, range, rangePct: mid > 0 ? (range / mid) * 100 : 0,
    lowFirst,
    last,
    brokeHigh, brokeLow, doubleBreak: brokeHigh && brokeLow,
    firstBreak,
    aboveMid: last ? last >= mid : null,
  };
}

function fmt(v: number) { return Number.isFinite(v) && v !== 0 ? v.toFixed(2) : "—"; }

interface Rule { title: string; detail: string; color: string; }

// NQ-specific probabilities (from the IB reference's NQ figures).
function rulesFor(ib: IbState): Rule[] {
  const out: Rule[] = [];
  if (!ib.hasData) return out;
  const tag = ib.done ? "" : " (provisional — IB still forming)";

  if (!ib.done) {
    out.push({ title: "IB Forming · Provisional Reads", color: "#ffb300",
      detail: `Tracking the 9:30–10:30 ET range live${ib.range > 0 ? ` — current IB H/L ${ib.high.toFixed(2)} / ${ib.low.toFixed(2)}` : ""}. Reads below use the developing range and lock at 10:30 ET.` });
  } else {
    out.push({ title: "Inside Day Exception", color: "#219EBC",
      detail: "IB window complete. Only ~0.6% of days stay fully inside the IB — plan for at least one breakout." });
  }

  if (ib.aboveMid === true) {
    out.push({ title: "Above-Mid Dominance (NQ)", color: "#00e676",
      detail: `Price above the IB midpoint → 83.3% NQ probability of an eventual IB High breakout${tag}.` });
  } else if (ib.aboveMid === false) {
    out.push({ title: "Below-Mid Dominance (NQ)", color: "#ff5252",
      detail: `Price below the IB midpoint → 78.2% NQ probability of an eventual IB Low breakdown${tag}.` });
  }

  if (ib.lowFirst === true) {
    out.push({ title: "Low Formed First (NQ)", color: "#7cff6b",
      detail: `Session low printed before the high → 78.79% break IB High later, only 19.7% reverse to IB Low${tag}.` });
  } else if (ib.lowFirst === false) {
    out.push({ title: "High Formed First", color: "#ffb300",
      detail: `Session high printed before the low → watch for downside rotation / double-cross risk${tag}.` });
  }

  if (ib.rangePct > 0 && ib.rangePct <= 1) {
    out.push({ title: "Volatility Compression (NQ)", color: "#ffb300",
      detail: `IB range compressed (${ib.rangePct.toFixed(2)}% ≤ 1%). A 5m close below IB Low = 98.01% continued-downside trigger${tag}.` });
  }

  if (ib.doubleBreak) {
    out.push({ title: "Double Breach (NQ)", color: "#ff1744",
      detail: `Both IB sides broken — NQ double-breach profile (~14–23%). Trend conviction reduced${tag}.` });
  } else if (ib.brokeHigh || ib.brokeLow) {
    out.push({ title: "Single-Break Trend Day (NQ)", color: "#00e676",
      detail: `One clean side broken — NQ single-break trend day rate 80.95%, double-breach 14.29%${tag}.` });
  }

  return out;
}

function highlightPct(text: string) {
  return text.split(/(\d+(?:\.\d+)?%)/g).map((p, i) =>
    /^\d+(?:\.\d+)?%$/.test(p)
      ? <strong key={i} style={{ fontSize: "1.0833em", fontWeight: 900 }}>{p}</strong>
      : <span key={i}>{p}</span>);
}

export function NqIbLive() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [nowMins, setNowMins] = useState(() => etParts().mins);
  const [connected, setConnected] = useState(false);
  const barsRef = useRef<Map<number, Bar>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const sample = async () => {
      try {
        const res = await fetch(`/api/tt-quotes?symbols=${encodeURIComponent(NQ_SYMBOL)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const items: Array<Record<string, unknown>> = data?.data?.items ?? [];
        const it = items.find((x) => String(x.symbol ?? "").startsWith("/NQ"));
        const price = it ? (num(it.last) ?? num(it.mark)) : null;
        if (price == null) { setConnected(false); return; }
        setConnected(true);

        const { mins } = etParts();
        const slot = Math.floor(mins / 5) * 5; // 5m bucket index (ET minutes)
        const prev = barsRef.current.get(slot);
        const bar: Bar = prev
          ? { ...prev, high: Math.max(prev.high, price), low: Math.min(prev.low, price), close: price }
          : { slot, open: price, high: price, low: price, close: price, mins: slot };
        barsRef.current.set(slot, bar);
        if (!cancelled) {
          setBars([...barsRef.current.values()].sort((a, b) => a.slot - b.slot));
          setNowMins(mins);
        }
      } catch { /* ignore */ }
    };

    sample();
    const id = setInterval(sample, SAMPLE_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const seed = etParts().date === SEED_DATE ? SEED_IB : null;
  const ib = computeIb(bars, nowMins, seed);
  const rules = rulesFor(ib);

  const broke = ib.brokeHigh || ib.brokeLow;
  const breakLabel = ib.doubleBreak ? "🚨 DOUBLE BREAK"
    : ib.brokeHigh ? "🚨 IB HIGH BROKEN"
    : ib.brokeLow ? "🚨 IB LOW BROKEN"
    : ib.done ? "INSIDE (no break yet)"
    : "FORMING";
  const breakColor = ib.doubleBreak ? "#ff1744"
    : ib.brokeHigh ? "#00e676"
    : ib.brokeLow ? "#ff5252"
    : "#94a3b8";

  const stat = (label: string, value: string, color = "#eef7ff") => (
    <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, padding: "18px 20px", background: "rgba(255,255,255,.02)" }}>
      <div style={{ fontSize: 11, color: "#ffffff", fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color, fontFamily: "monospace", marginTop: 8 }}>{value}</div>
    </div>
  );

  return (
    <div className="card-hover" style={{
      border: `1px solid ${ib.done ? "rgba(0,230,118,.28)" : "rgba(33,158,188,.22)"}`,
      background: "linear-gradient(180deg,rgba(0,26,38,.5),rgba(0,0,0,.3))",
      borderRadius: 10, padding: 16, marginBottom: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "#219EBC", letterSpacing: ".16em", textTransform: "uppercase", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
            Live IB · NQ Futures
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "#00e676" : "#5a7a99", boxShadow: connected ? "0 0 8px rgba(0,230,118,.8)" : "none" }} />
          </div>
          <div style={{ fontSize: 20, color: "#eef7ff", fontWeight: 800 }}>Initial Balance (9:30–10:30 ET)</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: breakColor, border: `1px solid ${breakColor}55`, background: `${breakColor}1a`, padding: "5px 10px", borderRadius: 6 }}>{breakLabel}</span>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: ib.done ? "#00e676" : "#ffb300", border: `1px solid ${ib.done ? "#00e676" : "#ffb300"}55`, padding: "5px 10px", borderRadius: 6 }}>{ib.done ? "IB Done" : "Forming"}</span>
          <span title="NQ has no DB candle feed — IB is built live from quote samples and is approximate" style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#ffb300", border: "1px solid #ffb30055", background: "#ffb3001a", padding: "5px 10px", borderRadius: 6 }}>≈ Quote-sampled</span>
        </div>
      </div>

      {!ib.hasData ? (
        <div style={{ fontSize: 13, color: "#ffffff", padding: "12px 0" }}>
          {nowMins < IB_OPEN
            ? "Waiting for the 9:30 ET open — NQ IB builds live from quote samples during 9:30–10:30 ET."
            : "Collecting NQ quote samples for today's IB window…"}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
            {stat("IB High", fmt(ib.high), "#00e676")}
            {stat("IB Low", fmt(ib.low), "#ff5252")}
            {stat("Midpoint", fmt(ib.mid), "#219EBC")}
            {stat("Range", fmt(ib.range), "#eef7ff")}
            {stat("Range %", ib.rangePct ? ib.rangePct.toFixed(2) + "%" : "—", ib.rangePct > 0 && ib.rangePct <= 1 ? "#ffb300" : "#eef7ff")}
            {stat("Last", fmt(ib.last), ib.aboveMid ? "#00e676" : "#ff5252")}
            {stat("Formed First", ib.lowFirst == null ? "—" : ib.lowFirst ? "LOW" : "HIGH", ib.lowFirst ? "#7cff6b" : "#ffb300")}
            {stat("vs Mid", ib.aboveMid == null ? "—" : ib.aboveMid ? "ABOVE" : "BELOW", ib.aboveMid ? "#00e676" : "#ff5252")}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#219EBC", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 800 }}>Rules In Play ({rules.length})</span>
            {!ib.done && (
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#ffb300", border: "1px solid #ffb30055", background: "#ffb3001a", padding: "3px 8px", borderRadius: 6 }}>Provisional · not locked</span>
            )}
          </div>
          {rules.length === 0 ? (
            <div style={{ fontSize: 12, color: "#ffffff" }}>No rules triggered yet.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(Math.max(1, Math.ceil(rules.length / 2)), 4)}, minmax(0, 1fr))`, gap: 10 }}>
              {rules.map((r) => (
                <div key={r.title} style={{ borderLeft: `3px solid ${r.color}`, borderTop: "1px solid rgba(255,255,255,.08)", borderRight: "1px solid rgba(255,255,255,.08)", borderBottom: "1px solid rgba(255,255,255,.08)", borderRadius: 8, padding: "10px 12px", background: "rgba(255,255,255,.02)" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: r.color }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: "#ffffff", lineHeight: 1.5, marginTop: 4 }}>{highlightPct(r.detail)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
