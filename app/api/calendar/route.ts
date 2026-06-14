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

export async function GET() {
  const proxyBase = process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com";

  try {
    const res = await fetch(`${proxyBase}/proxy/api/econ-calendar`, {
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      const detail = await res.text().then(t => t.slice(0, 200)).catch(() => "");
      console.error(`[calendar] proxy returned ${res.status}: ${detail}`);
      return NextResponse.json({ error: `Upstream ${res.status}`, detail, events: [] }, { status: 502 });
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
    console.error(`[calendar] error: ${msg}`);
    return NextResponse.json({ error: msg, events: [] }, { status: 500 });
  }
}
