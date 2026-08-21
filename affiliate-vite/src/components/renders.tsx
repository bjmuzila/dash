import type { ReactNode } from "react";

/**
 * The shareable graphics.
 *
 * These are INLINE SVG, not screenshots and not a chart library. Three reasons
 * that matters:
 *   1. They can be downloaded as a real PNG with no dependency — serialise the
 *      SVG, paint it to a canvas, toBlob. See downloadSvgPng() below.
 *   2. They stamp the affiliate's own code into the artwork, so a post that
 *      gets screenshotted and reshared still carries attribution.
 *   3. A 1200×675 SVG is a few KB. Shipping html2canvas to produce the same
 *      picture is ~200KB of JavaScript on a page most visitors never open.
 *
 * The numbers are ILLUSTRATIVE and labelled as such in the UI. Rendering a
 * live GEX map here would mean this public marketing app reaching the market
 * data stack, which nginx.conf deliberately forbids — and an affiliate posting
 * a stale "live" chart is worse than one posting a clearly generic example.
 */

const W = 1200;
const H = 675;

const C = {
  bg: "#05060A",
  panel: "#0D1119",
  edge: "rgba(255,255,255,0.10)",
  text: "#FFFFFF",
  dim: "rgba(255,255,255,0.45)",
  cyan: "#219EBC",
  lightBlue: "#7dd3fc",
  gold: "#ffd600",
  call: "#29b6f6",
  put: "#ff4757",
  up: "#30d158",
  down: "#ff5b5b",
  orange: "#FB8501",
};

const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

function Frame({ title, code, children }: { title: string; code: string; children: ReactNode }) {
  return (
    <>
      <defs>
        <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#219EBC" stopOpacity="0.18" />
          <stop offset="60%" stopColor="#219EBC" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={C.bg} />
      <rect width={W} height={H} fill="url(#glow)" />

      {/* header */}
      <rect x="44" y="40" width="34" height="34" rx="10" fill={C.cyan} />
      <text x="61" y="63" fontFamily={FONT} fontSize="15" fontWeight="800" fill="#04121a" textAnchor="middle">CB</text>
      <text x="92" y="63" fontFamily={FONT} fontSize="19" fontWeight="800" fill={C.text} letterSpacing="1">CB EDGE</text>
      <text x="218" y="63" fontFamily={FONT} fontSize="13" fontWeight="700" fill={C.cyan} letterSpacing="2">{title.toUpperCase()}</text>

      {children}

      {/* code stamp — the reason these are generated per-affiliate at all */}
      <rect x={W - 300} y={H - 78} width="256" height="40" rx="8" fill="rgba(5,6,10,0.75)" stroke="rgba(33,158,188,0.35)" />
      <text x={W - 172} y={H - 52} fontFamily={MONO} fontSize="15" fontWeight="700" fill={C.cyan} textAnchor="middle" letterSpacing="2">
        CODE {code}
      </text>
      <text x="44" y={H - 52} fontFamily={FONT} fontSize="13" fill={C.dim}>cbedge.net — live SPX gamma exposure</text>
    </>
  );
}

const LEVELS = [
  { k: "6470", v: 0.22, side: "call" as const, tag: "" },
  { k: "6450", v: 0.78, side: "call" as const, tag: "CW" },
  { k: "6425", v: 0.41, side: "call" as const, tag: "" },
  { k: "6400", v: 0.94, side: "cb" as const, tag: "CB" },
  { k: "6375", v: 0.36, side: "put" as const, tag: "" },
  { k: "6350", v: 0.54, side: "put" as const, tag: "" },
  { k: "6325", v: 0.84, side: "put" as const, tag: "PW" },
];

export function HeatmapSvg({ code, id }: { code: string; id: string }) {
  const top = 120, rowH = 62, barX = 190, barMax = 760;
  return (
    <svg id={id} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg">
      <Frame title="SPX GEX · 0DTE" code={code}>
        {LEVELS.map((l, i) => {
          const y = top + i * rowH;
          const fill = l.side === "cb" ? C.gold : l.side === "call" ? C.call : C.put;
          return (
            <g key={l.k}>
              <text x="150" y={y + 22} fontFamily={MONO} fontSize="19" fill={C.dim} textAnchor="end">{l.k}</text>
              <rect x={barX} y={y} width={barMax * l.v} height="30" rx="4" fill={fill} opacity={0.85} />
              {l.tag && (
                <>
                  <rect x={barX + barMax * l.v + 12} y={y + 1} width="46" height="28" rx="6" fill="rgba(5,6,10,0.7)" stroke={fill} />
                  <text x={barX + barMax * l.v + 35} y={y + 21} fontFamily={FONT} fontSize="14" fontWeight="700" fill={fill} textAnchor="middle">{l.tag}</text>
                </>
              )}
            </g>
          );
        })}
        <text x="44" y={top - 22} fontFamily={FONT} fontSize="14" fill={C.dim} letterSpacing="2">
          DEALER WALLS BY STRIKE
        </text>
      </Frame>
    </svg>
  );
}

const CANDLES = [
  [38, 52, 30, 48], [48, 62, 44, 58], [58, 60, 40, 43], [43, 55, 40, 52], [52, 54, 34, 36],
  [36, 58, 34, 55], [55, 57, 45, 47], [47, 66, 45, 63], [63, 78, 60, 74], [74, 76, 62, 65],
  [65, 82, 63, 79], [79, 92, 76, 90],
];

export function CandlesSvg({ code, id }: { code: string; id: string }) {
  const left = 90, right = W - 70, top = 130, bottom = H - 120;
  const w = (right - left) / CANDLES.length;
  const y = (v: number) => bottom - (v / 100) * (bottom - top);
  return (
    <svg id={id} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg">
      <Frame title="ES · overnight" code={code}>
        {/* EM band */}
        <rect x={left} y={y(84)} width={right - left} height={y(40) - y(84)} fill={C.cyan} opacity="0.07" />
        <line x1={left} y1={y(84)} x2={right} y2={y(84)} stroke={C.cyan} strokeDasharray="6 6" opacity="0.6" />
        <line x1={left} y1={y(40)} x2={right} y2={y(40)} stroke={C.cyan} strokeDasharray="6 6" opacity="0.6" />
        <text x={right} y={y(84) - 10} fontFamily={FONT} fontSize="13" fill={C.cyan} textAnchor="end">EM HIGH</text>
        <text x={right} y={y(40) + 22} fontFamily={FONT} fontSize="13" fill={C.cyan} textAnchor="end">EM LOW</text>

        {CANDLES.map(([o, h, l, c], i) => {
          const cx = left + i * w + w / 2;
          const up = c >= o;
          const col = up ? C.up : C.down;
          return (
            <g key={i}>
              <line x1={cx} y1={y(h)} x2={cx} y2={y(l)} stroke={col} strokeWidth="2" />
              <rect x={cx - w * 0.28} y={y(Math.max(o, c))} width={w * 0.56}
                    height={Math.max(3, Math.abs(y(o) - y(c)))} fill={col} rx="2" />
            </g>
          );
        })}
        <text x="44" y={top - 22} fontFamily={FONT} fontSize="14" fill={C.dim} letterSpacing="2">
          ES AGAINST THE ESTIMATED-MOVE BAND
        </text>
      </Frame>
    </svg>
  );
}

export function PhoneSvg({ code, id }: { code: string; id: string }) {
  const px = W / 2 - 120, py = 110, pw = 240, ph = 440;
  return (
    <svg id={id} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg">
      <Frame title="Phone build" code={code}>
        <rect x={px} y={py} width={pw} height={ph} rx="34" fill={C.panel} stroke={C.edge} strokeWidth="2" />
        <rect x={px + 84} y={py + 14} width="72" height="8" rx="4" fill="rgba(255,255,255,0.15)" />
        <text x={px + pw / 2} y={py + 54} fontFamily={FONT} fontSize="12" fill={C.dim} textAnchor="middle" letterSpacing="2">SPX · LIVE</text>
        {LEVELS.slice(0, 6).map((l, i) => {
          const yy = py + 74 + i * 48;
          const fill = l.side === "cb" ? C.gold : l.side === "call" ? C.call : C.put;
          return (
            <g key={l.k}>
              <text x={px + 54} y={yy + 16} fontFamily={MONO} fontSize="13" fill={C.dim} textAnchor="end">{l.k}</text>
              <rect x={px + 62} y={yy} width={(pw - 84) * l.v} height="20" rx="3" fill={fill} opacity="0.85" />
            </g>
          );
        })}
        <rect x={px + 20} y={py + ph - 44} width={pw - 40} height="6" rx="3" fill="rgba(255,255,255,0.10)" />
        <rect x={px + 20} y={py + ph - 44} width={(pw - 40) / 4} height="6" rx="3" fill={C.cyan} />

        <text x={W / 2} y={py + ph + 52} fontFamily={FONT} fontSize="20" fontWeight="700" fill={C.text} textAnchor="middle">
          Built for the phone, not shrunk onto it
        </text>
      </Frame>
    </svg>
  );
}

const CHAIN_ROWS = [
  ["6450", "12.40", "0.31", "18.2k", "4.10"],
  ["6425", "18.75", "0.42", "24.9k", "6.85"],
  ["6400", "27.10", "0.54", "41.3k", "11.20"],
  ["6375", "38.60", "0.66", "22.7k", "17.90"],
  ["6350", "52.30", "0.77", "15.1k", "26.40"],
];

export function ChainSvg({ code, id }: { code: string; id: string }) {
  const top = 140, rowH = 66, left = 70;
  const cols = ["STRIKE", "CALL", "DELTA", "OI", "PUT"];
  const colX = [left + 40, left + 300, left + 520, left + 740, left + 980];
  return (
    <svg id={id} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg">
      <Frame title="Options chain" code={code}>
        {cols.map((c, i) => (
          <text key={c} x={colX[i]} y={top - 16} fontFamily={FONT} fontSize="13" fontWeight="700"
                fill={C.dim} letterSpacing="2" textAnchor="middle">{c}</text>
        ))}
        <line x1={left} y1={top - 2} x2={W - left} y2={top - 2} stroke={C.edge} />
        {CHAIN_ROWS.map((r, i) => (
          <g key={r[0]}>
            {i % 2 === 1 && <rect x={left} y={top + i * rowH} width={W - left * 2} height={rowH} fill="rgba(255,255,255,0.02)" />}
            {r.map((cell, j) => (
              <text key={j} x={colX[j]} y={top + i * rowH + 42}
                    fontFamily={MONO} fontSize="22"
                    fill={j === 0 ? C.lightBlue : j === 1 ? C.up : j === 4 ? C.down : C.text}
                    textAnchor="middle">{cell}</text>
            ))}
          </g>
        ))}
      </Frame>
    </svg>
  );
}

export const RENDERS: Record<string, (p: { code: string; id: string }) => JSX.Element> = {
  heatmap: HeatmapSvg,
  candles: CandlesSvg,
  phone: PhoneSvg,
  chain: ChainSvg,
};

/**
 * Serialise an inline <svg> to a PNG and hand it to the browser as a download.
 *
 * Deliberately dependency-free: XMLSerializer → data URL → <img> → canvas →
 * toBlob. The SVG references no external image and no webfont file (the font
 * stack degrades to the system sans in the raster, which is fine at this size),
 * so the canvas is never tainted and toBlob always succeeds.
 *
 * The 2× scale is the point — X re-encodes anything it thinks is small, and a
 * 1200-wide upload comes back visibly soft.
 */
export function downloadSvgPng(svgId: string, filename: string): void {
  const el = document.getElementById(svgId) as unknown as SVGSVGElement | null;
  if (!el) return;
  const xml = new XMLSerializer().serializeToString(el);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      // Revoke on the next tick — revoking synchronously races the click in
      // Safari and silently produces a zero-byte file.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };
  img.src = src;
}
