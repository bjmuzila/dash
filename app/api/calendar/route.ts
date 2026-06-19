import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

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

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const SAVED_EVENTS_PATH = join(process.cwd(), "app/api/econ-calendar/events.json");

async function fetchForexFactoryEvents(): Promise<FFEvent[]> {
  const res = await fetch(FF_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
      "Referer": "https://www.forexfactory.com/",
    },
    next: { revalidate: 1800 },
  });

  if (!res.ok) {
    const detail = await res.text().then(t => t.slice(0, 200)).catch(() => "");
    throw new Error(`ForexFactory ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const raw = await res.json();
  return Array.isArray(raw) ? raw : [];
}

function fetchSavedEvents(): FFEvent[] {
  const raw: LocalEvent[] = JSON.parse(readFileSync(SAVED_EVENTS_PATH, "utf-8"));
  if (!Array.isArray(raw)) return [];

  return raw.map(ev => ({
    title: ev.title ?? ev.name ?? "",
    country: ev.country ?? "USD",
    date: `${ev.date}T${ev.time || "00:00"}:00-04:00`,
    impact: ev.impact ?? "High",
    forecast: ev.forecast ?? "",
    previous: ev.previous ?? ev.period ?? "",
    actual: ev.actual ?? "",
  }));
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
      fetchForexFactoryEvents(),
      fetchTrumpEvents(),
    ]);

    let raw: FFEvent[] = [];
    let source = "forexfactory";
    let warning: string | undefined;

    if (econResult.status === "fulfilled" && econResult.value.length > 0) {
      raw = econResult.value;
    } else {
      warning = econResult.status === "rejected" ? econResult.reason?.message : "ForexFactory returned no events";
      raw = fetchSavedEvents();
      source = "saved";
    }

    const econEvents: CalEvent[] = raw
      .map(ev => {
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

    const events: CalEvent[] = [...econEvents, ...(trumpEvents.status === "fulfilled" ? trumpEvents.value : [])]
      .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time));

    console.log(`[calendar] loaded ${econEvents.length} econ events from ${source} + ${trumpEvents.status === "fulfilled" ? trumpEvents.value.length : 0} Trump events`);
    return NextResponse.json({ events, source, warning }, {
      headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calendar] error: ${msg}`);
    return NextResponse.json({ error: msg, events: [] });
  }
}
