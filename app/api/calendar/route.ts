import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

interface FFEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
  actual?: string;
}

interface LocalEvent {
  date: string;
  time: string;
  name?: string;
  title?: string;
  period?: string;
  country?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

interface FactbaEvent {
  date?: string;
  time?: string;
  details?: string;
  type?: string;
  daily_text?: string;
}

interface CalEvent {
  date: string;
  time: string;
  time_formatted: string;
  title: string;
  country: string;
  impact: string;
  forecast: string;
  previous: string;
  actual: string;
}

// VERIFIED 2026-07-27: thisweek is the ONLY file faireconomy publishes here.
// ff_calendar_nextweek.json, ff_calendar_lastweek.json and
// ff_calendar_thismonth.json all return 404 — do not add them back.
//
// That file is Sun–Sat, but the panel renders a ROLLING today→today+6 window, so
// the tail of the window is data upstream hasn't published yet. Since it can't be
// fetched, the cache ACCUMULATES instead: each successful fetch is merged into the
// stored set rather than replacing it, so after a Sunday rollover the cache holds
// both the outgoing and incoming week and the rolling window stays populated.
const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
// How much history the accumulating cache keeps. Two weeks is enough to cover a
// rollover plus the panel's dimmed "already happened" section, and bounds the
// file so it can't grow without limit.
const CACHE_RETAIN_DAYS = 14;
const SAVED_EVENTS_PATH = join(process.cwd(), "app/api/econ-calendar/events.json");
// Last-good upstream response. Lives under state/ because that's the ONLY dir
// bind-mounted in docker-compose (./state:/app/state) — anywhere else in the
// image is ephemeral and the cache would reset on every redeploy, which is the
// exact failure this cache exists to prevent.
const CACHE_PATH = join(process.cwd(), "state", "econ-calendar-cache.json");
const FF_TIMEOUT_MS = 10_000;

// OBSERVED FAILURE (2026-07-27): faireconomy returned `429 Rate Limited` HTML,
// so the route fell through to a saved events.json last touched in June and the
// panel rendered "No events this week." The rate limit was self-inflicted —
// server-v2/econ-alert-recorder.js polls /api/calendar every 20s and NOTHING
// between that and the CDN was cached, so one VPS IP was issuing thousands of
// upstream requests a day against a feed that publishes a few times an hour.
// The TTL cache in getEconEvents() below is the actual fix; everything else here
// (disk cache, window-aware fallback, visible warning) is damage limitation for
// when upstream is down anyway.
const ECON_TTL_MS = 30 * 60 * 1000;      // faireconomy's own guidance is ~30 min
const ECON_BACKOFF_MS = 15 * 60 * 1000;  // after a hard failure, stop hammering

let econCache: { events: FFEvent[]; ts: number; savedAt: string } | null = null;
let econBackoffUntil = 0;

// Upstream answers rate limits with a full HTML error page. Dumping 200 chars of
// that into the error string put "<!DOCTYPE html> <html> <head>..." in the
// user-facing warning banner. Keep the <title> ("Rate Limited") and drop the
// markup; pass plain-text bodies through truncated.
function briefDetail(text: string): string {
  const t = String(text || "").trim();
  if (!t) return "";
  if (/^<(!doctype|html)/i.test(t)) {
    const title = t.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    return title ? `: ${title}` : ": HTML error page";
  }
  return `: ${t.slice(0, 120)}`;
}

const eventKey = (ev: FFEvent) => `${ev.date}|${ev.country}|${ev.title}`;

// Merge a freshly fetched week into what we already hold. Incoming rows WIN on a
// key collision so that forecast/actual values revise in place as the week plays
// out; anything older than CACHE_RETAIN_DAYS is dropped.
function mergeEvents(existing: FFEvent[], incoming: FFEvent[]): FFEvent[] {
  const cutoff = Date.now() - CACHE_RETAIN_DAYS * 86_400_000;
  const byKey = new Map<string, FFEvent>();
  for (const ev of existing) byKey.set(eventKey(ev), ev);
  for (const ev of incoming) byKey.set(eventKey(ev), ev);
  return [...byKey.values()]
    .filter(ev => {
      const t = Date.parse(ev.date);
      return !Number.isFinite(t) || t >= cutoff;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchFFWeek(url: string): Promise<FFEvent[]> {
  // No "Referer: forexfactory.com" header. Spoofing a cross-origin Referer onto
  // the faireconomy CDN is pointless and is one of the signals that gets an IP
  // classified as a scraper — exactly what we do not want while climbing out of
  // a 429. A complete, honest UA is enough.
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
    },
    signal: AbortSignal.timeout(FF_TIMEOUT_MS),
    next: { revalidate: 1800 },
  });

  const name = url.split("/").pop();
  if (!res.ok) {
    const detail = await res.text().then(briefDetail).catch(() => "");
    throw new Error(`${name} ${res.status}${detail}`);
  }

  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`${name}: non-array payload`);
  return raw;
}

async function fetchForexFactoryEvents(): Promise<FFEvent[]> {
  const events = await fetchFFWeek(FF_URL);
  if (!events.length) throw new Error("ForexFactory returned no events");
  return events;
}

// savedAt is passed in rather than stamped here so the disk copy and the
// in-process copy carry the SAME timestamp — the TTL check compares against it
// after a restart, and two independently-taken clocks would make the seeded
// cache look older (or newer) than it is.
function writeCache(events: FFEvent[], savedAt: string): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ savedAt, events }));
  } catch (err) {
    console.warn(`[calendar] cache write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function readCache(): { events: FFEvent[]; savedAt: string } | null {
  try {
    const j = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    if (!Array.isArray(j?.events) || !j.events.length) return null;
    return { events: j.events, savedAt: String(j.savedAt ?? "unknown") };
  } catch {
    return null;
  }
}

// The single gate in front of the upstream CDN. Every caller — page loads, the
// 20s alert recorder, the Discord snapshot — goes through here, so upstream sees
// at most one request per ECON_TTL_MS regardless of local traffic.
async function getEconEvents(): Promise<{ events: FFEvent[]; savedAt: string; fresh: boolean }> {
  const now = Date.now();

  if (econCache && now - econCache.ts < ECON_TTL_MS) {
    return { ...econCache, fresh: true };
  }

  // Seed from disk on first call after a restart so a redeploy doesn't send a
  // fetch upstream before the TTL has had a chance to apply.
  if (!econCache) {
    const disk = readCache();
    if (disk) {
      const diskTs = Date.parse(disk.savedAt);
      econCache = { events: disk.events, ts: Number.isFinite(diskTs) ? diskTs : 0, savedAt: disk.savedAt };
      if (now - econCache.ts < ECON_TTL_MS) return { ...econCache, fresh: true };
    }
  }

  if (now < econBackoffUntil) {
    const mins = Math.ceil((econBackoffUntil - now) / 60_000);
    if (econCache) return { ...econCache, fresh: false };
    throw new Error(`upstream in backoff after a failed fetch; retrying in ~${mins}m`);
  }

  try {
    const fetched = await fetchForexFactoryEvents();
    // Accumulate rather than replace — see the FF_URL comment. Without this, the
    // Sunday rollover would silently drop the outgoing week from the cache.
    const events = mergeEvents(econCache?.events ?? [], fetched);
    const savedAt = new Date(now).toISOString();
    econCache = { events, ts: now, savedAt };
    writeCache(events, savedAt);
    econBackoffUntil = 0;
    return { ...econCache, fresh: true };
  } catch (err) {
    econBackoffUntil = now + ECON_BACKOFF_MS;
    // A stale cache beats no calendar. Surface it as not-fresh so the caller can
    // warn instead of silently presenting old data as live.
    if (econCache) return { ...econCache, fresh: false };
    throw err;
  }
}

// Solve a New-York wall-clock date+time to a real UTC instant. The old code
// hardcoded "-04:00", which silently shifted every saved event an hour once ET
// left daylight time. Two passes converge because the offset error is itself
// what the first pass measures.
function etWallClockToISO(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let utc = target;

  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(utc));
    const g = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
    const rendered = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
    const diff = target - rendered;
    if (!diff) break;
    utc += diff;
  }
  return new Date(utc).toISOString();
}

function fetchSavedEvents(): FFEvent[] {
  const raw: LocalEvent[] = JSON.parse(readFileSync(SAVED_EVENTS_PATH, "utf-8"));
  if (!Array.isArray(raw)) return [];

  return raw.map(ev => ({
    title: ev.title ?? ev.name ?? "",
    country: ev.country ?? "USD",
    date: etWallClockToISO(ev.date, ev.time),
    impact: ev.impact ?? "High",
    forecast: ev.forecast ?? "",
    previous: ev.previous ?? ev.period ?? "",
    actual: ev.actual ?? "",
  }));
}

// The rolling ET window the panel renders (today → today+6). Date-only UTC
// arithmetic, so a DST boundary inside the window can't skip or repeat a day.
function etWindowDays(days = 7): string[] {
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [y, m, d] = todayStr.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length: days }, (_, i) =>
    new Date(base + i * 86_400_000).toISOString().slice(0, 10)
  );
}

function toET(iso: string): { date: string; time: string; time_formatted: string } {
  const d = new Date(iso);
  const etDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const etTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(d);
  const et24 = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return { date: etDate, time: et24, time_formatted: etTime };
}

const TRUMP_EXCLUDE = ["executive time", "pool call", "in-town pool"];
let trumpCache: { body: CalEvent[]; ts: number } = { body: [], ts: 0 };
const TRUMP_CACHE_TTL = 30 * 60 * 1000;

async function fetchTrumpEvents(): Promise<CalEvent[]> {
  if (trumpCache.body.length && Date.now() - trumpCache.ts < TRUMP_CACHE_TTL) {
    return trumpCache.body;
  }

  try {
    const res = await fetch("https://media-cdn.factba.se/rss/json/trump/calendar-full.json", {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const raw: FactbaEvent[] | { events: FactbaEvent[] } = await res.json();
    const items: FactbaEvent[] = Array.isArray(raw) ? raw : ((raw as { events: FactbaEvent[] }).events ?? []);

    const mapped: CalEvent[] = [];
    const seenDateHour = new Set<string>();

    for (const ev of items) {
      const name = String(ev.details || ev.type || ev.daily_text || "").toLowerCase();

      // Skip excluded keywords
      if (!ev.date || TRUMP_EXCLUDE.some(x => name.includes(x))) continue;

      // Skip TBD (no time set)
      const rawTime = ev.time ?? "";
      if (!rawTime) continue;

      const title = ev.details || ev.type || ev.daily_text || "President Event";
      const date = ev.date;

      // One event per hour per day
      const hour = rawTime.split(":")[0];
      const hourKey = `${date}-${hour}`;
      if (seenDateHour.has(hourKey)) continue;
      seenDateHour.add(hourKey);

      let time_formatted = rawTime;
      if (rawTime.includes(":")) {
        const [h, m] = rawTime.split(":").map(Number);
        const ampm = h >= 12 ? "PM" : "AM";
        const h12 = h % 12 || 12;
        time_formatted = `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
      }

      mapped.push({
        date,
        time: rawTime,
        time_formatted,
        title,
        country: "USD",
        impact: "President",
        forecast: "",
        previous: "",
        actual: "",
      });
    }

    trumpCache = { body: mapped, ts: Date.now() };
    return mapped;
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const [econResult, trumpEvents] = await Promise.allSettled([
      getEconEvents(),
      fetchTrumpEvents(),
    ]);

    const normalize = (list: FFEvent[]): CalEvent[] =>
      list.map(ev => {
        const { date, time, time_formatted } = toET(ev.date);
        return {
          date,
          time,
          time_formatted,
          title: ev.title,
          country: ev.country,
          impact: ev.impact,
          forecast: ev.forecast,
          previous: ev.previous,
          actual: ev.actual ?? "",
        };
      });

    const window = new Set(etWindowDays(7));
    const coversWindow = (list: CalEvent[]) => list.some(e => window.has(e.date));

    let econEvents: CalEvent[] = [];
    let source = "forexfactory";
    let warning: string | undefined;

    if (econResult.status === "fulfilled") {
      econEvents = normalize(econResult.value.events);
      source = econResult.value.fresh ? "forexfactory" : "cache";
      if (!econResult.value.fresh) {
        warning = `Live economic feed unavailable — showing cached data from ${econResult.value.savedAt}.`;
      }
    } else {
      const upstreamErr = econResult.reason instanceof Error
        ? econResult.reason.message
        : String(econResult.reason);

      // Fall back ONLY to something that actually covers the window the panel
      // renders. The old code fell back unconditionally, so a months-old
      // events.json got served with source:"saved" and every row filtered out —
      // indistinguishable from a genuinely quiet week.
      const candidates: { src: string; list: CalEvent[]; note: string }[] = [];
      const cached = readCache();
      if (cached) {
        candidates.push({ src: "cache", list: normalize(cached.events), note: `cached feed from ${cached.savedAt}` });
      }
      try {
        candidates.push({ src: "saved", list: normalize(fetchSavedEvents()), note: "manually saved events.json" });
      } catch (err) {
        console.warn(`[calendar] saved fallback unreadable: ${err instanceof Error ? err.message : String(err)}`);
      }

      const hit = candidates.find(c => coversWindow(c.list));
      if (hit) {
        econEvents = hit.list;
        source = hit.src;
        warning = `Live economic feed unavailable (${upstreamErr}) — showing ${hit.note}.`;
      } else {
        source = "unavailable";
        warning = `Economic calendar feed unavailable (${upstreamErr}). No cached or saved events cover the current week.`;
      }
    }

    const events: CalEvent[] = [...econEvents, ...(trumpEvents.status === "fulfilled" ? trumpEvents.value : [])]
      .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time));

    const inWindow = econEvents.filter(e => window.has(e.date)).length;
    console.log(`[calendar] loaded ${econEvents.length} econ events (${inWindow} in the next 7d) from ${source} + ${trumpEvents.status === "fulfilled" ? trumpEvents.value.length : 0} Trump events${warning ? ` — ${warning}` : ""}`);
    return NextResponse.json({ events, source, warning }, {
      headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calendar] error: ${msg}`);
    // Also send `warning` and source:"unavailable". This response is HTTP 200, so
    // clients checking res.ok see success — without a warning here a hard failure
    // renders as an ordinary empty week, which is how this broke unnoticed.
    return NextResponse.json({
      error: msg,
      warning: `Economic calendar failed to load: ${msg}`,
      source: "unavailable",
      events: [],
    });
  }
}
