// Worked example of the Net Drift (Premium) chart for /explore/flow.
//
// Deliberately a hand-drawn SVG of a REPRESENTATIVE session, not a live pull:
// this is a public marketing page and must render for signed-out visitors with
// no feed, no WS and no auth. The shape mirrors what the real /flow chart draws
// — cumulative net CALL premium (green) vs net PUT premium (red) across the full
// 9:30–4:00 RTH, with the per-minute premium histogram docked at the bottom.
//
// Numbers are illustrative and labelled as such. Do NOT wire this to live data.

import { HOME_THEME as T } from "@/components/shared/homeTheme";

const BULLISH = "#22c55e";
const BEARISH = T.red;

// Chart box (viewBox units). Lines live above the histogram lane.
const W = 900;
const H = 340;
const PAD_L = 8;
const PAD_R = 62;
const PAD_T = 16;
const LINE_H = 230; // line area height
const HIST_TOP = 264;
const HIST_H = 54;

// 27 half-hour-ish samples across the session, in $M of cumulative net premium.
// Calls build steadily after an opening chop; puts bleed negative into the close.
const CALL_M = [0, 1.4, 0.9, 2.6, 4.1, 3.6, 6.2, 8.4, 9.1, 11.8, 13.2, 12.6, 15.9, 18.4, 21.0, 23.6, 25.1, 27.8, 30.4, 31.2, 33.9, 36.1, 37.0, 38.6, 39.8, 40.5, 41.2];
const PUT_M = [0, -2.1, -3.4, -2.8, -4.6, -6.2, -5.5, -7.8, -9.4, -8.9, -11.2, -13.6, -12.9, -15.4, -17.1, -18.8, -20.2, -21.6, -22.4, -23.9, -24.6, -25.8, -26.4, -27.1, -27.9, -28.3, -28.6];
// Per-bin gross premium (histogram), and which side dominated that bin.
const BINS = [3, 5, 9, 7, 12, 6, 14, 11, 8, 16, 10, 7, 18, 13, 9, 15, 11, 17, 12, 8, 14, 10, 7, 11, 6, 9, 5];
const BIN_BULL = [1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1];

const MIN = -34;
const MAX = 46;

const x = (i: number) => PAD_L + (i / (CALL_M.length - 1)) * (W - PAD_L - PAD_R);
const y = (v: number) => PAD_T + ((MAX - v) / (MAX - MIN)) * LINE_H;

const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
const area = (vals: number[]) => `${path(vals)} L${x(vals.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

const TIMES = ["9:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:00"];

export default function NetDriftExample() {
  const maxBin = Math.max(...BINS);
  const lastCall = CALL_M[CALL_M.length - 1];
  const lastPut = PUT_M[PUT_M.length - 1];
  const net = lastCall + lastPut;

  return (
    <section style={wrap}>
      <div style={head}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>
            Net Drift (Premium) — <span style={{ color: T.cyan }}>SPX</span>
          </div>
          <div style={{ fontSize: 14, color: T.text, opacity: 0.7, marginTop: 2 }}>
            Cumulative net premium, 0DTE, OTM only, prints ≥ $50K
          </div>
        </div>
        <span style={sampleTag}>Illustrative session</span>
      </div>

      <div style={legend}>
        <span style={{ color: BULLISH, fontWeight: 700 }}>● Calls +${lastCall.toFixed(1)}M</span>
        <span style={{ color: BEARISH, fontWeight: 700 }}>● Puts −${Math.abs(lastPut).toFixed(1)}M</span>
        <span style={{ color: T.text, fontWeight: 700 }}>Net +${net.toFixed(1)}M</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Example Net Drift chart: cumulative net call premium climbing to +41.2M while net put premium bleeds to −28.6M across the session."
      >
        {/* grid */}
        {[MAX, 23, 0, -17, MIN].map((v) => (
          <g key={v}>
            <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={W - PAD_R + 8} y={y(v) + 4} fill={T.text} opacity="0.55" fontSize="12" fontFamily="ui-monospace, monospace">
              {v > 0 ? `+$${v}M` : v < 0 ? `−$${Math.abs(v)}M` : "$0"}
            </text>
          </g>
        ))}
        {/* zero line */}
        <line x1={PAD_L} y1={y(0)} x2={W - PAD_R} y2={y(0)} stroke="rgba(255,255,255,0.22)" strokeWidth="1" />

        {/* fills */}
        <path d={area(CALL_M)} fill={BULLISH} opacity="0.10" />
        <path d={area(PUT_M)} fill={BEARISH} opacity="0.10" />

        {/* lines */}
        <path d={path(CALL_M)} fill="none" stroke={BULLISH} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path(PUT_M)} fill="none" stroke={BEARISH} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* end dots */}
        <circle cx={x(CALL_M.length - 1)} cy={y(lastCall)} r="4" fill={BULLISH} />
        <circle cx={x(PUT_M.length - 1)} cy={y(lastPut)} r="4" fill={BEARISH} />

        {/* annotation: where conviction shows up */}
        <line x1={x(12)} y1={PAD_T} x2={x(12)} y2={PAD_T + LINE_H} stroke={T.cyan} strokeWidth="1" strokeDasharray="4 4" opacity="0.65" />
        <text x={x(12) + 8} y={PAD_T + 16} fill={T.cyan} fontSize="12.5" fontWeight="700" fontFamily="ui-monospace, monospace">
          calls take over
        </text>

        {/* histogram lane */}
        {BINS.map((b, i) => {
          const h = (b / maxBin) * HIST_H;
          const bw = (W - PAD_L - PAD_R) / BINS.length - 4;
          return (
            <rect
              key={i}
              x={x(i) - bw / 2}
              y={HIST_TOP + (HIST_H - h)}
              width={bw}
              height={h}
              rx="1.5"
              fill={BIN_BULL[i] ? BULLISH : BEARISH}
              opacity="0.5"
            />
          );
        })}

        {/* time axis */}
        {TIMES.map((t, i) => (
          <text
            key={t}
            x={PAD_L + (i / (TIMES.length - 1)) * (W - PAD_L - PAD_R)}
            y={H - 4}
            fill={T.text}
            opacity="0.55"
            fontSize="12"
            fontFamily="ui-monospace, monospace"
            textAnchor={i === 0 ? "start" : i === TIMES.length - 1 ? "end" : "middle"}
          >
            {t}
          </text>
        ))}
      </svg>

      <p style={{ fontSize: 14, color: T.text, opacity: 0.75, margin: "14px 0 0", lineHeight: 1.55 }}>
        Green is cumulative net <strong>call</strong> premium, red is net <strong>put</strong> premium — both signed by
        side, so a bought call adds and a sold call subtracts. The bars are per-minute gross premium. On the live page this
        spans the real 9:30–4:00 session and moves with every filter you set.
      </p>
    </section>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const wrap: React.CSSProperties = {
  marginTop: "clamp(28px,5vw,44px)",
  padding: "clamp(16px,3vw,24px)",
  borderRadius: 18,
  border: `1px solid ${T.border}`,
  background: `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.08) 0%, transparent 60%), ${T.panelBg}`,
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 12,
};

const sampleTag: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: T.text,
  border: `1px solid ${T.border}`,
  borderRadius: 999,
  padding: "4px 10px",
  whiteSpace: "nowrap",
};

const legend: React.CSSProperties = {
  display: "flex",
  gap: 22,
  flexWrap: "wrap",
  fontSize: 14,
  marginBottom: 10,
};
