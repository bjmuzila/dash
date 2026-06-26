import { NextRequest, NextResponse } from "next/server";

// Keyless weather for the Traders Dashboard. US ZIP → lat/lon via Open-Meteo's
// geocoder, then current temp + condition via the forecast API. No secrets.

const WMO: Record<number, string> = {
  0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime Fog", 51: "Light Drizzle", 53: "Drizzle", 55: "Heavy Drizzle",
  61: "Light Rain", 63: "Rain", 65: "Heavy Rain", 66: "Freezing Rain", 67: "Freezing Rain",
  71: "Light Snow", 73: "Snow", 75: "Heavy Snow", 77: "Snow Grains",
  80: "Rain Showers", 81: "Rain Showers", 82: "Violent Showers",
  85: "Snow Showers", 86: "Snow Showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
};

export async function GET(req: NextRequest) {
  const zip = (req.nextUrl.searchParams.get("zip") || "").trim();
  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "Valid 5-digit US ZIP required" }, { status: 400 });
  }
  try {
    const geoRes = await fetch(`https://api.zippopotam.us/us/${zip}`, { cache: "no-store" });
    if (!geoRes.ok) return NextResponse.json({ error: "ZIP not found" }, { status: 404 });
    const geo = await geoRes.json();
    const place0 = geo?.places?.[0];
    if (!place0) return NextResponse.json({ error: "ZIP not found" }, { status: 404 });
    const loc = {
      latitude: place0.latitude,
      longitude: place0.longitude,
      name: place0["place name"],
      admin1: place0["state abbreviation"],
    };

    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
        `&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`,
      { cache: "no-store" }
    );
    const w = await wRes.json();
    const cur = w?.current;
    if (!cur) return NextResponse.json({ error: "Weather unavailable" }, { status: 502 });

    return NextResponse.json({
      tempF: Math.round(cur.temperature_2m),
      condition: WMO[cur.weather_code] ?? "—",
      code: cur.weather_code,
      place: `${loc.name}${loc.admin1 ? ", " + loc.admin1 : ""}`,
    });
  } catch (err) {
    return NextResponse.json({ error: "Weather fetch failed", detail: String(err) }, { status: 500 });
  }
}
