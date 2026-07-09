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
  if (impact === "High") return { bg: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.4)", text: "#EF4444" };
  if (impact === "Medium") return { bg: "rgba(251,133,1,0.16)", border: "rgba(251,133,1,0.4)", text: "#FB8501" };
  return { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)", text: "#b8c2d6" };
}

function dash(v?: string): string {
  const s = (v || "").trim();
  return s ? s : "–";
}

// Fewer rows in a lane -> bigger type (fills the panel); more rows -> smaller
// type (keeps everything on-canvas). 4 rows is the "neutral" baseline.
function densityScale(n: number): number {
  const s = 1 + (4 - n) * 0.12;
  return Math.max(0.7, Math.min(1.55, s));
}

function buildSnapshotHTML(events: CalEvent[], quote: string, logoDataUrl = ""): string {
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

  const totalCount = economicEvents.length + presidentEvents.length;
  const econPct = totalCount > 0 ? Math.round((economicEvents.length / totalCount) * 100) : 0;
  const presPct = totalCount > 0 ? 100 - econPct : 0;

  const presScale = densityScale(Math.max(presidentEvents.length, 1));
  const econScale = densityScale(Math.max(economicEvents.length, 1));
  const px = (base: number, scale: number) => Math.round(base * scale);

  const presTimeSize = px(15, presScale);
  const presTitleSize = px(16, presScale);
  const presRowPadV = px(14, presScale);
  const presTimeCol = px(90, presScale);

  const econHeadSize = px(11, econScale);
  const econTimeSize = px(14, econScale);
  const econEventSize = px(15, econScale);
  const econNumSize = px(14, econScale);
  const econRowPadV = px(12, econScale);
  const pillFontSize = px(11, econScale);
  const pillPadV = px(3, econScale);
  const pillPadH = px(10, econScale);
  const econTimeCol = px(78, econScale);
  const econImpactCol = px(84, econScale);
  const econNumCol = px(68, econScale);

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
      <div class="ec-impact"><span class="impact-pill" style="background:${badge.bg};border-color:${badge.border};color:${badge.text}">${ev.impact}</span></div>
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

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
:root{--bg:#05060A;--panelBg:rgba(13,17,25,0.55);--panelBgSoft:rgba(13,17,25,0.4);--border:rgba(255,255,255,0.10);--cyan:#219EBC;--green:#8ECAE6;--red:#EF4444;--orange:#FB8501;--text:#FFFFFF;--muted:#b8c2d6}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1280px;min-height:720px;display:grid;place-items:center;padding:24px;color:var(--text);font-family:Arial,Helvetica,sans-serif;background:var(--bg)}
.snapshot{width:min(1280px,100%);min-height:680px;display:flex;flex-direction:column;position:relative;overflow:hidden;border-radius:24px;background:radial-gradient(circle at 15% 0%,rgba(33,158,188,0.10) 0%,transparent 45%),radial-gradient(circle at 85% 10%,rgba(142,202,230,0.06) 0%,transparent 40%),var(--bg);border:1px solid var(--border);padding:26px 30px 30px}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-shrink:0}
.badge{background:rgba(33,158,188,0.12);border:1px solid rgba(33,158,188,0.4);color:var(--cyan);padding:14px 26px;font-size:24px;letter-spacing:0.07em;font-weight:800;border-radius:10px;text-transform:uppercase}
.date-group{display:flex;gap:10px;align-items:center}
.date-pill{background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:8px;padding:10px 18px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;font-size:16px}
.today-pill{background:rgba(33,158,188,0.16);border:1px solid rgba(33,158,188,0.4);color:var(--cyan);border-radius:8px;padding:10px 18px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;font-size:16px}
.quote{margin:26px auto 6px;text-align:center;font-family:Georgia,"Times New Roman",serif;font-size:22px;font-style:italic;color:var(--muted);padding:0 36px;max-width:1120px;flex-shrink:0}
.grid{display:grid;grid-template-columns:2fr 3fr;gap:20px;margin-top:24px;flex:1;min-height:0}
.panel{border-radius:16px;border:1px solid var(--border);background:var(--panelBg);overflow:hidden;height:100%;display:flex;flex-direction:column}
.panel-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0}
.panel-title{font-size:16px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:var(--text)}
.panel-pct{font-size:14px;font-weight:800;color:var(--muted);background:rgba(255,255,255,0.06);border-radius:8px;padding:4px 10px}
.pres .panel-title{color:var(--green)}
.pres .panel-pct{color:var(--green);background:rgba(142,202,230,0.12)}
.econ .panel-title{color:var(--cyan)}
.econ .panel-pct{color:var(--cyan);background:rgba(33,158,188,0.12)}
.pres-body{padding:8px 14px;flex:1;display:flex;flex-direction:column}
.pres-row{display:grid;grid-template-columns:${presTimeCol}px 1fr;gap:12px;padding:${presRowPadV}px 6px;border-bottom:1px solid var(--border);flex:1;align-content:center}
.pres-row:last-child{border-bottom:none}
.pr-time{color:var(--green);font-weight:700;font-size:${presTimeSize}px}
.pr-title{font-size:${presTitleSize}px;font-weight:600;line-height:1.3}
.empty-panel{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:rgba(255,255,255,0.35);font-size:14px}
.econ-table{display:flex;flex-direction:column;flex:1}
.econ-row{display:grid;grid-template-columns:${econTimeCol}px 1fr ${econImpactCol}px ${econNumCol}px ${econNumCol}px ${econNumCol}px;gap:8px;padding:${econRowPadV}px 14px;align-items:center;border-bottom:1px solid var(--border);flex:1}
.econ-row:last-child{border-bottom:none}
.econ-row.head{background:rgba(255,255,255,0.03);font-size:${econHeadSize}px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.45);flex:0 0 auto}
.ec-time{font-size:${econTimeSize}px;font-weight:700;color:var(--muted)}
.ec-event{font-size:${econEventSize}px;font-weight:600}
.ec-num{font-size:${econNumSize}px;font-weight:700;text-align:right;color:var(--text)}
.ec-impact{text-align:left}
.impact-pill{display:inline-flex;align-items:center;justify-content:center;line-height:1;border:1px solid;border-radius:8px;padding:${pillPadV}px ${pillPadH}px;font-size:${pillFontSize}px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase}
.logo-wrap{position:absolute;bottom:18px;right:22px;display:flex;align-items:center;justify-content:flex-end;opacity:0.96}
.logo-wrap img{width:80px;height:80px;object-fit:contain}
</style></head><body>
<div class="snapshot" id="root">
  <div class="topbar">
    <div class="badge">Economic Calendar</div>
    <div class="date-group">
      <div class="date-pill">${todayLong()}</div>
      <div class="today-pill">TODAY</div>
    </div>
  </div>
  ${formattedQuote ? `<div class="quote">${formattedQuote}</div>` : ""}
  <div class="grid">
    <div class="panel pres">
      <div class="panel-head">
        <div class="panel-title">Presidential Schedule</div>
        <div class="panel-pct">${presPct}%</div>
      </div>
      ${presidentEvents.length > 0 ? `<div class="pres-body">${presRowsHTML}</div>` : `<div class="empty-panel">No political events today</div>`}
    </div>
    <div class="panel econ">
      <div class="panel-head">
        <div class="panel-title">Economic Calendar</div>
        <div class="panel-pct">${econPct}%</div>
      </div>
      ${economicEvents.length > 0 ? `
      <div class="econ-table">
        <div class="econ-row head">
          <div>Time</div><div>Event</div><div>Impact</div><div style="text-align:right">Actual</div><div style="text-align:right">Forecast</div><div style="text-align:right">Previous</div>
        </div>
        ${econRowsHTML}
      </div>` : `<div class="empty-panel">No high-impact events today</div>`}
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
  const [calRes, quoteRes, logoRes] = await Promise.all([
    fetch("/api/calendar", { cache: "no-store" }),
    fetch("/api/calendar-quote", { cache: "no-store" }).catch(() => null),
    fetch("/cb-edge-square.png", { cache: "no-store" }).catch(() => null),
  ]);
  const calJson = calRes.ok ? await calRes.json() : {};
  const quoteJson = quoteRes?.ok ? await quoteRes.json() : {};

  const events: CalEvent[] = calJson.events ?? [];
  const quote: string = quoteJson.quote ?? "";

  let logoDataUrl = "";
  if (logoRes?.ok) {
    const blob = await logoRes.blob();
    logoDataUrl = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  const html = buildSnapshotHTML(events, quote, logoDataUrl);
  return renderAndCapture(html);
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
