"use client";

import Link from "next/link";

type Page = { label: string; href: string };
type Group = { label: string; href?: string; color: string; pages: Page[] };

const GROUPS: Group[] = [
  {
    label: "GEX", color: "#22d3ee", // cyan
    pages: [
      { label: "Home", href: "/home" }, { label: "Home2", href: "/home2" },
      { label: "Multi Greek", href: "/mult-greek" }, { label: "Options Chain", href: "/options-chain" },
      { label: "Greeks", href: "/greeks" }, { label: "Confidence", href: "/confidence-score" },
      { label: "EM Front End", href: "/em" },
    ],
  },
  {
    label: "Futures", color: "#2dd4bf", // teal
    pages: [{ label: "ES Candles", href: "/es-candles" }, { label: "Fails", href: "/fails" }],
  },
  {
    label: "Stock Market", color: "#38bdf8", // sky blue
    pages: [{ label: "Premarket", href: "/premarket" }, { label: "Econ Calendar", href: "/economic-calendar" }],
  },
  {
    label: "Personal", color: "#60a5fa", // blue
    pages: [
      { label: "Journal", href: "/trading" }, { label: "Budget", href: "/owner/budget" },
      { label: "To-Do", href: "/owner/personal/todo" },
    ],
  },
  {
    label: "Admin", color: "#0ea5e9", // sky-600 blue
    pages: [
      { label: "Owner", href: "/owner/dev/owner" }, { label: "Admin", href: "/owner/dev/admin" },
      { label: "Tree", href: "/owner/dev/tree" }, { label: "Database", href: "/database" },
      { label: "Dev", href: "/owner/dev" }, { label: "EM BE", href: "/estimated-move" },
      { label: "Social", href: "/social-media" }, { label: "Logs", href: "/logs" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
];

const W = 1600;
const H = 1200;
const CX = W / 2;
const CY = H / 2;
const GROUP_R = 230; // ring radius for group nodes
const PAGE_GAP = 150; // distance from a group node out to its first page row
const ROW_STEP = 175; // distance between successive rows — must exceed box WIDTH
const COL_SEP = 60; // half-distance between the two columns (perpendicular)

function pt(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export default function RadialNav() {
  const n = GROUPS.length;

  // assign each group an angular sector around the circle (start at top, go clockwise)
  const groupAngles = GROUPS.map((_, i) => -90 + (360 / n) * i);

  // Each group's pages are laid out in two columns measured in real screen
  // space (outward axis + perpendicular axis), so boxes never overlap.
  const pagePos = (gi: number, j: number, count: number) => {
    const baseAngle = groupAngles[gi];
    const gp = pt(CX, CY, GROUP_R, baseAngle);
    const rad = (baseAngle * Math.PI) / 180;
    // unit vectors: outward (away from center) and perpendicular (sideways)
    const ox = Math.cos(rad), oy = Math.sin(rad);
    const px = -Math.sin(rad), py = Math.cos(rad);

    if (count === 1) {
      return { x: gp.x + ox * PAGE_GAP, y: gp.y + oy * PAGE_GAP };
    }

    // Choose stacking axis by orientation so spacing matches the box dimension
    // that lies along it: boxes are wide (~150) and short (~44).
    const horizontal = Math.abs(ox) > Math.abs(oy); // group points sideways

    if (horizontal) {
      const rowH = 56; // > box height
      // few items → single vertical column stacked out to the side
      if (count <= 3) {
        const offset = (j - (count - 1) / 2) * rowH;
        return { x: gp.x + ox * PAGE_GAP, y: gp.y + offset };
      }
      // many items → TWO vertical columns, alternating near/far
      const colIndex = j % 2;               // 0 = near column, 1 = far column
      const rowIndex = Math.floor(j / 2);   // position within the column
      const rowsInCol = colIndex === 0 ? Math.ceil(count / 2) : Math.floor(count / 2);
      const col = PAGE_GAP + colIndex * 190;
      const offset = (rowIndex - (rowsInCol - 1) / 2) * rowH;
      return { x: gp.x + ox * col, y: gp.y + offset };
    }
    // pages pointing up/down → two columns left/right (box width governs sideways)
    const rank = Math.floor(j / 2);
    const along = PAGE_GAP + rank * 64;     // box height governs vertical steps
    // bias columns AWAY from the vertical centerline so neighbouring bottom/top
    // groups don't collide in the middle. groups left of center lean left, etc.
    const centered = Math.abs(gp.x - CX) < 30; // GEX sits on the vertical axis
    let lateral: number;
    if (centered) {
      // symmetric left/right split
      lateral = (j % 2 === 0 ? -1 : 1) * 100;
    } else {
      // bias both columns away from center so adjacent groups don't collide
      const dir = gp.x < CX ? -1 : 1;
      const near = j % 2 === 0 ? 0 : 1;
      lateral = dir * (40 + near * 150);
    }
    return {
      x: gp.x + lateral,
      y: gp.y + oy * along,
    };
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", width: "100%", height: "100%", maxHeight: "100%" }}>
      <style>{`
        @keyframes nv-pulse { 0%,100%{ opacity:.18 } 50%{ opacity:.5 } }
        @keyframes nv-spin { to { transform: rotate(360deg) } }
        @keyframes nv-dash { to { stroke-dashoffset: -24 } }
        @keyframes nv-breathe { 0%,100%{ r:46 } 50%{ r:50 } }
        .nv-ring { transform-origin:${CX}px ${CY}px; animation: nv-spin 90s linear infinite; }
        .nv-ring2 { transform-origin:${CX}px ${CY}px; animation: nv-spin 60s linear infinite reverse; }
        .nv-edge { stroke-dasharray:4 8; animation: nv-dash 1.2s linear infinite; }
        .nv-glow { animation: nv-pulse 3s ease-in-out infinite; }
        .nv-home { animation: nv-breathe 4s ease-in-out infinite; }
        .nv-node { cursor:pointer; }
        .nv-node .nv-box { transition: transform .15s ease, filter .15s ease; transform-box: fill-box; transform-origin: center; }
        .nv-node:hover .nv-box { transform: scale(1.14); filter: brightness(1.5); }
        .nv-grp { transition: filter .15s ease; }
        .nv-grp:hover { filter: brightness(1.3); }
      `}</style>

      {/* decorative concentric rings */}
      <circle className="nv-glow" cx={CX} cy={CY} r={GROUP_R} fill="none" stroke="#38bdf8" strokeWidth={1} strokeOpacity={0.25} />
      <circle className="nv-ring" cx={CX} cy={CY} r={GROUP_R + PAGE_GAP} fill="none" stroke="#22d3ee" strokeWidth={1} strokeOpacity={0.14} strokeDasharray="2 14" />
      <circle className="nv-ring2" cx={CX} cy={CY} r={GROUP_R + 90} fill="none" stroke="#2dd4bf" strokeWidth={1} strokeOpacity={0.12} strokeDasharray="1 20" />

      {/* edges: home -> groups (animated flowing dashes) */}
      {GROUPS.map((g, i) => {
        const gp = pt(CX, CY, GROUP_R, groupAngles[i]);
        return (
          <line key={"e" + i} className="nv-edge" x1={CX} y1={CY} x2={gp.x} y2={gp.y}
            stroke={g.color} strokeOpacity={0.65} strokeWidth={4} />
        );
      })}

      {/* edges: group -> pages */}
      {GROUPS.map((g, i) => {
        const gp = pt(CX, CY, GROUP_R, groupAngles[i]);
        const count = g.pages.length;
        return g.pages.map((p, j) => {
          const pp = pagePos(i, j, count);
          return (
            <line key={`pe${i}-${j}`} x1={gp.x} y1={gp.y} x2={pp.x} y2={pp.y}
              stroke={g.color} strokeOpacity={0.3} strokeWidth={2.5} />
          );
        });
      })}

      {/* page nodes */}
      {GROUPS.map((g, i) => {
        const count = g.pages.length;
        return g.pages.map((p, j) => {
          const pp = pagePos(i, j, count);
          const w = Math.max(110, p.label.length * 11 + 28);
          return (
            <g key={`pn${i}-${j}`} className="nv-node" transform={`translate(${pp.x},${pp.y})`}>
              <a href={p.href}>
                <g className="nv-box">
                  <rect x={-w / 2} y={-22} width={w} height={44} rx={10}
                    fill="#0b1626" stroke={g.color} strokeOpacity={0.85} strokeWidth={2}
                    style={{ filter: `drop-shadow(0 0 6px ${g.color}55)` }} />
                  <text textAnchor="middle" dy={6} fontSize={18} fill="#dce6ee">{p.label}</text>
                </g>
              </a>
            </g>
          );
        });
      })}

      {/* group nodes */}
      {GROUPS.map((g, i) => {
        const gp = pt(CX, CY, GROUP_R, groupAngles[i]);
        const w = Math.max(130, g.label.length * 13 + 36);
        return (
          <g key={"gn" + i} className="nv-grp" transform={`translate(${gp.x},${gp.y})`} style={{ cursor: "pointer" }}>
            {/* solid backing so edge lines never show through */}
            <rect x={-w / 2} y={-26} width={w} height={52} rx={13} fill="#0a1018" />
            <rect x={-w / 2} y={-26} width={w} height={52} rx={13}
              fill={g.color} fillOpacity={0.18} stroke={g.color} strokeWidth={2.4}
              style={{ filter: `drop-shadow(0 0 10px ${g.color}66)` }} />
            <text textAnchor="middle" dy={7} fontSize={21} fontWeight={700} fill={g.color}>{g.label}</text>
          </g>
        );
      })}

      {/* center: Home with glowing halo */}
      <circle className="nv-glow" cx={CX} cy={CY} r={70} fill="#22d3ee" fillOpacity={0.16} />
      <g transform={`translate(${CX},${CY})`}>
        <a href="/home">
          <circle className="nv-home" r={46} fill="url(#homeGrad)" stroke="#a5f3fc" strokeWidth={2.5}
            style={{ filter: "drop-shadow(0 0 14px #22d3eeaa)" }} />
          <text textAnchor="middle" dy={6} fontSize={18} fontWeight={800} fill="#fff">Home</text>
        </a>
      </g>

      <defs>
        <radialGradient id="homeGrad" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="55%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </radialGradient>
      </defs>
    </svg>
  );
}
