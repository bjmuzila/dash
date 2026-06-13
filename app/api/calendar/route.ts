import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("https://media-cdn.factba.se/rss/json/trump/calendar-full.json", {
      next: { revalidate: 3600 }
    });
    if (!res.ok) return NextResponse.json({ error: "Calendar unavailable", events: [] }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, events: [] }, { status: 500 });
  }
}
