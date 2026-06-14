import { NextResponse } from "next/server";

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

const EXCLUDE = ["executive time", "pool call", "in-town pool"];

let _cache: { body: CalEvent[]; ts: number } = { body: [], ts: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 min

export async function GET() {
  if (_cache.body.length && Date.now() - _cache.ts < CACHE_TTL) {
    return NextResponse.json({ events: _cache.body }, { headers: { "X-Cache": "HIT" } });
  }

  try {
    const res = await fetch("https://media-cdn.factba.se/rss/json/trump/calendar-full.json", {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      return NextResponse.json({ events: [], error: `Upstream ${res.status}` }, { status: 502 });
    }

    const raw: FactbaEvent[] | { events: FactbaEvent[] } = await res.json();
    const items: FactbaEvent[] = Array.isArray(raw) ? raw : (raw as { events: FactbaEvent[] }).events ?? [];

    const events: CalEvent[] = items
      .filter(ev => {
        const name = String(ev.details || ev.type || ev.daily_text || "").toLowerCase();
        return !EXCLUDE.some(x => name.includes(x));
      })
      .map(ev => {
        const title = ev.details || ev.type || ev.daily_text || "President Event";
        const date = ev.date ?? "";
        const rawTime = ev.time ?? "";

        // Format time: "HH:MM" → "HH:MM AM/PM"
        let time_formatted = rawTime ? rawTime : "TBD";
        if (rawTime && rawTime.includes(":")) {
          const [h, m] = rawTime.split(":").map(Number);
          const ampm = h >= 12 ? "PM" : "AM";
          const h12 = h % 12 || 12;
          time_formatted = `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
        }

        return {
          date,
          time: rawTime,
          time_formatted,
          title,
          country: "US",
          impact: "President",
          forecast: "",
          previous: "",
          actual: "",
        };
      })
      .filter(ev => ev.date);

    _cache = { body: events, ts: Date.now() };
    return NextResponse.json({ events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ events: [], error: msg }, { status: 500 });
  }
}
