/**
 * Seventeen chart types drawn as plain inline SVG.
 *
 * These are visual references, not a component library — each one hard-codes its
 * own sample data and layout so the page has no dependencies beyond React. If a
 * shape earns its place on a real dashboard page, build it properly there; this
 * is the catalogue you flip through first.
 */
import type { ReactNode } from "react";
import {
  PALETTE as C,
  candles,
  categories,
  channels,
  funnel,
  grouped,
  heatmap,
  months,
  pnl,
  radarA,
  radarAxes,
  radarB,
  sankeyLinks,
  sankeyNodes,
  series1,
  series2,
  series3,
  sunburst,
  tileMap,
} from "./data";

/* ── helpers ──────────────────────────────────────────────────────────────── */

const W = 400;
const H = 210;
const PAD = { t: 16, r: 16, b: 26, l: 34 };

const px = (i: number, n: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
const py = (v: number, min: number, max: number) =>
  H - PAD.b - ((v - min) / (max - min || 1)) * (H - PAD.t - PAD.b);

/** Catmull-Rom → cubic bezier, so the lines read as smooth curves. */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

/** Donut/pie wedge. innerR = 0 gives a solid slice. */
function arc(cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOut, a0);
  const [x1, y1] = polar(cx, cy, rOut, a1);
  if (rIn <= 0) {
    return `M ${cx} ${cy} L ${x0} ${y0} A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} Z`;
  }
  const [x2, y2] = polar(cx, cy, rIn, a1);
  const [x3, y3] = polar(cx, cy, rIn, a0);
  return `M ${x0} ${y0} A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3} Z`;
}

function Svg({ children, vb = `0 0 ${W} ${H}` }: { children: ReactNode; vb?: string }) {
  return (
    <svg viewBox={vb} width="100%" style={{ display: "block", overflow: "visible" }} role="img">
      {children}
    </svg>
  );
}

function GridLines({ rows = 4 }: { rows?: number }) {
  return (
    <g>
      {Array.from({ length: rows + 1 }, (_, i) => {
        const y = PAD.t + (i / rows) * (H - PAD.t - PAD.b);
        return (
          <line
            key={i}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y}
            y2={y}
            stroke={C.grid}
            strokeDasharray="4 4"
          />
        );
      })}
    </g>
  );
}

function XLabels({ labels }: { labels: string[] }) {
  return (
    <g fill={C.axis} fontSize={9} textAnchor="middle">
      {labels.map((l, i) => (
        <text key={l + i} x={px(i, labels.length)} y={H - PAD.b + 14}>
          {l}
        </text>
      ))}
    </g>
  );
}

const tickLabels = ["", "Q1", "", "Q2", "", "Q3", "", "Q4"];

/* ── 1 · line ─────────────────────────────────────────────────────────────── */

export function LineExample() {
  const min = 30;
  const max = 110;
  const pts = series1.map((v, i) => [px(i, series1.length), py(v, min, max)] as [number, number]);
  const hover = 17;

  return (
    <Svg>
      <GridLines />
      <path d={smooth(pts)} fill="none" stroke={C.lightBlue} strokeWidth={2.5} strokeLinecap="round" />
      <line
        x1={pts[hover][0]}
        x2={pts[hover][0]}
        y1={PAD.t}
        y2={H - PAD.b}
        stroke="rgba(255,255,255,0.28)"
        strokeDasharray="3 3"
      />
      <circle cx={pts[hover][0]} cy={pts[hover][1]} r={7} fill={C.lightBlue} opacity={0.18} />
      <circle cx={pts[hover][0]} cy={pts[hover][1]} r={3.5} fill={C.lightBlue} />
      <g fill={C.axis} fontSize={9} textAnchor="end">
        {[110, 90, 70, 50, 30].map((v) => (
          <text key={v} x={PAD.l - 7} y={py(v, min, max) + 3}>
            {v}
          </text>
        ))}
      </g>
      <XLabels labels={tickLabels} />
    </Svg>
  );
}

/* ── 2 · area ─────────────────────────────────────────────────────────────── */

export function AreaExample() {
  const min = 10;
  const max = 110;
  const mk = (s: number[]) => s.map((v, i) => [px(i, s.length), py(v, min, max)] as [number, number]);
  const a = mk(series1);
  const b = mk(series2);
  const close = (pts: [number, number][]) =>
    `${smooth(pts)} L ${pts[pts.length - 1][0]} ${H - PAD.b} L ${pts[0][0]} ${H - PAD.b} Z`;

  return (
    <Svg>
      <defs>
        <linearGradient id="ex-area-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.cyan} stopOpacity={0.55} />
          <stop offset="100%" stopColor={C.cyan} stopOpacity={0} />
        </linearGradient>
        <linearGradient id="ex-area-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.orange} stopOpacity={0.45} />
          <stop offset="100%" stopColor={C.orange} stopOpacity={0} />
        </linearGradient>
      </defs>
      <GridLines />
      <path d={close(a)} fill="url(#ex-area-a)" />
      <path d={smooth(a)} fill="none" stroke={C.cyan} strokeWidth={2} />
      <path d={close(b)} fill="url(#ex-area-b)" />
      <path d={smooth(b)} fill="none" stroke={C.orange} strokeWidth={2} />
      <XLabels labels={tickLabels} />
    </Svg>
  );
}

/* ── 3 · composed ─────────────────────────────────────────────────────────── */

export function ComposedExample() {
  const min = 0;
  const max = 110;
  const n = 16;
  const bw = (W - PAD.l - PAD.r) / n - 6;
  const line = series1.slice(0, n).map((v, i) => [px(i, n), py(v, min, max)] as [number, number]);
  const areaPts = series2.slice(0, n).map((v, i) => [px(i, n), py(v + 22, min, max)] as [number, number]);

  return (
    <Svg>
      <defs>
        <linearGradient id="ex-comp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.green} stopOpacity={0.34} />
          <stop offset="100%" stopColor={C.green} stopOpacity={0} />
        </linearGradient>
      </defs>
      <GridLines />
      <path
        d={`${smooth(areaPts)} L ${areaPts[n - 1][0]} ${H - PAD.b} L ${areaPts[0][0]} ${H - PAD.b} Z`}
        fill="url(#ex-comp)"
      />
      {series3.slice(0, n).map((v, i) => {
        const y = py(v * 0.55, min, max);
        return (
          <rect
            key={i}
            x={px(i, n) - bw / 2}
            y={y}
            width={bw}
            height={H - PAD.b - y}
            rx={3}
            fill={C.gold}
            opacity={0.75}
          />
        );
      })}
      <path d={smooth(line)} fill="none" stroke={C.lightBlue} strokeWidth={2.5} />
      <XLabels labels={tickLabels} />
    </Svg>
  );
}

/* ── 4 · scatter ──────────────────────────────────────────────────────────── */

export function ScatterExample() {
  const min = 30;
  const max = 100;
  return (
    <Svg>
      <GridLines />
      {series3.map((v, i) => (
        <g key={i}>
          <circle cx={px(i, series3.length)} cy={py(v, min, max)} r={8} fill={C.cyan} opacity={0.14} />
          <circle
            cx={px(i, series3.length)}
            cy={py(v, min, max)}
            r={4}
            fill={C.cyan}
            stroke={C.lightBlue}
            strokeWidth={1.5}
          />
        </g>
      ))}
      {series2.map((v, i) => (
        <circle key={`b${i}`} cx={px(i, series2.length)} cy={py(v + 18, min, max)} r={3.5} fill={C.orange} opacity={0.85} />
      ))}
      <XLabels labels={tickLabels} />
    </Svg>
  );
}

/* ── 5 · live line ────────────────────────────────────────────────────────── */

export function LiveLineExample() {
  const min = 30;
  const max = 110;
  const pts = series1.map((v, i) => [px(i, series1.length) - 34, py(v, min, max)] as [number, number]);
  const last = pts[pts.length - 1];

  return (
    <Svg>
      <defs>
        <linearGradient id="ex-live" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.green} stopOpacity={0.35} />
          <stop offset="100%" stopColor={C.green} stopOpacity={0} />
        </linearGradient>
      </defs>
      <GridLines />
      <path
        d={`${smooth(pts)} L ${last[0]} ${H - PAD.b} L ${pts[0][0]} ${H - PAD.b} Z`}
        fill="url(#ex-live)"
      />
      <path d={smooth(pts)} fill="none" stroke={C.green} strokeWidth={2.5} />
      <line x1={last[0]} x2={W - PAD.r} y1={last[1]} y2={last[1]} stroke={C.green} strokeDasharray="3 3" opacity={0.5} />
      <circle cx={last[0]} cy={last[1]} r={11} fill={C.green} opacity={0.15} />
      <circle cx={last[0]} cy={last[1]} r={4} fill={C.green} />
      <g>
        <rect x={W - PAD.r - 44} y={last[1] - 10} width={48} height={20} rx={6} fill={C.green} />
        <text x={W - PAD.r - 20} y={last[1] + 4} fontSize={10} fontWeight={700} fill="#05060A" textAnchor="middle">
          102.4
        </text>
      </g>
      <XLabels labels={["", "-3m", "", "-2m", "", "-1m", "", "now"]} />
    </Svg>
  );
}

/* ── 6 · profit / loss ────────────────────────────────────────────────────── */

export function PnlExample() {
  const min = -45;
  const max = 70;
  const zero = py(0, min, max);
  const pts = pnl.map((v, i) => [px(i, pnl.length), py(v, min, max)] as [number, number]);
  const d = smooth(pts);

  return (
    <Svg>
      <defs>
        <clipPath id="ex-pnl-up">
          <rect x={0} y={0} width={W} height={zero} />
        </clipPath>
        <clipPath id="ex-pnl-dn">
          <rect x={0} y={zero} width={W} height={H - zero} />
        </clipPath>
      </defs>
      <GridLines />
      <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} stroke="rgba(255,255,255,0.35)" />
      <path d={`${d} L ${pts[pts.length - 1][0]} ${zero} L ${pts[0][0]} ${zero} Z`} fill="#22c55e" opacity={0.14} clipPath="url(#ex-pnl-up)" />
      <path d={`${d} L ${pts[pts.length - 1][0]} ${zero} L ${pts[0][0]} ${zero} Z`} fill={C.red} opacity={0.14} clipPath="url(#ex-pnl-dn)" />
      <path d={d} fill="none" stroke="#22c55e" strokeWidth={2.5} clipPath="url(#ex-pnl-up)" />
      <path d={d} fill="none" stroke={C.red} strokeWidth={2.5} clipPath="url(#ex-pnl-dn)" />
      <text x={PAD.l - 7} y={zero + 3} fontSize={9} fill={C.axis} textAnchor="end">
        0
      </text>
      <XLabels labels={tickLabels} />
    </Svg>
  );
}

/* ── 7 · candlestick ──────────────────────────────────────────────────────── */

export function CandlestickExample() {
  const min = 48;
  const max = 94;
  const n = candles.length;
  const step = (W - PAD.l - PAD.r) / n;
  const bw = step * 0.6;

  return (
    <Svg>
      <GridLines />
      {candles.map((c, i) => {
        const x = PAD.l + step * (i + 0.5);
        const up = c.c >= c.o;
        const col = up ? "#22c55e" : C.red;
        const yO = py(c.o, min, max);
        const yC = py(c.c, min, max);
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={py(c.h, min, max)} y2={py(c.l, min, max)} stroke={col} strokeWidth={1.2} />
            <rect
              x={x - bw / 2}
              y={Math.min(yO, yC)}
              width={bw}
              height={Math.max(2, Math.abs(yC - yO))}
              fill={col}
              rx={1}
            />
          </g>
        );
      })}
      <g fill={C.axis} fontSize={9} textAnchor="end">
        {[90, 78, 66, 54].map((v) => (
          <text key={v} x={PAD.l - 7} y={py(v, min, max) + 3}>
            {v}
          </text>
        ))}
      </g>
    </Svg>
  );
}

/* ── 8 · bar ──────────────────────────────────────────────────────────────── */

export function BarExample() {
  const min = 0;
  const max = 115;
  const n = grouped.length;
  const step = (W - PAD.l - PAD.r) / n;
  const bw = step * 0.3;

  return (
    <Svg>
      <GridLines />
      {grouped.map((g, i) => {
        const cx = PAD.l + step * (i + 0.5);
        const ya = py(g.a, min, max);
        const yb = py(g.b, min, max);
        return (
          <g key={g.label}>
            <rect x={cx - bw - 2} y={ya} width={bw} height={H - PAD.b - ya} rx={3} fill={C.cyan} />
            <rect x={cx + 2} y={yb} width={bw} height={H - PAD.b - yb} rx={3} fill={C.orange} opacity={0.85} />
          </g>
        );
      })}
      <XLabels labels={months} />
    </Svg>
  );
}

/* ── 9 · funnel ───────────────────────────────────────────────────────────── */

export function FunnelExample() {
  const top = funnel[0].value;
  const n = funnel.length;
  const step = (W - 40) / n;
  const midY = 88;
  const maxH = 56;
  const hAt = (v: number) => (v / top) * maxH;

  return (
    <Svg vb={`0 0 ${W} 185`}>
      {funnel.map((s, i) => {
        const next = funnel[i + 1] ?? s;
        const x0 = 20 + step * i;
        const x1 = x0 + step - 4;
        const cx = x0 + step / 2 - 2;
        const h0 = hAt(s.value);
        const h1 = hAt(next.value);
        return (
          <g key={s.label}>
            <path
              d={`M ${x0} ${midY - h0} L ${x1} ${midY - h1} L ${x1} ${midY + h1} L ${x0} ${midY + h0} Z`}
              fill={C.cyan}
              opacity={0.85 - i * 0.12}
            />
            {/* Values sit below the shape, not inside it — the tail stages get
                too thin for legible text on top of the fill. */}
            <text x={cx} y={midY + maxH + 26} fontSize={12} fontWeight={800} fill="#fff" textAnchor="middle">
              {s.display}
            </text>
            <text x={cx} y={midY + maxH + 40} fontSize={9} fill={C.axis} textAnchor="middle">
              {s.label}
            </text>
            <text x={cx} y={midY - maxH - 14} fontSize={9} fontWeight={700} fill={C.lightBlue} textAnchor="middle">
              {Math.round((s.value / top) * 100)}%
            </text>
          </g>
        );
      })}
    </Svg>
  );
}

/* ── 10 · heatmap ─────────────────────────────────────────────────────────── */

const heatScale = [
  "rgba(255,255,255,0.05)",
  "rgba(33,158,188,0.30)",
  "rgba(33,158,188,0.55)",
  "rgba(33,158,188,0.80)",
  "#7dd3fc",
];

export function HeatmapExample() {
  const cell = 15;
  const gap = 3;
  const x0 = 34;
  const y0 = 18;
  const days = ["M", "", "W", "", "F", "", ""];

  return (
    <Svg vb={`0 0 ${W} 175`}>
      {heatmap.map((row, r) =>
        row.map((v, c) => (
          <rect
            key={`${r}-${c}`}
            x={x0 + c * (cell + gap)}
            y={y0 + r * (cell + gap)}
            width={cell}
            height={cell}
            rx={3}
            fill={heatScale[v]}
          />
        )),
      )}
      <g fill={C.axis} fontSize={9}>
        {days.map((d, i) => (
          <text key={i} x={x0 - 9} y={y0 + i * (cell + gap) + 11} textAnchor="end">
            {d}
          </text>
        ))}
        <text x={x0} y={y0 - 6} fontSize={9}>
          Jan
        </text>
        <text x={x0 + 9 * (cell + gap)} y={y0 - 6} fontSize={9}>
          Apr
        </text>
      </g>
      <g transform={`translate(${x0}, ${y0 + 7 * (cell + gap) + 16})`}>
        <text x={0} y={9} fontSize={9} fill={C.axis}>
          Less
        </text>
        {heatScale.map((f, i) => (
          <rect key={i} x={30 + i * 15} y={0} width={11} height={11} rx={2.5} fill={f} />
        ))}
        <text x={110} y={9} fontSize={9} fill={C.axis}>
          More
        </text>
      </g>
    </Svg>
  );
}

/* ── 11 · pie ─────────────────────────────────────────────────────────────── */

export function PieExample() {
  const total = categories.reduce((s, c) => s + c.value, 0);
  let a = 0;
  return (
    <Svg vb="0 0 400 200">
      <g>
        {categories.map((c) => {
          const sweep = (c.value / total) * 360;
          const d = arc(105, 100, 82, 0, a + 0.6, a + sweep - 0.6);
          a += sweep;
          return <path key={c.label} d={d} fill={c.color} />;
        })}
      </g>
      <g fontSize={11}>
        {categories.map((c, i) => (
          <g key={c.label} transform={`translate(230, ${34 + i * 27})`}>
            <rect width={9} height={9} rx={2.5} y={-8} fill={c.color} />
            <text x={17} fill="rgba(255,255,255,0.82)">
              {c.label}
            </text>
            <text x={155} textAnchor="end" fill="rgba(255,255,255,0.55)">
              {Math.round((c.value / total) * 100)}%
            </text>
          </g>
        ))}
      </g>
    </Svg>
  );
}

/* ── 12 · ring ────────────────────────────────────────────────────────────── */

export function RingExample() {
  const cx = 105;
  const cy = 100;
  return (
    <Svg vb="0 0 400 200">
      {channels.map((c, i) => {
        const r = 88 - i * 22;
        const sweep = (c.value / c.max) * 330;
        return (
          <g key={c.label}>
            <path d={arc(cx, cy, r, r - 13, 0, 330)} fill="rgba(255,255,255,0.06)" />
            <path d={arc(cx, cy, r, r - 13, 0, sweep)} fill={c.color} />
          </g>
        );
      })}
      <text x={cx} y={cy - 1} fontSize={17} fontWeight={800} fill="#fff" textAnchor="middle">
        9.5k
      </text>
      <text x={cx} y={cy + 13} fontSize={8} fill={C.axis} textAnchor="middle">
        Total sessions
      </text>
      <g fontSize={11}>
        {channels.map((c, i) => (
          <g key={c.label} transform={`translate(230, ${52 + i * 30})`}>
            <rect width={9} height={9} rx={2.5} y={-8} fill={c.color} />
            <text x={17} fill="rgba(255,255,255,0.82)">
              {c.label}
            </text>
            <text x={155} textAnchor="end" fill="rgba(255,255,255,0.55)">
              {c.value.toLocaleString()}
            </text>
          </g>
        ))}
      </g>
    </Svg>
  );
}

/* ── 13 · gauge ───────────────────────────────────────────────────────────── */

export function GaugeExample() {
  const cx = 200;
  const cy = 132;
  const notches = 44;
  const value = 0.66;
  const start = -125;
  const end = 125;

  return (
    <Svg vb="0 0 400 190">
      {Array.from({ length: notches }, (_, i) => {
        const t = i / (notches - 1);
        const deg = start + t * (end - start);
        const on = t <= value;
        const [x1, y1] = polar(cx, cy, 74, deg);
        const [x2, y2] = polar(cx, cy, 96, deg);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={on ? C.lightBlue : "rgba(255,255,255,0.14)"}
            strokeWidth={4}
            strokeLinecap="round"
            opacity={on ? 0.5 + t * 0.5 : 1}
          />
        );
      })}
      <text x={cx} y={cy - 4} fontSize={30} fontWeight={800} fill="#fff" textAnchor="middle">
        $428k
      </text>
      <text x={cx} y={cy + 16} fontSize={10} fill={C.axis} textAnchor="middle">
        ARR run rate
      </text>
      <text x={cx} y={cy + 40} fontSize={10} fill={C.lightBlue} textAnchor="middle" fontWeight={700}>
        66% of target
      </text>
    </Svg>
  );
}

/* ── 14 · radar ───────────────────────────────────────────────────────────── */

export function RadarExample() {
  const cx = 200;
  const cy = 105;
  const R = 82;
  const n = radarAxes.length;
  const pt = (v: number, i: number, r = R) => polar(cx, cy, (v / 100) * r, (i / n) * 360);
  const poly = (vals: number[]) => vals.map((v, i) => pt(v, i).join(",")).join(" ");

  return (
    <Svg vb="0 0 400 210">
      {[0.25, 0.5, 0.75, 1].map((l) => (
        <polygon
          key={l}
          points={radarAxes.map((_, i) => polar(cx, cy, R * l, (i / n) * 360).join(",")).join(" ")}
          fill="none"
          stroke={C.grid}
        />
      ))}
      {radarAxes.map((_, i) => {
        const [x, y] = polar(cx, cy, R, (i / n) * 360);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={C.grid} />;
      })}
      <polygon points={poly(radarB)} fill={C.orange} fillOpacity={0.22} stroke={C.orange} strokeWidth={2} />
      <polygon points={poly(radarA)} fill={C.cyan} fillOpacity={0.25} stroke={C.lightBlue} strokeWidth={2} />
      {radarA.map((v, i) => {
        const [x, y] = pt(v, i);
        return <circle key={i} cx={x} cy={y} r={3} fill={C.lightBlue} />;
      })}
      <g fontSize={9} fill={C.axis}>
        {radarAxes.map((a, i) => {
          const [x, y] = polar(cx, cy, R + 17, (i / n) * 360);
          return (
            <text key={a} x={x} y={y + 3} textAnchor="middle">
              {a}
            </text>
          );
        })}
      </g>
    </Svg>
  );
}

/* ── 15 · sunburst ────────────────────────────────────────────────────────── */

export function SunburstExample() {
  const cx = 200;
  const cy = 105;
  const total = sunburst.reduce((s, g) => s + g.children.reduce((a, c) => a + c.value, 0), 0);
  let a = 0;

  return (
    <Svg vb="0 0 400 210">
      {sunburst.map((g) => {
        const gv = g.children.reduce((s, c) => s + c.value, 0);
        const gSweep = (gv / total) * 360;
        const inner = arc(cx, cy, 56, 30, a + 0.8, a + gSweep - 0.8);
        let ca = a;
        const kids = g.children.map((c) => {
          const cs = (c.value / total) * 360;
          const d = arc(cx, cy, 92, 60, ca + 0.8, ca + cs - 0.8);
          const [lx, ly] = polar(cx, cy, 76, ca + cs / 2);
          ca += cs;
          return { d, lx, ly, name: c.name, show: cs > 26 };
        });
        a += gSweep;
        return (
          <g key={g.name}>
            <path d={inner} fill={g.color} />
            {kids.map((k) => (
              <g key={k.name}>
                <path d={k.d} fill={g.color} opacity={0.5} />
                {k.show && (
                  <text x={k.lx} y={k.ly + 3} fontSize={8} fill="#fff" textAnchor="middle" opacity={0.9}>
                    {k.name}
                  </text>
                )}
              </g>
            ))}
          </g>
        );
      })}
      <text x={cx} y={cy + 1} fontSize={12} fontWeight={800} fill="#fff" textAnchor="middle">
        Revenue
      </text>
      <text x={cx} y={cy + 14} fontSize={9} fill={C.axis} textAnchor="middle">
        $810k
      </text>
    </Svg>
  );
}

/* ── 16 · sankey ──────────────────────────────────────────────────────────── */

export function SankeyExample() {
  const colX = [58, 200, 312];
  const nodeW = 11;
  const top = 18;
  const height = 150;
  const scale = height / 1330;
  const gap = 14;

  // stack nodes per column
  const layout = new Map<number, { x: number; y: number; h: number }>();
  [0, 1, 2].forEach((col) => {
    const inCol = sankeyNodes.map((n, i) => ({ ...n, i })).filter((n) => n.col === col);
    const totalH = inCol.reduce((s, n) => s + n.value * scale, 0) + gap * (inCol.length - 1);
    let y = top + (height - totalH) / 2;
    inCol.forEach((n) => {
      const h = n.value * scale;
      layout.set(n.i, { x: colX[col], y, h });
      y += h + gap;
    });
  });

  const outUsed = new Map<number, number>();
  const inUsed = new Map<number, number>();

  return (
    <Svg vb={`0 0 ${W} 190`}>
      {sankeyLinks.map((l, i) => {
        const s = layout.get(l.s)!;
        const t = layout.get(l.t)!;
        const h = l.v * scale;
        const so = outUsed.get(l.s) ?? 0;
        const ti = inUsed.get(l.t) ?? 0;
        outUsed.set(l.s, so + h);
        inUsed.set(l.t, ti + h);
        const y0 = s.y + so;
        const y1 = t.y + ti;
        const x0 = s.x + nodeW;
        const x1 = t.x;
        const mx = (x0 + x1) / 2;
        return (
          <path
            key={i}
            d={`M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1} L ${x1} ${y1 + h} C ${mx} ${y1 + h}, ${mx} ${y0 + h}, ${x0} ${y0 + h} Z`}
            fill={l.t === 6 ? C.red : C.cyan}
            opacity={0.24}
          />
        );
      })}
      {sankeyNodes.map((n, i) => {
        const p = layout.get(i)!;
        return (
          <g key={n.name}>
            <rect x={p.x} y={p.y} width={nodeW} height={p.h} rx={3} fill={n.name === "Bounced" ? C.red : C.lightBlue} />
            <text
              x={p.x + nodeW + 7}
              y={p.y + p.h / 2 + 3}
              fontSize={9}
              fill="rgba(255,255,255,0.75)"
              textAnchor="start"
            >
              {n.name}
            </text>
          </g>
        );
      })}
    </Svg>
  );
}

/* ── 17 · choropleth ──────────────────────────────────────────────────────── */

export function ChoroplethExample() {
  const cell = 30;
  const gap = 3;
  const x0 = 46;
  const y0 = 8;

  return (
    <Svg vb={`0 0 ${W} 262`}>
      {tileMap.map(([c, r, label, level]) => (
        <g key={label}>
          <rect
            x={x0 + c * (cell + gap)}
            y={y0 + r * (cell + gap)}
            width={cell}
            height={cell}
            rx={4}
            fill={heatScale[level]}
            stroke="rgba(255,255,255,0.07)"
          />
          <text
            x={x0 + c * (cell + gap) + cell / 2}
            y={y0 + r * (cell + gap) + cell / 2 + 3.5}
            fontSize={9}
            fontWeight={600}
            textAnchor="middle"
            fill={level >= 3 ? "#05060A" : "rgba(255,255,255,0.7)"}
          >
            {label}
          </text>
        </g>
      ))}
      <g transform={`translate(${x0}, 246)`}>
        <text x={0} y={9} fontSize={9} fill={C.axis}>
          Low
        </text>
        {heatScale.map((f, i) => (
          <rect key={i} x={28 + i * 15} y={0} width={11} height={11} rx={2.5} fill={f} />
        ))}
        <text x={108} y={9} fontSize={9} fill={C.axis}>
          High
        </text>
      </g>
    </Svg>
  );
}
