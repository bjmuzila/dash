/**
 * GET /api/econ-snapshot-html  —  internal only.
 *
 * Returns the Economic Calendar snapshot as a finished, fully self-contained
 * HTML document (every image already inlined as a data URL), laid out at
 * 1280x720 and ready to be screenshotted by a headless browser.
 *
 * WHY THIS ROUTE EXISTS
 * The 📅 Discord button (components/shared/EconCalendarDiscordBtn.tsx) builds
 * that HTML in the browser via buildCalendarTemplateImage() and rasterises it
 * with html2canvas. The scheduled morning post
 * (server-v2/econ-calendar-discord.js) needs the SAME picture, but it runs in
 * plain Node with no DOM. Rather than port the 700-line template into CJS — the
 * copy-and-drift trap that server-v2/mg-ladder-discord.js documents at length —
 * this route imports buildSnapshotHTML() from lib/discord/econSnapshot, the one
 * and only copy, and hands the markup out over HTTP. The cron just screenshots
 * it. Edit the layout in lib/discord/econSnapshot and BOTH surfaces change.
 *
 * Data comes from the same four sources the button uses — /api/calendar,
 * /api/calendar-quote, /proxy/earnings-week, /proxy/ticker-logo — fetched
 * server-side against this same origin with the internal-token bypass, since
 * /proxy/* is subscriber-gated and the cron has no session.
 *
 * ACCESS: x-internal-token must match INTERNAL_API_TOKEN. Anything else gets a
 * 404 (not a 401 — this route's existence is not interesting to the public).
 * middleware.ts short-circuits on that same header, so no matcher change is
 * needed here.
 *
 * Response headers x-econ-events / x-econ-pres / x-econ-earn carry today's row
 * counts so the caller can skip posting an empty calendar without re-fetching
 * and re-counting the feed itself. x-econ-feed / x-econ-warning say WHY a day is
 * empty: a genuinely quiet Tuesday and a dead upstream feed both produce zero
 * rows, and only one of them is worth staying quiet about.
 */

import type { NextRequest } from "next/server";
import { buildSnapshotHTML } from "@/lib/discord/econSnapshot";
import type { CalEvent, EarnRow } from "@/lib/discord/econSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export async function GET(req: NextRequest) {
  const token = (process.env.INTERNAL_API_TOKEN || "").trim();
  const sent = (req.headers.get("x-internal-token") || "").trim();
  if (!token || sent !== token) {
    return new Response("Not found", { status: 404 });
  }

  // LOOPBACK, not req.nextUrl.origin. The public origin routes back out through
  // Cloudflare, where /api/calendar's own `s-maxage=1800` can serve a CDN-cached
  // copy — including a cached EMPTY one from a minute when the upstream feed was
  // down. 127.0.0.1 is the same process answering itself: no TLS, no CDN, no
  // cache, and it cannot fail because the public hostname is having a bad day.
  const origin = `http://127.0.0.1:${process.env.PORT || 3002}`;
  const headers = { "x-internal-token": token };

  async function getJson(path: string): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(`${origin}${path}`, { cache: "no-store", headers });
      if (!res.ok) return {};
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  // Same job blobToDataUrl() does for the button, minus FileReader (browser
  // only). Returns "" on anything that isn't a real image — the template falls
  // back to a text chip, which is why every failure here is silent.
  async function getImageDataUrl(path: string): Promise<string> {
    try {
      const res = await fetch(`${origin}${path}`, { cache: "no-store", headers });
      if (!res.ok) return "";
      const type = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!type.startsWith("image/")) return "";
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) return "";
      return `data:${type};base64,${buf.toString("base64")}`;
    } catch {
      return "";
    }
  }

  const [calJson, quoteJson, ernJson] = await Promise.all([
    getJson("/api/calendar"),
    getJson("/api/calendar-quote"),
    getJson("/proxy/earnings-week"),
  ]);

  const events: CalEvent[] = Array.isArray(calJson.events) ? (calJson.events as CalEvent[]) : [];

  // /api/calendar ANSWERS 200 WITH events:[] WHEN THE FEED IS DOWN, attaching a
  // `warning` and source:"unavailable" — its own code comments say a hard
  // failure otherwise "renders as an ordinary empty week". Pass that distinction
  // on: a caller that skips quiet days must not also skip broken ones, because
  // those are the days it most needs to complain about.
  const feedWarning = typeof calJson.warning === "string" ? calJson.warning : "";
  const feedSource = typeof calJson.source === "string" ? calJson.source : "";
  const feedOk = feedSource !== "unavailable" && !calJson.error;
  const quote: string = typeof quoteJson.quote === "string" ? quoteJson.quote : "";

  // /proxy/earnings-week returns the whole week — today only, biggest first.
  // Identical filter/sort to buildCalendarTemplateImage(); if one changes the
  // other must, or the button and the cron stop agreeing on the earnings lane.
  const today = etToday();
  const allEarn: EarnRow[] = Array.isArray(ernJson.rows) ? (ernJson.rows as EarnRow[]) : [];
  const earnings: EarnRow[] = allEarn
    .filter((r) => r.date === today)
    .sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));

  const logoDataUrl = await getImageDataUrl("/cb-edge-square.png");

  const tickerLogos: Record<string, string> = {};
  await Promise.all(
    earnings.map(async (r) => {
      const url = await getImageDataUrl(
        `/proxy/ticker-logo?sym=${encodeURIComponent(r.symbol.toUpperCase())}&name=${encodeURIComponent(r.company || "")}`
      );
      if (url) tickerLogos[r.symbol] = url;
    })
  );

  // Counts are computed the way the template filters, so "0 events" here means
  // the rendered image really would be empty.
  const todays = events.filter((e) => e.date === today);
  const econCount = todays.filter(
    (e) => e.country === "USD" && e.impact !== "Holiday" && e.impact !== "President"
  ).length;
  const presCount = todays.filter((e) => e.impact === "President").length;

  const html = buildSnapshotHTML(events, quote, logoDataUrl, earnings, tickerLogos);

  // ONE LINE THAT ANSWERS "why is the snapshot empty".
  // The first empty post cost an afternoon precisely because nothing recorded
  // what this route fetched: the feed was healthy, the filters were right, and
  // the image still came out blank. `origin` is in here because it WAS the bug —
  // the route used to fetch its own data through the public hostname.
  console.log(
    `[econ-snapshot] origin=${origin} feed=${feedOk ? feedSource || "ok" : "unavailable"} ` +
    `events=${events.length} today=${todays.length} econ=${econCount} pres=${presCount} ` +
    `earn=${earnings.length} logos=${Object.keys(tickerLogos).length} logo=${logoDataUrl ? "y" : "n"}` +
    (feedWarning ? ` warning=${feedWarning}` : "")
  );

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-econ-events": String(econCount),
      "x-econ-pres": String(presCount),
      "x-econ-earn": String(earnings.length),
      // "ok" | "cache" | "unavailable" — why an empty day is empty.
      "x-econ-feed": feedOk ? (feedSource || "ok") : "unavailable",
      // Header values must be latin-1 and single-line; the warning is free text
      // from upstream, so strip it rather than throw on a stray character.
      "x-econ-warning": feedWarning.replace(/[^\x20-\x7E]/g, " ").slice(0, 300),
    },
  });
}
