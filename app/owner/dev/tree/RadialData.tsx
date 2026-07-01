"use client";

// Radial data-flow: backend sources ring the center; the pages that consume
// each source fan outward from it. Styled to match RadialNav.

type Src = { id: string; label: string; color: string; pages: { label: string; href: string }[] };

// Grouped by primary backend source (a page may appear under its main source).
const SOURCES: Src[] = [
  {
    id: "ws", label: "WS /ws/gex", color: "#22d3ee",
    pages: [
      { label: "Home", href: "/home" }, { label: "Home2", href: "/home2" },
      { label: "ES Candles", href: "/es-candles" },
    ],
  },
  {
    id: "gex", label: "api/gex · chains", color: "#2dd4bf",
    pages: [
      { label: "Multi Greek", href: "/mult-greek" }, { label: "Options Chain", href: "/options-chain" },
      { label: "Premarket", href: "/premarket" },
    ],
  },
  {
    id: "insights", label: "api/insights", color: "#38bdf8",
    pages: [{ label: "Greeks", href: "/greeks" }, { label: "Home (gex)", href: "/home" }],
  },
  {
    id: "snap", label: "api/snapshots", color: "#60a5fa",
    pages: [
      { label: "Confidence", href: "/confidence-score" }, { label: "Journal", href: "/trading" },
      { label: "Greeks", href: "/greeks" },
    ],
  },
  {
    id: "levels", label: "api/levels · em", color: "#0ea5e9",
    pages: [{ label: "EM Front End", href: "/em" }, { label: "Home (levels)", href: "/home" }],
  },
  {
    id: "es", label: "api/es-stats · dxlink", color: "#5eead4",
    pages: [{ label: "ES Candles", href: "/es-candles" }, { label: "Fails", href: "/fails" }],
  },
  {
    id: "cal", label: "api calendars", color: "#7dd3fc",
    pages: [{ label: "Econ Calendar", href: "/economic-calendar" }],
  },
  {
    id: "misc", label: "api/db · budget · proxy", color: "#818cf8",
    pages: [
      { label: "Budget", href: "/owner/budget" }, { label: "Database", href: "/database" },
      { label: "Owner", href: "/owner/dev/owner" },
    ],
  },
];

const W = 1600;
const H = 1200;
const CX = W / 2;
const CY = H / 2;
const SRC_R = 300;
const PAGE_GAP = 150;

function pt(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export default function RadialData() {
  const n = SOURCES.length;
  const angles = SOURCES.map((_, i) => -90 + (360 / n) * i);

  const pagePos = (si: number, j: number, count: number) => {
    const base = angles[si];
    const sp = pt(CX, CY, SRC_R, base);
    const rad = (base * Math.PI) / 180;
    const ox = Math.cos(rad), oy = Math.sin(rad);
    const rowH = 58;
    // source box half-extent the pages must clear before they start
    const srcHalfW = Math.max(150, SOURCES[si].label.length * 11 + 30) / 2;
    const horizontal = Math.abs(ox) > Math.abs(oy);

    if (horizontal) {
      // pages clear the source's WIDTH, then stack vertically out to the side
      const out = srcHalfW + 110;            // clear half the box + a margin
      const offset = (j - (count - 1) / 2) * rowH;
      return { x: sp.x + Math.sign(ox) * out, y: sp.y + offset, ax: sp.x + Math.sign(ox) * srcHalfW, ay: sp.y };
    }

    // up/down → pages clear the source's HEIGHT, two columns biased outward
    const srcHalfH = 26;
    if (count === 1) {
      return { x: sp.x, y: sp.y + Math.sign(oy) * (srcHalfH + 90), ax: sp.x, ay: sp.y + Math.sign(oy) * srcHalfH };
    }
    const rank = Math.floor(j / 2);
    const along = srcHalfH + 90 + rank * 66;
    const centered = Math.abs(sp.x - CX) < 30;
    let lateral: number;
    if (centered) lateral = (j % 2 === 0 ? -1 : 1) * 110;
    else { const dir = sp.x < CX ? -1 : 1; const near = j % 2 === 0 ? 0 : 1; lateral = dir * (50 + near * 160); }
    return { x: sp.x + lateral, y: sp.y + Math.sign(oy) * along, ax: sp.x, ay: sp.y + Math.sign(oy) * srcHalfH };
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", width: "100%", height: "100%", maxHeight: "100%" }}>
      <style>{`
        @keyframes dv-pulse { 0%,100%{ opacity:.18 } 50%{ opacity:.5 } }
        @keyframes dv-spin { to { transform: rotate(360deg) } }
        @keyframes dv-dash { to { stroke-dashoffset: -24 } }
        @keyframes dv-breathe { 0%,100%{ r:46 } 50%{ r:50 } }
        .dv-ring { transform-origin:${CX}px ${CY}px; animation: dv-spin 90s linear infinite; }
        .dv-edge { stroke-dasharray:4 8; animation: dv-dash 1.2s linear infinite; }
        .dv-glow { animation: dv-pulse 3s ease-in-out infinite; }
        .dv-home { animation: dv-breathe 4s ease-in-out infinite; }
        .dv-node { cursor:pointer; }
        .dv-node .dv-box { transition: transform .15s ease, filter .15s ease; transform-box: fill-box; transform-origin: center; }
        .dv-node:hover .dv-box { transform: scale(1.14); filter: brightness(1.5); }
        .dv-src { transition: filter .15s ease; }
        .dv-src:hover { filter: brightness(1.3); }
      `}</style>

      {/* decorative rings */}
      <circle className="dv-glow" cx={CX} cy={CY} r={SRC_R} fill="none" stroke="#38bdf8" strokeWidth={1} strokeOpacity={0.25} />
      <circle className="dv-ring" cx={CX} cy={CY} r={SRC_R + PAGE_GAP} fill="none" stroke="#22d3ee" strokeWidth={1} strokeOpacity={0.12} strokeDasharray="2 14" />

      {/* center -> source edges */}
      {SOURCES.map((s, i) => {
        const sp = pt(CX, CY, SRC_R, angles[i]);
        return <line key={"se" + i} className="dv-edge" x1={CX} y1={CY} x2={sp.x} y2={sp.y}
          stroke={s.color} strokeOpacity={0.65} strokeWidth={4} />;
      })}

      {/* source -> page edges */}
      {SOURCES.map((s, i) =>
        s.pages.map((p, j) => {
          const pp = pagePos(i, j, s.pages.length);
          return <line key={`pe${i}-${j}`} x1={pp.ax} y1={pp.ay} x2={pp.x} y2={pp.y}
            stroke={s.color} strokeOpacity={0.3} strokeWidth={2.5} />;
        })
      )}

      {/* page nodes */}
      {SOURCES.map((s, i) =>
        s.pages.map((p, j) => {
          const pp = pagePos(i, j, s.pages.length);
          const w = Math.max(110, p.label.length * 11 + 28);
          return (
            <g key={`pn${i}-${j}`} className="dv-node" transform={`translate(${pp.x},${pp.y})`}>
              <a href={p.href}>
                <g className="dv-box">
                  <rect x={-w / 2} y={-22} width={w} height={44} rx={10}
                    fill="#0b1626" stroke={s.color} strokeOpacity={0.85} strokeWidth={2}
                    style={{ filter: `drop-shadow(0 0 6px ${s.color}55)` }} />
                  <text textAnchor="middle" dy={6} fontSize={17} fill="#dce6ee">{p.label}</text>
                </g>
              </a>
            </g>
          );
        })
      )}

      {/* source nodes */}
      {SOURCES.map((s, i) => {
        const sp = pt(CX, CY, SRC_R, angles[i]);
        const w = Math.max(150, s.label.length * 11 + 30);
        return (
          <g key={"sn" + i} className="dv-src" transform={`translate(${sp.x},${sp.y})`}>
            <rect x={-w / 2} y={-26} width={w} height={52} rx={13} fill="#0a1018" />
            <rect x={-w / 2} y={-26} width={w} height={52} rx={13}
              fill={s.color} fillOpacity={0.18} stroke={s.color} strokeWidth={2.4}
              style={{ filter: `drop-shadow(0 0 10px ${s.color}66)` }} />
            <text textAnchor="middle" dy={6} fontSize={16} fontWeight={700} fill={s.color}>{s.label}</text>
          </g>
        );
      })}

      {/* center */}
      <circle className="dv-glow" cx={CX} cy={CY} r={70} fill="#22d3ee" fillOpacity={0.16} />
      <g transform={`translate(${CX},${CY})`}>
        <circle className="dv-home" r={52} fill="url(#dataGrad)" stroke="#a5f3fc" strokeWidth={2.5}
          style={{ filter: "drop-shadow(0 0 14px #22d3eeaa)" }} />
        <text textAnchor="middle" dy={-2} fontSize={14} fontWeight={800} fill="#fff">Data</text>
        <text textAnchor="middle" dy={16} fontSize={14} fontWeight={800} fill="#fff">Layer</text>
      </g>

      <defs>
        <radialGradient id="dataGrad" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="55%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </radialGradient>
      </defs>
    </svg>
  );
}
