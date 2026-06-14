import { NextResponse } from "next/server";

interface FFEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
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

async function fetchTrumpEvents(): Promise<CalEvent[]> {
  try {
    const res = await fetch("https://media-cdn.factba.se/rss/json/trump/calendar-full.json", {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const raw: FactbaEvent[] | { events: FactbaEvent[] } = await res.json();
    const items: FactbaEvent[] = Array.isArray(raw) ? raw : ((raw as { events: FactbaEvent[] }).events ?? []);

    return items
      .filter(ev => {
        const name = String(ev.details || ev.type || ev.daily_text || "").toLowerCase();
        return ev.date && !TRUMP_EXCLUDE.some(x => name.includes(x));
      })
      .map(ev => {
        const title = ev.details || ev.type || ev.daily_text || "President Event";
        const date = ev.date ?? "";
        const rawTime = ev.time ?? "";
        let time_formatted = rawTime || "TBD";
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
          country: "USD",
          impact: "President",
          forecast: "",
          previous: "",
          actual: "",
        };
      });
  } catch {
    return [];
  }
}

export async function GET() {
  const proxyBase = process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com";

  try {
    const [econRes, trumpEvents] = await Promise.all([
      fetch(`${proxyBase}/proxy/api/econ-calendar`, {
        next: { revalidate: 1800 },
      }),
      fetchTrumpEvents(),
    ]);

    if (!econRes.ok) {
      const detail = await econRes.text().then(t => t.slice(0, 200)).catch(() => "");
      console.error(`[calendar] proxy returned ${econRes.status}: ${detail}`);
      return NextResponse.json({ error: `Upstream ${econRes.status}`, detail, events: [] }, { status: 502 });
    }

    const raw: FFEvent[] = await econRes.json();

    // USD-only economic events
    const econEvents: CalEvent[] = raw
      .filter(ev => ev.country === "USD")
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

    const events: CalEvent[] = [...econEvents, ...trumpEvents];

    console.log(`[calendar] loaded ${econEvents.length} USD econ + ${trumpEvents.length} Trump events`);
    return NextResponse.json({ events }, {
      headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calendar] error: ${msg}`);
    return NextResponse.json({ error: msg, events: [] }, { status: 500 });
  }
}
