"use client";

/**
 * MultiGreekLevelSnapshot — one-click clipboard snapshot of the CB / CW / PW
 * levels for all four Multi Greek tickers.
 *
 * Two renders, picked by a toolbar toggle and remembered per browser:
 *   TABLE   — ticker · spot · exp · DTE · CB · CW · PW, one row per ticker.
 *             Dense; lines up against a previous snapshot for diffing.
 *   LADDERS — per ticker, the three levels positioned by value with a spot
 *             marker between them. Carries the POSITIONING a number list loses.
 *
 * Drawn straight to a <canvas> rather than rasterizing the DOM: html2canvas is
 * unreliable on the inline-styled panels (the same failure mode that forced the
 * EM badges to become inline SVG bitmaps — see emBadgeDataUri in
 * MultGreekClient), and a canvas render is deterministic, crisp at 2x, and free
 * of the surrounding page.
 *
 * Every colour comes from homeTheme — HOME_THEME for the surface, LEVEL_COLORS
 * for CB/CW/PW (the same values the page paints its badges with), and
 * REFRESH_GREEN / SOFT_RED for the spot-vs-CB delta. Nothing here is hardcoded.
 */

import { useCallback, useEffect, useState } from "react";
import {
  HOME_THEME as HT,
  LEVEL_COLORS,
  LIGHT_BLUE,
  SOFT_RED,
  REFRESH_GREEN,
} from "@/components/shared/homeTheme";

// ── Public shape ─────────────────────────────────────────────────────────────

/** One ticker's front-expiry levels. `null` = that wall could not be resolved. */
export interface SnapshotRow {
  ticker: string;
  spot: number;
  /** Front expiry, ISO `YYYY-MM-DD`. */
  expiration: string;
  cb: number | null;
  cw: number | null;
  pw: number | null;
}

export type SnapshotView = "table" | "ladders";

const VIEW_KEY = "mg_snapshot_view";

// ── Drawing constants ────────────────────────────────────────────────────────

/**
 * The page's own font stack, read off <body> at render time. next/font emits a
 * hashed family name behind `--font-inter`, so a literal "Inter" here would
 * silently fall through to Arial and the snapshot would not match the page.
 */
let FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";
function resolveFont() {
  try {
    const f = getComputedStyle(document.body).fontFamily;
    if (f) FONT = f;
  } catch { /* SSR / detached */ }
}

const DPR = 2; // fixed 2x — the image should be crisp regardless of the display

const PAD = 22;
const HEAD_H = 34;
const FOOT_H = 36;

/** Text is WHITE everywhere. Only the levels and the delta carry colour. */
const INK = HT.text;

// ── Small canvas helpers ─────────────────────────────────────────────────────

function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.arcTo(x + w, y, x + w, y + h, rad);
  c.arcTo(x + w, y + h, x, y + h, rad);
  c.arcTo(x, y + h, x, y, rad);
  c.arcTo(x, y, x + w, y, rad);
  c.closePath();
}

function txt(
  c: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  opts: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; track?: number } = {},
) {
  const { size = 13, weight = 600, color = INK, align = "left", track = 0 } = opts;
  c.font = `${weight} ${size}px ${FONT}`;
  c.fillStyle = color;
  c.textBaseline = "middle";
  if (!track) {
    c.textAlign = align;
    c.fillText(s, x, y);
    return;
  }
  // Manual letter-spacing — ctx.letterSpacing is not in every engine yet.
  const chars = [...s];
  const w = chars.reduce((a, ch) => a + c.measureText(ch).width + track, -track);
  let cx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  c.textAlign = "left";
  chars.forEach((ch) => {
    c.fillText(ch, cx, y);
    cx += c.measureText(ch).width + track;
  });
}

/** Strikes print as integers unless the ticker actually trades halves. */
function fmtLvl(v: number | null): string {
  if (v == null || !isFinite(v)) return "--";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function fmtSpot(v: number): string {
  if (!isFinite(v) || v <= 0) return "--";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dteOf(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T16:00:00-04:00`).getTime();
  if (!isFinite(d)) return null;
  return Math.max(0, Math.round((d - Date.now()) / 86_400_000));
}

function stampNow(): string {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }).toUpperCase();
  const date = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return `${day} ${date} · ${time} ET`;
}

function fileStamp(): string {
  const d = new Date();
  const date = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).replace(/-/g, "");
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).replace(":", "");
  return `${date}-${time}`;
}

// ── Shared chrome (header + footer), drawn on both views ─────────────────────

function drawShell(c: CanvasRenderingContext2D, w: number, h: number) {
  // Card surface — classicCardStyle, flattened (canvas has no backdrop blur).
  c.fillStyle = HT.bg;
  c.fillRect(0, 0, w, h);
  const glow = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, h * 0.9);
  glow.addColorStop(0, "rgba(33,158,188,0.07)");
  glow.addColorStop(1, "rgba(33,158,188,0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = HT.border;
  c.lineWidth = 1;
  rrect(c, 0.5, 0.5, w - 1, h - 1, 18);
  c.stroke();
}

function drawHeader(c: CanvasRenderingContext2D, w: number) {
  const y = PAD + 10;
  c.fillStyle = HT.cyan;
  rrect(c, PAD, y - 4, 8, 8, 2);
  c.fill();
  txt(c, "CB EDGE · MULTI GREEK", PAD + 17, y, { size: 11, weight: 700, track: 1.9 });
  txt(c, stampNow(), w - PAD, y, { size: 10.5, weight: 600, align: "right", track: 0.8 });
}

function drawFooter(c: CanvasRenderingContext2D, w: number, y: number) {
  c.strokeStyle = HT.border;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(PAD, y + 0.5);
  c.lineTo(w - PAD, y + 0.5);
  c.stroke();

  const ly = y + 18;
  const legend: [string, string][] = [
    ["CB · CORE BULLSEYE", LEVEL_COLORS.cb],
    ["CW · CALL WALL", LEVEL_COLORS.cw],
    ["PW · PUT WALL", LEVEL_COLORS.pw],
  ];
  let x = PAD;
  legend.forEach(([label, color]) => {
    c.fillStyle = color;
    rrect(c, x, ly - 4, 8, 8, 2);
    c.fill();
    txt(c, label, x + 14, ly, { size: 9.5, weight: 700, track: 1.2 });
    c.font = `700 9.5px ${FONT}`;
    x += 14 + [...label].reduce((a, ch) => a + c.measureText(ch).width + 1.2, 0) + 18;
  });
  txt(c, "CBEDGE.NET", w - PAD, ly, { size: 9.5, weight: 700, color: HT.cyan, align: "right", track: 1.1 });
}

// ── View 1: TABLE ────────────────────────────────────────────────────────────

const T_COLS: { key: string; label: string; w: number; align: CanvasTextAlign }[] = [
  { key: "ticker", label: "TICKER", w: 96, align: "left" },
  { key: "spot", label: "SPOT", w: 116, align: "right" },
  { key: "exp", label: "EXP", w: 124, align: "right" },
  { key: "dte", label: "DTE", w: 56, align: "right" },
  { key: "cb", label: "CB", w: 128, align: "right" },
  { key: "cw", label: "CW", w: 128, align: "right" },
  { key: "pw", label: "PW", w: 128, align: "right" },
];
const T_W = PAD * 2 + T_COLS.reduce((a, c) => a + c.w, 0);
const T_ROW_H = 38;

function drawTable(c: CanvasRenderingContext2D, rows: SnapshotRow[], w: number) {
  drawHeader(c, w);
  let y = PAD + HEAD_H + 18;

  // Column heads
  let x = PAD;
  T_COLS.forEach((col) => {
    txt(c, col.label, col.align === "right" ? x + col.w - 12 : x + 2, y, {
      size: 9.5, weight: 700, align: col.align, track: 1.4,
    });
    x += col.w;
  });
  y += 14;
  c.strokeStyle = HT.border;
  c.lineWidth = 1;
  c.beginPath(); c.moveTo(PAD, y + 0.5); c.lineTo(w - PAD, y + 0.5); c.stroke();

  rows.forEach((r, i) => {
    const top = y + i * T_ROW_H;
    const mid = top + T_ROW_H / 2;

    // Level cells get a faint tint band, as on the page.
    let cx = PAD + T_COLS.slice(0, 4).reduce((a, col) => a + col.w, 0);
    (["cb", "cw", "pw"] as const).forEach((k, ki) => {
      const col = T_COLS[4 + ki];
      c.fillStyle = LEVEL_COLORS.tint[k];
      c.fillRect(cx, top, col.w, T_ROW_H);
      cx += col.w;
    });

    x = PAD;
    const dte = dteOf(r.expiration);
    const cells: [string, string, number, number][] = [
      [r.ticker, LIGHT_BLUE, 14.5, 700],
      [fmtSpot(r.spot), INK, 15.5, 600],
      [r.expiration || "--", INK, 11.5, 500],
      [dte == null ? "--" : String(dte), INK, 11.5, 500],
      [fmtLvl(r.cb), LEVEL_COLORS.cb, 15.5, 700],
      [fmtLvl(r.cw), LEVEL_COLORS.cw, 15.5, 700],
      [fmtLvl(r.pw), LEVEL_COLORS.pw, 15.5, 700],
    ];
    cells.forEach(([s, color, size, weight], ci) => {
      const col = T_COLS[ci];
      txt(c, s, col.align === "right" ? x + col.w - 12 : x + 2, mid, {
        size, weight, color, align: col.align, track: ci === 0 ? 1.5 : 0,
      });
      x += col.w;
    });

    if (i < rows.length - 1) {
      c.strokeStyle = "rgba(255,255,255,0.05)";
      c.beginPath();
      c.moveTo(PAD, top + T_ROW_H + 0.5);
      c.lineTo(w - PAD, top + T_ROW_H + 0.5);
      c.stroke();
    }
  });

  drawFooter(c, w, y + rows.length * T_ROW_H + 14);
}

// ── View 2: LADDERS ──────────────────────────────────────────────────────────

const L_W = 1240;
const L_GAP = 14;
const L_TRACK_H = 216;
const L_TILE_H = 300;

function drawLadders(c: CanvasRenderingContext2D, rows: SnapshotRow[], w: number) {
  drawHeader(c, w);
  const top = PAD + HEAD_H + 10;
  const inner = w - PAD * 2;
  const tileW = (inner - L_GAP * (rows.length - 1)) / rows.length;

  rows.forEach((r, i) => {
    const x = PAD + i * (tileW + L_GAP);
    drawLadderTile(c, r, x, top, tileW);
  });

  drawFooter(c, w, top + L_TILE_H + 14);
}

function drawLadderTile(c: CanvasRenderingContext2D, r: SnapshotRow, x: number, y: number, w: number) {
  // Tile surface — statTileStyle, flattened.
  c.fillStyle = "rgba(13,17,25,0.45)";
  rrect(c, x, y, w, L_TILE_H, 16);
  c.fill();
  c.strokeStyle = HT.border;
  c.lineWidth = 1;
  rrect(c, x + 0.5, y + 0.5, w - 1, L_TILE_H - 1, 16);
  c.stroke();

  const px = x + 15;
  const pw = w - 30;

  // Tile head: ticker + exp/DTE/spot
  txt(c, r.ticker, px, y + 20, { size: 16, weight: 700, color: LIGHT_BLUE, track: 1.5 });
  const dte = dteOf(r.expiration);
  const sub = `${(r.expiration || "").slice(5) || "--"} · ${dte == null ? "--" : `${dte}DTE`}`;
  txt(c, sub, x + w - 15, y + 20, { size: 10, weight: 600, align: "right", track: 0.7 });

  const tTop = y + 40;
  const tBot = tTop + L_TRACK_H;

  // Scale: min/max across the three walls and spot, so every mark lands inside.
  const vals = [r.cb, r.cw, r.pw, r.spot].filter((v): v is number => v != null && isFinite(v));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  // 8% margin top and bottom so the extreme marks are not flush to the edge.
  const yOf = (v: number) => tBot - (0.08 + ((v - lo) / span) * 0.84) * L_TRACK_H;

  const marks: { v: number; tag: string; color: string }[] = [];
  if (r.cb != null) marks.push({ v: r.cb, tag: "CB", color: LEVEL_COLORS.cb });
  if (r.cw != null) marks.push({ v: r.cw, tag: "CW", color: LEVEL_COLORS.cw });
  if (r.pw != null) marks.push({ v: r.pw, tag: "PW", color: LEVEL_COLORS.pw });

  // Spot's rule and arrow go down FIRST so the wall chips — which are plated —
  // read on top of the dash where a wall and spot land within a pixel or two of
  // each other (QQQ pinned to its CW is the normal case, not the edge case).
  const spotOk = isFinite(r.spot) && r.spot > 0;
  const sy = spotOk ? yOf(r.spot) : 0;
  if (spotOk) {
    c.save();
    c.setLineDash([5, 5]);
    c.strokeStyle = LIGHT_BLUE;
    c.globalAlpha = 0.7;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(px - 9, sy + 0.5);
    c.lineTo(px + pw + 6, sy + 0.5);
    c.stroke();
    c.restore();

    c.fillStyle = LIGHT_BLUE;
    c.beginPath();
    c.moveTo(px - 11, sy - 5);
    c.lineTo(px - 4, sy);
    c.lineTo(px - 11, sy + 5);
    c.closePath();
    c.fill();
  }

  marks.forEach((m) => {
    const my = yOf(m.v);
    c.globalAlpha = 0.45;
    c.fillStyle = m.color;
    c.fillRect(px, my - 0.75, pw, 1.5);
    c.globalAlpha = 1;

    // Tag chip on the left, over an opaque plate so the rule reads behind it.
    c.font = `700 9.5px ${FONT}`;
    const tw = [...m.tag].reduce((a, ch) => a + c.measureText(ch).width + 0.9, 0) + 12;
    c.fillStyle = HT.panel;
    rrect(c, px, my - 8, tw, 16, 4);
    c.fill();
    c.strokeStyle = m.color;
    c.globalAlpha = 0.45;
    rrect(c, px + 0.5, my - 7.5, tw - 1, 15, 4);
    c.stroke();
    c.globalAlpha = 1;
    txt(c, m.tag, px + 6, my, { size: 9.5, weight: 700, color: m.color, track: 0.9 });

    // Value on the right, also plated.
    c.font = `600 13.5px ${FONT}`;
    const vs = fmtLvl(m.v);
    const vw = c.measureText(vs).width;
    c.fillStyle = HT.panel;
    c.fillRect(px + pw - vw - 6, my - 8, vw + 6, 16);
    txt(c, vs, px + pw, my, { size: 13.5, weight: 600, color: m.color, align: "right" });
  });

  // Spot's value plate is CENTERED in the track, drawn last.
  //
  // The tags own the left edge and the wall values own the right, so a spot
  // that sits a few cents off a wall — SPY at 771.42 under a 772 call wall —
  // had its label land on top of that wall's number. Centering gives the plate
  // its own horizontal band: it can never collide, whatever the prices do.
  if (spotOk) {
    c.font = `700 13.5px ${FONT}`;
    const ss = fmtSpot(r.spot);
    const sw = c.measureText(ss).width + 16;
    const sx = px + pw / 2 - sw / 2;
    c.fillStyle = HT.panel;
    rrect(c, sx, sy - 10, sw, 20, 5);
    c.fill();
    c.fillStyle = "rgba(125,211,252,0.12)";
    rrect(c, sx, sy - 10, sw, 20, 5);
    c.fill();
    c.strokeStyle = "rgba(125,211,252,0.45)";
    c.lineWidth = 1;
    rrect(c, sx + 0.5, sy - 9.5, sw - 1, 19, 5);
    c.stroke();
    txt(c, ss, px + pw / 2, sy, { size: 13.5, weight: 700, align: "center" });
  }

  // Tile foot — spot vs CB.
  const fy = y + L_TILE_H - 22;
  c.strokeStyle = HT.border;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(px, fy - 10.5);
  c.lineTo(px + pw, fy - 10.5);
  c.stroke();
  txt(c, "SPOT VS CB", px, fy, { size: 9.5, weight: 700, track: 1.1 });
  if (r.cb != null && isFinite(r.spot)) {
    const d = r.spot - r.cb;
    const s = `${d < 0 ? "−" : "+"}${Math.abs(d).toFixed(2)}`;
    txt(c, s, px + pw, fy, {
      size: 12, weight: 700, align: "right", color: d < 0 ? SOFT_RED : REFRESH_GREEN,
    });
  } else {
    txt(c, "--", px + pw, fy, { size: 12, weight: 700, align: "right" });
  }
}

// ── Render entry ─────────────────────────────────────────────────────────────

export function renderSnapshot(rows: SnapshotRow[], view: SnapshotView): HTMLCanvasElement {
  resolveFont();
  const w = view === "table" ? T_W : L_W;
  const h = view === "table"
    ? PAD + HEAD_H + 18 + 14 + rows.length * T_ROW_H + 14 + FOOT_H + PAD - 12
    : PAD + HEAD_H + 10 + L_TILE_H + 14 + FOOT_H + PAD - 12;

  const cv = document.createElement("canvas");
  cv.width = Math.round(w * DPR);
  cv.height = Math.round(h * DPR);
  const c = cv.getContext("2d");
  if (!c) return cv;
  c.scale(DPR, DPR);

  drawShell(c, w, h);
  if (view === "table") drawTable(c, rows, w);
  else drawLadders(c, rows, w);
  return cv;
}

// ── Toolbar control ──────────────────────────────────────────────────────────

type CopyState = "idle" | "done" | "error";

/**
 * TABLE/LADDERS toggle + copy button. Sits in the Multi Greek dock.
 *
 * `getRows` is a callback, not a prop value, so nothing is computed until the
 * button is actually pressed — the walls are re-derived from live state at
 * click time rather than on every render of the page.
 */
export function MultiGreekSnapshotBtn({ getRows }: { getRows: () => SnapshotRow[] }) {
  const [view, setView] = useState<SnapshotView>("table");
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "table" || v === "ladders") setView(v);
    } catch { /* private mode */ }
  }, []);

  const pick = useCallback((v: SnapshotView) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  }, []);

  const copy = useCallback(async () => {
    const rows = getRows();
    if (!rows.length) { setState("error"); setTimeout(() => setState("idle"), 1400); return; }
    // Canvas measures text against whatever is loaded AT DRAW TIME — without
    // this the first click of a cold page can lay out against the fallback.
    try { await document.fonts?.ready; } catch { /* no font API */ }
    const cv = renderSnapshot(rows, view);
    const blob: Blob | null = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!blob) { setState("error"); setTimeout(() => setState("idle"), 1400); return; }

    try {
      // Clipboard image write needs a secure context; on http it throws.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setState("done");
    } catch {
      // Fall back to a download so the click is never a no-op.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `multigreek-${view}-${fileStamp()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setState("done");
    }
    setTimeout(() => setState("idle"), 1400);
  }, [getRows, view]);

  const segBtn = (v: SnapshotView, label: string) => {
    const on = view === v;
    return (
      <button
        key={v}
        onClick={() => pick(v)}
        title={v === "table"
          ? "Snapshot as a table — dense, one row per ticker"
          : "Snapshot as ladders — shows where spot sits between the walls"}
        style={{
          padding: "3px 10px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em",
          textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap",
          border: "none",
          borderRight: v === "table" ? `1px solid ${HT.border}` : "none",
          background: on ? "linear-gradient(180deg,rgba(33,158,188,0.16),rgba(33,158,188,0.04))" : "transparent",
          color: on ? HT.cyan : HT.text,
          boxShadow: on ? "inset 0 0 14px rgba(33,158,188,0.22)" : "none",
        }}
      >{label}</button>
    );
  };

  const label = state === "done" ? "✓" : state === "error" ? "!" : "🗒";
  const color = state === "done" ? REFRESH_GREEN : state === "error" ? HT.red : HT.cyan;

  return (
    <>
      <span style={{
        display: "inline-flex", borderRadius: 6, overflow: "hidden",
        border: `1px solid ${HT.border}`, background: "rgba(0,0,0,0.4)", flexShrink: 0,
      }}>
        {segBtn("table", "Table")}
        {segBtn("ladders", "Ladders")}
      </span>
      <button
        onClick={copy}
        title={`Copy the ${view === "table" ? "table" : "ladder"} snapshot to the clipboard as a PNG`}
        style={{
          padding: "3px 9px", fontSize: 12, lineHeight: 1.3, borderRadius: 6, cursor: "pointer",
          flexShrink: 0,
          border: `1px solid ${state === "done" ? REFRESH_GREEN : "rgba(33,158,188,0.25)"}`,
          background: state === "done"
            ? "rgba(31,217,138,0.10)"
            : "linear-gradient(180deg,rgba(33,158,188,0.12),rgba(33,158,188,0.04))",
          color,
          textShadow: state === "done" ? `0 0 12px ${REFRESH_GREEN}80` : "none",
        }}
      >{label}</button>
    </>
  );
}
