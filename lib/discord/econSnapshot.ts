/**
 * Economic Calendar snapshot template.
 *
 * REDONE 2026-09-24 — Voltick theme, "layout B · timeline", to match the v3
 * snapshot button (cbedge-v3/src/board/econCalendar/econTemplate.ts). Economic
 * prints and the presidential schedule share ONE time-sorted list (so a day
 * with 1 print and 14 White House items is just 15 rows), rows squeeze with the
 * count down to a 13px floor, and past MAX_ROWS the most important rows are
 * kept with a "+N more today · voltick.io/bzila" row. Earnings chips sit on the
 * right with a "+N" overflow chip. No grey text; no CB Edge logo.
 *
 * Builds the 1280x720 snapshot as a standalone HTML document, renders it in an
 * off-screen iframe, and returns a PNG data URL. Populated from live
 * /api/calendar + /api/calendar-quote + /proxy/earnings-week data.
 *
 * This lives apart from the button on purpose. Presentation (this file) and
 * transport (lib/discord/share.ts) used to sit in one 700-line component, so a
 * typo in a CSS comment could — and did — take down the Discord upload and fail
 * the production build. Edit the layout here freely; you cannot break the
 * upload path from this file.
 *
 * IMPORTANT: the CSS below is one big template literal. Never use a backtick in
 * a CSS comment here — it terminates the string and breaks the build in a way
 * the error message does not make obvious. Use "quotes" instead.
 *
 * html2canvas is not a browser. It mis-renders several things real Chrome gets
 * right; the comments inside the CSS record which workarounds are load-bearing.
 * Read them before "simplifying" anything.
 */

import { ANTICIPATED_SYMBOLS } from "@/lib/econCalendar";

// NOTE: lib/snapshot (html2canvas) is imported DYNAMICALLY inside
// renderAndCapture(), not at module scope. Everything above the "Off-screen
// render + capture" divider — buildSnapshotHTML() and its helpers — is pure
// string building with no DOM, and is now imported on the SERVER too by
// app/api/econ-snapshot-html/route.ts so the scheduled Discord post renders the
// exact same template as the button. A static html2canvas import would drag a
// browser-only module into that Node route. Keep this import lazy.

// ── Voltick palette (Voltick DESIGN.md · web/src/theme.jsx) ───────────────────
const VT = {
  ink: "#0a0d10",
  panel: "#0e1216",
  elev: "#141a21",
  line: "#1e2630",
  lineSoft: "rgba(30,38,48,0.6)",
  rail: "#3a4654",
  paper: "#e7ece9",
  accent: "#2f6bff",
  accentText: "#6aa0ff",
  sky: "#7fb0ff",
  bad: "#ff6b7a",
} as const;

// ── Geometry (1280x720, locked) ───────────────────────────────────────────────
const CANVAS_W = 1280;
const CANVAS_H = 720;
const LEFT_W = 860;
const PAD_X = 30;
const LIST_TOP = 178;
const LIST_H = CANVAS_H - LIST_TOP - 26;
const MIN_ROW_H = 34;
const MAX_ROW_H = 60;
const MAX_ROWS = Math.floor(LIST_H / MIN_ROW_H);
const TIME_COL = 78;
const DOT_COL = 22;
const TAG_COL = 66;
const COL_GAP = 10;
const ERN_H = 440;
const ERN_GROUP_OVERHEAD = 14 + 14 + 11 + 10 + 14;
const CHIP_H = 30;
const CHIP_GAP = 8;
const CHIPS_PER_ROW = 3;

// Shape returned by /proxy/earnings-week — same source the /economic-calendar
// page uses. (The old /api/earnings-today Yahoo scrape returns [] now.)
export interface EarnRow {
  date: string;                 // YYYY-MM-DD (ET)
  symbol: string;
  company: string;
  session: "pre" | "after" | "unknown";
  market_cap: number;
}

export interface CalEvent {
  date: string;
  time: string;
  time_formatted?: string;
  title: string;
  country: string;
  impact: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function etToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/**
 * THE EARNINGS LANE IS A $1B+ LANE.
 *
 * /proxy/earnings-week hands back the full Nasdaq calendar with no market-cap
 * floor (the recorder dropped its own — see server-with-proxy's route comment),
 * so an ordinary Wednesday buries LEN and LUXE under a dozen $40M names nobody
 * trades. Worse, those are exactly the tickers with no logo, so the lane reads
 * as a row of grey initials. A snapshot is 1280px wide and read in a Discord
 * scroll: the only useful earnings lane is the one a trader recognises.
 *
 * Rows whose cap the provider did not supply come back as 0, NOT as small — so
 * a strict floor would silently drop a real name on a day the quote lookup
 * failed. An unknown cap therefore survives when the symbol is on the curated
 * ANTICIPATED_SYMBOLS list in lib/econCalendar; an unknown cap that is ALSO
 * unknown to that list is a micro-cap in every case observed and is dropped.
 */
export const MIN_EARN_MCAP = 1e9;

export function isSnapshotEarning(r: EarnRow): boolean {
  const cap = Number(r.market_cap) || 0;
  if (cap >= MIN_EARN_MCAP) return true;
  return cap <= 0 && ANTICIPATED_SYMBOLS.has(String(r.symbol || "").toUpperCase());
}

/**
 * Today's earnings for the snapshot: today only, $1B+, biggest first.
 *
 * ONE copy, called by both surfaces — the browser button
 * (buildCalendarTemplateImage below) and the scheduled post's HTML route
 * (app/api/econ-snapshot-html). They used to hold the same filter twice with a
 * comment asking whoever edited one to remember the other; this is that comment
 * made unnecessary.
 */
export function pickSnapshotEarnings(rows: EarnRow[], today = etToday()): EarnRow[] {
  return rows
    .filter((r) => r.date === today)
    .filter(isSnapshotEarning)
    .sort((a, b) => (Number(b.market_cap) || 0) - (Number(a.market_cap) || 0));
}

function todayLong() {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });
}

function fmtTime(ev: CalEvent): string {
  return ev.time_formatted || ev.time || "TBD";
}

/**
 * The White House feed writes every entry as "The President <verb>s …", so the
 * lane repeated its own panel title once per row and spent ~14 characters of a
 * narrow column saying nothing. Drop the subject, keep the action.
 *
 * NOT stripped when the subject is compound ("The President and the First Lady
 * host …") — that would leave a dangling "and …".
 */
function stripPresidentSubject(title: string): string {
  const s = (title || "").trim();
  const m = s.match(/^(?:the\s+)?president(?:\s+trump)?\s+(?!and\b)(.+)$/i);
  if (!m) return s;
  const rest = m[1].trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function includeTemplateEvent(ev: CalEvent): boolean {
  // Match the home panel's default all-USD scope — quiet days (only Low-impact
  // USD prints, e.g. CB Leading Index) were rendering empty even though the
  // panel showed the events.
  return ev.impact === "President" || (ev.country === "USD" && ev.impact !== "Holiday");
}

const HEADLINE_PRIORITY_RULES: Array<{ rank: number; rules: RegExp[] }> = [
  {
    rank: 1,
    rules: [
      /\b(nonfarm payrolls?|nfp|unemployment rate|average hourly earnings|hourly earnings)\b/i,
    ],
  },
  {
    rank: 2,
    rules: [
      /\b(cpi|consumer price index|headline cpi|core cpi)\b/i,
    ],
  },
  {
    rank: 3,
    rules: [
      /\b(fomc|fed rate decision|federal funds rate|powell|dot plot|rate decision)\b/i,
    ],
  },
  {
    rank: 4,
    rules: [
      /\b(gdp|gross domestic product|advance gdp|second estimate|third estimate)\b/i,
    ],
  },
  {
    rank: 5,
    rules: [
      /\b(ppi|producer price index)\b/i,
    ],
  },
  {
    rank: 6,
    rules: [
      /\b(ism manufacturing|manufacturing pmi)\b/i,
    ],
  },
  {
    rank: 7,
    rules: [
      /\b(ism services|services pmi|non-manufacturing pmi)\b/i,
    ],
  },
  {
    rank: 8,
    rules: [
      /\b(retail sales)\b/i,
    ],
  },
  {
    rank: 9,
    rules: [
      /\b(adp|private payrolls?)\b/i,
    ],
  },
  {
    rank: 10,
    rules: [
      /\b(initial jobless claims|jobless claims)\b/i,
    ],
  },
  {
    rank: 11,
    rules: [
      /\b(pce|personal consumption expenditures)\b/i,
    ],
  },
  {
    rank: 12,
    rules: [
      /\b(durable goods)\b/i,
    ],
  },
  {
    rank: 13,
    rules: [
      /\b(industrial production)\b/i,
    ],
  },
  {
    rank: 14,
    rules: [
      /\b(housing starts|building permits)\b/i,
    ],
  },
  {
    rank: 15,
    rules: [
      /\b(existing home sales)\b/i,
    ],
  },
  {
    rank: 16,
    rules: [
      /\b(jolts|job openings)\b/i,
    ],
  },
  {
    rank: 17,
    rules: [
      /\b(consumer confidence|michigan sentiment|consumer sentiment)\b/i,
    ],
  },
  {
    rank: 18,
    rules: [
      /\b(factory orders)\b/i,
    ],
  },
  {
    rank: 19,
    rules: [
      /\b(trade balance)\b/i,
    ],
  },
  {
    rank: 20,
    rules: [
      /\b(ecb|boe|bank of england|bank of canada|boj|snb|rba|riksbank|central bank|global cpi|global gdp|global pmi|major global cpi|major global gdp|major global pmi)\b/i,
    ],
  },
];

function headlinePriorityIndex(ev: CalEvent): number {
  const haystack = `${ev.title} ${ev.country} ${ev.impact}`.toLowerCase();
  const match = HEADLINE_PRIORITY_RULES.find((group) => group.rules.some((rule) => rule.test(haystack)));
  return match?.rank ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Optical-centering correction for text inside a pill. THE rule to understand
 * before touching any pill CSS in this file:
 *
 * html2canvas puts the text baseline at (content-box top + font ascent) and
 * ignores line-height's half-leading, which a real browser uses to centre the
 * glyphs in the line box. Consequences, both of which we hit for real:
 *   - height:56px + line-height:54px  -> the 54px of leading is discarded, text
 *     rides HIGH against the top of the box.
 *   - line-height:1                   -> ascent (~0.97em) nearly fills the box,
 *     text sits LOW.
 * Neither centres. So we centre it ourselves: keep line-height:1 (predictable
 * box height) and shift padding from the top to the bottom.
 *
 * Offset works out to about (2*ascent - capHeight - fontSize)/2. For Inter
 * (ascent 0.969em, cap 0.727em) that is ~0.108em; for the Arial/Helvetica
 * fallback (0.905 / 0.716) it is ~0.046em. The snapshot renders in an iframe
 * written via document.write, which does NOT inherit the parent's @font-face,
 * so the real font is likely the fallback — 0.08em splits the difference and
 * lands within a pixel either way at these sizes.
 *
 * If text looks HIGH, lower this. If it looks LOW, raise it. One number, every
 * pill.
 *
 * MEASURED, not derived. The formula above predicts ~0.05em, but a real render
 * disagreed badly: in the HIGH/MEDIUM/LOW pills the gap above the glyphs was
 * 16px and the gap below 3px (at scale 1.5), i.e. the text sat ~4.7 CSS px too
 * LOW. So this is tuned from that render rather than from the model — the model
 * is a useful explanation of the mechanism, not a reliable predictor of the
 * magnitude. If the pills drift again, re-measure the same way (find the pill's
 * border rows, then the glyph rows inside them, and compare the two gaps) and
 * adjust; don't re-derive from font metrics.
 */
export const PILL_NUDGE_EM = 0.42;

/**
 * ...AND IT IS MEASURED PER RENDERER, because the magnitude depends on the FONT
 * that actually resolves, not on the markup.
 *
 * The iframe path (the 📅 button) runs on a desktop browser, where
 * 'Inter','Helvetica Neue',Arial,sans-serif lands on Arial. Headless Chromium in
 * the Docker image has neither Inter nor Helvetica Neue and resolves the stack
 * differently, to a face with a taller ascent — same markup, same html2canvas,
 * glyphs ~3.3px higher in the pill. Measured off a real posted PNG: 4px of gap
 * above the glyphs and 14px below, at scale 1.5.
 *
 * So the nudge is an ARGUMENT with the browser value as the default. Callers
 * that render somewhere else pass their own; app/api/econ-snapshot-html does.
 * Re-measure the same way if either render drifts — find the pill's border rows,
 * then the glyph rows inside them, and compare the two gaps. Do not re-derive
 * from font metrics; the model predicts the mechanism, not the magnitude.
 */
export const PILL_NUDGE_EM_HEADLESS = 0.08;

function makeNudge(nudgeEm: number) {
  return (fontSize: number): number => Math.round(nudgeEm * fontSize);
}

const EARN_GROUP_LABEL: Record<EarnRow["session"], string> = {
  pre: "Premarket",
  after: "After hours",
  // /proxy/earnings-week reports session:"unknown" when the provider hasn't
  // confirmed the slot yet. These used to be filtered into oblivion — only
  // "pre" and "after" were rendered — so a name like AMZN could be in today's
  // feed and simply never appear on the snapshot. Give them their own group
  // rather than guessing a session or dropping them.
  unknown: "Time TBD",
};

export interface SnapshotOptions {
  /**
   * Vertical optical-centring nudge for every pill, in em. Defaults to the
   * browser-measured value; pass PILL_NUDGE_EM_HEADLESS from a Node/Chromium
   * render. See the constants above.
   */
  pillNudgeEm?: number;
}

/**
 * Rank for the "which rows make the cut" pass — LOWER is more important.
 * High prints first (in HEADLINE_PRIORITY_RULES order), then presidential items
 * about the economy / trade / the Fed, then Medium prints, then other
 * presidential items, then Low prints, and gaggles / travel / photo-ops last.
 */
const PRES_MARKET = /\b(econom\w*|trade|tariff\w*|fed(eral reserve)?|jobs?|inflation|tax\w*|budget|treasury|china|executive order|sign\w*|address|speech|remarks|bill|deal|sanction\w*|oil|energy)\b/i;
const PRES_FLUFF = /\b(gaggle|depart\w*|arriv\w*|travel\w*|lunch|dinner|photo|marine one|air force one|motorcade|pool|lid|briefing|en route|returns?)\b/i;

function rankOf(ev: CalEvent): number {
  if (ev.impact === "President") {
    if (PRES_FLUFF.test(ev.title) && !PRES_MARKET.test(ev.title)) return 5;
    return PRES_MARKET.test(ev.title) ? 1 : 3;
  }
  const k = (ev.impact || "").trim().toLowerCase();
  const pri = Math.min(headlinePriorityIndex(ev), 99) / 100;
  if (k.startsWith("high")) return pri;
  if (k.startsWith("med")) return 2 + pri;
  return 4 + pri;
}

type Tier = "h" | "m" | "l" | "p";
function tierOf(ev: CalEvent): Tier {
  if (ev.impact === "President") return "p";
  const k = (ev.impact || "").trim().toLowerCase();
  return k.startsWith("high") ? "h" : k.startsWith("med") ? "m" : "l";
}
const TIER_LABEL: Record<Tier, string> = { h: "High", m: "Med", l: "Low", p: "POTUS" };

/** Text is data. It goes into an HTML string, so it gets escaped. */
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// html2canvas has no text-overflow:ellipsis — clip in JS.
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The Voltick bolt mark (brand sheet v3), inline so the render needs no fetch. */
function voltickMark(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="vtbolt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${VT.sky}"/><stop offset="1" stop-color="${VT.accent}"/></linearGradient></defs><path d="M38 2 L12 34 L26 34 L22 49 L52 22 L35 22 Z" fill="url(#vtbolt)"/><line x1="6" y1="56" x2="58" y2="56" stroke="${VT.rail}" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="56" r="8" fill="rgba(47,107,255,0.30)"/><rect x="14" y="52" width="8" height="8" rx="1.6" transform="rotate(45 18 56)" fill="${VT.paper}"/></svg>`;
}

function weekdayLong(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
}
function monthDay(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
}

export function buildSnapshotHTML(
  events: CalEvent[],
  quote: string,
  // Kept for the call sites (the HTML route still passes one); no longer drawn —
  // the CB Edge logo is off the snapshot.
  _logoDataUrl = "",
  earnings: EarnRow[] = [],
  tickerLogos: Record<string, string> = {},
  opts: SnapshotOptions = {},
): string {
  const nudgePx = makeNudge(
    Number.isFinite(opts.pillNudgeEm as number) ? (opts.pillNudgeEm as number) : PILL_NUDGE_EM,
  );
  const today = etToday();

  // ── RULE 1 · ONE LIST, SIZED BY CONTENT ──────────────────────────────────
  const all = events.filter((e) => e.date === today && includeTemplateEvent(e));
  const econTotal = all.filter((e) => e.impact !== "President").length;
  const presTotal = all.length - econTotal;

  // ── RULE 3 · CAP, NEVER CLIP SILENTLY ────────────────────────────────────
  const overflow = all.length > MAX_ROWS;
  const kept = overflow
    ? all.slice().sort((a, b) => rankOf(a) - rankOf(b) || a.time.localeCompare(b.time)).slice(0, MAX_ROWS - 1)
    : all;
  const shown = kept.slice().sort((a, b) => a.time.localeCompare(b.time) || rankOf(a) - rankOf(b));
  const hidden = all.length - shown.length;
  const nRows = shown.length + (hidden > 0 ? 1 : 0);

  // ── RULE 2 · SQUEEZE ─────────────────────────────────────────────────────
  const rowH = Math.max(MIN_ROW_H, Math.min(MAX_ROW_H, Math.floor(LIST_H / Math.max(nRows, 1))));
  const titleSize = Math.max(13, Math.min(20, Math.round(rowH * 0.34)));
  const timeSize = Math.max(12, Math.min(16, Math.round(rowH * 0.28)));
  const fpSize = Math.max(11, Math.min(14, Math.round(rowH * 0.24)));
  const pillH = Math.max(18, Math.min(24, Math.round(rowH * 0.46)));
  const pillSize = Math.max(10, Math.min(12, Math.round(rowH * 0.22)));
  const dot = Math.max(9, Math.min(13, Math.round(rowH * 0.22)));
  const anyFp = shown.some((e) => (e.forecast || e.previous) && e.impact !== "President");
  const fpCol = anyFp ? 92 : 0;
  const titleColW = LEFT_W - 2 * PAD_X - TIME_COL - DOT_COL - fpCol * 2 - TAG_COL - 5 * COL_GAP;
  const titleMax = Math.max(14, Math.floor(titleColW / (titleSize * 0.56)));

  // html2canvas drops line-height's half-leading, so single-line text in a
  // flex/grid-centred cell draws LOW. `lift(fs)` is bottom padding that moves
  // the centred box — and the glyphs — up by the measured nudge. See
  // PILL_NUDGE_EM for how it was measured.
  const lift = (fs: number) => 2 * nudgePx(fs);

  const rows = shown
    .map((ev) => {
      const t = tierOf(ev);
      const title = ev.impact === "President" ? stripPresidentSubject(ev.title) : ev.title;
      const isP = ev.impact === "President";
      const f = !isP && ev.forecast ? `<span class="fp">F ${esc(ev.forecast)}</span>` : "<span></span>";
      const pv = !isP && ev.previous ? `<span class="fp">P ${esc(ev.previous)}</span>` : "<span></span>";
      return `<div class="row"><span class="t">${esc(ev.time ? fmtTime(ev) : "All day")}</span><span class="dot d-${t}"></span><span class="ev">${esc(clip(title, titleMax))}</span>${anyFp ? f + pv : ""}<span class="tag tg-${t}"><span>${TIER_LABEL[t]}</span></span></div>`;
    })
    .join("");
  const moreRow = hidden > 0
    ? `<div class="row more"><span class="t"></span><span class="dot d-more"></span><span class="ev">+${hidden} more today · <b>voltick.io/bzila</b></span></div>`
    : "";
  const railTop = LIST_TOP + Math.round(rowH / 2);
  const railH = Math.max(0, (nRows - 1) * rowH);
  const list = shown.length
    ? `<div class="rail" style="top:${railTop}px;height:${railH}px"></div><div class="tl">${rows}${moreRow}</div>`
    : `<div class="empty"><span>No scheduled economic data or White House events today.</span></div>`;

  // ── Earnings (right pane) ────────────────────────────────────────────────
  const groups = (["pre", "after", "unknown"] as const)
    .map((k) => ({ k, rows: earnings.filter((e) => (k === "unknown" ? e.session !== "pre" && e.session !== "after" : e.session === k)) }))
    .filter((g) => g.rows.length > 0);
  const ernTotal = groups.reduce((a, g) => a + g.rows.length, 0);
  const chipRowsAvail = Math.max(1, Math.floor((ERN_H - groups.length * ERN_GROUP_OVERHEAD) / (CHIP_H + CHIP_GAP)));
  const need = groups.map((g) => Math.ceil(g.rows.length / CHIPS_PER_ROW));
  const alloc = need.map(() => 1);
  let spare = chipRowsAvail - alloc.length;
  while (spare > 0) {
    let best = -1;
    for (let i = 0; i < need.length; i++) {
      const short = need[i] - alloc[i];
      if (short > 0 && (best === -1 || short < need[best] - alloc[best])) best = i;
    }
    if (best === -1) break;
    alloc[best] += 1;
    spare--;
  }
  const chip = (r: EarnRow) => {
    const src = tickerLogos[r.symbol];
    return `<span class="chip">${src ? `<img src="${src}" alt="" />` : ""}<span class="cs">${esc(r.symbol)}</span></span>`;
  };
  const ernHtml = groups.length
    ? groups
        .map((g, i) => {
          const cap = alloc[i] * CHIPS_PER_ROW;
          const fits = g.rows.length <= cap;
          const vis = fits ? g.rows : g.rows.slice(0, cap - 1);
          const extra = fits ? "" : `<span class="chip more"><span class="cs">+${g.rows.length - vis.length}</span></span>`;
          return `<div class="box"><div class="lbl">${EARN_GROUP_LABEL[g.k]} · ${g.rows.length}</div><div class="chips">${vis.map(chip).join("")}${extra}</div></div>`;
        })
        .join("")
    : `<div class="box"><div class="lbl">No earnings today</div></div>`;

  const quoteText = (() => {
    const raw = (quote || "").trim();
    if (!raw) return "";
    let q = raw.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
    let author = "";
    const m = q.match(/\s[-–—]\s([^"-][^-–—]+)$/);
    if (m?.[1]) {
      author = m[1].trim().replace(/^"+|"+$/g, "");
      q = q.slice(0, m.index ?? 0).trim();
    }
    q = clip(q.replace(/^"+|"+$/g, "").trim(), 150);
    return author ? `“${q}” — ${author}` : `“${q}”`;
  })();

  const SANS = `'Inter',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif`;
  const MONO = `'JetBrains Mono',ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace`;
  const subBits = [
    `${econTotal} release${econTotal === 1 ? "" : "s"}`,
    `${presTotal} White House event${presTotal === 1 ? "" : "s"}`,
    "all times ET",
  ];

  // EVERY word is Paper White or a colour that MEANS something (impact, the
  // accent). No grey text anywhere (Brandon, 2026-09-24). No backticks in CSS
  // comments here — see the header.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:${SANS}}
html,body{width:${CANVAS_W}px;height:${CANVAS_H}px;background:${VT.ink}}
#root{width:${CANVAS_W}px;height:${CANVAS_H}px;position:relative;overflow:hidden;background:${VT.ink};color:${VT.paper}}
.lp{position:absolute;left:0;top:0;bottom:0;width:${LEFT_W}px;padding:26px ${PAD_X}px}
.rp{position:absolute;right:0;top:0;bottom:0;width:${CANVAS_W - LEFT_W}px;background:${VT.panel};border-left:1px solid ${VT.line};padding:26px 26px}
.brand{display:flex;align-items:center;height:32px}
.brand svg{display:block;margin-right:10px}
.wm{font-weight:800;font-size:19px;line-height:1;color:${VT.paper};padding-bottom:${lift(19)}px}
.wm b{color:${VT.accent};font-weight:800}
.eyebrow{font-weight:700;font-size:11px;line-height:1;letter-spacing:.14em;text-transform:uppercase;color:${VT.paper}}
.brand .eyebrow{margin-left:16px;padding-bottom:${lift(11)}px}
.h1{font-weight:900;font-size:40px;line-height:1;margin-top:14px;white-space:nowrap;color:${VT.paper}}
.h1 span{color:${VT.accentText}}
.sub{font-weight:600;font-size:15px;line-height:1;margin-top:10px;color:${VT.paper}}
.rail{position:absolute;left:${PAD_X + TIME_COL + COL_GAP + DOT_COL / 2 - 1}px;width:2px;background:${VT.line}}
.tl{position:absolute;left:${PAD_X}px;width:${LEFT_W - 2 * PAD_X}px;top:${LIST_TOP}px}
.row{display:grid;grid-template-columns:${TIME_COL}px ${DOT_COL}px 1fr${anyFp ? ` ${fpCol}px ${fpCol}px` : ""} ${TAG_COL}px;column-gap:${COL_GAP}px;align-items:center;height:${rowH}px;border-bottom:1px solid ${VT.lineSoft}}
.row.more{grid-template-columns:${TIME_COL}px ${DOT_COL}px 1fr;border-bottom:0}
.t{font-family:${MONO};font-weight:700;font-size:${timeSize}px;line-height:1;padding-bottom:${lift(timeSize)}px;color:${VT.paper};white-space:nowrap}
.dot{display:block;width:${dot}px;height:${dot}px;border-radius:50%;justify-self:center;position:relative}
.d-h{background:${VT.bad}} .d-m{background:${VT.sky}} .d-l{background:${VT.paper}} .d-p{background:${VT.accent}}
.d-more{background:${VT.ink};border:2px solid ${VT.accentText}}
.ev{font-weight:700;font-size:${titleSize}px;line-height:1;padding-bottom:${lift(titleSize)}px;white-space:nowrap;overflow:hidden;color:${VT.paper}}
.more .ev{font-weight:600} .more .ev b{font-family:${MONO};color:${VT.accentText}}
.fp{font-family:${MONO};font-size:${fpSize}px;line-height:1;padding-bottom:${lift(fpSize)}px;color:${VT.paper};white-space:nowrap}
.tag{display:flex;align-items:center;justify-content:center;height:${pillH}px;border-radius:6px;border:1px solid;font-weight:800;font-size:${pillSize}px;letter-spacing:.06em;text-transform:uppercase}
.tag span{display:block;line-height:1;padding-bottom:${lift(pillSize)}px}
.tg-h{color:${VT.bad};border-color:rgba(255,107,122,.45);background:rgba(255,107,122,.12)}
.tg-m{color:${VT.sky};border-color:rgba(127,176,255,.40);background:rgba(127,176,255,.10)}
.tg-l{color:${VT.paper};border-color:rgba(231,236,233,.30);background:rgba(231,236,233,.06)}
.tg-p{color:${VT.accentText};border-color:rgba(47,107,255,.45);background:rgba(47,107,255,.12)}
.empty{position:absolute;left:${PAD_X}px;width:${LEFT_W - 2 * PAD_X}px;top:${LIST_TOP}px;height:${LIST_H}px;display:flex;align-items:center;justify-content:center;border:1px dashed ${VT.line};border-radius:14px;font-size:18px;font-weight:600;color:${VT.paper}}
.empty span{display:block;line-height:1;padding-bottom:${lift(18)}px}
.box{background:${VT.elev};border:1px solid ${VT.line};border-radius:12px;padding:14px;margin-top:14px}
.lbl{font-weight:700;font-size:11px;line-height:1;letter-spacing:.14em;text-transform:uppercase;color:${VT.sky}}
.chips{display:grid;grid-template-columns:repeat(${CHIPS_PER_ROW},1fr);gap:${CHIP_GAP}px;margin-top:10px}
.chip{display:flex;align-items:center;justify-content:center;height:${CHIP_H}px;border-radius:8px;background:${VT.ink};border:1px solid ${VT.line};overflow:hidden}
.chip img{width:18px;height:18px;border-radius:4px;object-fit:contain;display:block;margin-right:6px}
.cs{display:block;font-family:${MONO};font-weight:700;font-size:13px;line-height:1;padding-bottom:${lift(13)}px;color:${VT.paper};white-space:nowrap}
.chip.more{border-style:dashed} .chip.more .cs{color:${VT.accentText}}
.qbox{position:absolute;left:26px;right:26px;bottom:78px;border:1px solid rgba(47,107,255,.3);background:rgba(47,107,255,.06);border-radius:12px;padding:14px}
.qt{font-style:italic;font-weight:500;font-size:15px;line-height:1.4;margin-top:8px;color:${VT.paper}}
.foot{position:absolute;left:26px;right:26px;bottom:26px;display:flex;justify-content:space-between;align-items:center}
.url{font-family:${MONO};font-weight:800;font-size:17px;line-height:1;color:${VT.paper}}
.url b{color:${VT.accentText};font-weight:800}
</style></head><body>
<div id="root">
  <div class="lp">
    <div class="brand">${voltickMark(30)}<span class="wm">Vol<b>tick</b></span><span class="eyebrow">Economic Calendar</span></div>
    <div class="h1">${esc(weekdayLong())}<span>.</span> ${esc(monthDay())}</div>
    <div class="sub">${subBits.join(" · ")}</div>
  </div>
  ${list}
  <div class="rp">
    <div class="eyebrow">Earnings today${ernTotal ? ` · ${ernTotal}` : ""}</div>
    ${ernHtml}
    ${quoteText ? `<div class="qbox"><div class="eyebrow">Quote of the day</div><div class="qt">${esc(quoteText)}</div></div>` : ""}
    <div class="foot"><span class="eyebrow">${esc(todayLong())}</span><span class="url">voltick.io/<b>bzila</b></span></div>
  </div>
</div>
</body></html>`;
}

// ── Off-screen render + capture ───────────────────────────────────────────────

async function renderAndCapture(html: string): Promise<string> {
  // Create hidden iframe
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1280px;height:720px;border:none;visibility:hidden;";
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();

    // Wait for fonts/layout
    await new Promise(r => setTimeout(r, 400));

    const root = doc.getElementById("root") ?? doc.body;
    // Shared engine (lib/snapshot.ts). windowWidth/windowHeight are the one
    // legitimate use of the reflow options in the app: this document really is
    // laid out at a fixed 1280x720 inside an off-screen iframe, so the virtual
    // viewport SHOULD match it. The background used to be a hardcoded #08111f
    // that didn't match the document's own --bg (HOME_THEME.bg), which tinted
    // every transparent gap in the render.
    const { captureToDataUrl } = await import("@/lib/snapshot");
    return await captureToDataUrl(root, {
      scale: 1.5,
      windowWidth: 1280,
      windowHeight: 720,
    });
  } finally {
    document.body.removeChild(iframe);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch today's calendar/quote/earnings data, render the snapshot off-screen,
 * and return it as a PNG data URL. Used by both the Discord button and the
 * clipboard-copy button.
 */
export async function buildCalendarTemplateImage(): Promise<string> {
  // No brand logo fetch: the CB Edge logo is off the snapshot (2026-09-24);
  // the Voltick mark is inline SVG in the template.
  const [calRes, quoteRes, ernRes] = await Promise.all([
    fetch("/api/calendar", { cache: "no-store" }),
    fetch("/api/calendar-quote", { cache: "no-store" }).catch(() => null),
    fetch("/proxy/earnings-week", { cache: "no-store" }).catch(() => null),
  ]);
  const calJson = calRes.ok ? await calRes.json() : {};
  const quoteJson = quoteRes?.ok ? await quoteRes.json() : {};
  const ernJson = ernRes?.ok ? await ernRes.json() : {};

  const events: CalEvent[] = calJson.events ?? [];
  const quote: string = quoteJson.quote ?? "";

  // /proxy/earnings-week returns the whole week — pickSnapshotEarnings keeps
  // today only, $1B+, biggest first. Same call the cron's HTML route makes.
  const allEarn: EarnRow[] = Array.isArray(ernJson.rows) ? ernJson.rows : [];
  const earnings: EarnRow[] = pickSnapshotEarnings(allEarn, etToday());


  // html2canvas can't reliably wait on <img src="/proxy/..."> inside the
  // off-screen iframe, so inline every ticker logo as a data URL up front.
  const tickerLogos: Record<string, string> = {};
  await Promise.all(
    earnings.map(async (r) => {
      try {
        const res = await fetch(
          `/proxy/ticker-logo?sym=${encodeURIComponent(r.symbol.toUpperCase())}&name=${encodeURIComponent(r.company || "")}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const blob = await res.blob();
        if (!blob.type.startsWith("image/") || blob.size === 0) return;
        tickerLogos[r.symbol] = await blobToDataUrl(blob);
      } catch {
        /* chip falls back to the ticker text */
      }
    })
  );

  const html = buildSnapshotHTML(events, quote, "", earnings, tickerLogos);
  return renderAndCapture(html);
}
