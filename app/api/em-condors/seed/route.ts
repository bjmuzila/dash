import { NextRequest, NextResponse } from "next/server";
import { getDb, getEmBandsForWeek, getEmCondors, upsertEmCondor, queryAll, type EmCondorRow } from "@/lib/db";
import {
  deriveLegs, defaultWing, strikeIncrement, economics, mondayOf, weekLabel,
} from "@/lib/em-condor/compute";

// Seed the Monday condors from that week's Estimated Move bands.
//
// GET  /api/em-condors/seed?week_start=2026-07-27[&wing=25]
//        -> { week_start, week_label, rows: [...] }   preview only, nothing saved
//
// POST /api/em-condors/seed
//        { week_start?, wing?, wings?: { SPX: 25, ... }, tickers?: [...],
//          contracts?, overwrite? }
//        -> { ok, week_start, seeded, skipped, rows }
//
// Non-destructive by default: strikes/credits already on a row are kept
// (COALESCE upsert), so re-running after you've hand-edited a ticker is safe.
// Pass overwrite:true to re-derive every strike from the current band.

export const dynamic = "force-dynamic";

const STRIKE_COLS = ["put_long", "put_short", "call_short", "call_long", "ref_price", "em"];

interface Seeded {
  ticker: string;
  put_long: number;
  put_short: number;
  call_short: number;
  call_long: number;
  ref_price: number | null;
  em: number | null;
  wing: number;
  increment: number;
  band_down: number;
  band_up: number;
  max_loss_width: number;
  exists: boolean;
}

/** Band edges for an EM row: explicit up/down if stored, else ref_close ± em. */
function bandOf(r: { up?: number | null; down?: number | null; ref_close?: number | null; em?: number | null }) {
  const em = Number(r.em);
  const ref = r.ref_close != null ? Number(r.ref_close) : null;
  const up = r.up != null ? Number(r.up) : ref != null && Number.isFinite(em) ? ref + em : null;
  const down = r.down != null ? Number(r.down) : ref != null && Number.isFinite(em) ? ref - em : null;
  if (up == null || down == null || !Number.isFinite(up) || !Number.isFinite(down)) return null;
  // Reference price: stored close if present, otherwise the band midpoint.
  return { up, down, ref: ref ?? (up + down) / 2, em: Number.isFinite(em) ? em : (up - down) / 2 };
}

/**
 * The tickers the EM publisher currently maintains — i.e. the same watchlist the
 * Levels Publish chips show on the EM Tracker tab.
 *
 * ticker_levels IS that roster: the publisher upserts every name it prices and
 * prunes anything no longer in em-tickers.js on each full run, so reading the
 * table needs no import from server-v2 and can't drift from the roster file.
 *
 * Why the condor board needs it: em_tracker keeps bands forever (that's the
 * win/loss history), so seeding straight off it kept offering names that had
 * been dropped from the roster — 285 candidates against a 234-name watchlist,
 * including monthly-only names like ACAD/ACLS/AEIS that have no weekly
 * expiration to build a condor on at all.
 */
async function rosterTickers(): Promise<Set<string>> {
  try {
    const rows = await queryAll<{ ticker: string }>("SELECT ticker FROM ticker_levels");
    return new Set(rows.map((r) => String(r.ticker).toUpperCase()).filter(Boolean));
  } catch {
    return new Set(); // table unreadable — fall through unfiltered rather than blank the board
  }
}

async function build(week_start: string, opts: {
  wing?: number | null;
  wings?: Record<string, number>;
  tickers?: string[];
}): Promise<Seeded[]> {
  const bands = await getEmBandsForWeek(week_start);
  const existing = new Set(
    (await getEmCondors({ week_start })).map((c) => c.ticker.toUpperCase())
  );
  const only = opts.tickers?.length
    ? new Set(opts.tickers.map((t) => t.toUpperCase()))
    : null;
  const roster = await rosterTickers();

  const out: Seeded[] = [];
  for (const b of bands) {
    const ticker = String(b.ticker).toUpperCase();
    if (only && !only.has(ticker)) continue;
    // Off the current watchlist — historical band, not a tradeable candidate.
    // Empty roster = couldn't read the table; don't filter on that.
    if (roster.size && !roster.has(ticker)) continue;
    const band = bandOf(b);
    if (!band) continue;

    const wing = Number(opts.wings?.[ticker]) > 0
      ? Number(opts.wings![ticker])
      : Number(opts.wing) > 0
        ? Number(opts.wing)
        : defaultWing(ticker);

    const legs = deriveLegs({ ticker, down: band.down, up: band.up, wing });
    if (!legs) continue;

    out.push({
      ticker,
      ...legs,
      ref_price: band.ref,
      em: band.em,
      wing,
      increment: strikeIncrement(ticker),
      band_down: band.down,
      band_up: band.up,
      max_loss_width: Math.max(legs.put_short - legs.put_long, legs.call_long - legs.call_short),
      exists: existing.has(ticker),
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    await getDb();
    const p = req.nextUrl.searchParams;
    const week_start = mondayOf(p.get("week_start") || new Date().toISOString().slice(0, 10));
    const wing = p.get("wing") ? Number(p.get("wing")) : null;
    const rows = await build(week_start, { wing });
    return NextResponse.json({ week_start, week_label: weekLabel(week_start), rows });
  } catch (err) {
    console.error("[/api/em-condors/seed GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body = seed this week */ }
    await getDb();

    const week_start = mondayOf(String(body.week_start || new Date().toISOString().slice(0, 10)));
    const label = weekLabel(week_start);
    const contracts = Number(body.contracts) > 0 ? Number(body.contracts) : 1;
    const overwrite = body.overwrite === true;

    const seeded = await build(week_start, {
      wing: body.wing != null ? Number(body.wing) : null,
      wings: (body.wings as Record<string, number>) || undefined,
      tickers: Array.isArray(body.tickers) ? (body.tickers as string[]) : undefined,
    });

    if (!seeded.length) {
      return NextResponse.json({
        ok: true, week_start, week_label: label, seeded: 0, skipped: 0, rows: [],
        note: "No EM bands on record for that week — import/commit the Monday board first.",
      });
    }

    let saved = 0, skipped = 0;
    for (const s of seeded) {
      if (s.exists && !overwrite) { skipped++; continue; }
      const row: EmCondorRow = {
        ticker: s.ticker,
        week_start,
        week_label: label,
        ref_price: s.ref_price,
        em: s.em,
        put_long: s.put_long,
        put_short: s.put_short,
        call_short: s.call_short,
        call_long: s.call_long,
        contracts,
        multiplier: 100,
        result_source: "seed",
      };
      await upsertEmCondor(row, overwrite ? STRIKE_COLS : []);
      saved++;
    }

    return NextResponse.json({
      ok: true,
      week_start,
      week_label: label,
      seeded: saved,
      skipped,
      rows: seeded.map((s) => ({
        ...s,
        // width-only economics (no credit yet) so the UI can show risk up front
        max_loss_no_credit: economics({ ...s, net_credit: 0, multiplier: 100 })?.max_loss ?? null,
      })),
    });
  } catch (err) {
    console.error("[/api/em-condors/seed POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
