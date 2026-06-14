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

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.forexfactory.com/",
};

export async function GET() {
  let statusCode = 0;
  let bodySnippet = "";

  try {
    const res = await fetch(FF_URL, {
      cache: "no-store",
      headers: FETCH_HEADERS,
    });

    statusCode = res.status;

    if (!res.ok) {
      bodySnippet = await res.text().then(t => t.slice(0, 200)).catch(() => "");
      console.error(`[calendar] FF returned ${statusCode}: ${bodySnippet}`);
      return NextResponse.json(
        { error: `Upstream ${statusCode}`, detail: bodySnippet, events: [] },
        { status: 502 }
      );
    }

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

    console.log(`[calendar] loaded ${events.length} events`);
    return NextResponse.json({ events }, {
      headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calendar] fetch error: ${msg}`);
    return NextResponse.json({ error: msg, events: [] }, { status: 500 });
  }
}
