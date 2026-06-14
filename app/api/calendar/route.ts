import { NextResponse } from "next/server";

interface FFEvent {
  title: string;
  country: string;
  date: string; // ISO8601 with offset e.g. "2026-06-10T08:30:00-04:00"
  impact: string;
  forecast: string;
  previous: string;
  actual?: string;
}

interface CalEvent {
  date: string;        // YYYY-MM-DD ET
  time: string;        // HH:MM (24h ET)
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

export async function GET() {
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
      next: { revalidate: 1800 },
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return NextResponse.json({ error: "Calendar unavailable", events: [] }, { status: res.status });

    const raw: FFEvent[] = await res.json();

    const events: CalEvent[] = raw.map(ev => {
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

    return NextResponse.json({ events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, events: [] }, { status: 500 });
  }
}
