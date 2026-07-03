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
    // Primary geocoder: zippopotam. Falls back to Nominatim if it fails/throws.
    let loc: { latitude: string; longitude: string; name: string; admin1: string } | null = null;
    try {
      const geoRes = await fetch(`https://api.zippopotam.us/us/${zip}`, { cache: "no-store" });
      if (geoRes.ok) {
        const geo = await geoRes.json();
        const p = geo?.places?.[0];
        if (p) loc = { latitude: p.latitude, longitude: p.longitude, name: p["place name"], admin1: p["state abbreviation"] };
      }
    } catch { /* fall through to Nominatim */ }

    if (!loc) {
      const nomRes = await fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&addressdetails=1&limit=1`,
        { cache: "no-store", headers: { "User-Agent": "cbedge-traders-dashboard/1.0" } }
      );
      if (nomRes.ok) {
        const arr = await nomRes.json();
        const n = Array.isArray(arr) ? arr[0] : null;
        if (n) loc = { latitude: n.lat, longitude: n.lon, name: n.address?.town || n.address?.city || n.address?.village || n.display_name?.split(",")[0] || zip, admin1: n.address?.["ISO3166-2-lvl4"]?.split("-")[1] || "" };
      }
    }

    if (!loc) return NextResponse.json({ error: "ZIP not found" }, { status: 404 });

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
