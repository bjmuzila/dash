"use client";

/**
 * components/scanner/IbLevelCanvas.tsx
 *
 * The live IB state canvas — today's actual Initial Balance, drawn as a price
 * ladder, with every extension level priced in POINTS and tagged with the
 * historical probability of reaching it.
 *
 * The table tells you 34.8% of breaks reach 1.0×. This tells you 1.0× is
 * ES 6,412.50, it's 22.3 points away, and 34.8% of breaks get there. That's the
 * difference between a stat and a target.
 *
 * DATA
 *   live IB  → useEsCandles (today's 5m bars, 09:30–10:30 ET)
 *   base rates → public/data/ib-ES.json (the same slim export the tab reads)
 *
 * HONESTY — the probabilities are CONDITIONAL on a break happening at all.
 * They are not "34.8% chance the market goes there today"; they are "of the
 * breaks that occurred, 34.8% reached 1.0×". Before the IB even breaks, the
 * unconditional odds are lower. The header says so, out loud, because a level
 * with a confident-looking percentage next to it is exactly the kind of thing
 * that gets over-trusted.
 */

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, classicCardAccentStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { useEsCandles } from "@/hooks/useEsCandles";
import type { IbDataset } from "@/lib/ibStats";

const IB_START = 570;   // 09:30 ET
const IB_END = 630;     // 10:30 ET

/** minute-of-day in ET for a candle timestamp */
function etMinutes(ts: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const m: Record<string, string> = {};
  p.forEach((x) => (m[x.type] = x.value));
  return (+m.hour % 24) * 60 + +m.minute;
}

type Lvl = {
  mult: number;          // 0.5 / 1 / 1.5 / 2, signed by side
  side: "up" | "down";
  price: number;
  dist: number;          // points from the live price
  prob: number | null;   // historical reach rate, of breaks that occurred
};

export default function IbLevelCanvas() {
  const { candles, connected } = useEsCandles(true, 1);
  const [ds, setDs] = useState<IbDataset | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/data/ib-ES.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setDs(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* today's IB from the live 5m tape */
  const ib = useMemo(() => {
    if (!candles.length) return null;
    const inIb = candles.filter((c) => {
      const m = etMinutes(c.timestamp);
      return m >= IB_START && m < IB_END;
    });
    if (inIb.length < 2) return null;
    const high = Math.max(...inIb.map((c) => c.high));
    const low = Math.min(...inIb.map((c) => c.low));
    const width = high - low;
    if (!(width > 0)) return null;
    const last = candles[candles.length - 1].close;
    const complete = etMinutes(candles[candles.length - 1].timestamp) >= IB_END;
    return { high, low, width, mid: (high + low) / 2, last, complete, bars: inIb.length };
  }, [candles]);

  /* base rates — of breaks that occurred, how often did they reach each multiple */
  const rates = useMemo(() => {
    if (!ds) return null;
    const b = ds.days.filter((d) => d.fcb);
    const r = (k: string) => (b.length ? b.filter((d) => d.fcb!.hit[k]).length / b.length : null);
    const failed = b.filter((d) => d.fcb!.failed);
    return {
      n: b.length,
      h: { "0.5": r("0.5"), "1": r("1"), "1.5": r("1.5"), "2": r("2") } as Record<string, number | null>,
      failRate: b.length ? failed.length / b.length : null,
      fadeMid: failed.length ? failed.filter((d) => d.fcb!.fadeMid).length / failed.length : null,
      fadeOpp: failed.length ? failed.filter((d) => d.fcb!.fadeOpp).length / failed.length : null,
    };
  }, [ds]);

  const levels: Lvl[] = useMemo(() => {
    if (!ib || !rates) return [];
    const out: Lvl[] = [];
    for (const m of [0.5, 1, 1.5, 2]) {
      const up = ib.high + m * ib.width;
      const dn = ib.low - m * ib.width;
      out.push({ mult: m, side: "up", price: up, dist: up - ib.last, prob: rates.h[String(m)] ?? null });
      out.push({ mult: m, side: "down", price: dn, dist: dn - ib.last, prob: rates.h[String(m)] ?? null });
    }
    return out;
  }, [ib, rates]);

  if (!ib) {
    return (
      <Card title="Live IB state" subtitle="Today's Initial Balance, priced">
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>
          {connected
            ? "Waiting for the 09:30–10:30 ET bars. The canvas builds itself as the Initial Balance forms."
            : "Not connected to the ES candle feed."}
        </div>
      </Card>
    );
  }

  /* ── SVG ladder geometry ─────────────────────────────────────────────────── */
  const W = 560;
  const H = 460;
  const PAD_T = 26;
  const PAD_B = 26;
  const top = ib.high + 2.35 * ib.width;
  const bot = ib.low - 2.35 * ib.width;
  const y = (p: number) => PAD_T + ((top - p) / (top - bot)) * (H - PAD_T - PAD_B);

  const BOX_L = 96;
  const BOX_R = 300;
  const LINE_R = 372;

  const up = levels.filter((l) => l.side === "up").sort((a, b) => b.mult - a.mult);
  const dn = levels.filter((l) => l.side === "down").sort((a, b) => a.mult - b.mult);

  // A break is ANY post-IB (>= 10:30 ET) bar that CLOSED beyond the level. Once a
  // close prints outside, the break is real for the rest of the session even if
  // price slips back inside — so scan every post-IB bar, not just the current
  // close (the old logic only read the last bar and forgot completed breaks).
  const postIbBars = candles
    .filter((c) => etMinutes(c.timestamp) >= IB_END)
    .sort((a, b) => a.timestamp - b.timestamp);
  let brokeUp = false, brokeDown = false, firstBreak: "up" | "down" | null = null;
  for (const c of postIbBars) {
    if (!brokeUp && c.close > ib.high) { brokeUp = true; firstBreak ??= "up"; }
    if (!brokeDown && c.close < ib.low) { brokeDown = true; firstBreak ??= "down"; }
  }
  const broke = firstBreak;
  const backInside = broke != null && ib.last <= ib.high && ib.last >= ib.low;

  return (
    <Card
      title="Live IB state"
      subtitle={`ES · IB ${ib.low.toFixed(2)}–${ib.high.toFixed(2)} · width ${ib.width.toFixed(2)} pts${ib.complete ? "" : " · still forming"}`}
    >
      <style>{`@keyframes ibBrokenPulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>

      {/* ── status pills ── */}
      {(() => {
        const brokeColor = broke === "up" ? HOME_THEME.green : HOME_THEME.red;
        const pill = (bg: string, brd: string, color: string, extra?: React.CSSProperties): React.CSSProperties => ({
          display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 8,
          fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
          background: bg, border: `1px solid ${brd}`, color, ...extra,
        });
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {broke ? (
              <span style={pill(`${brokeColor}1F`, `${brokeColor}66`, brokeColor, backInside ? undefined : { animation: "ibBrokenPulse 1.1s ease-in-out infinite" })}>
                <span style={{ fontSize: 12 }}>{broke === "up" ? "▲" : "▼"}</span>
                IB {broke === "up" ? "HIGH" : "LOW"} BROKEN{backInside ? " · BACK INSIDE" : ""}
              </span>
            ) : (
              <span style={pill(`${LIGHT_BLUE}17`, `${LIGHT_BLUE}44`, LIGHT_BLUE)}>IB UNBROKEN</span>
            )}
            <span style={pill(
              ib.complete ? `${HOME_THEME.green}14` : `${HOME_THEME.orange}17`,
              ib.complete ? `${HOME_THEME.green}44` : `${HOME_THEME.orange}55`,
              ib.complete ? HOME_THEME.green : HOME_THEME.orange,
            )}>
              {ib.complete ? "IB DONE" : "IB FORMING"}
            </span>
            {ib.complete && (
              <span style={pill(`${LIGHT_BLUE}12`, `${LIGHT_BLUE}3B`, LIGHT_BLUE)}>
                <span style={{ fontSize: 12 }}>🔒</span> LOCKED
              </span>
            )}
          </div>
        );
      })()}

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* ── the ladder ── */}
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 560, flex: "1 1 380px" }} role="img" aria-label={`ES initial balance ladder. IB high ${ib.high.toFixed(2)}, low ${ib.low.toFixed(2)}, last ${ib.last.toFixed(2)}.`}>
          {/* extension lines above */}
          {up.map((l) => (
            <g key={`u${l.mult}`}>
              <line
                x1={BOX_L} y1={y(l.price)} x2={LINE_R} y2={y(l.price)}
                stroke={l.mult >= 1.5 ? HOME_THEME.red : l.mult >= 1 ? HOME_THEME.orange : LIGHT_BLUE}
                strokeWidth={1} strokeDasharray="4 4" opacity={0.75}
              />
              <text x={LINE_R + 8} y={y(l.price) + 4} fontSize={11} fontWeight={700} fill={l.mult >= 1.5 ? HOME_THEME.red : l.mult >= 1 ? HOME_THEME.orange : LIGHT_BLUE}>
                {l.mult}× {l.prob != null ? `(${(100 * l.prob).toFixed(1)}%)` : ""}
              </text>
            </g>
          ))}
          {/* extension lines below */}
          {dn.map((l) => (
            <g key={`d${l.mult}`}>
              <line
                x1={BOX_L} y1={y(l.price)} x2={LINE_R} y2={y(l.price)}
                stroke={l.mult >= 1.5 ? HOME_THEME.red : l.mult >= 1 ? HOME_THEME.orange : LIGHT_BLUE}
                strokeWidth={1} strokeDasharray="4 4" opacity={0.75}
              />
              <text x={LINE_R + 8} y={y(l.price) + 4} fontSize={11} fontWeight={700} fill={l.mult >= 1.5 ? HOME_THEME.red : l.mult >= 1 ? HOME_THEME.orange : LIGHT_BLUE}>
                −{l.mult}× {l.prob != null ? `(${(100 * l.prob).toFixed(1)}%)` : ""}
              </text>
            </g>
          ))}

          {/* the IB box */}
          <rect
            x={BOX_L} y={y(ib.high)} width={BOX_R - BOX_L} height={Math.max(2, y(ib.low) - y(ib.high))}
            fill={`${LIGHT_BLUE}0D`} stroke={HOME_THEME.border} strokeWidth={1} rx={2}
          />
          {/* 0.25 fib pullback edge — the retest entry from the IB book */}
          <line
            x1={BOX_L} y1={y(ib.high - 0.25 * ib.width)} x2={BOX_R} y2={y(ib.high - 0.25 * ib.width)}
            stroke={HOME_THEME.green} strokeWidth={1} strokeDasharray="2 3" opacity={0.55}
          />
          <text x={BOX_L + 4} y={y(ib.high - 0.25 * ib.width) - 4} fontSize={9} fill={HOME_THEME.green} opacity={0.85}>
            0.25 fib — pullback entry
          </text>

          {/* midpoint */}
          <line x1={BOX_L} y1={y(ib.mid)} x2={LINE_R} y2={y(ib.mid)} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="5 5" />
          <text x={LINE_R + 8} y={y(ib.mid) + 4} fontSize={11} fontWeight={700} fill="rgba(255,255,255,0.6)">MIDPOINT</text>

          {/* IB high / low */}
          <line x1={BOX_L} y1={y(ib.high)} x2={LINE_R} y2={y(ib.high)} stroke={LIGHT_BLUE} strokeWidth={2.5} />
          <text x={LINE_R + 8} y={y(ib.high) + 4} fontSize={11} fontWeight={800} fill={LIGHT_BLUE}>IB HIGH</text>
          <line x1={BOX_L} y1={y(ib.low)} x2={LINE_R} y2={y(ib.low)} stroke={HOME_THEME.orange} strokeWidth={2.5} />
          <text x={LINE_R + 8} y={y(ib.low) + 4} fontSize={11} fontWeight={800} fill={HOME_THEME.orange}>IB LOW</text>

          {/* live price marker — dashboard card language, colored vs IB midpoint */}
          {(() => {
            const pxColor = ib.last >= ib.mid ? HOME_THEME.green : HOME_THEME.red;
            return (
              <g>
                <circle cx={BOX_R - 40} cy={y(ib.last)} r={4} fill={pxColor} />
                <circle cx={BOX_R - 40} cy={y(ib.last)} r={7} fill="none" stroke={pxColor} strokeWidth={1} opacity={0.35} />
                <line x1={BOX_R - 118} y1={y(ib.last)} x2={BOX_R - 40} y2={y(ib.last)} stroke={pxColor} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
                <rect
                  x={BOX_R - 124} y={y(ib.last) - 30} width={104} height={22} rx={7}
                  fill={HOME_THEME.panelBgStrong} stroke={`${pxColor}59`} strokeWidth={1}
                />
                <text x={BOX_R - 72} y={y(ib.last) - 15} fontSize={11} fontWeight={800} textAnchor="middle" fill={pxColor} style={{ fontVariantNumeric: "tabular-nums" } as any}>
                  {ib.last.toFixed(2)}
                </text>
              </g>
            );
          })()}
        </svg>

        {/* ── the level rail ── */}
        <div style={{ flex: "1 1 260px", minWidth: 260, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text }}>
              Targets — {broke === "up" ? "upside live" : broke === "down" ? "downside live" : "unbroken"}
            </span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: connected ? HOME_THEME.green : HOME_THEME.red }}>
              {connected ? "LIVE" : "STALE"}
            </span>
          </div>

          {(broke === "down" ? dn : up).map((l) => (
            <div key={`${l.side}${l.mult}`} style={{ ...classicCardAccentStyle, padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 14, color: HOME_THEME.text, fontWeight: 700 }}>{l.mult}× extension</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontVariantNumeric: "tabular-nums" }}>{l.price.toFixed(2)}</span>
                <span style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: l.dist >= 0 ? LIGHT_BLUE : HOME_THEME.orange }}>
                  {l.dist >= 0 ? "+" : ""}{l.dist.toFixed(2)}
                </span>
                <span
                  style={{
                    fontSize: 12, fontWeight: 800, padding: "3px 8px", borderRadius: 6, fontVariantNumeric: "tabular-nums",
                    background: `${l.mult >= 1.5 ? HOME_THEME.red : l.mult >= 1 ? HOME_THEME.orange : LIGHT_BLUE}22`,
                    color: l.mult >= 1.5 ? HOME_THEME.red : l.mult >= 1 ? HOME_THEME.orange : LIGHT_BLUE,
                  }}
                >
                  {l.prob != null ? `${(100 * l.prob).toFixed(1)}%` : "—"}
                </span>
              </span>
            </div>
          ))}

          {rates && (
            <div style={{ ...classicCardAccentStyle, padding: "12px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.orange, marginBottom: 6 }}>
                If the break fails
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", lineHeight: 1.5, marginBottom: 10 }}>
                {rates.failRate != null ? `${(100 * rates.failRate).toFixed(1)}% of breaks close back inside within 30 minutes. Of those:` : ""}
              </div>
              <div style={{ display: "flex", gap: 18 }}>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Reach the mid</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.green, fontVariantNumeric: "tabular-nums" }}>
                    {rates.fadeMid != null ? `${(100 * rates.fadeMid).toFixed(1)}%` : "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Full rotation</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.red, fontVariantNumeric: "tabular-nums" }}>
                    {rates.fadeOpp != null ? `${(100 * rates.fadeOpp).toFixed(1)}%` : "—"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
