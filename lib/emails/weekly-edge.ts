// Weekly newsletter — "The Weekly Edge". Recaps last week's market action,
// previews this week's catalysts (FOMC, earnings, econ data), covers the
// oil/geopolitical situation, and closes with the CB Edge dashboard scorecard
// (Core Bullseye, Estimated Move) as social proof + a CTA.
//
// Data-driven via opts — every number below is a parameter so this template
// gets reused week to week without touching markup. Sensible defaults are
// filled in from the most recent week so a blank call still renders.
//
// Same brand shell/conventions as cb-confidence.ts (see EMAILS_HANDOFF.md),
// with one deliberate deviation: logo is TOP-LEFT (not centered) per request.
// Palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 ·
// green #00E676 · amber #FFB300 · red #FF4757.

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const PRICING_URL = `${SITE_URL}/pricing`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

export interface IndexMove { name: string; pct: string; }
export interface CalendarEvent { day: string; desc: string; }
export interface EarningsTicker { symbol: string; logoUrl?: string; }
export interface EarningsDay { label: string; tickers: EarningsTicker[]; }
export interface ConfRow { date: string; s945: string; c945: string; s1030: string; c1030: string; s1200: string; c1200: string; hit945: boolean; hit1030: boolean; hit1200: boolean; }

export interface WeeklyEdgeOpts {
  issueLabel?: string;              // e.g. "Week of Jul 27"
  recapHeadline?: string;
  recapBody?: string[];             // paragraphs
  indexMoves?: IndexMove[];         // S&P/Nasdaq/Dow style tiles
  aheadHeadline?: string;
  calendarEvents?: CalendarEvent[];
  earningsDays?: EarningsDay[];
  aheadNote?: string;
  oilHeadline?: string;
  oilPrice?: string;
  oilChangeNote?: string;
  oilBody?: string[];
  coreBullseyePct?: string;
  coreBullseyeSub?: string;
  estMovePct?: string;
  estMoveSub?: string;
  confRows?: ConfRow[];
  resultsNote?: string;
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

const DEFAULT_INDEX_MOVES: IndexMove[] = [
  { name: "S&amp;P 500", pct: "+1.1%" },
  { name: "Nasdaq", pct: "+0.4%" },
  { name: "Dow", pct: "-0.3%" },
];

const DEFAULT_CALENDAR: CalendarEvent[] = [
  { day: "MON 8/17", desc: "Quiet open after last week's soft retail-sales print — positioning ahead of Wednesday/Thursday's retail-earnings gauntlet." },
  { day: "TUE 8/18", desc: "<strong>Building Permits &amp; Housing Starts</strong> — first housing read of the week, paired with Home Depot's earnings for a consumer-health check." },
  { day: "WED 8/19", desc: "The heaviest retail-earnings day of the week — Target, Lowe's and TJX all report, testing whether last week's weak retail sales was a one-off." },
  { day: "THU 8/20", desc: "<strong>FOMC Minutes</strong> from the July meeting and <strong>Jobless Claims</strong> — plus Walmart's earnings, the single biggest read on the US consumer this week." },
  { day: "FRI 8/21", desc: "<strong>S&amp;P Global Flash Manufacturing &amp; Services PMI</strong> — first look at August activity heading into next week's Jackson Hole symposium." },
];

const DEFAULT_EARNINGS: EarningsDay[] = [
  { label: "Mon 8/17", tickers: [{ symbol: "FN" }] },
  { label: "Tue 8/18", tickers: [{ symbol: "HD" }, { symbol: "BIDU" }, { symbol: "TOL" }, { symbol: "KEYS" }] },
  { label: "Wed 8/19 — retail-earnings gauntlet", tickers: [{ symbol: "TGT" }, { symbol: "LOW" }, { symbol: "TJX" }, { symbol: "ADI" }, { symbol: "EL" }] },
  { label: "Thu 8/20 — Walmart reports", tickers: [{ symbol: "WMT" }, { symbol: "BABA" }, { symbol: "DE" }, { symbol: "ROST" }] },
  { label: "Fri 8/21", tickers: [{ symbol: "BJ" }, { symbol: "BKE" }] },
];

const DEFAULT_CONF_ROWS: ConfRow[] = [
  { date: "08-14", s945: "7810", c945: "2.1", hit945: true, s1030: "7810", c1030: "3.1", hit1030: true, s1200: "7780", c1200: "0.1", hit1200: true },
  { date: "08-13", s945: "7800", c945: "0.1", hit945: true, s1030: "7820", c1030: "4.8", hit1030: true, s1200: "7780", c1200: "0.1", hit1200: true },
  { date: "08-12", s945: "7800", c945: "41.3", hit945: false, s1030: "7780", c1030: "21.7", hit1030: false, s1200: "7740", c1200: "0.3", hit1200: true },
  { date: "08-11", s945: "7780", c945: "17.9", hit945: false, s1030: "7780", c1030: "17.9", hit1030: false, s1200: "7740", c1200: "0.2", hit1200: true },
  { date: "08-10", s945: "7775", c945: "2.0", hit945: true, s1030: "7775", c1030: "2.0", hit1030: true, s1200: "7775", c1200: "8.3", hit1200: false },
  { date: "08-07", s945: "7750", c945: "0.2", hit945: true, s1030: "7750", c1030: "0.2", hit1030: true, s1200: "7760", c1200: "0.3", hit1200: true },
  { date: "08-06", s945: "7700", c945: "1.7", hit945: true, s1030: "7700", c1030: "1.7", hit1030: true, s1200: "7700", c1200: "1.7", hit1200: true },
];

function withDefaults(opts: WeeklyEdgeOpts): Required<Pick<WeeklyEdgeOpts,
  "issueLabel" | "recapHeadline" | "recapBody" | "indexMoves" | "aheadHeadline" | "calendarEvents" |
  "earningsDays" | "aheadNote" | "oilHeadline" | "oilPrice" | "oilChangeNote" | "oilBody" |
  "coreBullseyePct" | "coreBullseyeSub" | "estMovePct" | "estMoveSub" |
  "confRows" | "resultsNote" | "ctaUrl">> {
  return {
    issueLabel: opts.issueLabel || "Week of Aug 17–21",
    recapHeadline: opts.recapHeadline || "A third straight winning week for stocks, but cracks showed on Friday",
    recapBody: opts.recapBody || [
      "The S&amp;P 500 notched its third consecutive weekly gain and Nasdaq eked out a small advance, even as both slipped Friday off fresh record highs. The Dow finished the week lower. Friday's pullback came on a weak University of Michigan consumer-sentiment report — Americans flagged renewed inflation anxiety — and a sharper-than-expected drop in retail sales, the steepest monthly decline in over a year.",
      "Strong corporate earnings had carried the market for most of the week before that consumer-data one-two punch stalled momentum into the close. Oil added to the pressure, climbing more than 5% on the week as Middle East supply risk stayed front and center.",
    ],
    indexMoves: opts.indexMoves || DEFAULT_INDEX_MOVES,
    aheadHeadline: opts.aheadHeadline || "FOMC Minutes, flash PMIs, and a retail-earnings gauntlet — Home Depot, Target, Lowe's, TJX and Walmart",
    calendarEvents: opts.calendarEvents || DEFAULT_CALENDAR,
    earningsDays: opts.earningsDays || DEFAULT_EARNINGS,
    aheadNote: opts.aheadNote || "After last week's weak retail sales and soft consumer sentiment, this week's retail earnings (HD, TGT, LOW, TJX, WMT) become a real referendum on the consumer rather than routine prints. Thursday's FOMC Minutes and Friday's flash PMIs round out the macro picture ahead of next week's Jackson Hole symposium.",
    oilHeadline: opts.oilHeadline || "Hormuz remains closed, and the IEA warns of the widest supply shortfall in five years",
    oilPrice: opts.oilPrice || "$88.52",
    oilChangeNote: opts.oilChangeNote || "Brent, Aug 14 · +1.7% on the day, +5%+ on the week, +34.4% YoY",
    oilBody: opts.oilBody || [
      "Brent gained more than 5% last week as the Strait of Hormuz stayed closed amid a diplomatic deadlock — the US Treasury has rolled out what it calls \"unprecedented economic measures\" alongside a naval blockade of Iranian ports, and Iran and Oman have yet to reach terms on reopening the strait. The IEA now warns of the widest global supply shortfall in five years, projecting a 4.3 million barrel-per-day decline.",
      "Adding to the pressure, Iran-backed Houthi militants struck Saudi Arabia's Jazan refinery, and tankers continue transiting the Red Sea with elevated risk — some running with transponders switched off. With no resolution in sight, expect crude to stay a headline-sensitive driver of overnight futures and gap risk into the 9:45 CB window.",
    ],
    coreBullseyePct: opts.coreBullseyePct || "86%",
    coreBullseyeSub: opts.coreBullseyeSub || "12:00 CB &middot; 71% at 9:45 &amp; 10:30",
    estMovePct: opts.estMovePct || "67.5%",
    estMoveSub: opts.estMoveSub || "158-76 &middot; 234 scored (week of 8/14)",
    confRows: opts.confRows || DEFAULT_CONF_ROWS,
    resultsNote: opts.resultsNote || "Core Bullseye hit rate this week: 71% at 9:45, 71% at 10:30, and 86% at 12:00 — with the 12:00 read landing within 8 points on 6 of the last 7 sessions.",
    ctaUrl: opts.ctaUrl || PRICING_URL,
  };
}

export const WEEKLY_EDGE_SUBJECT = "The Weekly Edge — retail earnings, FOMC Minutes, and where CB Edge called it right";

/** Plain-text fallback. */
export function weeklyEdgeText(opts: WeeklyEdgeOpts = {}): string {
  const o = withDefaults(opts);
  const strip = (s: string) => s.replace(/<[^>]+>/g, "");
  return [
    `THE WEEKLY EDGE — ${o.issueLabel.toUpperCase()}`,
    "",
    "LAST WEEK RECAP",
    strip(o.recapHeadline),
    ...o.indexMoves.map((m) => `${strip(m.name)}: ${m.pct}`),
    "",
    ...o.recapBody.map(strip),
    "",
    "THIS WEEK AHEAD",
    strip(o.aheadHeadline),
    ...o.calendarEvents.map((e) => `${e.day} — ${strip(e.desc)}`),
    "",
    ...o.earningsDays.map((d) => `${strip(d.label)}: ${d.tickers.map((t) => t.symbol).join(", ")}`),
    "",
    strip(o.aheadNote),
    "",
    "OIL & THE WAR SITUATION",
    strip(o.oilHeadline),
    `${o.oilPrice} — ${o.oilChangeNote}`,
    ...o.oilBody.map(strip),
    "",
    "CB EDGE — THIS WEEK'S RESULTS",
    `Core Bullseye: ${o.coreBullseyePct} (${strip(o.coreBullseyeSub)})`,
    `Estimated Move: ${o.estMovePct} (${strip(o.estMoveSub)})`,
    strip(o.resultsNote),
    "",
    `Claim your access: ${o.ctaUrl}`,
    "",
    "— The CB Edge Team",
    "",
    "cbedge.net · not financial advice",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML weekly newsletter email. */
export function weeklyEdgeEmail(opts: WeeklyEdgeOpts = {}): string {
  const o = withDefaults(opts);
  const cta = escapeHtml(o.ctaUrl);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const indexTile = (m: IndexMove) => {
    const down = m.pct.trim().startsWith("-");
    const color = down ? "#FF4757" : "#00E676";
    return `
              <td width="33%" style="padding:0 5px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(255,255,255,0.02);">
                  <tr><td align="center" style="padding:12px 8px;">
                    <div style="font:700 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#6b7d8f;">${m.name}</div>
                    <div style="font:800 20px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${color};margin-top:6px;">${escapeHtml(m.pct)}</div>
                  </td></tr>
                </table>
              </td>`;
  };

  const eventRow = (e: CalendarEvent) => `
            <tr>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,0.06);" valign="top">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td width="70" valign="top" style="font:800 11px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#219EBC;">${e.day}</td>
                  <td valign="top" style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${e.desc}</td>
                </tr></table>
              </td>
            </tr>`;

  const earningsTile = (t: EarningsTicker) => {
    const logo = t.logoUrl || `https://logos.stocktwits-cdn.com/${encodeURIComponent(t.symbol)}.png?w=64`;
    return `
              <td width="64" style="padding:0 5px 10px 5px;" align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td width="44" height="44" align="center" valign="middle" style="border-radius:9px;background:#ffffff;overflow:hidden;">
                    <img src="${logo}" width="44" height="44" alt="${escapeHtml(t.symbol)}" style="display:block;width:44px;height:44px;object-fit:cover;border:0;border-radius:9px;">
                  </td>
                </tr></table>
                <div style="font:800 9px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.04em;color:#9fb3c8;">${escapeHtml(t.symbol)}</div>
              </td>`;
  };

  const earningsDay = (d: EarningsDay) => `
            <div style="font:800 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;color:#6b7d8f;margin:14px 0 8px 0;">${d.label}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              ${d.tickers.map(earningsTile).join("")}
            </tr></table>`;

  const confCell = (val: string, hit: boolean) => `<span style="color:${hit ? "#219EBC" : "#FF4757"};font-weight:700;">${escapeHtml(val)} ${hit ? "✓" : "✗"}</span>`;

  const confHeaderRow = `
              <tr>
                <td rowspan="2" style="padding:8px 6px;font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;text-align:left;border-bottom:1px solid rgba(255,255,255,0.10);">Date</td>
                <td colspan="2" style="padding:8px 6px;font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">9:45 CB</td>
                <td colspan="2" style="padding:8px 6px;font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">10:30 CB</td>
                <td colspan="2" style="padding:8px 6px;font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">12:00 CB</td>
              </tr>
              <tr>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Strike</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Closest</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Strike</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Closest</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Strike</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Closest</td>
              </tr>`;

  const confBodyRows = o.confRows.map((r, i) => `
              <tr>
                <td style="padding:7px 6px;font:700 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${escapeHtml(r.date)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${escapeHtml(r.s945)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${confCell(r.c945, r.hit945)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${escapeHtml(r.s1030)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${confCell(r.c1030, r.hit1030)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${escapeHtml(r.s1200)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${confCell(r.c1200, r.hit1200)}</td>
              </tr>`).join("");

  const resultTile = (label: string, pct: string, sub: string, color: string, width: string = "33%") => `
              <td width="${width}" valign="top" style="padding:0 5px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(255,255,255,0.02);">
                  <tr><td align="center" style="padding:14px 8px;">
                    <div style="font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#6b7d8f;">${label}</div>
                    <div style="font:800 22px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${color};margin-top:8px;">${pct}</div>
                    <div style="font:500 10px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:4px;">${sub}</div>
                  </td></tr>
                </table>
              </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(WEEKLY_EDGE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Last week's recap, this week's FOMC + Mag 7 earnings, the oil/war situation, and where CB Edge called it right.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <tr><td style="height:4px;background:linear-gradient(90deg,rgba(56,189,248,0) 0%,#38BDF8 50%,rgba(56,189,248,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- HEADER: logo top-left + issue tag top-right -->
          <tr>
            <td style="padding:26px 28px 4px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="left" valign="middle">
                  <img src="${LOGO_URL}" alt="CB Edge" width="150" style="display:block;width:150px;max-width:60%;height:auto;border:0;">
                </td>
                <td align="right" valign="middle">
                  <span style="display:inline-block;font:700 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#9fb3c8;border:1px solid rgba(255,255,255,0.14);border-radius:20px;padding:6px 12px;">${escapeHtml(o.issueLabel)}</span>
                </td>
              </tr></table>
              <div style="font:900 24px/1.25 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:16px;">The Weekly Edge</div>
              <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:4px;">Last week's recap, this week's catalysts, and where CB Edge called it right.</div>
            </td>
          </tr>

          <!-- LAST WEEK RECAP -->
          <tr>
            <td style="padding:22px 28px 0 28px;border-top:1px solid rgba(255,255,255,0.08);margin-top:18px;">
              <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#38BDF8;margin-top:18px;">● Last Week Recap</div>
              <div style="font:800 17px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:8px;">${o.recapHeadline}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
                ${o.indexMoves.map(indexTile).join("")}
              </tr></table>
              ${o.recapBody.map((p) => `<div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:12px;">${p}</div>`).join("")}
            </td>
          </tr>

          <!-- THIS WEEK AHEAD -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#38BDF8;">● This Week Ahead</div>
              <div style="font:800 17px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:8px;">${o.aheadHeadline}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
                ${o.calendarEvents.map(eventRow).join("")}
              </table>
              ${o.earningsDays.map(earningsDay).join("")}
              <div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:14px;">${o.aheadNote}</div>
            </td>
          </tr>

          <!-- OIL & WAR -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#FB8501;">● Oil &amp; The War Situation</div>
              <div style="font:800 17px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:8px;">${o.oilHeadline}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(255,255,255,0.02);">
                <tr><td style="padding:16px 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td style="font:800 24px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#FFB300;padding-right:10px;">${escapeHtml(o.oilPrice)}</td>
                    <td style="font:400 11px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">${escapeHtml(o.oilChangeNote)}</td>
                  </tr></table>
                  ${o.oilBody.map((p) => `<div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:10px;">${p}</div>`).join("")}
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- CB EDGE RESULTS -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#00E676;">● CB Edge — This Week's Results</div>
              <div style="font:800 17px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:8px;">The dashboard called it — here's the scorecard</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
                ${resultTile("Core Bullseye", o.coreBullseyePct, o.coreBullseyeSub, "#38BDF8", "50%")}
                ${resultTile("Estimated Move", o.estMovePct, o.estMoveSub, "#FFB300", "50%")}
              </tr></table>

              ${o.confRows.length ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(255,255,255,0.02);border-collapse:separate;">
                ${confHeaderRow}
                ${confBodyRows}
              </table>` : `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border:1px dashed rgba(255,255,255,0.18);border-radius:10px;">
                <tr><td align="center" style="padding:22px 16px;font:600 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">[ADD CB EDGE SCREENSHOT / CONFIDENCE TABLE HERE]</td></tr>
              </table>`}
              <div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:14px;">${o.resultsNote}</div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:26px 28px 6px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(0,230,118,0.35);border-radius:16px;background:radial-gradient(circle at 50% 0%,rgba(0,230,118,0.14) 0%,transparent 70%),rgba(0,230,118,0.04);">
                <tr>
                  <td align="center" style="padding:26px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#00E676;">Founding Access Closing Soon</div>
                    <div style="font:900 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:10px;">This is a heavy week. <span style="color:#00E676;">Trade it with an edge.</span></div>
                    <div style="font:400 13px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:8px;max-width:460px;">A retail-earnings gauntlet, FOMC Minutes, and an oil market still pricing in war risk — get the live GEX levels, Core Bullseye confidence scoring, and estimated-move tracking before founding pricing ends.</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
                      <td align="center" style="border-radius:12px;background:#00C853;">
                        <a href="${cta}" style="display:inline-block;padding:14px 34px;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#04140A;text-decoration:none;border-radius:12px;">Claim Your Access →</a>
                      </td>
                    </tr></table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:18px 28px 30px 28px;">
              <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">— The CB Edge Team</div>
            </td>
          </tr>
        </table>

        <!-- footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;">
          <tr>
            <td align="center" style="padding:18px 32px;">
              <div style="font:400 11px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">
                <a href="${unsubHref}" style="color:#8ECAE6;text-decoration:underline;font-size:14px;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="${SITE_URL}" style="color:#6b7d8f;text-decoration:underline;font-size:14px;">cbedge.net</a>
                <br>
                <span style="color:#5a6b7d;">Market analytics, not financial advice.</span>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
