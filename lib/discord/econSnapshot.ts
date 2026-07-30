/**
 * Economic Calendar snapshot template.
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

import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { captureToDataUrl } from "@/lib/snapshot";

// Single source of truth for the snapshot palette — dashboard theme, no ad-hoc hex.
const HT = {
  bg: HOME_THEME.bg,
  panelBg: HOME_THEME.panelBg,
  border: HOME_THEME.border,
  cyan: HOME_THEME.cyan,
  green: HOME_THEME.green,
  red: HOME_THEME.red,
  orange: HOME_THEME.orange,
  text: HOME_THEME.text,
  muted: "#b8c2d6",
} as const;

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

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

function todayLong() {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });
}

function fmtTime(ev: CalEvent): string {
  return ev.time_formatted || ev.time || "TBD";
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

function impactBadge(impact: string): { bg: string; border: string; text: string } {
  if (impact === "High") return { bg: hexA(HT.red, 0.16), border: hexA(HT.red, 0.4), text: HT.red };
  if (impact === "Medium") return { bg: hexA(HT.orange, 0.16), border: hexA(HT.orange, 0.4), text: HT.orange };
  return { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)", text: HT.muted };
}

function dash(v?: string): string {
  const s = (v || "").trim();
  return s ? s : "–";
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
const PILL_NUDGE_EM = 0.42;

function nudgePx(fontSize: number): number {
  return Math.round(PILL_NUDGE_EM * fontSize);
}

// Fewer rows in a lane -> bigger type (fills the panel); more rows -> smaller
// type (keeps everything on-canvas). 6 rows is the "neutral" baseline: a light
// day (4-5 events) should read BIG rather than leave the panel half empty.
function densityScale(n: number): number {
  const s = 1 + (6 - n) * 0.07;
  return Math.max(0.85, Math.min(1.25, s));
}

// Earnings lane mirrors the /economic-calendar page: two labelled groups
// (Premarket / After hours), each a wrapped strip of logo + ticker chips.
// No company name, no market cap — the ticker IS the information.
function earnChipsHTML(rows: EarnRow[], logos: Record<string, string>): string {
  return rows.map(r => {
    const src = logos[r.symbol];
    const art = src
      ? `<img src="${src}" alt="${r.symbol}" />`
      : `<span class="chip-fb">${r.symbol.slice(0, 4)}</span>`;
    return `
      <div class="ern-chip">
        <span class="chip-logo">${art}</span>
        <span class="chip-sym">${r.symbol}</span>
      </div>`;
  }).join("");
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

function earnGroupHTML(kind: EarnRow["session"], rows: EarnRow[], logos: Record<string, string>): string {
  if (rows.length === 0) return "";
  return `
    <div class="ern-group">
      <div class="ern-group-label">${EARN_GROUP_LABEL[kind]}</div>
      <div class="ern-chips">${earnChipsHTML(rows, logos)}</div>
    </div>`;
}

export function buildSnapshotHTML(
  events: CalEvent[],
  quote: string,
  logoDataUrl = "",
  earnings: EarnRow[] = [],
  tickerLogos: Record<string, string> = {},
): string {
  const today = etToday();
  const todayEvents = events
    .filter(e => e.date === today && includeTemplateEvent(e))
    .sort((a, b) => {
      const priorityDiff = headlinePriorityIndex(a) - headlinePriorityIndex(b);
      return priorityDiff !== 0 ? priorityDiff : a.time.localeCompare(b.time);
    });

  // Presidential schedule is its own lane — never mixed into the economic
  // calendar table (different kind of event entirely).
  const economicEvents = todayEvents.filter(e => e.impact !== "President").slice(0, 8);
  const presidentEvents = todayEvents
    .filter(e => e.impact === "President")
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 6);

  // Panel badges are plain counts — a "% of today's events" figure told you
  // nothing and just looked like a stat.
  const econCount = economicEvents.length;
  const presCount = presidentEvents.length;

  const presScale = densityScale(Math.max(presidentEvents.length, 1));
  const econScale = densityScale(Math.max(economicEvents.length, 1));
  const px = (base: number, scale: number) => Math.round(base * scale);

  const presTimeSize = px(15, presScale);
  const presTitleSize = px(16, presScale);
  const presRowPadV = px(14, presScale);
  const presTimeCol = px(92, presScale);
  const presTitleCol = presTimeCol;

  // Header labels must fit econNumCol (58 * scale ~= 62px). Bold uppercase runs
  // about 0.72em per glyph, so "FORECAST"/"PREVIOUS" need ~67px and collided
  // with their neighbour — hence "Fcst"/"Prev" in the markup below. The data in
  // those columns ("216K", "12.7") was never the problem, so the columns stay
  // narrow and the Event column keeps the width instead.
  const econHeadSize = px(10, econScale);
  const econTimeSize = px(14, econScale);
  const econEventSize = px(16, econScale);
  const econNumSize = px(15, econScale);
  const econRowPadV = px(12, econScale);
  const pillFontSize = px(11, econScale);
  const pillHeight = px(22, econScale);
  const pillPadH = px(10, econScale);
  const pillPadV = Math.max(0, Math.round((pillHeight - pillFontSize) / 2));
  const pillNudge = nudgePx(pillFontSize);
  // Height-preserving: whatever the nudge, top + bottom padding always sums to
  // 2 * pillPadV, so tuning the centring can never change the pill's size.
  // (The old form added the nudge to the bottom without taking it off the top
  // once padTop hit the Math.max(0) floor, so a large nudge silently grew the
  // pill.)
  const pillPadTop = Math.max(0, pillPadV - pillNudge);
  const pillPadBot = Math.max(0, 2 * pillPadV - pillPadTop);
  const econTimeCol = px(74, econScale);
  const econImpactCol = px(74, econScale);
  const econNumCol = px(58, econScale);
  const econColGap = 6;
  const econRowPadH = 14;

  // html2canvas does NOT implement text-overflow:ellipsis and treats
  // overflow:hidden on text nodes unreliably — long titles bleed out from under
  // the Event cell and run beneath the impact pill. So truncate in JS against
  // the measured column width instead of trusting CSS to clip.
  // 1280 canvas - 60 snapshot padding - 36 grid gaps = 1184 across 6.3fr;
  // the econ panel is 3.6fr of that.
  const ECON_PANEL_W = Math.round((1280 - 60 - 36) * (3.6 / 6.3));
  const econEventColW = Math.max(
    120,
    ECON_PANEL_W - econRowPadH * 2 - econTimeCol - econImpactCol - econNumCol * 3 - econColGap * 5
  );
  const econMaxChars = Math.max(12, Math.floor(econEventColW / (econEventSize * 0.56)));
  const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

  const formattedQuote = (() => {
    const raw = (quote || "").trim();
    if (!raw) return "";
    let q = raw.replace(/[""]/g, '"').replace(/['']/g, "'").trim();
    let author = "";
    const m = q.match(/\s[-–—]\s([^"-][^-–—]+)$/);
    if (m) { author = m[1].trim().replace(/^"+|"+$/g, ""); q = q.slice(0, m.index ?? 0).trim(); }
    q = q.replace(/^"+|"+$/g, "").trim();
    return author ? `"${q}" - ${author}` : `"${q}"`;
  })();

  const econRowsHTML = economicEvents.map(ev => {
    const badge = impactBadge(ev.impact);
    return `
    <div class="econ-row">
      <div class="ec-time">${fmtTime(ev)}</div>
      <div class="ec-event">${clipText(ev.title, econMaxChars)}</div>
      <div class="ec-impact"><span class="impact-pill" style="background:${badge.bg};border-color:${badge.border};color:${badge.text}"><span class="pill-inner-04">${ev.impact}</span></span></div>
      <div class="ec-num">${dash(ev.actual)}</div>
      <div class="ec-num">${dash(ev.forecast)}</div>
      <div class="ec-num">${dash(ev.previous)}</div>
    </div>`;
  }).join("");

  // Presidential titles were rendered raw, and the White House feed writes long
  // ones ("The President greets the White House Internship Program Summer
  // Class"). At this column width that wraps to eight lines, the rows push past
  // the panel, and the last event is sliced off the bottom. Same treatment as
  // .ec-event above — clip in JS against the measured column width, because
  // html2canvas implements neither text-overflow:ellipsis nor line-clamp.
  // 1280 canvas - 60 snapshot padding - 36 grid gaps = 1184 across 6.3fr; the
  // presidential panel is 1.3fr of that.
  const PRES_PANEL_W = Math.round((1280 - 60 - 36) * (1.3 / 6.3));
  const presTitleColW = Math.max(90, PRES_PANEL_W - 14 * 2 - 6 * 2 - presTitleCol - 12);
  const PRES_TITLE_LINES = 2;
  const presMaxChars = Math.max(
    18,
    Math.floor((presTitleColW / (presTitleSize * 0.56)) * PRES_TITLE_LINES),
  );

  const presRowsHTML = presidentEvents.map(ev => `
    <div class="pres-row">
      <div class="pr-time">${fmtTime(ev)}</div>
      <div class="pr-title">${clipText(ev.title, presMaxChars)}</div>
    </div>
  `).join("");

  const preRows = earnings.filter(e => e.session === "pre").slice(0, 12);
  const afterRows = earnings.filter(e => e.session === "after").slice(0, 12);
  // Anything the feed hasn't assigned a session to. Rendered in its own group so
  // it can't vanish — see EARN_GROUP_LABEL.unknown.
  const tbdRows = earnings
    .filter(e => e.session !== "pre" && e.session !== "after")
    .slice(0, 12);
  // Count what is actually ON the image, so the badge can never claim more (or
  // fewer) names than you can see.
  const ernCount = preRows.length + afterRows.length + tbdRows.length;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
:root{--bg:${HT.bg};--panelBg:${HT.panelBg};--border:${HT.border};--cyan:${HT.cyan};--green:${HT.green};--red:${HT.red};--orange:${HT.orange};--text:${HT.text};--muted:${HT.muted};--lblue:${LIGHT_BLUE}}
*{box-sizing:border-box;margin:0;padding:0}
/* Fixed 1280x720 — height is LOCKED, not min-height. Anything that overflows
   must shrink (see densityScale), never push the canvas taller. */
body{width:1280px;height:720px;display:grid;place-items:center;padding:24px;color:var(--text);font-family:'Inter','Helvetica Neue',Arial,sans-serif;background:var(--bg)}
.snapshot{width:1280px;height:672px;display:flex;flex-direction:column;position:relative;overflow:hidden;border-radius:24px;background:radial-gradient(circle at 15% 50%,${hexA(HT.cyan, 0.06)} 0%,transparent 50%),radial-gradient(circle at 85% 30%,rgba(18,103,131,0.07) 0%,transparent 50%),var(--bg);border:1px solid var(--border);padding:26px 30px 30px}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-shrink:0}
/* Every pill: line-height:1 + ASYMMETRIC vertical padding (bottom > top). See
   PILL_NUDGE_EM above for why — html2canvas ignores half-leading, so neither a
   tall line-height nor symmetric padding centres the text. Do not "simplify"
   these to inline-flex + align-items:center (html2canvas ignores that too), do
   not reintroduce height + tall line-height, and do not even out the padding.
   Box heights are unchanged: top + bottom still sum to the old 2x value. */
.badge{display:inline-block;line-height:1;background:${hexA(HT.cyan, 0.12)};border:1px solid ${hexA(HT.cyan, 0.4)};color:var(--cyan);padding:${16 - nudgePx(24)}px 26px ${16 + nudgePx(24)}px;font-size:24px;font-weight:800;border-radius:10px;text-transform:uppercase;text-align:center}
.badge-inner{display:inline-block;letter-spacing:0.07em;margin-right:-0.07em}
.date-group{display:flex;gap:10px;align-items:center}
.date-pill{display:inline-block;line-height:1;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:8px;padding:${12 - nudgePx(16)}px 18px ${12 + nudgePx(16)}px;font-weight:800;text-transform:uppercase;font-size: 17px;text-align:center}
.today-pill{display:inline-block;line-height:1;background:${hexA(HT.cyan, 0.16)};border:1px solid ${hexA(HT.cyan, 0.4)};color:var(--cyan);border-radius:8px;padding:${12 - nudgePx(16)}px 18px ${12 + nudgePx(16)}px;font-weight:800;text-transform:uppercase;font-size: 17px;text-align:center}
.pill-inner-06{display:inline-block;letter-spacing:0.06em;margin-right:-0.06em}
.quote{margin:22px auto 6px;text-align:center;font-family:Georgia,"Times New Roman",serif;font-size:30px;font-style:italic;color:var(--muted);padding:0 36px;max-width:1120px;flex-shrink:0}
/* Econ lane is widened (3.3fr -> 3.6fr) because the Event column was the
   tightest thing on the canvas — titles like "Philly Fed Manufacturing Index"
   had ~200px to live in. Keep the fr total at 6.3 or update ECON_PANEL_W. */
.grid{display:grid;grid-template-columns:1.3fr 3.6fr 1.4fr;gap:18px;margin-top:20px;flex:1;min-height:0}
/* THE card surface (classicCardAccentStyle): frosted fill, hairline edge, faint
   light-blue radial glow, 18px radius. NO per-card accent strip, NO colored
   panel titles — see PageCard.tsx. */
.panel{border-radius:18px;border:1px solid var(--border);background:radial-gradient(circle at 50% 0%,rgba(126,211,252,0.10) 0%,transparent 60%),var(--panelBg);box-shadow:0 18px 40px rgba(0,0,0,0.22);overflow:hidden;height:100%;display:flex;flex-direction:column}
.panel-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0}
.panel-title{font-size: 14px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);line-height:1}
/* Count bubble — same nudged-padding rule as the topbar pills. It kept the old
   height+line-height form by oversight and sat top-heavy for it. */
.panel-pct{display:inline-block;line-height:1;min-width:24px;text-align:center;font-size: 14px;font-weight:800;color:var(--lblue);background:rgba(126,211,252,0.10);border-radius:8px;padding:${6 - nudgePx(13)}px 9px ${6 + nudgePx(13)}px}
.ern-body{display:flex;flex-direction:column;flex:1}
.ern-group{padding:14px 16px;border-bottom:1px solid var(--border);flex:1}
.ern-group:last-child{border-bottom:none}
.ern-group-label{font-size: 12px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--cyan);margin-bottom:12px;line-height:1}
.ern-chips{display:flex;flex-wrap:wrap;gap:12px}
.ern-chip{width:48px;text-align:center;flex-shrink:0}
.chip-logo{display:block;width:36px;height:36px;margin:0 auto 5px;border-radius:8px;overflow:hidden}
.chip-logo img{width:36px;height:36px;object-fit:contain;display:block}
/* Ticker fallback chip — same nudged-padding rule; 36px box matches the logos. */
.chip-fb{display:block;width:36px;height:36px;line-height:1;padding:${13 - nudgePx(10)}px 0 ${13 + nudgePx(10)}px;text-align:center;border-radius:8px;background:rgba(33,158,188,0.10);border:1px solid var(--border);font-size:10px;font-weight:800;color:var(--cyan)}
/* Same trap as .ec-event: overflow:hidden + a tight line-height made
   html2canvas shear the bottom off every ticker (NFLX rendered as "NFLY").
   No clipping, and leading to spare. Tickers are <=5 chars — they fit. */
.chip-sym{display:block;font-size: 12px;font-weight:800;color:var(--text);letter-spacing:0.02em;line-height:15px;white-space:nowrap}
.pres-body{padding:8px 14px;flex:1;display:flex;flex-direction:column}
.pres-row{display:grid;grid-template-columns:${presTimeCol}px 1fr;gap:12px;padding:${presRowPadV}px 6px;border-bottom:1px solid var(--border);flex:1;align-content:center;min-width:0}
.pres-row:last-child{border-bottom:none}
.pr-time{color:var(--lblue);font-weight:700;font-size:${presTimeSize}px}
.pr-title{font-size:${presTitleSize}px;font-weight:600;line-height:1.3;min-width:0}
.empty-panel{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:rgba(255,255,255,0.35);font-size:14px}
.econ-table{display:flex;flex-direction:column;flex:1}
.econ-row{display:grid;grid-template-columns:${econTimeCol}px 1fr ${econImpactCol}px ${econNumCol}px ${econNumCol}px ${econNumCol}px;gap:${econColGap}px;padding:${econRowPadV}px ${econRowPadH}px;align-items:center;border-bottom:1px solid var(--border);flex:1;min-width:0}
.econ-row:last-child{border-bottom:none}
/* Tracking trimmed 0.06 -> 0.04em for the same reason econHeadSize dropped to
   10: every 0.01em costs ~1px across "FORECAST" and pushes it into the next
   column. nowrap so a tight fit never silently becomes two lines. */
.econ-row.head{background:rgba(255,255,255,0.03);font-size:${econHeadSize}px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.45);flex:0 0 auto;white-space:nowrap}
/* Every cell carries an explicit line-height with leading to spare. Without it
   html2canvas draws the glyphs low inside a line box it measured as "normal"
   and the descenders get sheared off by the row's overflow. */
.ec-time{font-size:${econTimeSize}px;line-height:${econTimeSize + 8}px;font-weight:700;color:var(--muted);white-space:nowrap}
/* NO overflow:hidden here. Titles are already truncated in JS (see clipText),
   so clipping earns nothing — and html2canvas measures this box slightly short
   and shears the bottom off every glyph, which is exactly the "words cut off"
   bug. The Presidential lane has never had overflow:hidden and has never
   clipped; that is the control group. Do not add it back. */
.ec-event{font-size:${econEventSize}px;line-height:${econEventSize + 8}px;font-weight:600;white-space:nowrap;min-width:0}
.ec-num{font-size:${econNumSize}px;line-height:${econNumSize + 8}px;font-weight:700;text-align:right;color:var(--text);white-space:nowrap}
.ec-impact{text-align:left;min-width:0}
.impact-pill{display:inline-block;line-height:1;text-align:center;border:1px solid;border-radius:8px;padding:${pillPadTop}px ${pillPadH}px ${pillPadBot}px;font-size:${pillFontSize}px;font-weight:800;text-transform:uppercase;white-space:nowrap}
.pill-inner-04{display:inline-block;letter-spacing:0.04em;margin-right:-0.04em}
.logo-wrap{position:absolute;bottom:18px;right:22px;display:flex;align-items:center;justify-content:flex-end;opacity:0.96}
.logo-wrap img{width:80px;height:80px;object-fit:contain}
</style></head><body>
<div class="snapshot" id="root">
  <div class="topbar">
    <div class="badge"><span class="badge-inner">Economic Calendar</span></div>
    <div class="date-group">
      <div class="date-pill"><span class="pill-inner-06">${todayLong()}</span></div>
      <div class="today-pill"><span class="pill-inner-06">TODAY</span></div>
    </div>
  </div>
  ${formattedQuote ? `<div class="quote">${formattedQuote}</div>` : ""}
  <div class="grid">
    <div class="panel pres">
      <div class="panel-head">
        <div class="panel-title">Presidential Schedule</div>
        <div class="panel-pct">${presCount}</div>
      </div>
      ${presidentEvents.length > 0 ? `<div class="pres-body">${presRowsHTML}</div>` : `<div class="empty-panel">No political events today</div>`}
    </div>
    <div class="panel econ">
      <div class="panel-head">
        <div class="panel-title">Economic Calendar</div>
        <div class="panel-pct">${econCount}</div>
      </div>
      ${economicEvents.length > 0 ? `
      <div class="econ-table">
        <div class="econ-row head">
          <div>Time</div><div>Event</div><div>Impact</div><div style="text-align:right">Actual</div><div style="text-align:right">Fcst</div><div style="text-align:right">Prev</div>
        </div>
        ${econRowsHTML}
      </div>` : `<div class="empty-panel">No economic events today</div>`}
    </div>
    <div class="panel ern">
      <div class="panel-head">
        <div class="panel-title">Earnings</div>
        <div class="panel-pct">${ernCount}</div>
      </div>
      ${ernCount > 0 ? `<div class="ern-body">
        ${earnGroupHTML("pre", preRows, tickerLogos)}
        ${earnGroupHTML("after", afterRows, tickerLogos)}
        ${earnGroupHTML("unknown", tbdRows, tickerLogos)}
      </div>` : `<div class="empty-panel">No earnings today</div>`}
    </div>
  </div>
  ${logoDataUrl ? `
  <div class="logo-wrap">
    <img src="${logoDataUrl}" alt="Logo" />
  </div>` : ""}
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
  const [calRes, quoteRes, logoRes, ernRes] = await Promise.all([
    fetch("/api/calendar", { cache: "no-store" }),
    fetch("/api/calendar-quote", { cache: "no-store" }).catch(() => null),
    fetch("/cb-edge-square.png", { cache: "no-store" }).catch(() => null),
    fetch("/proxy/earnings-week", { cache: "no-store" }).catch(() => null),
  ]);
  const calJson = calRes.ok ? await calRes.json() : {};
  const quoteJson = quoteRes?.ok ? await quoteRes.json() : {};
  const ernJson = ernRes?.ok ? await ernRes.json() : {};

  const events: CalEvent[] = calJson.events ?? [];
  const quote: string = quoteJson.quote ?? "";

  // /proxy/earnings-week returns the whole week — keep today only, biggest first.
  const today = etToday();
  const allEarn: EarnRow[] = Array.isArray(ernJson.rows) ? ernJson.rows : [];
  const earnings: EarnRow[] = allEarn
    .filter(r => r.date === today)
    .sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));

  let logoDataUrl = "";
  if (logoRes?.ok) logoDataUrl = await blobToDataUrl(await logoRes.blob());

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

  const html = buildSnapshotHTML(events, quote, logoDataUrl, earnings, tickerLogos);
  return renderAndCapture(html);
}
