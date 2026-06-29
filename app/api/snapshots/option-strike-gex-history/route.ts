import { NextRequest, NextResponse } from "next/server";
import {
  getOptionStrikeRollingNetGex,
  getOptionStrikeNetGexAsOf,
  getOptionStrikeNetGexAsOfOrNearest,
  getOptionStrikeNetGexAtOpen,
  getOptionStrikeGexSlots,
  getOptionStrikeGexSlotsWindow,
  insertOptionStrikeGexRows,
} from "@/lib/db";

function todayET(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .filter((part) => part.type !== "literal")
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {} as Record<string, string>);

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows: Record<string, unknown>[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.rows)
        ? body.rows
        : [body];

    const normalized = rows
      .map((row) => ({
        timestamp: Number(row.timestamp ?? Date.now()),
        date: String(row.date ?? todayET()),
        expiry: String(row.expiry ?? ""),
        spot: Number(row.spot ?? 0),
        strike: Number(row.strike ?? 0),
        net_gex: Number(row.net_gex ?? 0),
        net_vol_gex: row.net_vol_gex == null ? undefined : Number(row.net_vol_gex),
      }))
      .filter((row) => row.expiry && row.strike > 0 && Number.isFinite(row.net_gex));

    await insertOptionStrikeGexRows(normalized);

    return NextResponse.json({ ok: true, count: normalized.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? todayET();
    const expiry = searchParams.get("expiry") ?? "";
    const mode = searchParams.get("mode") ?? "rolling";

    if (!expiry) {
      return NextResponse.json({ error: "expiry is required", rows: [] });
    }

    // mode=heatmap → today's per-strike net GEX collapsed to one reading per
    // (strike, 5-min slot), pre-bucketed into heatmap columns (one per slot)
    // with per-column max + top-3 magnitudes for the intensity gradient. Powers
    // the ES Candles heatmap backfill so history shows immediately on load.
    if (mode === "heatmap") {
      // Rolling window (minutes) overrides the single-ET-day read so the heatmap
      // spans across midnight. Defaults to 24h; capped at 48h. Pass minutes=0 to
      // fall back to the legacy today-only behavior.
      const winParam = searchParams.get("minutes");
      const winMin = winParam == null ? 1440 : Math.max(0, Math.min(2880, Number(winParam)));
      const slots = winMin > 0
        ? await getOptionStrikeGexSlotsWindow(Date.now() - winMin * 60 * 1000, expiry)
        : await getOptionStrikeGexSlots(date, expiry);
      const bySlot = new Map<number, Array<{ strike: number; net: number; netVol: number }>>();
      for (const r of slots) {
        if (!(r.strike > 0) || !Number.isFinite(r.net_gex)) continue;
        let arr = bySlot.get(r.slot_ts);
        if (!arr) { arr = []; bySlot.set(r.slot_ts, arr); }
        // `net` is the OI+Vol convention to match the live front column
        // (page.tsx: netOiVol = netGEX + netVolGEX). Persisting net_gex alone
        // here flips the color on close (positive live → red closed bar).
        const netVol = Number(r.net_vol_gex ?? 0);
        arr.push({ strike: r.strike, net: r.net_gex + (Number.isFinite(netVol) ? netVol : 0), netVol });
      }
      const columns = [...bySlot.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([slotTs, cells]) => {
          const absVals = cells.map((c) => Math.abs(c.net)).filter((v) => v > 0);
          const max = absVals.length ? Math.max(...absVals) : 1;
          const top3 = [...absVals].sort((a, b) => b - a).slice(0, 3);
          return { slotTs, cells, max, top3 };
        });
      return NextResponse.json({ mode: "heatmap", columns });
    }

    // mode=point → per-strike net GEX baselines at the open + each requested age
    // (minutes ago). The popup subtracts these from the live value to get the
    // rolling difference for the open/5m/15m/30m boxes.
    if (mode === "point") {
      const ages = (searchParams.get("ages") ?? "5,15,30")
        .split(",")
        .map((a) => Math.max(1, Math.min(240, Number(a.trim()))))
        .filter((a) => Number.isFinite(a));
      const now = Date.now();
      // tolerant=1 → fall back to the nearest snapshot when nothing is exactly
      // `age` minutes old (chart ghost overlay). Default (popup) stays exact.
      const tolerant = searchParams.get("tolerant") === "1";
      const asOf = tolerant
        ? getOptionStrikeNetGexAsOfOrNearest
        : getOptionStrikeNetGexAsOf;

      const [openRows, ...ageRowSets] = await Promise.all([
        getOptionStrikeNetGexAtOpen(date, expiry),
        ...ages.map((m) => asOf(date, expiry, now - m * 60 * 1000)),
      ]);

      // baselines[strike] = { open, "5", "15", "30" } net GEX values.
      const baselines: Record<number, Record<string, number>> = {};
      const put = (strike: number, key: string, v: number) => {
        (baselines[strike] ??= {})[key] = v;
      };
      // Baselines are OI+Vol composite (net_gex + net_vol_gex) to match the
      // live chart bar, which is the OI+Vol netGEX in "net" mode. This makes the
      // 5m/15m/30m ghost overlay a true live-vs-live comparison instead of
      // live(OI+Vol) vs prior(OI-only), which previously exaggerated the delta.
      const oiVol = (r: { net_gex: number; net_vol_gex?: number }) =>
        r.net_gex + (Number.isFinite(r.net_vol_gex as number) ? (r.net_vol_gex as number) : 0);
      for (const r of openRows) put(r.strike, "open", oiVol(r));
      ages.forEach((m, i) => {
        for (const r of ageRowSets[i]) put(r.strike, String(m), oiVol(r));
      });

      return NextResponse.json({ mode: "point", ages, baselines });
    }

    const minutes = Math.max(1, Math.min(240, Number(searchParams.get("minutes") ?? 30)));
    const sinceTimestamp = Date.now() - minutes * 60 * 1000;
    const rows = await getOptionStrikeRollingNetGex(date, expiry, sinceTimestamp);
    return NextResponse.json({ rows, minutes });
  } catch (err) {
    return NextResponse.json({ error: String(err), rows: [] });
  }
}
