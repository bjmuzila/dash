"use client";

/**
 * EconCalendarDiscordBtn
 *
 * Renders the snapshot-template-example.html CSS layout off-screen,
 * populated with live /api/calendar + /api/calendar-quote data,
 * then html2canvas's it and posts to Discord.
 */

import { useState, useCallback } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";

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
interface EarnRow {
  date: string;                 // YYYY-MM-DD (ET)
  symbol: string;
  company: string;
  session: "pre" | "after" | "unknown";
  market_cap: number;
}

// ── Owner gate (cosmetic — matches DataBox/NavMenu) ───────────────────────────
function useIsOwner(): boolean {
  const { isSignedIn, user } = useAuth();
  const ownerId = process.env.NEXT_PUBLIC_OWNER_USER_ID;
  return ownerId ? user?.id === ownerId : !!isSignedIn;
}

interface CalEvent {
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

type TemplateBtnState = "idle" | "busy" | "ok" | "err";

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

function isHighPriority(ev: CalEvent): boolean {
  return ev.impact === "High" && ev.country === "USD";
}

function includeTemplateEvent(ev: CalEvent): boolean {
  return ev.impact === "President" || (ev.impact === "Medium" && ev.country === "USD") || (ev.impact === "High" && ev.country === "USD");
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

// ── Build the snapshot HTML (matches snapshot-template-example.html CSS) ──────

function impactBadge(impact: string): { bg: string; border: string; text: string } {
  if (impact === "High") return { bg: hexA(HT.red, 0.16), border: hexA(HT.red, 0.4), text: HT.red };
  if (impact === "Medium") return { bg: hexA(HT.orange, 0.16), border: hexA(HT.orange, 0.4), text: HT.orange };
  return { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)", text: HT.muted };
}

function dash(v?: string): string {
  const s = (v || "").trim();
  return s ? s : "–";
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

function earnGroupHTML(kind: "pre" | "after", rows: EarnRow[], logos: Record<string, string>): string {
  if (rows.length === 0) return "";
  return `
    <div class="ern-group">
      <div class="ern-group-label">${kind === "pre" ? "Premarket" : "After hours"}</div>
      <div class="ern-chips">${earnChipsHTML(rows, logos)}</div>
    </div>`;
}

function buildSnapshotHTML(
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

  const econHeadSize = px(11, econScale);
  const econTimeSize = px(14, econScale);
  const econEventSize = px(16, econScale);
  const econNumSize = px(15, econScale);
  const econRowPadV = px(12, econScale);
  const pillFontSize = px(11, econScale);
  const pillHeight = px(22, econScale);
  const pillPadH = px(10, econScale);
  const econTimeCol = px(80, econScale);
  const econImpactCol = px(80, econScale);
  const econNumCol = px(66, econScale);

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
      <div class="ec-event">${ev.title}</div>
      <div class="ec-impact"><span class="impact-pill" style="background:${badge.bg};border-color:${badge.border};color:${badge.text}"><span class="pill-inner-04">${ev.impact}</span></span></div>
      <div class="ec-num">${dash(ev.actual)}</div>
      <div class="ec-num">${dash(ev.forecast)}</div>
      <div class="ec-num">${dash(ev.previous)}</div>
    </div>`;
  }).join("");

  const presRowsHTML = presidentEvents.map(ev => `
    <div class="pres-row">
      <div class="pr-time">${fmtTime(ev)}</div>
      <div class="pr-title">${ev.title}</div>
    </div>
  `).join("");

  const preRows = earnings.filter(e => e.session === "pre").slice(0, 12);
  const afterRows = earnings.filter(e => e.session === "after").slice(0, 12);
  const ernCount = preRows.length + afterRows.length;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
:root{--bg:${HT.bg};--panelBg:${HT.panelBg};--border:${HT.border};--cyan:${HT.cyan};--green:${HT.green};--red:${HT.red};--orange:${HT.orange};--text:${HT.text};--muted:${HT.muted};--lblue:${LIGHT_BLUE}}
*{box-sizing:border-box;margin:0;padding:0}
/* Fixed 1280x720 — height is LOCKED, not min-height. Anything that overflows
   must shrink (see densityScale), never push the canvas taller. */
body{width:1280px;height:720px;display:grid;place-items:center;padding:24px;color:var(--text);font-family:'Inter','Helvetica Neue',Arial,sans-serif;background:var(--bg)}
.snapshot{width:1280px;height:672px;display:flex;flex-direction:column;position:relative;overflow:hidden;border-radius:24px;background:radial-gradient(circle at 15% 50%,${hexA(HT.cyan, 0.06)} 0%,transparent 50%),radial-gradient(circle at 85% 30%,rgba(18,103,131,0.07) 0%,transparent 50%),var(--bg);border:1px solid var(--border);padding:26px 30px 30px}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-shrink:0}
/* html2canvas does NOT vertically center flex text — it renders on the normal
   baseline, which is why pills looked top-heavy. Every pill below is an
   inline-block whose line-height == its inner height. Do not "simplify" these
   back to inline-flex + align-items:center. */
.badge{display:inline-block;height:56px;line-height:54px;background:${hexA(HT.cyan, 0.12)};border:1px solid ${hexA(HT.cyan, 0.4)};color:var(--cyan);padding:0 26px;font-size:24px;font-weight:800;border-radius:10px;text-transform:uppercase;text-align:center}
.badge-inner{display:inline-block;letter-spacing:0.07em;margin-right:-0.07em}
.date-group{display:flex;gap:10px;align-items:center}
.date-pill{display:inline-block;height:40px;line-height:38px;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:8px;padding:0 18px;font-weight:800;text-transform:uppercase;font-size:16px;text-align:center}
.today-pill{display:inline-block;height:40px;line-height:38px;background:${hexA(HT.cyan, 0.16)};border:1px solid ${hexA(HT.cyan, 0.4)};color:var(--cyan);border-radius:8px;padding:0 18px;font-weight:800;text-transform:uppercase;font-size:16px;text-align:center}
.pill-inner-06{display:inline-block;letter-spacing:0.06em;margin-right:-0.06em}
.quote{margin:26px auto 6px;text-align:center;font-family:Georgia,"Times New Roman",serif;font-size:22px;font-style:italic;color:var(--muted);padding:0 36px;max-width:1120px;flex-shrink:0}
.grid{display:grid;grid-template-columns:1.4fr 3.3fr 1.5fr;gap:18px;margin-top:20px;flex:1;min-height:0}
/* THE card surface (classicCardAccentStyle): frosted fill, hairline edge, faint
   light-blue radial glow, 18px radius. NO per-card accent strip, NO colored
   panel titles — see PageCard.tsx. */
.panel{border-radius:18px;border:1px solid var(--border);background:radial-gradient(circle at 50% 0%,rgba(126,211,252,0.10) 0%,transparent 60%),var(--panelBg);box-shadow:0 18px 40px rgba(0,0,0,0.22);overflow:hidden;height:100%;display:flex;flex-direction:column}
.panel-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0}
.panel-title{font-size:13px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);line-height:1}
.panel-pct{display:inline-block;height:24px;line-height:24px;min-width:24px;text-align:center;font-size:13px;font-weight:800;color:var(--lblue);background:rgba(126,211,252,0.10);border-radius:8px;padding:0 9px}
.ern-body{display:flex;flex-direction:column;flex:1}
.ern-group{padding:14px 16px;border-bottom:1px solid var(--border);flex:1}
.ern-group:last-child{border-bottom:none}
.ern-group-label{font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--cyan);margin-bottom:12px;line-height:1}
.ern-chips{display:flex;flex-wrap:wrap;gap:12px}
.ern-chip{width:48px;text-align:center;flex-shrink:0}
.chip-logo{display:block;width:36px;height:36px;margin:0 auto 5px;border-radius:8px;overflow:hidden}
.chip-logo img{width:36px;height:36px;object-fit:contain;display:block}
.chip-fb{display:block;width:36px;height:36px;line-height:34px;text-align:center;border-radius:8px;background:rgba(33,158,188,0.10);border:1px solid var(--border);font-size:10px;font-weight:800;color:var(--cyan)}
.chip-sym{display:block;font-size:11px;font-weight:800;color:var(--text);letter-spacing:0.02em;line-height:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.pres-body{padding:8px 14px;flex:1;display:flex;flex-direction:column}
.pres-row{display:grid;grid-template-columns:${presTimeCol}px 1fr;gap:12px;padding:${presRowPadV}px 6px;border-bottom:1px solid var(--border);flex:1;align-content:center;min-width:0}
.pres-row:last-child{border-bottom:none}
.pr-time{color:var(--lblue);font-weight:700;font-size:${presTimeSize}px}
.pr-title{font-size:${presTitleSize}px;font-weight:600;line-height:1.3;min-width:0}
.empty-panel{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:rgba(255,255,255,0.35);font-size:14px}
.econ-table{display:flex;flex-direction:column;flex:1}
.econ-row{display:grid;grid-template-columns:${econTimeCol}px 1fr ${econImpactCol}px ${econNumCol}px ${econNumCol}px ${econNumCol}px;gap:8px;padding:${econRowPadV}px 14px;align-items:center;border-bottom:1px solid var(--border);flex:1;min-width:0}
.econ-row:last-child{border-bottom:none}
.econ-row.head{background:rgba(255,255,255,0.03);font-size:${econHeadSize}px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.45);flex:0 0 auto}
.ec-time{font-size:${econTimeSize}px;font-weight:700;color:var(--muted);white-space:nowrap}
.ec-event{font-size:${econEventSize}px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ec-num{font-size:${econNumSize}px;font-weight:700;text-align:right;color:var(--text)}
.ec-impact{text-align:left}
.impact-pill{display:inline-block;height:${pillHeight}px;line-height:${pillHeight - 2}px;text-align:center;border:1px solid;border-radius:8px;padding:0 ${pillPadH}px;font-size:${pillFontSize}px;font-weight:800;text-transform:uppercase}
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
          <div>Time</div><div>Event</div><div>Impact</div><div style="text-align:right">Actual</div><div style="text-align:right">Forecast</div><div style="text-align:right">Previous</div>
        </div>
        ${econRowsHTML}
      </div>` : `<div class="empty-panel">No high-impact events today</div>`}
    </div>
    <div class="panel ern">
      <div class="panel-head">
        <div class="panel-title">Earnings</div>
        <div class="panel-pct">${ernCount}</div>
      </div>
      ${ernCount > 0 ? `<div class="ern-body">
        ${earnGroupHTML("pre", preRows, tickerLogos)}
        ${earnGroupHTML("after", afterRows, tickerLogos)}
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

    const { default: html2canvas } = await import("html2canvas");
    const root = doc.getElementById("root") ?? doc.body;
    const canvas = await html2canvas(root, {
      backgroundColor: "#08111f",
      useCORS: true,
      allowTaint: true,
      scale: 1.5,
      logging: false,
      // Tell html2canvas to render inside the iframe's window
      windowWidth: 1280,
      windowHeight: 720,
    });

    return canvas.toDataURL("image/png");
  } finally {
    document.body.removeChild(iframe);
  }
}

async function postToDiscord(imageBase64: string): Promise<void> {
  const now = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
  const content = `📅 **Economic Calendar** — ${today} · ${now} ET`;
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content }));
  const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  form.append("files[0]", new Blob([bytes], { type: "image/png" }), "econ-calendar.png");
  const res = await fetch("/api/discord-share", { method: "POST", body: form });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
}

async function copyImageToClipboard(imageBase64: string): Promise<void> {
  const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "image/png" });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

async function buildCalendarTemplateImage(): Promise<string> {
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

// ── Discord icon ──────────────────────────────────────────────────────────────

function IconDiscord({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function IconCamera({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EconCalendarDiscordBtn() {
  const [s, set] = useState<TemplateBtnState>("idle");
  const isOwner = useIsOwner();

  const run = useCallback(async () => {
    if (s === "busy") return;
    set("busy");
    try {
      const img = await buildCalendarTemplateImage();
      await postToDiscord(img);
      set("ok");
    } catch (e) {
      console.error("[EconCalendarDiscordBtn]", e);
      set("err");
    } finally {
      setTimeout(() => set("idle"), 1800);
    }
  }, [s]);

  // Discord share is owner-only (cosmetic gate).
  if (!isOwner) return null;

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#7289da";
  const statusLabel = s === "busy" ? "..." : s === "ok" ? "OK" : s === "err" ? "ERR" : null;
  const label = s === "busy" ? "…" : s === "ok" ? "✓" : s === "err" ? "✕" : "💬";

  return (
    <button
      onClick={run}
      disabled={s === "busy"}
      title="Share Economic Calendar snapshot to Discord"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        padding: "2px 5px",
        border: `1px solid ${color}40`,
        borderRadius: 2,
        background: "rgba(255,255,255,0.04)",
        color,
        cursor: s === "busy" ? "default" : "pointer",
        fontSize: statusLabel ? 9 : 0, fontWeight: 700, letterSpacing: ".08em",
        fontFamily: "inherit", flexShrink: 0,
        transition: "color .15s, border-color .15s",
      }}
    >
      {statusLabel ?? <IconDiscord />}
    </button>
  );
}

export function EconCalendarTemplateCopyBtn() {
  const [s, set] = useState<TemplateBtnState>("idle");
  const isOwner = useIsOwner();

  const run = useCallback(async () => {
    if (s === "busy") return;
    set("busy");
    try {
      const img = await buildCalendarTemplateImage();
      await copyImageToClipboard(img);
      set("ok");
    } catch (e) {
      console.error("[EconCalendarTemplateCopyBtn]", e);
      set("err");
    } finally {
      setTimeout(() => set("idle"), 1800);
    }
  }, [s]);

  if (!isOwner) return null;

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#a78bfa";
  const statusLabel = s === "busy" ? "..." : s === "ok" ? "OK" : s === "err" ? "ERR" : null;
  const label = s === "busy" ? "…" : s === "ok" ? "✓" : s === "err" ? "✕" : "📸";

  return (
    <button
      onClick={run}
      disabled={s === "busy"}
      title="Copy the economic calendar template to clipboard"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2px 5px",
        border: `1px solid ${color}40`,
        borderRadius: 2,
        background: "rgba(255,255,255,0.04)",
        color,
        cursor: s === "busy" ? "default" : "pointer",
        fontSize: statusLabel ? 9 : 0,
        fontWeight: 700,
        fontFamily: "inherit",
        flexShrink: 0,
        transition: "color .15s, border-color .15s",
      }}
    >
      {statusLabel ?? <IconCamera />}
    </button>
  );
}
