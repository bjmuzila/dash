"use client";

/**
 * IB Logic & AI — live Initial Balance tracker + static reference.
 *
 * Live section computes the 9:30–10:30 ET IB high/low/mid/range from streaming
 * 5m ES candles (useEsCandles), marks IB complete at 10:30, detects break state,
 * and surfaces which rules from the master reference currently apply. The static
 * reference table remains below so the page is useful even with no live data.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEsCandles, type EsCandle } from "@/hooks/useEsCandles";
import { saveIbLevels, queryIbLevels, type IbLevelsRecord } from "@/lib/snapdb";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { HOME_THEME, homeGlossPanelStyle } from "@/components/shared/homeTheme";

// rgba helper — matches the convention used across themed pages.
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function todayETStr(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

const IB_OPEN = 9 * 60 + 30;   // 09:30 ET in minutes
const IB_CLOSE = 10 * 60 + 30; // 10:30 ET

function etNowMins(): number {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return d.getHours() * 60 + d.getMinutes();
}

function etDayOfWeek(): number {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return d.getDay(); // 0=Sun … 2=Tue
}

function slotMinsOf(c: EsCandle): number {
  const t = (c.slotKey ?? c.time ?? "").slice(11, 16) || (c.time ?? "").slice(0, 5);
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

interface IbState {
  hasData: boolean;
  done: boolean;            // IB window complete (>= 10:30)
  high: number;
  low: number;
  mid: number;
  range: number;
  rangePct: number;         // range as % of mid
  lowFirst: boolean | null; // session low printed before session high?
  openPrice: number;
  lastClose: number;
  brokeHigh: boolean;
  brokeLow: boolean;
  doubleBreak: boolean;
  firstBreak: "high" | "low" | null;
  firstBreakMins: number | null; // ET minutes of first break
  brokeHighTs: number | null;    // epoch ms of IB High break candle
  brokeLowTs: number | null;     // epoch ms of IB Low break candle
  aboveMid: boolean | null;
}

/** "9:42 AM ET" style label from an epoch-ms timestamp. */
function etTimeLabel(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
  }) + " ET";
}

function computeIb(candles: EsCandle[]): IbState {
  const empty: IbState = {
    hasData: false, done: false, high: 0, low: 0, mid: 0, range: 0, rangePct: 0,
    lowFirst: null, openPrice: 0, lastClose: 0, brokeHigh: false, brokeLow: false,
    doubleBreak: false, firstBreak: null, firstBreakMins: null,
    brokeHighTs: null, brokeLowTs: null, aboveMid: null,
  };
  const ibBars = candles
    .filter((c) => { const m = slotMinsOf(c); return m >= IB_OPEN && m < IB_CLOSE; })
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!ibBars.length) return empty;

  let high = -Infinity, low = Infinity, highAt = Infinity, lowAt = Infinity;
  for (const b of ibBars) {
    if (b.high > high) { high = b.high; highAt = b.timestamp; }
    if (b.low < low) { low = b.low; lowAt = b.timestamp; }
  }
  const mid = (high + low) / 2;
  const range = high - low;
  const openPrice = ibBars[0].open;
  const done = etNowMins() >= IB_CLOSE;

  // Post-IB bars for break detection.
  const postBars = candles
    .filter((c) => slotMinsOf(c) >= IB_CLOSE)
    .sort((a, b) => a.timestamp - b.timestamp);
  let brokeHigh = false, brokeLow = false, firstBreak: "high" | "low" | null = null, firstBreakMins: number | null = null;
  let brokeHighTs: number | null = null, brokeLowTs: number | null = null;
  for (const b of postBars) {
    if (!brokeHigh && b.high > high) { brokeHigh = true; brokeHighTs = b.timestamp; if (!firstBreak) { firstBreak = "high"; firstBreakMins = slotMinsOf(b); } }
    if (!brokeLow && b.low < low) { brokeLow = true; brokeLowTs = b.timestamp; if (!firstBreak) { firstBreak = "low"; firstBreakMins = slotMinsOf(b); } }
  }
  const lastClose = (postBars[postBars.length - 1] ?? ibBars[ibBars.length - 1]).close;

  return {
    hasData: true,
    done,
    high, low, mid, range,
    rangePct: mid > 0 ? (range / mid) * 100 : 0,
    lowFirst: lowAt !== highAt ? lowAt < highAt : null,
    openPrice,
    lastClose,
    brokeHigh,
    brokeLow,
    doubleBreak: brokeHigh && brokeLow,
    firstBreak,
    firstBreakMins,
    brokeHighTs,
    brokeLowTs,
    aboveMid: lastClose ? lastClose >= mid : null,
  };
}

interface AppliedRule { title: string; detail: string; color: string; }

/**
 * Evaluate which reference rules currently apply given the live IB state.
 *
 * Rules now compute as soon as there is IB data — not only after 10:30 ET. While
 * the window is still forming, the developing high/low/mid/formed-first drive the
 * same probability reads, surfaced as PROVISIONAL (they can still flip until the
 * IB locks). Only the post-10:30 "Range Mode" timing rule stays gated, since it's
 * meaningless before the IB closes.
 */
function applicableRules(ib: IbState): AppliedRule[] {
  const out: AppliedRule[] = [];
  if (!ib.hasData) return out;

  const tag = ib.done ? "" : " (provisional — IB still forming)";

  // Lead notice while forming so it's clear these are developing reads.
  if (!ib.done) {
    out.push({ title: "IB Forming · Provisional Reads", color: "#ffb300",
      detail: `Tracking the 9:30–10:30 ET range live${ib.range > 0 ? ` — current IB H/L ${ib.high.toFixed(2)} / ${ib.low.toFixed(2)}` : ""}. The reads below use the developing range and can still change; they lock at 10:30 ET.` });
  } else {
    out.push({ title: "Inside Day Exception", color: "#219EBC",
      detail: "IB window complete. Only 0.6% of days stay fully inside the IB — plan for at least one breakout." });
  }

  if (ib.aboveMid === true) {
    out.push({ title: "Above-Mid Dominance (ES)", color: "#00e676",
      detail: `Price is above the IB midpoint → 83.5% historical probability of an eventual IB High breakout${tag}.` });
  } else if (ib.aboveMid === false) {
    out.push({ title: "Below-Mid Dominance (ES)", color: "#ff5252",
      detail: `Price is below the IB midpoint → 94.9% historical probability of an eventual IB Low breakdown. Fading carries ~5% survival${tag}.` });
  }

  if (ib.lowFirst === true) {
    out.push({ title: "Low Formed First", color: "#7cff6b",
      detail: `Session low printed before the high → upward path skew: 78.79% break IB High later, only 19.7% reverse to IB Low${tag}.` });
  } else if (ib.lowFirst === false) {
    out.push({ title: "High Formed First", color: "#ffb300",
      detail: `Session high printed before the low → watch for downside rotation / double-cross risk${tag}.` });
  }

  if (etDayOfWeek() === 2) {
    if (ib.lowFirst === false) {
      out.push({ title: "Tuesday · High First", color: "#ff5ec4",
        detail: `Tuesday + IB High first → first break skews to IB Low first (58.33%)${tag}.` });
    } else if (ib.lowFirst === true) {
      out.push({ title: "Tuesday · Low First", color: "#ff5ec4",
        detail: `Tuesday + IB Low first → first break skews to IB High first (64.29%)${tag}.` });
    }
  }

  if (ib.rangePct > 0 && ib.rangePct <= 1) {
    out.push({ title: "Volatility Compression", color: "#ffb300",
      detail: `IB range is compressed (${ib.rangePct.toFixed(2)}% ≤ 1%). A 5m close below IB Low = 98.01% continued-downside trigger; fading carries ~0% edge${tag}.` });
  }

  // Timing-curve "Range Mode" only makes sense once the IB has closed.
  const nowMins = etNowMins();
  if (ib.done && !ib.brokeHigh && !ib.brokeLow && nowMins > 11 * 60) {
    out.push({ title: "Timing Curve · Range Mode", color: "#ffffff",
      detail: "Past 11:00 ET with no breakout — 84.1% of breakouts hit by now. Shift from breakout to range/premium-decay playbook." });
  } else if (ib.firstBreak && ib.firstBreakMins != null) {
    const mins = ib.firstBreakMins - IB_CLOSE;
    out.push({ title: "Timing Curve · Early Break", color: "#00e676",
      detail: `First break (${ib.firstBreak.toUpperCase()}) ~${Math.max(0, mins)}m after IB close. 84.1% of breakouts occur within 30m; avg 18m / median 2m.` });
  }

  if (ib.doubleBreak) {
    out.push({ title: "Double Breach (ES)", color: "#ff1744",
      detail: `Both IB sides broken — the ~40% ES double-cross whiplash profile. Trend-continuation conviction is reduced${tag}.` });
  } else if (ib.brokeHigh || ib.brokeLow) {
    out.push({ title: "Single-Break Trend Day", color: "#00e676",
      detail: `One clean side broken — modern ES regime: 75.59% single-break trend days, 22.05% double-breach risk. Respect the first break${tag}.` });
  }

  return out;
}

function fmt(v: number, dp = 2) { return Number.isFinite(v) && v !== 0 ? v.toFixed(dp) : "—"; }

/** Render a detail string with percentage values one size larger and bold. */
function highlightPct(text: string): ReactNode {
  const parts = text.split(/(\d+(?:\.\d+)?%)/g);
  return parts.map((p, i) =>
    /^\d+(?:\.\d+)?%$/.test(p)
      ? <strong key={i} style={{ fontSize: "1.0833em", fontWeight: 900 }}>{p}</strong>
      : <span key={i}>{p}</span>
  );
}

/**
 * Overlay a locked DB record onto live break detection: the high/low/mid/range,
 * formed-first and open are taken from the immutable locked row, while
 * brokeHigh/brokeLow/lastClose/aboveMid continue to update live against those
 * frozen levels.
 */
function mergeLocked(live: IbState, locked: IbLevelsRecord, candles: EsCandle[]): IbState {
  const high = locked.high, low = locked.low;
  const postBars = candles
    .filter((c) => slotMinsOf(c) >= IB_CLOSE)
    .sort((a, b) => a.timestamp - b.timestamp);
  let brokeHigh = false, brokeLow = false, firstBreak: "high" | "low" | null = null, firstBreakMins: number | null = null;
  let brokeHighTs: number | null = null, brokeLowTs: number | null = null;
  for (const b of postBars) {
    if (!brokeHigh && b.high > high) { brokeHigh = true; brokeHighTs = b.timestamp; if (!firstBreak) { firstBreak = "high"; firstBreakMins = slotMinsOf(b); } }
    if (!brokeLow && b.low < low) { brokeLow = true; brokeLowTs = b.timestamp; if (!firstBreak) { firstBreak = "low"; firstBreakMins = slotMinsOf(b); } }
  }
  const lastClose = postBars.length ? postBars[postBars.length - 1].close : (live.lastClose || locked.mid);
  return {
    hasData: true,
    done: true,
    high, low, mid: locked.mid, range: locked.range, rangePct: locked.rangePct,
    lowFirst: locked.lowFirst == null ? null : locked.lowFirst === 1,
    openPrice: locked.openPrice,
    lastClose,
    brokeHigh, brokeLow,
    doubleBreak: brokeHigh && brokeLow,
    firstBreak, firstBreakMins,
    brokeHighTs, brokeLowTs,
    aboveMid: lastClose ? lastClose >= locked.mid : null,
  };
}

export function LiveIb() {
  const { candles } = useEsCandles();
  const [locked, setLocked] = useState<IbLevelsRecord | null>(null);
  const savedRef = useRef(false);

  // Idle tracker — the alert flash runs only while the user is active. After
  // 60s of no mouse/keyboard activity the flash goes static; any activity
  // restarts it (while a break is still in play).
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 60_000);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, []);

  const computed = computeIb(candles);
  // Prefer the immutable locked record once it exists; otherwise show live compute.
  const ib = locked ? mergeLocked(computed, locked, candles) : computed;
  const rules = applicableRules(ib);

  // Load any locked record for today on mount (survives refresh/restart/rollover).
  useEffect(() => {
    queryIbLevels(todayETStr()).then((row) => {
      if (row && row.locked === 1) { setLocked(row); savedRef.current = true; }
    }).catch(() => {});
  }, []);

  // At/after 10:30 ET, freeze the IB once: write the locked record. The server
  // upsert refuses to overwrite an already-locked row, so this is safe to retry.
  useEffect(() => {
    if (savedRef.current || locked) return;
    if (!computed.hasData || !computed.done) return;
    savedRef.current = true;
    const rec: IbLevelsRecord = {
      date: todayETStr(),
      symbol: "/ES",
      timestamp: Date.now(),
      locked: 1,
      high: computed.high, low: computed.low, mid: computed.mid,
      range: computed.range, rangePct: computed.rangePct,
      openPrice: computed.openPrice,
      lowFirst: computed.lowFirst == null ? null : computed.lowFirst ? 1 : 0,
      barCount: candles.filter((c) => { const m = slotMinsOf(c); return m >= IB_OPEN && m < IB_CLOSE; }).length,
    };
    saveIbLevels(rec).then((stored) => { if (stored) setLocked(stored); }).catch(() => {});
  }, [computed, locked, candles]);

  const broke = ib.brokeHigh || ib.brokeLow;
  const flashing = broke && !idle; // flash only while user is active
  const breakLabel = ib.doubleBreak ? "🚨 DOUBLE BREAK"
    : ib.brokeHigh ? "🚨 IB HIGH BROKEN"
    : ib.brokeLow ? "🚨 IB LOW BROKEN"
    : ib.done ? "INSIDE (no break yet)"
    : "FORMING";
  const breakColor = ib.doubleBreak ? HOME_THEME.red
    : ib.brokeHigh ? HOME_THEME.green
    : ib.brokeLow ? HOME_THEME.red
    : HOME_THEME.text;

  // Timestamp of the first IB break (earliest of high/low breaks).
  const firstBreakTs = (() => {
    const ts = [ib.brokeHighTs, ib.brokeLowTs].filter((t): t is number => t != null);
    return ts.length ? Math.min(...ts) : null;
  })();
  const breakTimeLabel = etTimeLabel(firstBreakTs);

  const stat = (label: string, value: string, color: string = HOME_THEME.text) => (
    <div style={{ border: `1px solid ${HOME_THEME.border}`, borderRadius: 10, padding: "18px 20px", background: rgba(HOME_THEME.text, 0.02) }}>
      <div style={{ fontSize: 14, color: HOME_THEME.text, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color, fontFamily: "monospace", marginTop: 8 }}>{value}</div>
    </div>
  );

  return (
    <div className="card-hover" style={{
      ...homeGlossPanelStyle(ib.done ? HOME_THEME.green : HOME_THEME.cyan),
      padding: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, color: HOME_THEME.cyan, letterSpacing: ".16em", textTransform: "uppercase", fontWeight: 800 }}>Live IB · ES Futures</div>
          <div style={{ fontSize: 22, color: HOME_THEME.text, fontWeight: 800 }}>Initial Balance (9:30–10:30 ET)</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {flashing && (
            <style>{`
              @keyframes ibAlertFlash {
                0%, 100% { box-shadow: 0 0 0 0 ${breakColor}00; background: ${breakColor}1a; }
                50%      { box-shadow: 0 0 14px 2px ${breakColor}aa; background: ${breakColor}40; }
              }
              @media (prefers-reduced-motion: reduce) { .ib-alert-flash { animation: none !important; } }
            `}</style>
          )}
          <span className={flashing ? "ib-alert-flash" : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: breakColor, opacity: broke ? 1 : 0.7, border: `1px solid ${rgba(breakColor, 0.33)}`, background: rgba(breakColor, 0.1), padding: "5px 10px", borderRadius: 6, animation: flashing ? "ibAlertFlash 1.1s ease-in-out infinite" : undefined }}>
            {breakLabel}
            {broke && breakTimeLabel && (
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", textTransform: "none", color: breakColor, opacity: .9, fontFamily: "monospace", paddingLeft: 6, borderLeft: `1px solid ${rgba(breakColor, 0.33)}` }}>{breakTimeLabel}</span>
            )}
          </span>
          {ib.doubleBreak && (
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", color: HOME_THEME.text, border: `1px solid ${rgba(HOME_THEME.text, 0.12)}`, padding: "5px 10px", borderRadius: 6, fontFamily: "monospace" }}>
              ⬆ {etTimeLabel(ib.brokeHighTs) || "—"} · ⬇ {etTimeLabel(ib.brokeLowTs) || "—"}
            </span>
          )}
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: ib.done ? HOME_THEME.green : HOME_THEME.orange, border: `1px solid ${rgba(ib.done ? HOME_THEME.green : HOME_THEME.orange, 0.33)}`, padding: "5px 10px", borderRadius: 6 }}>{ib.done ? "IB Done" : "Forming"}</span>
          {locked && <span title="IB high/low frozen in database — will not reset" style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.cyan, border: `1px solid ${rgba(HOME_THEME.cyan, 0.33)}`, background: rgba(HOME_THEME.cyan, 0.1), padding: "5px 10px", borderRadius: 6 }}>🔒 Locked</span>}
        </div>
      </div>

      {!ib.hasData ? (
        <div style={{ fontSize: 13, color: HOME_THEME.text, padding: "12px 0" }}>
          No ES candle data yet for today’s IB window. Live IB populates from the 5m ES candle feed during 9:30–10:30 ET.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
            {stat("IB High", fmt(ib.high), HOME_THEME.green)}
            {stat("IB Low", fmt(ib.low), HOME_THEME.red)}
            {stat("Midpoint", fmt(ib.mid), HOME_THEME.cyan)}
            {stat("Range", fmt(ib.range), HOME_THEME.text)}
            {stat("Range %", ib.rangePct ? ib.rangePct.toFixed(2) + "%" : "—", ib.rangePct > 0 && ib.rangePct <= 1 ? HOME_THEME.orange : HOME_THEME.text)}
            {stat("Last", fmt(ib.lastClose), ib.aboveMid ? HOME_THEME.green : HOME_THEME.red)}
            {stat("Formed First", ib.lowFirst == null ? "—" : ib.lowFirst ? "LOW" : "HIGH", ib.lowFirst ? HOME_THEME.green : HOME_THEME.orange)}
            {stat("vs Mid", ib.aboveMid == null ? "—" : ib.aboveMid ? "ABOVE" : "BELOW", ib.aboveMid ? HOME_THEME.green : HOME_THEME.red)}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18, color: HOME_THEME.cyan, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 800 }}>
              Rules In Play ({rules.length})
            </span>
            {!ib.done && (
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.orange, border: `1px solid ${rgba(HOME_THEME.orange, 0.33)}`, background: rgba(HOME_THEME.orange, 0.1), padding: "3px 8px", borderRadius: 6 }}>
                Provisional · not locked
              </span>
            )}
          </div>
          {rules.length === 0 ? (
            <div style={{ fontSize: 12, color: HOME_THEME.text }}>No rules triggered yet.</div>
          ) : (
            <div style={{
              display: "grid",
              // Flow rule cards across ~2 rows: half the count per row (min 1),
              // capped so cards stay readable; wraps responsively on narrow widths.
              gridTemplateColumns: `repeat(${Math.min(Math.max(1, Math.ceil(rules.length / 2)), 4)}, minmax(0, 1fr))`,
              gap: 10,
            }}>
              {rules.map((r) => (
                <div key={r.title} style={{
                  borderLeft: `3px solid ${r.color}`,
                  borderTop: `1px solid ${HOME_THEME.border}`,
                  borderRight: `1px solid ${HOME_THEME.border}`,
                  borderBottom: `1px solid ${HOME_THEME.border}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  background: rgba(HOME_THEME.text, 0.02),
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: r.color }}>{r.title}</div>
                  <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.5, marginTop: 4 }}>{highlightPct(r.detail)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const LOGIC_ROWS: { title: string; color: string; items: string[] }[] = [
  {
    title: "The Inside Day Exception",
    color: "#219EBC",
    items: [
      "If the 60-minute RTH Initial Balance completes from 9:30 to 10:30 AM ET, the remainder of the session stays fully inside that range only 0.6% of the time.",
      "Operationally, the default expectation is at least one breakout. Do not build a plan that depends on the range holding.",
    ],
  },
  {
    title: "ES Structural Asymmetry",
    color: "#ffb300",
    items: [
      "IB Low breaks more often than IB High on the long-term ES baseline.",
      "IB High break probability: 67.1%.",
      "IB Low break probability: 72.4%.",
    ],
  },
  {
    title: "Cross-Asset Whiplash",
    color: "#00e676",
    items: [
      "If one side of the IB breaks early, there is still a meaningful risk of a full double breach.",
      "ES double breach probability: 40.1%.",
      "NQ double breach probability: 23.5%.",
    ],
  },
  {
    title: "Midpoint Dominance",
    color: "#ff5ec4",
    items: [
      "If ES closes or trades above the IB midpoint, the odds favor an eventual IB High breakout.",
      "Above-mid ES probability of IB High break: 83.5%.",
      "If ES closes or trades below the midpoint, the odds strongly favor an IB Low break.",
      "Below-mid ES probability of IB Low break: 94.9%.",
      "NQ above-mid probability of IB High break: 83.3%.",
      "NQ below-mid probability of IB Low break: 78.2%.",
    ],
  },
  {
    title: "Timing Curve",
    color: "#7cff6b",
    items: [
      "Most IB-related breakout activity happens quickly after 10:30 AM ET.",
      "84.1% of session breakouts appear within the first 30 minutes after the IB closes.",
      "Average time to first breakout: 18 minutes.",
      "Median time to first breakout: 2 minutes.",
      "If neither boundary has broken by 11:00 AM ET, the setup usually shifts toward range behavior and premium decay.",
    ],
  },
  {
    title: "Boundary Sequence",
    color: "#ff5ec4",
    items: [
      "When the IB low forms first on NQ, the remainder of the session skews upward.",
      "Probability of breaking IB High after low-first: 78.79%.",
      "Probability of later breaking back through IB Low: 19.7%.",
    ],
  },
  {
    title: "Tuesday Behavior",
    color: "#00e676",
    items: [
      "Tuesday sessions show a distinct path bias on NQ.",
      "If the IB High forms first on Tuesday, the first break skews to IB Low first: 58.33%.",
      "If the IB Low forms first on Tuesday, the first break skews to IB High first: 64.29%.",
    ],
  },
  {
    title: "Volatility Compression",
    color: "#ffb300",
    items: [
      "On compressed NQ days where IB size is 0% to 1%, a 5-minute close below IB Low is a strong continuation trigger.",
      "Probability of continued downside after a -0.1 close: 98.01%.",
      "Probability of continued downside after closes of -0.2, -0.3, -0.4, -0.5, and -0.8: 87.56%, 81.59%, 74.63%, 67.66%, and 50.75%.",
      "A reversal to a 5-minute close above +0.1 is extremely rare at 0.5%.",
    ],
  },
  {
    title: "Modern Regimes",
    color: "#219EBC",
    items: [
      "Recent 6-month data shows cleaner trend holding than the older 10-year baseline.",
      "NQ single-break trend day rate: 80.95%.",
      "NQ double breach risk: 14.29%.",
      "ES single-break trend day rate: 75.59%.",
      "ES double breach risk: 22.05%.",
      "The current regime favors respecting first breaks instead of automatically fading them.",
    ],
  },
  {
    title: "Liquidity Sweep Confluence",
    color: "#ff5ec4",
    items: [
      "If price tags the prior day high early, then locks into an IB High first path, and the opening hour closes large and red, treat it as a trap setup.",
      "Bias shifts bearish, with the preferred trade being a short on pullbacks into the opening-hour distribution.",
      "Target the IB Low and protect above the opening price.",
    ],
  },
];

export default function IbLogic() {
  const ibRef = useRef<HTMLDivElement>(null);
  const { refresh } = useEsCandles();
  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(refresh);

  return (
    <div ref={ibRef} id="ib-board" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Title row — refresh / screenshot / discord, matching other tabs */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#eef7ff", letterSpacing: ".04em" }}>IB Logic &amp; AI</div>
          <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Initial Balance · ES Futures</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={trigger} style={btnStyle}>{btnLabel}</button>
          <BoxSnapBtn targetRef={ibRef} label="📷" />
          <BoxDiscordBtn targetRef={ibRef} message={`📊 IB Logic — ${new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false})} ET`} />
        </div>
      </div>

      <LiveIb />

      {/* Static IB Logic Reference hidden from user view */}
      <div style={{ display: "none" }}>
      <div style={{ marginBottom: 6, marginTop: 8 }}>
        <div style={{ fontSize: 11, color: "#ffffff", letterSpacing: ".16em", textTransform: "uppercase", fontWeight: 800, marginBottom: 8 }}>
          Static IB Logic Reference
        </div>
        <div style={{ fontSize: 22, color: "#eef7ff", fontWeight: 800 }}>
          Initial Balance Logic, Listed Out
        </div>
        <div style={{ fontSize: 12, color: "#ffffff", marginTop: 6 }}>
          Full probability map. The live tracker above applies the relevant rules to today’s session automatically.
        </div>
      </div>

      <div style={{
        border: "1px solid rgba(33,158,188,.18)", background: "rgba(33,158,188,.04)",
        borderRadius: 8, padding: 12,
      }}>
        <div style={{ fontSize: 11, color: "#219EBC", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 800, marginBottom: 8 }}>
          Reference Summary
        </div>
        <div style={{ fontSize: 13, color: "#ffffff", lineHeight: 1.55 }}>
          IB logic is a probability map, not a prediction engine. The core read is:
          first hour sets the range, midpoint tells directional pressure, the first break
          matters most, and compressed days can expand fast.
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
      }}>
        {LOGIC_ROWS.map((row) => (
          <div key={row.title} style={{
            border: "1px solid rgba(255,255,255,.08)", borderRadius: 8,
            padding: 14, background: "rgba(255,255,255,.02)",
          }}>
            <div style={{
              fontSize: 13, color: row.color, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8,
            }}>
              {row.title}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, color: "#ffffff", fontSize: 13, lineHeight: 1.55 }}>
              {row.items.map((item, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
