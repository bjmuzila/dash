// Weekly newsletter — "The Weekly Edge". Recaps last week's market action,
// previews this week's catalysts (FOMC, earnings, econ data), covers the
// oil/geopolitical situation, and closes with the CB Edge dashboard scorecard
// (Core Bullseye, Estimated Move) as social proof + a CTA.
//
// Data-driven via opts — every number below is a parameter so this template
// gets reused week to week without touching markup. Sensible defaults are
// filled in from the most recent week so a blank call still renders.
//
// CURRENT ISSUE: week of Aug 24–28, 2026. Recap covers Aug 17–21 (S&P -1.4%
// snapping a 3-week streak on a bond selloff); the week ahead is July PCE +
// Q2 GDP revision Wed, NVIDIA/CRM/CRWD Wed after the close, Jackson Hole
// Thu–Fri with Chair Warsh. DEFAULT_CONF_ROWS is intentionally empty so the
// results table renders as the dashed placeholder — fill it before sending.
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
  { name: "S&amp;P 500", pct: "-1.4%" },
  { name: "Nasdaq", pct: "-2.1%" },
  { name: "Dow", pct: "-0.9%" },
];

const DEFAULT_CALENDAR: CalendarEvent[] = [
  { day: "MON 8/24", desc: "Quiet macro open — <strong>Chicago Fed National Activity Index</strong> and remarks from Treasury Secretary Bessent. PDD and XPEV report; the tape mostly positions for Wednesday." },
  { day: "TUE 8/25", desc: "<strong>New Home Sales</strong>, the <strong>Richmond Fed</strong> survey and the FHFA House Price Index. Dick's Sporting Goods before the bell, Intuit and Zoom after it." },
  { day: "WED 8/26", desc: "The heavy one — <strong>July PCE</strong>, Personal Income &amp; Spending and Durable Goods at 8:30, plus the second estimate of <strong>Q2 GDP</strong>. Then <strong>NVIDIA</strong>, Salesforce and CrowdStrike after the close." },
  { day: "THU 8/27", desc: "<strong>Jobless Claims</strong> and the Kansas City Fed survey, and the <strong>Jackson Hole symposium</strong> opens — this year's theme is financial innovation and its implications for payments and policy." },
  { day: "FRI 8/28", desc: "Preliminary <strong>benchmark revision to Non-Farm Payrolls</strong> and the Chicago Business Barometer, with <strong>Chair Warsh</strong> speaking from Jackson Hole." },
];

const DEFAULT_EARNINGS: EarningsDay[] = [
  { label: "Mon 8/24", tickers: [{ symbol: "PDD" }, { symbol: "XPEV" }] },
  { label: "Tue 8/25", tickers: [{ symbol: "DKS" }, { symbol: "INTU" }, { symbol: "ZM" }, { symbol: "BMO" }, { symbol: "HEI" }] },
  { label: "Wed 8/26 — NVIDIA reports after the close", tickers: [{ symbol: "NVDA" }, { symbol: "CRM" }, { symbol: "CRWD" }, { symbol: "SNPS" }, { symbol: "KSS" }, { symbol: "ANF" }] },
  { label: "Thu 8/27 — retail + software double header", tickers: [{ symbol: "BBY" }, { symbol: "DG" }, { symbol: "DLTR" }, { symbol: "MRVL" }, { symbol: "WDAY" }, { symbol: "ADSK" }] },
  { label: "Fri 8/28", tickers: [{ symbol: "MNSO" }] },
];

/**
 * Daily Core Bullseye confidence rows. LEFT EMPTY ON PURPOSE for this issue —
 * an empty array makes the template render the dashed "[ADD CB EDGE SCREENSHOT
 * / CONFIDENCE TABLE HERE]" block instead of a stale table. Fill from the owner
 * Results page before sending; row shape:
 *   { date: "08-21", s945: "7810", c945: "2.1", hit945: true,
 *                    s1030: "7810", c1030: "3.1", hit1030: true,
 *                    s1200: "7780", c1200: "0.1", hit1200: true },
 */
const DEFAULT_CONF_ROWS: ConfRow[] = [];

function withDefaults(opts: WeeklyEdgeOpts): Required<Pick<WeeklyEdgeOpts,
  "issueLabel" | "recapHeadline" | "recapBody" | "indexMoves" | "aheadHeadline" | "calendarEvents" |
  "earningsDays" | "aheadNote" | "oilHeadline" | "oilPrice" | "oilChangeNote" | "oilBody" |
  "coreBullseyePct" | "coreBullseyeSub" | "estMovePct" | "estMoveSub" |
  "confRows" | "resultsNote" | "ctaUrl">> {
  return {
    issueLabel: opts.issueLabel || "Week of Aug 24–28",
    recapHeadline: opts.recapHeadline || "Bonds broke the streak — yields ripped and the Nasdaq wore it",
    recapBody: opts.recapBody || [
      "The S&amp;P 500 fell 1.4% on the week, snapping a three-week winning streak and leaving it about 1.6% below the record close it set on August 13. The Nasdaq took the worst of it at -2.1%; the Dow got off lightest at -0.9%. The damage was rate-driven: the 10-year yield pushed to 4.737%, its biggest one-week gain since July 31, as a wave of AI-related debt issuance and renewed inflation anxiety hit the long end.",
      "Treasury Secretary Bessent tried to steady the tape — doubling long-term buybacks to at least $4 billion per operation through November — but yields snapped straight back to their highs. Away from equities the risk bid was alive and well: gold added 2.4% to $4,680.60 for a third straight winning week, bitcoin ran nearly 20% in 48 hours to almost $80,000 (its best week in two years), and WTI gained 6.9% to $87.06 as Iran headlines stayed live. Friday finally caught a bid — Dow +0.98%, S&amp;P and Nasdaq both +0.43% — but not enough to save the week.",
    ],
    indexMoves: opts.indexMoves || DEFAULT_INDEX_MOVES,
    aheadHeadline: opts.aheadHeadline || "PCE Wednesday morning, NVIDIA Wednesday night, Jackson Hole Thursday — three events set the tape",
    calendarEvents: opts.calendarEvents || DEFAULT_CALENDAR,
    earningsDays: opts.earningsDays || DEFAULT_EARNINGS,
    aheadNote: opts.aheadNote || "Three things do the work this week. Wednesday's July PCE is the last major inflation print before the September meeting, with consensus at +0.2% on core. Wednesday night NVIDIA reports into an expectation of roughly 97% revenue growth — the same AI-capex story the long end of the curve has spent two weeks repricing. Then Jackson Hole hands Chair Warsh the microphone with rates already coming off their sharpest one-week move since July. Expect gap risk Thursday morning and again into Friday's benchmark payroll revision.",
    oilHeadline: opts.oilHeadline || "Hormuz still isn't open — but Tehran is finally talking about ending it",
    oilPrice: opts.oilPrice || "$94.39",
    oilChangeNote: opts.oilChangeNote || "Brent, Aug 21 · +0.7% on the day, +39.4% YoY · WTI $87.06, +6.9% on the week",
    oilBody: opts.oilBody || [
      "Crude posted its biggest weekly gain since late July as the Strait of Hormuz standoff dragged into another week. President Trump threatened \"TREMENDOUS Economic Consequences\" for any nation still trading with Iran, and the Treasury followed with a tighter sanctions package — enough to keep a war premium in every barrel even as tanker traffic through the region held up better than the headlines implied.",
      "Friday brought the first real crack in the deadlock: Iranian President Pezeshkian said Tehran would rather conclude the war while it still holds a position of strength. Oil barely moved on it, which tells you how little this market is willing to price a deal it hasn't seen. Until the strait actually reopens, crude stays a headline-driven overnight risk — and that is gap risk landing straight into the 9:45 CB window.",
    ],
    coreBullseyePct: opts.coreBullseyePct || "—",
    coreBullseyeSub: opts.coreBullseyeSub || "[fill before send]",
    estMovePct: opts.estMovePct || "—",
    estMoveSub: opts.estMoveSub || "[fill before send]",
    confRows: opts.confRows || DEFAULT_CONF_ROWS,
    resultsNote: opts.resultsNote || "[ADD THIS WEEK'S CORE BULLSEYE + ESTIMATED MOVE SUMMARY]",
    ctaUrl: opts.ctaUrl || PRICING_URL,
  };
}

export const WEEKLY_EDGE_SUBJECT = "The Weekly Edge — NVIDIA, PCE and Jackson Hole all land in one week";

/** Plain-text fallback. */
export function weeklyEdgeText(opts: WeeklyEdgeOpts = {}): string {
  const o = withDefaults(opts);
  // Strip tags AND decode the handful of entities the HTML copy carries, so the
  // plain-text part doesn't ship literal "S&amp;P 500" to text-only clients.
  const strip = (s: string) =>
    s.replace(/<[^>]+>/g, "")
     .replace(/&middot;/g, "·")
     .replace(/&nbsp;/g, " ")
     .replace(/&lt;/g, "<")
     .replace(/&gt;/g, ">")
     .replace(/&quot;/g, '"')
     .replace(/&#39;/g, "'")
     .replace(/&amp;/g, "&");
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
    `Annual access is $400/yr instead of $1,000 with code EDGE3: ${o.ctaUrl}`,
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
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Bonds snapped the win streak and oil ripped 7% — and this week brings July PCE, NVIDIA earnings and Jackson Hole.</div>
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
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#00E676;">Code EDGE3 · $400/yr instead of $1,000</div>
                    <div style="font:900 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:10px;">NVIDIA, PCE and Jackson Hole in one week. <span style="color:#00E676;">Don't trade it blind.</span></div>
                    <div style="font:400 13px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:8px;max-width:460px;">Live GEX levels, Core Bullseye confidence scoring and estimated-move tracking — full annual access for $400 with code <strong style="color:#ffffff;">EDGE3</strong>, instead of $1,000.</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
                      <td align="center" style="border-radius:12px;background:#00C853;">
                        <a href="${cta}" style="display:inline-block;padding:14px 34px;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#04140A;text-decoration:none;border-radius:12px;">Get Annual Access →</a>
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
