"use client";

/**
 * EconCalendarDiscordBtn
 *
 * Renders the snapshot-template-example.html CSS layout off-screen,
 * populated with live /api/calendar + /api/calendar-quote data,
 * then html2canvas's it and posts to Discord.
 */

import { useState, useCallback } from "react";

type BtnState = "idle" | "busy" | "ok" | "err";

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

// ── Build the snapshot HTML (matches snapshot-template-example.html CSS) ──────

function buildSnapshotHTML(events: CalEvent[], quote: string): string {
  const today = etToday();
  const todayEvents = events.filter(e => e.date === today);

  // Sort by time
  todayEvents.sort((a, b) => a.time.localeCompare(b.time));

  // Pick the headline: highest impact High USD first, else first event
  const headlineEv = todayEvents.find(isHighPriority) ?? todayEvents[0];
  const additionalEvents = headlineEv
    ? todayEvents.filter(e => e !== headlineEv)
    : [];

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

  const eventCount = additionalEvents.length;
  const layoutClass = todayEvents.length <= 1 ? "layout-compact" : todayEvents.length >= 6 ? "layout-busy" : "";

  const eventRowsHTML = additionalEvents.map(ev => `
    <div class="row">
      <div class="row-time">${fmtTime(ev)}</div>
      <div class="row-label">${ev.title}</div>
    </div>
  `).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
:root{--bg:#08111f;--gold:#f2c96d;--gold-soft:rgba(242,201,109,0.2);--cyan:#6de6ff;--text:#f5f7fb;--muted:#b8c2d6;--line:rgba(255,255,255,0.08);--green:#32d67d;--rose:#ff8fa3}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1280px;min-height:720px;display:grid;place-items:center;padding:24px;color:var(--text);font-family:Arial,Helvetica,sans-serif;background:radial-gradient(circle at 18% 10%,rgba(58,110,199,0.35),transparent 28%),radial-gradient(circle at 82% 18%,rgba(46,171,116,0.15),transparent 24%),linear-gradient(140deg,#040911,#091628 42%,#08111f)}
.snapshot{width:min(1280px,100%);min-height:680px;position:relative;overflow:hidden;border-radius:28px;background:linear-gradient(180deg,rgba(255,255,255,0.04),transparent 25%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent 45%),linear-gradient(180deg,#07101d 0%,#09172a 48%,#06101c 100%);border:1px solid rgba(255,255,255,0.08);box-shadow:0 30px 80px rgba(0,0,0,0.45);padding:24px 28px 26px}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:16px}
.badge{background:linear-gradient(180deg,#d7b26a,#9f7939);color:#1c1202;box-shadow:inset 0 1px 0 rgba(255,255,255,0.35);padding:16px 28px;font-size:28px;letter-spacing:0.06em;font-weight:800;border-radius:16px;text-transform:uppercase}
.date-group{display:flex;gap:12px;align-items:center}
.date-pill{background:rgba(0,0,0,0.28);border-radius:12px;padding:10px 18px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase}
.today-pill{background:linear-gradient(180deg,#2be57a,#18a84b);color:#06210f;box-shadow:0 0 24px rgba(43,229,122,0.35);border-radius:12px;padding:10px 18px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase}
.quote{margin:34px auto 18px;text-align:center;font-family:Georgia,"Times New Roman",serif;font-size:28px;font-style:italic;text-shadow:0 3px 14px rgba(0,0,0,0.7);padding:0 36px;max-width:1120px}
.content{display:grid;grid-template-columns:minmax(0,1fr);gap:20px;margin-top:10px}
.main-card{width:min(860px,calc(100% - 120px));margin:0 auto;border:3px solid rgba(255,214,104,0.9);border-radius:14px;padding:26px 28px 22px;background:rgba(20,39,68,0.56);box-shadow:0 0 0 2px rgba(255,214,104,0.08),0 0 24px rgba(255,214,104,0.24),inset 0 0 24px rgba(255,255,255,0.05);position:relative;z-index:1}
.time{color:var(--cyan);font-size:28px;font-weight:700;margin-bottom:10px}
.headline{font-size:50px;font-weight:900;letter-spacing:0.02em;color:#fff3c8;text-shadow:0 0 18px rgba(255,214,104,0.38);text-transform:uppercase;line-height:1}
.subhead{margin-top:14px;color:var(--muted);font-size:22px}
.secondary-section{width:min(900px,calc(100% - 80px));margin:0 auto;position:relative;z-index:1}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.section-tag{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#d7deea;font-size:12px;border-radius:12px;padding:10px 18px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase}
.section-note{color:rgba(255,255,255,0.5);font-size:12px;letter-spacing:0.08em;text-transform:uppercase}
.rows{display:grid;gap:8px}
.row{border-radius:10px;overflow:hidden;border:1px solid rgba(150,190,230,0.2);background:rgba(43,76,112,0.48);display:grid;grid-template-columns:180px 1fr}
.row-time{padding:10px 14px;font-size:22px;font-weight:700;background:rgba(104,166,225,0.18);border-right:1px solid rgba(255,255,255,0.08)}
.row-label{padding:10px 16px;font-size:22px}
.layout-compact .main-card{width:min(920px,calc(100% - 80px));padding-top:30px;padding-bottom:28px}
.layout-compact .headline{font-size:56px}
.layout-busy .main-card{width:min(800px,calc(100% - 120px))}
.layout-busy .row-time,.layout-busy .row-label{font-size:20px}
.empty-note{color:rgba(255,255,255,0.35);text-align:center;font-size:14px;padding:16px}
</style></head><body>
<div class="snapshot ${layoutClass}" id="root">
  <div class="topbar">
    <div class="badge">Economic Calendar</div>
    <div class="date-group">
      <div class="date-pill">${todayLong()}</div>
      <div class="today-pill">TODAY</div>
    </div>
  </div>
  ${formattedQuote ? `<div class="quote">${formattedQuote}</div>` : ""}
  <div class="content">
    ${headlineEv ? `
    <div class="main-card">
      <div class="time">${fmtTime(headlineEv)} ET</div>
      <div class="headline">${headlineEv.title}</div>
      ${headlineEv.forecast ? `<div class="subhead">Forecast: ${headlineEv.forecast}${headlineEv.previous ? ` &nbsp;|&nbsp; Prev: ${headlineEv.previous}` : ""}</div>` : ""}
    </div>` : `<div class="empty-note">No high-impact events today</div>`}
    ${additionalEvents.length > 0 ? `
    <div class="secondary-section">
      <div class="section-head">
        <div class="section-tag">Additional Events</div>
        <div class="section-note">${eventCount} event${eventCount !== 1 ? "s" : ""} today</div>
      </div>
      <div class="rows">${eventRowsHTML}</div>
    </div>` : ""}
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

// ── Discord icon ──────────────────────────────────────────────────────────────

function IconDiscord({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EconCalendarDiscordBtn() {
  const [s, set] = useState<BtnState>("idle");

  const run = useCallback(async () => {
    if (s === "busy") return;
    set("busy");
    try {
      // Fetch calendar data + quote in parallel
      const [calRes, quoteRes] = await Promise.all([
        fetch("/api/calendar"),
        fetch("/api/calendar-quote").catch(() => null),
      ]);
      const calJson = calRes.ok ? await calRes.json() : {};
      const quoteJson = quoteRes?.ok ? await quoteRes.json() : {};

      const events: CalEvent[] = calJson.events ?? [];
      const quote: string = quoteJson.quote ?? "";

      const html = buildSnapshotHTML(events, quote);
      const img  = await renderAndCapture(html);
      await postToDiscord(img);
      set("ok");
    } catch (e) {
      console.error("[EconCalendarDiscordBtn]", e);
      set("err");
    } finally {
      setTimeout(() => set("idle"), 1800);
    }
  }, [s]);

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#7289da";
  const label = s === "busy" ? "…" : s === "ok" ? "✓ SENT" : s === "err" ? "✕ ERR" : "DISCORD";

  return (
    <button
      onClick={run}
      disabled={s === "busy"}
      title="Share Economic Calendar snapshot to Discord"
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 7px",
        border: `1px solid ${color}40`,
        borderRadius: 2,
        background: "rgba(255,255,255,0.04)",
        color,
        cursor: s === "busy" ? "default" : "pointer",
        fontSize: 9, fontWeight: 700, letterSpacing: ".08em",
        fontFamily: "inherit", flexShrink: 0,
        transition: "color .15s, border-color .15s",
      }}
    >
      <IconDiscord />
      {label}
    </button>
  );
}
