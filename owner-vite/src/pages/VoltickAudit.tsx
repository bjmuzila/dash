/**
 * Voltick Audit — a board of cards, one per thing to change or look at on a
 * Voltick page, each with notes and marked-up screenshots.
 *
 * Shaped like the To-Do page (a grid of cards, a status pill that cycles, edit
 * in place), with two differences that drive the whole design:
 *
 *  1. A card is ABOUT a page. `page` is a free-text field with Voltick's
 *     destinations offered as suggestions, and the filter bar across the top
 *     is built from whatever pages the cards actually name.
 *
 *  2. Screenshots, with markup. A screenshot's bytes are stored ONCE, as
 *     pasted, and never rewritten. The markup (pen, highlighter, arrow, circle,
 *     box, text) is vector JSON stored beside it, in image pixels. So:
 *       - a markup stays editable forever (open it again, erase one arrow);
 *       - the image URL is immutable and caches hard;
 *       - the thumbnail and the editor draw the SAME shapes through the same
 *         SVG, and the Download / Copy buttons flatten them onto a canvas with
 *         the same geometry.
 *
 * Storage is POSTGRES via /api/owner/voltick-audit (server-v2/api-router.js):
 * voltick_audit_card + voltick_audit_shot. Per-gesture actions, not a
 * whole-document save like To-Do, because screenshots are megabytes and must
 * never ride along with a notes edit. Text fields debounce; everything else
 * posts on the gesture.
 *
 * No browser alert/confirm/prompt anywhere: destructive buttons arm on the
 * first click ("SURE?") and fire on the second.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  OWNER_THEME,
  LIGHT_BLUE,
  TYPE,
  ownerRgba as rgba,
  homeButtonStyle,
  homeContentStyle,
  homeHeaderStyle,
  homeInputStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
  homeShellStyle,
} from "../lib/theme";
import { imageFilesFrom, prepareShot, SHOT_ACCEPT } from "../lib/feedbackShots";

// ── Constants ─────────────────────────────────────────────────────────────────

const API = "/api/owner/voltick-audit";
const shotSrc = (s: Pick<Shot, "id">) => `${API}/shot?id=${s.id}`;

/** Voltick's destinations, offered as suggestions. Any other text is fine too. */
const VOLTICK_PAGES = [
  "The Board", "Flow", "Read The Market", "The Receipts", "Yours", "Education",
  "Terminal", "Scanner", "Chart", "Alerts", "Landing", "Pricing", "Sign in",
  "Account", "Admin", "Mobile", "Global / Nav", "Other",
];

type Status = "Open" | "In Progress" | "Done";
const STATUSES: Status[] = ["Open", "In Progress", "Done"];
const DONE_GREEN = "#3FD68C";
const STATUS_COLORS: Record<Status, string> = {
  Open: LIGHT_BLUE,
  "In Progress": OWNER_THEME.orange,
  Done: DONE_GREEN,
};
const nextStatus = (s: Status): Status => STATUSES[(STATUSES.indexOf(s) + 1) % STATUSES.length];

/** One colour per page name, stable across reloads (hash, not index). */
const PAGE_PALETTE = [LIGHT_BLUE, OWNER_THEME.orange, "#F472B6", "#A3E635", OWNER_THEME.gold, "#60A5FA", "#C084FC", "#2DD4BF"];
function pageColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PAGE_PALETTE[h % PAGE_PALETTE.length];
}

/** Markup ink. Red first: the default is "this is wrong, look here". */
const INKS = ["#FF3B4E", "#FFD600", "#7dd3fc", "#3FD68C", "#FFFFFF", "#0B0D12"];
const SIZES = [
  { key: "S", mul: 1 },
  { key: "M", mul: 2 },
  { key: "L", mul: 3.5 },
];

const MAX_SHOTS_PER_CARD = 12;

// ── Types ─────────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };
type Shape =
  | { t: "pen"; c: string; w: number; pts: number[] }
  | { t: "hl"; c: string; w: number; pts: number[] }
  | { t: "arrow"; c: string; w: number; x1: number; y1: number; x2: number; y2: number }
  | { t: "ellipse"; c: string; w: number; x1: number; y1: number; x2: number; y2: number }
  | { t: "rect"; c: string; w: number; x1: number; y1: number; x2: number; y2: number }
  | { t: "text"; c: string; s: number; x: number; y: number; text: string };

type Tool = "pen" | "hl" | "arrow" | "ellipse" | "rect" | "text" | "erase";

interface Shot {
  id: number;
  cardId: number;
  caption: string;
  mime: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
  markup: Shape[];
}

interface AuditCard {
  id: number;
  page: string;
  title: string;
  notes: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  shots: Shot[];
}

type SaveState = "idle" | "saving" | "saved" | "error";

// ── Wire helpers ──────────────────────────────────────────────────────────────

async function post<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || (data && (data as { error?: string }).error)) {
    throw new Error((data as { error?: string })?.error || `HTTP ${r.status}`);
  }
  return data as T;
}

function coerceStatus(v: unknown): Status {
  const s = String(v ?? "");
  return (STATUSES as string[]).includes(s) ? (s as Status) : "Open";
}

function coerceShape(raw: unknown): Shape | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const c = typeof o.c === "string" ? o.c : INKS[0];
  switch (o.t) {
    case "pen":
    case "hl":
      return Array.isArray(o.pts) ? { t: o.t, c, w: n(o.w) || 4, pts: (o.pts as unknown[]).map(n) } : null;
    case "arrow":
    case "ellipse":
    case "rect":
      return { t: o.t, c, w: n(o.w) || 4, x1: n(o.x1), y1: n(o.y1), x2: n(o.x2), y2: n(o.y2) };
    case "text":
      return typeof o.text === "string" && o.text.trim()
        ? { t: "text", c, s: n(o.s) || 24, x: n(o.x), y: n(o.y), text: o.text }
        : null;
    default:
      return null;
  }
}

function readShot(raw: Record<string, unknown>): Shot {
  const markup = Array.isArray(raw.markup) ? (raw.markup as unknown[]).map(coerceShape).filter(Boolean) as Shape[] : [];
  return {
    id: Number(raw.id),
    cardId: Number(raw.card_id ?? raw.cardId),
    caption: String(raw.caption ?? ""),
    mime: String(raw.mime ?? "image/png"),
    name: String(raw.filename ?? raw.name ?? ""),
    bytes: Number(raw.byte_size ?? raw.bytes ?? 0),
    width: Number(raw.width ?? 0),
    height: Number(raw.height ?? 0),
    markup,
  };
}

function readCard(raw: Record<string, unknown>, shots: Shot[]): AuditCard {
  return {
    id: Number(raw.id),
    page: String(raw.page ?? ""),
    title: String(raw.title ?? ""),
    notes: String(raw.notes ?? ""),
    status: coerceStatus(raw.status),
    createdAt: String(raw.created_at ?? ""),
    updatedAt: String(raw.updated_at ?? ""),
    shots,
  };
}

/** Natural size of an image data URL (prepareShot doesn't report it). */
function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

// ── Geometry shared by the SVG and the canvas renderers ──────────────────────

/** Base stroke for an image — scales with the picture so S/M/L mean the same on any size. */
const baseStroke = (w: number, h: number) => Math.max(1.5, Math.max(w, h) / 500);

function arrowHead(x1: number, y1: number, x2: number, y2: number, w: number): number[] {
  const len = Math.max(w * 4.2, 12);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    x2, y2,
    x2 - len * Math.cos(ang - spread), y2 - len * Math.sin(ang - spread),
    x2 - len * Math.cos(ang + spread), y2 - len * Math.sin(ang + spread),
  ];
}

/** Arrow shaft stops short of the tip so a wide line doesn't poke through the head. */
function arrowShaftEnd(x1: number, y1: number, x2: number, y2: number, w: number): Pt {
  const len = Math.max(w * 4.2, 12) * 0.7;
  const d = Math.hypot(x2 - x1, y2 - y1) || 1;
  const k = Math.max(0, (d - len) / d);
  return { x: x1 + (x2 - x1) * k, y: y1 + (y2 - y1) * k };
}

/** Smoothed path through the points (quadratic curves through midpoints). */
function penPath(pts: number[]): string {
  if (pts.length < 2) return "";
  if (pts.length <= 4) {
    const [x, y] = pts;
    const x2 = pts[2] ?? x + 0.01;
    const y2 = pts[3] ?? y + 0.01;
    return `M${x} ${y}L${x2} ${y2}`;
  }
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2;
    const my = (pts[i + 1] + pts[i + 3]) / 2;
    d += `Q${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  d += `L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
  return d;
}

const HL_ALPHA = 0.35;
const TEXT_FONT = "800 {s}px Inter, 'Helvetica Neue', Arial, sans-serif";
const textOutline = (c: string) => (c === "#0B0D12" ? "#FFFFFF" : "#000000");

function ShapeSvg({ s, onErase, erasing }: { s: Shape; onErase?: () => void; erasing?: boolean }) {
  const hit = erasing
    ? { onPointerDown: (e: ReactPointerEvent) => { e.stopPropagation(); onErase?.(); }, style: { cursor: "not-allowed" as const, pointerEvents: "all" as const } }
    : { style: { pointerEvents: "none" as const } };
  switch (s.t) {
    case "pen":
      return <path d={penPath(s.pts)} fill="none" stroke={s.c} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" {...hit} />;
    case "hl":
      return <path d={penPath(s.pts)} fill="none" stroke={s.c} strokeOpacity={HL_ALPHA} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" {...hit} />;
    case "arrow": {
      const end = arrowShaftEnd(s.x1, s.y1, s.x2, s.y2, s.w);
      const h = arrowHead(s.x1, s.y1, s.x2, s.y2, s.w);
      return (
        <g {...hit}>
          <line x1={s.x1} y1={s.y1} x2={end.x} y2={end.y} stroke={s.c} strokeWidth={s.w} strokeLinecap="round" />
          <polygon points={h.join(" ")} fill={s.c} stroke={s.c} strokeWidth={s.w * 0.5} strokeLinejoin="round" />
        </g>
      );
    }
    case "ellipse":
      return (
        <ellipse
          cx={(s.x1 + s.x2) / 2} cy={(s.y1 + s.y2) / 2}
          rx={Math.abs(s.x2 - s.x1) / 2} ry={Math.abs(s.y2 - s.y1) / 2}
          fill="none" stroke={s.c} strokeWidth={s.w} {...hit}
        />
      );
    case "rect":
      return (
        <rect
          x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)}
          width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)}
          rx={s.w} fill="none" stroke={s.c} strokeWidth={s.w} strokeLinejoin="round" {...hit}
        />
      );
    case "text":
      return (
        <text
          x={s.x} y={s.y} fill={s.c} stroke={textOutline(s.c)} strokeWidth={s.s * 0.16}
          paintOrder="stroke" strokeLinejoin="round"
          style={{ font: TEXT_FONT.replace("{s}", String(s.s)), whiteSpace: "pre", ...(hit.style) }}
          onPointerDown={hit.onPointerDown}
        >
          {s.text.split("\n").map((line, i) => (
            <tspan key={i} x={s.x} dy={i === 0 ? 0 : s.s * 1.2}>{line || " "}</tspan>
          ))}
        </text>
      );
  }
}

function drawShapesOnCanvas(ctx: CanvasRenderingContext2D, shapes: Shape[]) {
  for (const s of shapes) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.t === "pen" || s.t === "hl") {
      ctx.globalAlpha = s.t === "hl" ? HL_ALPHA : 1;
      ctx.strokeStyle = s.c;
      ctx.lineWidth = s.w;
      ctx.stroke(new Path2D(penPath(s.pts)));
    } else if (s.t === "arrow") {
      const end = arrowShaftEnd(s.x1, s.y1, s.x2, s.y2, s.w);
      ctx.strokeStyle = s.c;
      ctx.fillStyle = s.c;
      ctx.lineWidth = s.w;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(end.x, end.y); ctx.stroke();
      const h = arrowHead(s.x1, s.y1, s.x2, s.y2, s.w);
      ctx.lineWidth = s.w * 0.5;
      ctx.beginPath(); ctx.moveTo(h[0], h[1]); ctx.lineTo(h[2], h[3]); ctx.lineTo(h[4], h[5]); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (s.t === "ellipse") {
      ctx.strokeStyle = s.c;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.t === "rect") {
      ctx.strokeStyle = s.c;
      ctx.lineWidth = s.w;
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, s.w); else ctx.rect(x, y, w, h);
      ctx.stroke();
    } else if (s.t === "text") {
      ctx.font = TEXT_FONT.replace("{s}", String(s.s));
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = s.s * 0.16;
      ctx.strokeStyle = textOutline(s.c);
      ctx.fillStyle = s.c;
      s.text.split("\n").forEach((line, i) => {
        const y = s.y + i * s.s * 1.2;
        ctx.strokeText(line, s.x, y);
        ctx.fillText(line, s.x, y);
      });
    }
    ctx.restore();
  }
}

/** The screenshot with its markup flattened in, as a PNG blob. Same-origin, so the canvas isn't tainted. */
async function flatten(shot: Shot, markup: Shape[]): Promise<Blob> {
  const img = new Image();
  img.src = shotSrc(shot);
  await img.decode();
  const w = img.naturalWidth || shot.width;
  const h = img.naturalHeight || shot.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  drawShapesOnCanvas(ctx, markup);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), "image/png"),
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Small UI pieces ───────────────────────────────────────────────────────────

const btnBase: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6 };
const btnPrimary: CSSProperties = { ...homeButtonStyle, ...btnBase, color: LIGHT_BLUE, borderColor: rgba(LIGHT_BLUE, 0.35) };
const btnGhost: CSSProperties = { ...homeSecondaryButtonStyle, ...btnBase };
const btnSmall: CSSProperties = { padding: "5px 10px", fontSize: TYPE.label, borderRadius: 8 };

const labelStyle: CSSProperties = {
  fontSize: TYPE.label, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: OWNER_THEME.green,
};

function Plus() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function StatusPill({ status, onCycle }: { status: Status; onCycle: () => void }) {
  const col = STATUS_COLORS[status];
  return (
    <button
      type="button"
      className="va-pill"
      onClick={onCycle}
      title="Click to change status"
      style={{
        fontSize: TYPE.micro, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase",
        whiteSpace: "nowrap", padding: "3px 10px", borderRadius: 999, cursor: "pointer",
        color: col, background: rgba(col, 0.13), border: `1px solid ${rgba(col, 0.45)}`,
        display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: col, boxShadow: `0 0 6px ${rgba(col, 0.8)}` }} />
      {status}
    </button>
  );
}

function PageChip({ page, active, count, onClick }: { page: string; active?: boolean; count?: number; onClick?: () => void }) {
  const col = page ? pageColor(page) : LIGHT_BLUE;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: TYPE.label, fontWeight: 800, letterSpacing: ".05em", whiteSpace: "nowrap",
        padding: "4px 11px", borderRadius: 999, cursor: onClick ? "pointer" : "default",
        color: active ? "#05060A" : col,
        background: active ? col : rgba(col, 0.1),
        border: `1px solid ${rgba(col, active ? 0.9 : 0.4)}`,
        display: "inline-flex", alignItems: "center", gap: 6,
      }}
    >
      {page || "All pages"}
      {count != null && <span style={{ fontFamily: "var(--font-mono), monospace", opacity: 0.85 }}>{count}</span>}
    </button>
  );
}

/** Two-click delete: first click arms, second fires, blur disarms. */
function ArmedDelete({ onConfirm, label = "×", title }: { onConfirm: () => void; label?: ReactNode; title: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      onBlur={() => setArmed(false)}
      title={armed ? "Click again to delete" : title}
      style={{
        background: armed ? rgba(OWNER_THEME.orange, 0.15) : "none",
        border: armed ? `1px solid ${rgba(OWNER_THEME.orange, 0.5)}` : "1px solid transparent",
        color: armed ? OWNER_THEME.orange : OWNER_THEME.text,
        cursor: "pointer", fontSize: armed ? TYPE.micro : TYPE.body, fontWeight: 800,
        lineHeight: 1, padding: armed ? "4px 8px" : "2px 5px", borderRadius: 999,
        letterSpacing: armed ? ".06em" : undefined, flexShrink: 0,
      }}
    >
      {armed ? "SURE?" : label}
    </button>
  );
}

/** Textarea that grows with its content. */
function AutoTextarea(props: { value: string; onChange: (v: string) => void; placeholder?: string; minRows?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      value={props.value}
      placeholder={props.placeholder}
      rows={props.minRows ?? 3}
      onChange={(e) => props.onChange(e.target.value)}
      style={{ ...homeInputStyle, width: "100%", resize: "none", lineHeight: 1.5, fontFamily: "inherit", overflow: "hidden", ...props.style }}
    />
  );
}

/** A screenshot with its markup drawn over it, at any size. */
function ShotView({ shot, markup, height, onClick }: { shot: Shot; markup?: Shape[]; height: number; onClick?: () => void }) {
  const [dims, setDims] = useState({ w: shot.width, h: shot.height });
  const w = dims.w || 16, h = dims.h || 9;
  return (
    <button
      type="button"
      onClick={onClick}
      className="va-shot"
      title={shot.caption || "Open to mark up"}
      style={{
        position: "relative", height, aspectRatio: `${w} / ${h}`, maxWidth: "100%", padding: 0,
        border: `1px solid ${OWNER_THEME.border}`, borderRadius: 10, overflow: "hidden",
        background: "#000", cursor: onClick ? "pointer" : "default", flexShrink: 0,
      }}
    >
      <img
        src={shotSrc(shot)}
        alt={shot.caption || shot.name || "screenshot"}
        loading="lazy"
        onLoad={(e) => {
          const el = e.currentTarget;
          if (!shot.width || !shot.height) setDims({ w: el.naturalWidth, h: el.naturalHeight });
        }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", display: "block" }}
      />
      <svg viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        {(markup ?? shot.markup).map((s, i) => <ShapeSvg key={i} s={s} />)}
      </svg>
      {(markup ?? shot.markup).length > 0 && (
        <span style={{
          position: "absolute", right: 5, bottom: 5, fontSize: TYPE.micro, fontWeight: 800, letterSpacing: ".06em",
          padding: "2px 6px", borderRadius: 999, background: "rgba(0,0,0,.72)", color: "#FF3B4E",
          border: "1px solid rgba(255,59,78,.5)",
        }}>✎ {(markup ?? shot.markup).length}</span>
      )}
    </button>
  );
}

// ── The markup editor ─────────────────────────────────────────────────────────

const TOOLS: { key: Tool; glyph: string; label: string; hotkey: string }[] = [
  { key: "pen", glyph: "✎", label: "Pen", hotkey: "p" },
  { key: "hl", glyph: "▰", label: "Highlighter", hotkey: "h" },
  { key: "arrow", glyph: "↗", label: "Arrow", hotkey: "a" },
  { key: "ellipse", glyph: "◯", label: "Circle", hotkey: "c" },
  { key: "rect", glyph: "▭", label: "Box", hotkey: "b" },
  { key: "text", glyph: "T", label: "Text", hotkey: "t" },
  { key: "erase", glyph: "⌫", label: "Eraser (click a mark)", hotkey: "e" },
];

function MarkupEditor({
  shot, onClose, onSave,
}: {
  shot: Shot;
  onClose: () => void;
  onSave: (markup: Shape[], caption: string) => Promise<void>;
}) {
  const [nat, setNat] = useState({ w: shot.width, h: shot.height });
  const [shapes, setShapes] = useState<Shape[]>(shot.markup);
  const [redo, setRedo] = useState<Shape[][]>([]);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [tool, setTool] = useState<Tool>("arrow");
  const [ink, setInk] = useState(INKS[0]);
  const [sizeKey, setSizeKey] = useState("M");
  const [draft, setDraft] = useState<Shape | null>(null);
  const [caption, setCaption] = useState(shot.caption);
  const [textAt, setTextAt] = useState<(Pt & { value: string }) | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "download" | "copy">("");
  const [msg, setMsg] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const drawing = useRef(false);

  const dirty = useMemo(
    () => JSON.stringify(shapes) !== JSON.stringify(shot.markup) || caption !== shot.caption,
    [shapes, caption, shot.markup, shot.caption],
  );

  const W = nat.w || 1600, H = nat.h || 900;
  const base = baseStroke(W, H);
  const mul = SIZES.find((s) => s.key === sizeKey)?.mul ?? 2;
  const strokeW = base * mul;
  const hlW = base * mul * 5;
  const fontPx = Math.round(base * 7 * (mul / 2 + 0.5));

  // Fit the picture into whatever room the stage has.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const scale = box.w && box.h ? Math.min(box.w / W, box.h / H, 2) : 0;
  const dispW = Math.max(1, Math.floor(W * scale));
  const dispH = Math.max(1, Math.floor(H * scale));

  const commit = useCallback((next: Shape[]) => {
    setHistory((h) => [...h.slice(-99), shapes]);
    setRedo([]);
    setShapes(next);
  }, [shapes]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setRedo((r) => [...r, shapes]);
      setShapes(prev);
      return h.slice(0, -1);
    });
  }, [shapes]);

  const redoFn = useCallback(() => {
    setRedo((r) => {
      if (!r.length) return r;
      const next = r[r.length - 1];
      setHistory((h) => [...h, shapes]);
      setShapes(next);
      return r.slice(0, -1);
    });
  }, [shapes]);

  const toImg = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W)),
      y: Math.max(0, Math.min(H, ((e.clientY - r.top) / r.height) * H)),
    };
  };

  const commitText = useCallback(() => {
    if (!textAt) return;
    const v = textAt.value.replace(/\s+$/, "");
    if (v.trim()) commit([...shapes, { t: "text", c: ink, s: fontPx, x: textAt.x, y: textAt.y + fontPx * 0.85, text: v }]);
    setTextAt(null);
  }, [textAt, shapes, ink, fontPx, commit]);

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === "erase") return;
    if (textAt) { commitText(); return; }
    const p = toImg(e);
    if (tool === "text") {
      setTextAt({ ...p, value: "" });
      setTimeout(() => textRef.current?.focus(), 0);
      return;
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const pts = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
    if (tool === "pen") setDraft({ t: "pen", c: ink, w: strokeW, pts });
    else if (tool === "hl") setDraft({ t: "hl", c: ink, w: hlW, pts });
    else setDraft({ t: tool, c: ink, w: strokeW, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing.current || !draft) return;
    const p = toImg(e);
    if (draft.t === "pen" || draft.t === "hl") {
      const n = draft.pts.length;
      // Skip sub-pixel jitter — keeps the JSON small without visibly changing the line.
      if (Math.hypot(p.x - draft.pts[n - 2], p.y - draft.pts[n - 1]) < Math.max(1, base * 0.6)) return;
      setDraft({ ...draft, pts: [...draft.pts, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] });
    } else if (draft.t !== "text") {
      let { x, y } = p;
      // Shift = perfect circle / square.
      if (e.shiftKey && (draft.t === "ellipse" || draft.t === "rect")) {
        const d = Math.max(Math.abs(x - draft.x1), Math.abs(y - draft.y1));
        x = draft.x1 + Math.sign(x - draft.x1 || 1) * d;
        y = draft.y1 + Math.sign(y - draft.y1 || 1) * d;
      }
      setDraft({ ...draft, x2: x, y2: y });
    }
  };

  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const d = draft;
    setDraft(null);
    if (!d) return;
    if ((d.t === "pen" || d.t === "hl") && d.pts.length < 2) return;
    if (d.t === "arrow" || d.t === "ellipse" || d.t === "rect") {
      // A click with no drag isn't a shape.
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < base * 3) return;
    }
    commit([...shapes, d]);
  };

  // Keyboard: tools, undo/redo, Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redoFn(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); redoFn(); return; }
      if (typing) return;
      if (e.key === "Escape") { e.preventDefault(); if (dirty) setConfirmLeave(true); else onClose(); return; }
      const t = TOOLS.find((x) => x.hotkey === e.key.toLowerCase());
      if (t && !e.ctrlKey && !e.metaKey) setTool(t.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redoFn, dirty, onClose]);

  const save = async () => {
    if (textAt) commitText();
    setBusy("save"); setMsg("");
    try {
      await onSave(shapes, caption);
      onClose();
    } catch (err) {
      setMsg(`Save failed · ${(err as Error).message}`);
    } finally { setBusy(""); }
  };

  const download = async () => {
    setBusy("download"); setMsg("");
    try {
      const blob = await flatten(shot, shapes);
      const base = (shot.name || `voltick-audit-${shot.id}`).replace(/\.[a-z0-9]+$/i, "");
      downloadBlob(blob, `${base}-marked.png`);
    } catch (err) { setMsg(`Download failed · ${(err as Error).message}`); }
    finally { setBusy(""); }
  };

  const copy = async () => {
    setBusy("copy"); setMsg("");
    try {
      const blob = await flatten(shot, shapes);
      const CI = (window as unknown as { ClipboardItem?: new (d: Record<string, Blob>) => ClipboardItem }).ClipboardItem;
      if (!CI || !navigator.clipboard?.write) throw new Error("this browser can't copy images");
      await navigator.clipboard.write([new CI({ "image/png": blob })]);
      setMsg("Copied · paste it anywhere");
    } catch (err) { setMsg(`Copy failed · ${(err as Error).message}`); }
    finally { setBusy(""); }
  };

  const toolBtn = (active: boolean, col = LIGHT_BLUE): CSSProperties => ({
    minWidth: 38, height: 36, padding: "0 10px", borderRadius: 9, cursor: "pointer",
    fontSize: TYPE.subhead, fontWeight: 800,
    color: active ? "#05060A" : OWNER_THEME.text,
    background: active ? col : "rgba(255,255,255,0.05)",
    border: `1px solid ${active ? col : OWNER_THEME.border}`,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  });
  const sep = <span style={{ width: 1, alignSelf: "stretch", background: OWNER_THEME.border, margin: "0 4px" }} />;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1200, background: "rgba(2,3,6,.94)",
        display: "flex", flexDirection: "column", backdropFilter: "blur(6px)",
      }}
    >
      {/* Toolbar */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "10px 14px",
        borderBottom: `1px solid ${OWNER_THEME.border}`, background: OWNER_THEME.panel,
      }}>
        <span style={{ ...labelStyle, color: LIGHT_BLUE, marginRight: 6 }}>Mark up</span>
        {TOOLS.map((t) => (
          <button key={t.key} type="button" title={`${t.label} (${t.hotkey.toUpperCase()})`} onClick={() => setTool(t.key)}
            style={toolBtn(tool === t.key, t.key === "erase" ? OWNER_THEME.orange : LIGHT_BLUE)}>
            <span>{t.glyph}</span>
            <span className="va-tool-label" style={{ fontSize: TYPE.label }}>{t.label.split(" ")[0]}</span>
          </button>
        ))}
        {sep}
        {INKS.map((c) => (
          <button key={c} type="button" title="Ink" onClick={() => setInk(c)}
            style={{
              width: 26, height: 26, borderRadius: "50%", cursor: "pointer", background: c,
              border: ink === c ? "3px solid #FFFFFF" : `2px solid ${OWNER_THEME.border}`,
              boxShadow: ink === c ? `0 0 0 2px ${rgba(LIGHT_BLUE, 0.8)}` : "none",
            }} />
        ))}
        {sep}
        {SIZES.map((s) => (
          <button key={s.key} type="button" title={`Size ${s.key}`} onClick={() => setSizeKey(s.key)} style={toolBtn(sizeKey === s.key)}>
            {s.key}
          </button>
        ))}
        {sep}
        <button type="button" title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.length} style={{ ...toolBtn(false), opacity: history.length ? 1 : 0.4 }}>↶</button>
        <button type="button" title="Redo (Ctrl+Shift+Z)" onClick={redoFn} disabled={!redo.length} style={{ ...toolBtn(false), opacity: redo.length ? 1 : 0.4 }}>↷</button>
        <ArmedDelete title="Clear all marks" label={<span style={{ fontSize: TYPE.label, fontWeight: 800 }}>Clear</span>} onConfirm={() => shapes.length && commit([])} />
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...btnGhost, ...btnSmall }} onClick={copy} disabled={!!busy}>
          {busy === "copy" ? "Copying…" : "Copy image"}
        </button>
        <button type="button" style={{ ...btnGhost, ...btnSmall }} onClick={download} disabled={!!busy}>
          {busy === "download" ? "Exporting…" : "Download PNG"}
        </button>
        {confirmLeave ? (
          <button type="button" style={{ ...btnGhost, ...btnSmall, color: OWNER_THEME.orange, borderColor: rgba(OWNER_THEME.orange, 0.5) }} onClick={onClose}>
            Discard changes?
          </button>
        ) : (
          <button type="button" style={{ ...btnGhost, ...btnSmall }} onClick={() => (dirty ? setConfirmLeave(true) : onClose())}>
            Cancel
          </button>
        )}
        <button type="button" style={{ ...btnPrimary, ...btnSmall }} onClick={save} disabled={!!busy}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Stage */}
      <div ref={stageRef} style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflow: "hidden" }}>
        {scale > 0 && (
          <div style={{ position: "relative", width: dispW, height: dispH, boxShadow: "0 20px 60px rgba(0,0,0,.6)", borderRadius: 6, overflow: "hidden", background: "#000" }}>
            <img
              src={shotSrc(shot)} alt="" draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth && (el.naturalWidth !== nat.w || el.naturalHeight !== nat.h)) setNat({ w: el.naturalWidth, h: el.naturalHeight });
              }}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", userSelect: "none", pointerEvents: "none" }}
            />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              style={{
                position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none",
                cursor: tool === "text" ? "text" : tool === "erase" ? "default" : "crosshair",
              }}
            >
              {shapes.map((s, i) => (
                <ShapeSvg key={i} s={s} erasing={tool === "erase"} onErase={() => commit(shapes.filter((_, j) => j !== i))} />
              ))}
              {draft && <ShapeSvg s={draft} />}
            </svg>
            {textAt && (
              <textarea
                ref={textRef}
                value={textAt.value}
                placeholder="Type, Enter to place · Shift+Enter new line"
                onChange={(e) => setTextAt({ ...textAt, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
                  if (e.key === "Escape") { e.preventDefault(); setTextAt(null); }
                }}
                onBlur={commitText}
                rows={Math.max(1, textAt.value.split("\n").length)}
                style={{
                  position: "absolute",
                  left: textAt.x * scale, top: textAt.y * scale,
                  minWidth: 220, maxWidth: Math.max(220, dispW - textAt.x * scale - 8),
                  font: TEXT_FONT.replace("{s}", String(Math.max(12, fontPx * scale))),
                  color: ink, background: "rgba(0,0,0,.55)", border: `1px dashed ${ink}`,
                  borderRadius: 6, padding: "2px 6px", outline: "none", resize: "none",
                  lineHeight: 1.2, overflow: "hidden",
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer: caption + hint */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 14px",
        borderTop: `1px solid ${OWNER_THEME.border}`, background: OWNER_THEME.panel,
      }}>
        <span style={labelStyle}>Caption</span>
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="What's wrong here / what should change"
          style={{ ...homeInputStyle, flex: "1 1 280px", padding: "7px 10px" }}
        />
        <span style={{ fontSize: TYPE.label, color: msg.includes("failed") ? OWNER_THEME.orange : OWNER_THEME.green }}>
          {msg || "Shift = perfect circle/box · Eraser: click a mark · Ctrl+Z undo"}
        </span>
      </div>
    </div>
  );
}

// ── One audit card ────────────────────────────────────────────────────────────

function CardView({
  card, onPatch, onDelete, onAddShots, onOpenShot, onDeleteShot, uploading,
}: {
  card: AuditCard;
  onPatch: (patch: Partial<Pick<AuditCard, "page" | "title" | "notes" | "status">>) => void;
  onDelete: () => void;
  onAddShots: (files: File[]) => void;
  onOpenShot: (shot: Shot) => void;
  onDeleteShot: (shot: Shot) => void;
  uploading: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const col = card.page ? pageColor(card.page) : LIGHT_BLUE;
  const done = card.status === "Done";

  const copyText = async () => {
    const lines = [
      `## ${card.page ? `[${card.page}] ` : ""}${card.title || "Untitled"}`,
      `Status: ${card.status}`,
      card.notes.trim() ? `\n${card.notes.trim()}` : "",
      ...card.shots.filter((s) => s.caption.trim()).map((s, i) => `- Screenshot ${i + 1}: ${s.caption.trim()}`),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — nothing to do */ }
  };

  return (
    <div
      className="va-card"
      tabIndex={0}
      onPaste={(e) => {
        const files = imageFilesFrom(e.clipboardData);
        if (files.length) { e.preventDefault(); onAddShots(files); }
      }}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = imageFilesFrom(e.dataTransfer);
        if (files.length) onAddShots(files);
      }}
      style={{
        ...homePanelStyle, padding: 16, display: "flex", flexDirection: "column", gap: 12, outline: "none",
        borderColor: dragOver ? LIGHT_BLUE : OWNER_THEME.border,
        boxShadow: dragOver ? `0 0 0 2px ${rgba(LIGHT_BLUE, 0.5)}` : homePanelStyle.boxShadow,
        opacity: done ? 0.8 : 1,
      }}
    >
      {/* Top row: page · status · actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: col, boxShadow: `0 0 8px ${rgba(col, 0.7)}`, flexShrink: 0 }} />
        <input
          list="va-pages"
          value={card.page}
          placeholder="Page…"
          onChange={(e) => onPatch({ page: e.target.value })}
          title="Which Voltick page this is about"
          style={{
            background: "transparent", border: "none", outline: "none", color: col,
            fontSize: TYPE.label, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase",
            flex: "1 1 120px", minWidth: 80, padding: "2px 0",
          }}
        />
        <StatusPill status={card.status} onCycle={() => onPatch({ status: nextStatus(card.status) })} />
        <button type="button" onClick={copyText} title="Copy this card as text (for Claude / Discord)"
          style={{ background: "none", border: "none", color: copied ? DONE_GREEN : OWNER_THEME.text, cursor: "pointer", fontSize: TYPE.label, fontWeight: 800, padding: "2px 4px" }}>
          {copied ? "✓" : "⧉"}
        </button>
        <ArmedDelete title="Delete card and its screenshots" onConfirm={onDelete} />
      </div>

      {/* Title */}
      <input
        value={card.title}
        placeholder="What needs looking at?"
        onChange={(e) => onPatch({ title: e.target.value })}
        style={{
          background: "transparent", border: "none", outline: "none", color: OWNER_THEME.text, width: "100%",
          fontSize: TYPE.title, fontWeight: 800, padding: 0,
          textDecoration: done ? "line-through" : "none",
        }}
      />

      {/* Notes */}
      <AutoTextarea
        value={card.notes}
        onChange={(v) => onPatch({ notes: v })}
        placeholder="Notes · what to change, what's wrong, what it should do…"
        minRows={3}
        style={{ fontSize: TYPE.body, padding: "9px 11px" }}
      />

      {/* Screenshots */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={labelStyle}>Screenshots</span>
          <span style={{ fontSize: TYPE.label, color: OWNER_THEME.green, fontFamily: "var(--font-mono), monospace" }}>{card.shots.length}</span>
          <span style={{ flex: 1 }} />
          <button type="button" style={{ ...btnGhost, ...btnSmall }} disabled={uploading || card.shots.length >= MAX_SHOTS_PER_CARD}
            onClick={() => fileRef.current?.click()}>
            <Plus /> {uploading ? "Uploading…" : "Add"}
          </button>
          <input ref={fileRef} type="file" accept={SHOT_ACCEPT} multiple hidden
            onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onAddShots(f); }} />
        </div>
        {card.shots.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {card.shots.map((s) => (
              <div key={s.id} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4, maxWidth: "100%" }}>
                <ShotView shot={s} height={card.shots.length === 1 ? 180 : 110} onClick={() => onOpenShot(s)} />
                <div style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,.7)", borderRadius: 999 }}>
                  <ArmedDelete title="Delete screenshot" onConfirm={() => onDeleteShot(s)} />
                </div>
                {s.caption && (
                  <div style={{ fontSize: TYPE.label, color: OWNER_THEME.green, maxWidth: 260, lineHeight: 1.35 }}>{s.caption}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()}
            style={{
              border: `1px dashed ${rgba(LIGHT_BLUE, 0.35)}`, borderRadius: 10, padding: "14px 10px",
              background: "transparent", color: OWNER_THEME.green, fontSize: TYPE.label, cursor: "pointer", textAlign: "center",
            }}>
            {uploading ? "Uploading…" : "Paste (click the card, Ctrl+V), drop, or click to add screenshots"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VoltickAudit() {
  const [cards, setCards] = useState<AuditCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [pageFilter, setPageFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [q, setQ] = useState("");
  const [uploadingFor, setUploadingFor] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Shot | null>(null);

  // New-card composer
  const [showCreate, setShowCreate] = useState(false);
  const [nPage, setNPage] = useState("");
  const [nTitle, setNTitle] = useState("");
  const [nNotes, setNNotes] = useState("");
  const [nFiles, setNFiles] = useState<{ key: string; file: File; url: string }[]>([]);
  const [creating, setCreating] = useState(false);

  const pending = useRef(0);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const queued = useRef<Record<number, Record<string, unknown>>>({});

  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    pending.current += 1;
    setSaveState("saving");
    try {
      const out = await p;
      pending.current -= 1;
      if (pending.current === 0) setSaveState("saved");
      return out;
    } catch (err) {
      pending.current -= 1;
      setSaveState("error");
      setErrMsg((err as Error).message);
      throw err;
    }
  }, []);

  // Load
  const load = useCallback(async () => {
    try {
      const r = await fetch(API, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok || data?.error) throw new Error(data?.error || `HTTP ${r.status}`);
      const shots: Shot[] = (Array.isArray(data?.shots) ? data.shots : []).map(readShot);
      const byCard = new Map<number, Shot[]>();
      for (const s of shots) {
        const l = byCard.get(s.cardId) ?? [];
        l.push(s);
        byCard.set(s.cardId, l);
      }
      setCards((Array.isArray(data?.cards) ? data.cards : []).map((c: Record<string, unknown>) => readCard(c, byCard.get(Number(c.id)) ?? [])));
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Unsaved-change guard while anything is in flight.
  useEffect(() => {
    if (saveState !== "saving" && saveState !== "error") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  /** Local update now; text fields hit the server on a debounce, the rest immediately. */
  const patchCard = useCallback((id: number, patch: Partial<Pick<AuditCard, "page" | "title" | "notes" | "status">>) => {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    queued.current[id] = { ...(queued.current[id] ?? {}), ...patch };
    const flush = () => {
      const body = queued.current[id];
      delete queued.current[id];
      delete timers.current[id];
      if (body) track(post({ action: "updateCard", id, ...body })).catch(() => {});
    };
    clearTimeout(timers.current[id]);
    if ("status" in patch) flush();
    else {
      setSaveState("saving");
      timers.current[id] = setTimeout(flush, 700);
    }
  }, [track]);

  // Flush debounced edits on unmount so leaving the page never drops a keystroke.
  useEffect(() => () => {
    for (const [id, body] of Object.entries(queued.current)) {
      clearTimeout(timers.current[Number(id)]);
      fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, body: JSON.stringify({ action: "updateCard", id: Number(id), ...body }) }).catch(() => {});
    }
  }, []);

  const deleteCard = (id: number) => {
    setCards((cs) => cs.filter((c) => c.id !== id));
    clearTimeout(timers.current[id]);
    delete queued.current[id];
    track(post({ action: "deleteCard", id })).catch(() => load());
  };

  const uploadShots = async (cardId: number, files: File[]) => {
    const card = cards.find((c) => c.id === cardId);
    const room = MAX_SHOTS_PER_CARD - (card?.shots.length ?? 0);
    if (room <= 0) { setErrMsg(`Up to ${MAX_SHOTS_PER_CARD} screenshots per card.`); setSaveState("error"); return; }
    setUploadingFor((s) => new Set(s).add(cardId));
    try {
      const prepared = [];
      for (const f of files.slice(0, room)) {
        const p = await prepareShot(f);
        const dims = await imageSize(p.dataUrl);
        prepared.push({ dataUrl: p.dataUrl, name: p.name, ...dims });
      }
      const data = await track(post<{ shots: Record<string, unknown>[] }>({ action: "addShots", cardId, shots: prepared }));
      const added = (data.shots ?? []).map(readShot);
      setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, shots: [...c.shots, ...added] } : c)));
    } catch (err) {
      setErrMsg((err as Error).message);
      setSaveState("error");
    } finally {
      setUploadingFor((s) => { const n = new Set(s); n.delete(cardId); return n; });
    }
  };

  const deleteShot = (shot: Shot) => {
    setCards((cs) => cs.map((c) => (c.id === shot.cardId ? { ...c, shots: c.shots.filter((s) => s.id !== shot.id) } : c)));
    track(post({ action: "deleteShot", id: shot.id })).catch(() => load());
  };

  const saveMarkup = async (shot: Shot, markup: Shape[], caption: string) => {
    await track(post({ action: "updateShot", id: shot.id, markup, caption }));
    setCards((cs) => cs.map((c) => (c.id === shot.cardId
      ? { ...c, shots: c.shots.map((s) => (s.id === shot.id ? { ...s, markup, caption } : s)) }
      : c)));
  };

  // ── New card ────────────────────────────────────────────────────────────────
  const openCreate = (page = pageFilter) => {
    setNPage(page); setNTitle(""); setNNotes(""); setNFiles([]); setShowCreate(true);
  };
  const addComposerFiles = (files: File[]) => {
    setNFiles((cur) => [
      ...cur,
      ...files.slice(0, MAX_SHOTS_PER_CARD - cur.length).map((file) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file, url: URL.createObjectURL(file),
      })),
    ]);
  };
  const closeCreate = () => {
    for (const f of nFiles) URL.revokeObjectURL(f.url);
    setShowCreate(false);
  };
  const createCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nTitle.trim() && !nNotes.trim() && !nFiles.length) return;
    setCreating(true);
    try {
      const data = await track(post<{ card: Record<string, unknown> }>({
        action: "createCard", page: nPage.trim(), title: nTitle.trim(), notes: nNotes,
      }));
      const card = readCard(data.card, []);
      setCards((cs) => [card, ...cs]);
      const files = nFiles.map((f) => f.file);
      closeCreate();
      if (files.length) {
        // uploadShots reads `cards` for the room check; the new card has none yet.
        setUploadingFor((s) => new Set(s).add(card.id));
        try {
          const prepared = [];
          for (const f of files) {
            const p = await prepareShot(f);
            prepared.push({ dataUrl: p.dataUrl, name: p.name, ...(await imageSize(p.dataUrl)) });
          }
          const up = await track(post<{ shots: Record<string, unknown>[] }>({ action: "addShots", cardId: card.id, shots: prepared }));
          const added = (up.shots ?? []).map(readShot);
          setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, shots: added } : c)));
        } finally {
          setUploadingFor((s) => { const n = new Set(s); n.delete(card.id); return n; });
        }
      }
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const pageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      const k = c.page.trim();
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [cards]);

  const statusCounts = useMemo(() => {
    const o: Record<Status, number> = { Open: 0, "In Progress": 0, Done: 0 };
    for (const c of cards) o[c.status] += 1;
    return o;
  }, [cards]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards.filter((c) =>
      (!pageFilter || c.page.trim() === pageFilter) &&
      (!statusFilter || c.status === statusFilter) &&
      (!needle || `${c.page} ${c.title} ${c.notes} ${c.shots.map((s) => s.caption).join(" ")}`.toLowerCase().includes(needle)),
    );
  }, [cards, pageFilter, statusFilter, q]);

  const saveLabel =
    loadError ? "Offline" :
    saveState === "error" ? "Save failed" :
    saveState === "saving" ? "Saving…" :
    saveState === "saved" ? "Saved" : "Postgres";
  const saveCol = loadError || saveState === "error" ? OWNER_THEME.orange : LIGHT_BLUE;

  const modalOverlay: CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)", padding: 16,
  };

  return (
    <div style={homeShellStyle}>
      <style>{`
        .va-card{transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;}
        .va-card:hover{border-color:${rgba(LIGHT_BLUE, 0.3)} !important;}
        .va-card:focus-within{border-color:${rgba(LIGHT_BLUE, 0.45)} !important;}
        .va-pill{transition:filter .12s ease, transform .12s ease;}
        .va-pill:hover{filter:brightness(1.25);transform:translateY(-1px);}
        .va-shot{transition:transform .12s ease, border-color .12s ease;}
        .va-shot:hover{transform:translateY(-1px);border-color:${rgba(LIGHT_BLUE, 0.6)} !important;}
        @media (max-width: 1500px){ .va-tool-label{display:none;} }
      `}</style>

      <datalist id="va-pages">
        {[...new Set([...VOLTICK_PAGES, ...pageCounts.map(([p]) => p)])].map((p) => <option key={p} value={p} />)}
      </datalist>

      {/* Header */}
      <div style={{ ...homeHeaderStyle, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: TYPE.title, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".12em", color: LIGHT_BLUE }}>
            Voltick · Audit
          </span>
          <span style={{ fontSize: TYPE.body, fontFamily: "var(--font-mono), monospace" }}>
            <span style={{ color: STATUS_COLORS.Open }}>{statusCounts.Open} open</span>
            {" · "}
            <span style={{ color: STATUS_COLORS["In Progress"] }}>{statusCounts["In Progress"]} in progress</span>
            {" · "}
            <span style={{ color: STATUS_COLORS.Done }}>{statusCounts.Done} done</span>
          </span>
          <span
            title={errMsg || (loadError ? `Couldn't load: ${loadError}` : "Cards and screenshots are saved to Postgres")}
            style={{
              fontSize: TYPE.label, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase",
              padding: "3px 9px", borderRadius: 999, border: `1px solid ${rgba(saveCol, 0.45)}`, color: saveCol,
            }}
          >{saveLabel}</span>
        </div>
        <button style={btnPrimary} onClick={() => openCreate()} disabled={!!loadError}>
          <Plus /> New Card
        </button>
      </div>

      <div style={{ ...homeContentStyle, overflow: "auto" }}>
        {/* Filters */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <PageChip page="" active={!pageFilter} count={cards.length} onClick={() => setPageFilter("")} />
            {pageCounts.map(([p, n]) => (
              <PageChip key={p} page={p} count={n} active={pageFilter === p} onClick={() => setPageFilter(pageFilter === p ? "" : p)} />
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {(["", ...STATUSES] as (Status | "")[]).map((s) => {
              const active = statusFilter === s;
              const col = s ? STATUS_COLORS[s] : LIGHT_BLUE;
              return (
                <button key={s || "all"} type="button" onClick={() => setStatusFilter(s)}
                  style={{
                    fontSize: TYPE.label, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                    padding: "4px 11px", borderRadius: 8, cursor: "pointer",
                    color: active ? "#05060A" : col, background: active ? col : "transparent",
                    border: `1px solid ${rgba(col, active ? 0.9 : 0.35)}`,
                  }}>
                  {s || "Any status"}
                </button>
              );
            })}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search cards…"
              style={{ ...homeInputStyle, padding: "6px 10px", fontSize: TYPE.label, flex: "0 1 240px", marginLeft: "auto" }}
            />
          </div>
        </div>

        {/* Body */}
        {!loaded ? (
          <div style={{ color: OWNER_THEME.green }}>Loading…</div>
        ) : loadError ? (
          <div style={{ ...homePanelStyle, padding: 20, color: OWNER_THEME.orange }}>
            Couldn't load the audit board ({loadError}).{" "}
            <button type="button" style={{ ...btnGhost, ...btnSmall }} onClick={() => { setLoaded(false); load(); }}>Retry</button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))", gap: 16, alignItems: "start" }}>
            {visible.map((c) => (
              <CardView
                key={c.id}
                card={c}
                uploading={uploadingFor.has(c.id)}
                onPatch={(p) => patchCard(c.id, p)}
                onDelete={() => deleteCard(c.id)}
                onAddShots={(files) => uploadShots(c.id, files)}
                onOpenShot={(s) => setEditing(s)}
                onDeleteShot={deleteShot}
              />
            ))}

            {/* New-card tile — last cell, so new cards feel like they land in place. */}
            <button type="button" onClick={() => openCreate()}
              style={{
                ...homePanelStyle, background: "transparent", border: `1px dashed ${rgba(LIGHT_BLUE, 0.35)}`,
                minHeight: 180, cursor: "pointer", color: LIGHT_BLUE, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              <span style={{ fontSize: 28, lineHeight: 1 }}>+</span>
              <span style={{ fontSize: TYPE.label, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>
                New card{pageFilter ? ` · ${pageFilter}` : ""}
              </span>
            </button>

            {!visible.length && cards.length > 0 && (
              <div style={{ gridColumn: "1 / -1", color: OWNER_THEME.green, fontSize: TYPE.body }}>
                No cards match these filters.
              </div>
            )}
          </div>
        )}
      </div>

      {/* New card modal */}
      {showCreate && (
        <div style={modalOverlay} onClick={closeCreate}>
          <form
            onSubmit={createCard}
            onClick={(e) => e.stopPropagation()}
            onPaste={(e) => {
              const files = imageFilesFrom(e.clipboardData);
              if (files.length) { e.preventDefault(); addComposerFiles(files); }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = imageFilesFrom(e.dataTransfer); if (f.length) addComposerFiles(f); }}
            style={{ ...homePanelStyle, background: OWNER_THEME.panel, width: "100%", maxWidth: 560, padding: 22, display: "flex", flexDirection: "column", gap: 14, maxHeight: "92vh", overflow: "auto" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottom: `1px solid ${OWNER_THEME.border}` }}>
              <span style={{ fontSize: TYPE.title, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".1em", color: LIGHT_BLUE }}>New audit card</span>
              <button type="button" onClick={closeCreate} style={{ background: "none", border: "none", color: OWNER_THEME.text, fontSize: TYPE.title, cursor: "pointer" }}>×</button>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>Page</span>
              <input list="va-pages" value={nPage} onChange={(e) => setNPage(e.target.value)} placeholder="e.g. The Board" style={{ ...homeInputStyle }} autoFocus />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {VOLTICK_PAGES.slice(0, 10).map((p) => (
                  <PageChip key={p} page={p} active={nPage === p} onClick={() => setNPage(p)} />
                ))}
              </div>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>Title</span>
              <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="e.g. Volt chip overlaps the rail on phone" style={{ ...homeInputStyle }} />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>Notes</span>
              <AutoTextarea value={nNotes} onChange={setNNotes} placeholder="What to change or look at…" minRows={4} />
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={labelStyle}>Screenshots</span>
              <div style={{
                border: `1px dashed ${rgba(LIGHT_BLUE, 0.35)}`, borderRadius: 10, padding: 12,
                display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
              }}>
                {nFiles.map((f) => (
                  <div key={f.key} style={{ position: "relative" }}>
                    <img src={f.url} alt="" style={{ height: 70, borderRadius: 8, border: `1px solid ${OWNER_THEME.border}`, display: "block" }} />
                    <button type="button" onClick={() => { URL.revokeObjectURL(f.url); setNFiles((cur) => cur.filter((x) => x.key !== f.key)); }}
                      style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,.75)", color: "#fff", border: "none", borderRadius: 999, width: 20, height: 20, cursor: "pointer", fontSize: TYPE.label, lineHeight: 1 }}>×</button>
                  </div>
                ))}
                <label style={{ ...btnGhost, ...btnSmall, cursor: "pointer" }}>
                  <Plus /> Pick files
                  <input type="file" accept={SHOT_ACCEPT} multiple hidden
                    onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) addComposerFiles(f); }} />
                </label>
                <span style={{ fontSize: TYPE.label, color: OWNER_THEME.green }}>or paste (Ctrl+V) / drop here · mark up after saving</span>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" style={btnGhost} onClick={closeCreate}>Cancel</button>
              <button type="submit" style={btnPrimary} disabled={creating || (!nTitle.trim() && !nNotes.trim() && !nFiles.length)}>
                {creating ? "Saving…" : "Add card"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Markup editor */}
      {editing && (
        <MarkupEditor
          key={editing.id}
          shot={editing}
          onClose={() => setEditing(null)}
          onSave={(markup, caption) => saveMarkup(editing, markup, caption)}
        />
      )}

      {/* Error toast */}
      {saveState === "error" && errMsg && (
        <div style={{
          position: "fixed", right: 16, bottom: 16, zIndex: 1100, maxWidth: 360,
          ...homePanelStyle, background: OWNER_THEME.panel, borderColor: rgba(OWNER_THEME.orange, 0.5),
          padding: "10px 14px", color: OWNER_THEME.orange, fontSize: TYPE.label, display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ flex: 1 }}>{errMsg}</span>
          <button type="button" onClick={() => { setErrMsg(""); setSaveState("idle"); }} style={{ background: "none", border: "none", color: OWNER_THEME.text, cursor: "pointer" }}>×</button>
        </div>
      )}
    </div>
  );
}

