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

/** Fetch one contract's live data and shape it into a snapshot (unsaved). */
async function probe(row: WatchOption): Promise<WatchSnapshot | null> {
  const url =
    `${proxyBase()}/proxy/probe-rest?ticker=${encodeURIComponent(row.ticker)}` +
    `&expiry=${encodeURIComponent(row.expiration)}&type=${row.side}` +
    `&strike=${encodeURIComponent(row.strike)}`;
  let j: ProbeResult;
  try {
    const res = await fetch(url, { cache: "no-store" });
    j = (await res.json()) as ProbeResult;
  } catch {
    return null;
  }
  if (!j?.found || !j.result) return null;

  const q = j.result.feeds?.Quote ?? {};
  const tr = j.result.feeds?.Trade ?? {};
  const su = j.result.feeds?.Summary ?? {};
  const g = j.result.feeds?.Greeks ?? {};
  const ex = j.result.exposures ?? {};

  const mark = num(q.mark) ?? num(q.mid);
  const volume = num(tr.volume) ?? num(ex.volume);
  const netPrem = mark != null && volume != null ? mark * volume * 100 : null;

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
  };
}

export async function GET(req: NextRequest) {
  try {
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
      if (!ticker || !expiration || !Number.isFinite(strike)) {
        return NextResponse.json({ error: "ticker, expiry and strike required" }, { status: 400 });
      }
      const created = await insertWatchOption({ ticker, expiration, strike, side, note });
      // Best-effort immediate snapshot so the row isn't blank until the next poll.
      // Its mark also becomes the permanent "added @" price for this contract.
      if (created) {
        const snap = await probe(created);
        if (snap) {
          await insertWatchSnapshot(snap);
          if (snap.mark != null) {
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
