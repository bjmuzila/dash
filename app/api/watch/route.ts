import { NextRequest, NextResponse } from "next/server";
import { proxyBase } from "@/lib/proxyForward";
import {
  getWatchOptions, insertWatchOption, deleteWatchOption, setWatchAddedPrice,
  insertWatchSnapshot, getLatestWatchSnapshots, getWatchHistory, getWatchHistorySince,
  type WatchOption, type WatchSnapshot,
} from "@/lib/db";

// Chart range → lookback window. "1d" (default, no ?range=) keeps the old
// last-300-snapshots behavior; anything wider queries by timestamp cutoff.
const RANGE_MS: Record<string, number> = {
  "1d": 24 * 3600_000,
  "3d": 3 * 24 * 3600_000,
  "1w": 7 * 24 * 3600_000,
  "1m": 30 * 24 * 3600_000,
};

// Owner options-watchlist tracker.
//   GET                       → { rows } where each row = contract + latest snapshot
//   GET ?history=<id>         → { history } time series for one contract
//   POST { action:"add", ticker, strike, side, expiry, note }
//   POST { action:"remove", id }
//   POST { action:"refresh" } → pull live greeks/price/flow for every contract,
//                               write a snapshot each, return the fresh rows
//
// Live data comes from /proxy/probe-rest (server-v2) — the same REST path the
// /dev + analytics pages use; it resolves any ticker's chain then returns the
// contract's Theta greeks + TT quote + OI/volume in one shot.

export const dynamic = "force-dynamic";

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

interface ProbeResult {
  found?: boolean;
  status?: string;
  resolvedStrike?: number | null;
  result?: {
    feeds?: {
      Quote?: { bid?: number; ask?: number; mid?: number; mark?: number };
      Trade?: { last?: number; volume?: number };
      Summary?: { openInterest?: number; prevClose?: number };
      Greeks?: {
        iv?: number; delta?: number; gamma?: number; theta?: number; vega?: number;
        bsIv?: number; bsDelta?: number; bsGamma?: number; bsTheta?: number; bsVega?: number;
      };
    };
    exposures?: { spot?: number; oi?: number; volume?: number };
  };
}

/** Fetch one side of a strike from /proxy/probe-rest. */
async function fetchProbe(
  ticker: string, expiry: string, side: string, strike: number
): Promise<ProbeResult | null> {
  const url =
    `${proxyBase()}/proxy/probe-rest?ticker=${encodeURIComponent(ticker)}` +
    `&expiry=${encodeURIComponent(expiry)}&type=${side}` +
    `&strike=${encodeURIComponent(strike)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    return (await res.json()) as ProbeResult;
  } catch {
    return null;
  }
}

/** Gamma + position (OI+Vol) + spot for one side, for the net-GEX calc. */
function sideExposure(j: ProbeResult | null): { gamma: number | null; pos: number; spot: number | null } {
  if (!j?.found || !j.result) return { gamma: null, pos: 0, spot: null };
  const g = j.result.feeds?.Greeks ?? {};
  const su = j.result.feeds?.Summary ?? {};
  const tr = j.result.feeds?.Trade ?? {};
  const ex = j.result.exposures ?? {};
  const oi = num(su.openInterest) ?? num(ex.oi) ?? 0;
  const vol = num(tr.volume) ?? num(ex.volume) ?? 0;
  return { gamma: num(g.bsGamma), pos: oi + vol, spot: num(ex.spot) };
}

/**
 * Fetch a contract's live data and shape it into a snapshot (unsaved). Probes
 * BOTH sides of the strike so net_gex reflects the whole strike (call+put),
 * matching lib/calculations: netGEX = |Γc|·(OIc+Volc)·S² − |Γp|·(OIp+Volp)·S².
 */
async function probe(row: WatchOption): Promise<WatchSnapshot | null> {
  const oppSide = row.side === "C" ? "P" : "C";
  const [j, oppJ] = await Promise.all([
    fetchProbe(row.ticker, row.expiration, row.side, row.strike),
    fetchProbe(row.ticker, row.expiration, oppSide, row.strike),
  ]);
  if (!j?.found || !j.result) return null;

  const q = j.result.feeds?.Quote ?? {};
  const tr = j.result.feeds?.Trade ?? {};
  const su = j.result.feeds?.Summary ?? {};
  const g = j.result.feeds?.Greeks ?? {};
  const ex = j.result.exposures ?? {};

  const mark = num(q.mark) ?? num(q.mid);
  const volume = num(tr.volume) ?? num(ex.volume);
  const netPrem = mark != null && volume != null ? mark * volume * 100 : null;

  // Net GEX of the whole strike: dealers long calls (+), short puts (−).
  const watched = sideExposure(j);
  const opp = sideExposure(oppJ);
  const call = row.side === "C" ? watched : opp;
  const put = row.side === "C" ? opp : watched;
  const spot = watched.spot ?? opp.spot;
  let netGex: number | null = null;
  if (spot != null && spot > 0) {
    const callGex = Math.abs(call.gamma ?? 0) * call.pos * spot * spot;
    const putGex = -Math.abs(put.gamma ?? 0) * put.pos * spot * spot;
    netGex = callGex + putGex;
  }

  return {
    watch_id: row.id,
    ts: Date.now(),
    spot: num(ex.spot),
    bid: num(q.bid),
    ask: num(q.ask),
    mark,
    last: num(tr.last),
    // Watch always shows Black-Scholes-calculated greeks (not raw Theta live
    // greeks), so values never blank out on Theta gaps and stay consistent
    // contract-to-contract. See feeds.Greeks.bs* in proxy-tastytrade.js.
    iv: num(g.bsIv) ?? num(g.iv),
    delta: num(g.bsDelta),
    gamma: num(g.bsGamma),
    theta: num(g.bsTheta),
    vega: num(g.bsVega),
    open_interest: num(su.openInterest) ?? num(ex.oi),
    volume,
    net_prem: netPrem,
    prev_close: num(su.prevClose),
    net_gex: netGex,
  };
}

export async function GET(req: NextRequest) {
  try {
    // One-off live quote for a contract (no DB write) — used by the Day Posts
    // trade-idea "Get price": /api/watch?quote=TSLA&expiry=2026-07-17&side=C&strike=420
    const quoteTicker = req.nextUrl.searchParams.get("quote");
    if (quoteTicker) {
      const expiry = String(req.nextUrl.searchParams.get("expiry") || "").trim();
      const side = String(req.nextUrl.searchParams.get("side") || "C").toUpperCase() === "P" ? "P" : "C";
      const strike = Number(req.nextUrl.searchParams.get("strike"));
      if (!expiry || !Number.isFinite(strike)) {
        return NextResponse.json({ error: "expiry and strike required" }, { status: 400 });
      }
      const j = await fetchProbe(quoteTicker.trim().toUpperCase(), expiry, side, strike);
      if (!j?.found || !j.result) return NextResponse.json({ found: false });
      const q = j.result.feeds?.Quote ?? {};
      const tr = j.result.feeds?.Trade ?? {};
      return NextResponse.json({
        found: true,
        bid: num(q.bid), ask: num(q.ask),
        mark: num(q.mark) ?? num(q.mid), last: num(tr.last),
      });
    }

    const historyId = req.nextUrl.searchParams.get("history");
    if (historyId) {
      const range = req.nextUrl.searchParams.get("range") || "";
      const windowMs = RANGE_MS[range];
      const history = windowMs
        ? await getWatchHistorySince(Number(historyId), Date.now() - windowMs)
        : await getWatchHistory(Number(historyId));
      return NextResponse.json({ history });
    }
    const [options, latest] = await Promise.all([
      getWatchOptions(),
      getLatestWatchSnapshots(),
    ]);
    const byId = new Map(latest.map((s) => [s.watch_id, s]));
    const rows = options.map((o) => ({ ...o, snapshot: byId.get(o.id) ?? null }));
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("[/api/watch GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "add") {
      const ticker = String(body.ticker || "").trim().toUpperCase();
      const expiration = String(body.expiry || body.expiration || "").trim();
      const strike = Number(body.strike);
      const side = String(body.side || "").trim().toUpperCase() === "C" ? "C" : "P";
      const note = body.note ? String(body.note).slice(0, 240) : null;
      // Optional user-typed fill price. When present it becomes the permanent
      // "added @" entry (the P&L basis) instead of the auto-captured live mark.
      const entryPrice = Number(body.addedPrice ?? body.entryPrice);
      const hasEntry = Number.isFinite(entryPrice) && entryPrice > 0;
      if (!ticker || !expiration || !Number.isFinite(strike)) {
        return NextResponse.json({ error: "ticker, expiry and strike required" }, { status: 400 });
      }
      const created = await insertWatchOption({ ticker, expiration, strike, side, note });
      // Best-effort immediate snapshot so the row isn't blank until the next poll.
      // The entry price (typed, else the live mark) becomes the permanent "added @".
      if (created) {
        // A typed fill wins as the entry basis — set it first so the mark-based
        // set below no-ops (setWatchAddedPrice only writes when added_price IS NULL).
        if (hasEntry) {
          await setWatchAddedPrice(created.id, entryPrice);
          created.added_price = entryPrice;
        }
        const snap = await probe(created);
        if (snap) {
          await insertWatchSnapshot(snap);
          if (snap.mark != null && !hasEntry) {
            await setWatchAddedPrice(created.id, snap.mark);
            created.added_price = snap.mark;
          }
        }
      }
      return NextResponse.json({ ok: true, created });
    }

    if (action === "remove") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
      await deleteWatchOption(id);
      return NextResponse.json({ ok: true });
    }

    if (action === "refresh") {
      const options = await getWatchOptions();
      let recorded = 0;
      await Promise.all(
        options.map(async (o) => {
          const snap = await probe(o);
          if (snap) { await insertWatchSnapshot(snap); recorded++; }
        })
      );
      const latest = await getLatestWatchSnapshots();
      const byId = new Map(latest.map((s) => [s.watch_id, s]));
      const rows = options.map((o) => ({ ...o, snapshot: byId.get(o.id) ?? null }));
      return NextResponse.json({ ok: true, recorded, rows });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[/api/watch POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
