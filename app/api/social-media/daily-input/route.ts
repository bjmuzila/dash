import { NextResponse } from "next/server";
import { proxyBase } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/social-media/daily-input — one bundled pre-market read for the Social
 * Media page's "Daily Input" panel. Composes existing live sources (no new
 * proxy behavior): SPX spot / call wall / put wall / gamma flip / net GEX come
 * from the same /proxy/gex frame the Overview + Greeks pages use; the expected
 * move is derived from the SPX ATM straddle exactly like EstimatedMoves
 * (0.84 * avgIV * spot * sqrt(dte/365), straddle-mid fallback); ES overnight
 * high/low come from the /ESU26 5m candle history the ES pages already read.
 *
 * Every field is best-effort: a failed leg returns null for that field so the
 * client can show "--" and let the user type the value in. Nothing here writes.
 */

interface DailyInput {
  spxSpot: number | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  expectedMove: number | null;
  expectedMoveExpiry: string | null;
  netGex: number | null; // billions of $
  esOvernightHigh: number | null;
  esOvernightLow: number | null;
  updatedAt: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function daysTo(exp: string): number {
  return Math.ceil((new Date(exp + "T16:00:00").getTime() - Date.now()) / 86_400_000);
}

interface Leg {
  strike: number;
  type: "CALL" | "PUT";
  bid: number;
  ask: number;
  mark: number;
  last: number;
  iv: number;
  dte: number;
}

function legMid(o: Leg): number {
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  if (o.mark > 0) return o.mark;
  if (o.last > 0) return o.last;
  return 0;
}

// Flatten the nested broker chain payload ({ data: { items: [{ expiration-date,
// strikes: [{ strike-price, call, put }] }] } }) into a flat leg list. Mirrors
// EstimatedMoves.normalizeOptions for the fields the straddle needs.
function flattenChain(json: unknown): { legs: Leg[]; underlying: number } {
  const root = (json ?? {}) as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  const legs: Leg[] = [];
  for (const grp of items) {
    const expiration = String(
      grp["expiration-date"] ?? grp.expirationDate ?? grp.expiration ?? ""
    );
    const strikes = Array.isArray(grp.strikes) ? (grp.strikes as Record<string, unknown>[]) : [];
    for (const row of strikes) {
      const strike = Number(row["strike-price"] ?? row.strikePrice ?? row.strike ?? 0);
      if (!(strike > 0)) continue;
      for (const side of ["call", "put"] as const) {
        const leg = row[side] as Record<string, unknown> | undefined;
        if (!leg) continue;
        legs.push({
          strike,
          type: side.toUpperCase() as "CALL" | "PUT",
          bid: Number(leg.bid ?? leg["bid-price"] ?? 0),
          ask: Number(leg.ask ?? leg["ask-price"] ?? 0),
          mark: Number(leg.mark ?? leg["mark-price"] ?? leg["mid-price"] ?? 0),
          last: Number(leg.last ?? leg["last-price"] ?? 0),
          iv: Number(leg.iv ?? leg["implied-volatility"] ?? leg.volatility ?? 0),
          dte: Number(leg.dte ?? leg.daysToExpiration ?? (expiration ? daysTo(expiration) : 0)),
        });
      }
    }
  }
  const underlying = Number(
    data.underlyingPrice ?? data.underlying_price ?? root.underlyingPrice ?? 0
  );
  return { legs, underlying };
}

// Expected move from the nearest-dated SPX expiration's ATM straddle. Same
// formula + fallback EstimatedMoves uses; returns { em, expiry } or nulls.
async function computeExpectedMove(
  base: string,
  spot: number
): Promise<{ em: number | null; expiry: string | null }> {
  try {
    const r = await fetch(`${base}/proxy/api/tt/chains/SPX`, { cache: "no-store" });
    if (!r.ok) return { em: null, expiry: null };
    const { legs, underlying } = flattenChain(await r.json());
    if (!legs.length) return { em: null, expiry: null };

    const center = underlying > 0 ? underlying : spot;
    if (!(center > 0)) return { em: null, expiry: null };

    // Group legs by days-to-expiration → walk from the nearest expiration out.
    const byDte = new Map<number, Leg[]>();
    for (const l of legs) {
      const d = Math.max(0, l.dte);
      if (!byDte.has(d)) byDte.set(d, []);
      byDte.get(d)!.push(l);
    }
    const dtes = [...byDte.keys()].sort((a, b) => a - b);
    if (!dtes.length) return { em: null, expiry: null };

    for (const dte of dtes) {
      const pool = byDte.get(dte)!;
      const strikes = [...new Set(pool.map((l) => l.strike))]
        .sort((a, b) => Math.abs(a - center) - Math.abs(b - center))
        .slice(0, 8);
      for (const k of strikes) {
        const c = pool.find((l) => l.strike === k && l.type === "CALL");
        const p = pool.find((l) => l.strike === k && l.type === "PUT");
        if (!c || !p) continue;
        const avgIV = (Number(c.iv || 0) + Number(p.iv || 0)) / 2;
        const effDte = c.dte || p.dte || dte;
        let em = 0;
        if (avgIV > 0 && effDte > 0) {
          em = 0.84 * avgIV * center * Math.sqrt(effDte / 365);
        } else {
          const cMid = legMid(c);
          const pMid = legMid(p);
          if (cMid > 0 && pMid > 0) em = (cMid + pMid) * 0.85;
        }
        if (Number.isFinite(em) && em > 0) {
          const emPct = em / center;
          if (emPct < 0.002 || emPct > 0.25) continue;
          return { em, expiry: dteToDateLabel(dte) };
        }
      }
    }
    return { em: null, expiry: null };
  } catch {
    return { em: null, expiry: null };
  }
}

function dteToDateLabel(dte: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, dte));
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

// ES overnight session high/low from the persisted 5m ES candle store
// (/api/snapshots/candles — the same rows the ES-gap tracker reads). "Overnight"
// = every bar AFTER the prior 16:00 ET cash close through the upcoming 09:30
// open. slotKey is "YYYY-MM-DDThh:mm" (ET wall clock), mirroring the tracker's
// own slotKey slicing.
async function computeEsOvernight(
  base: string
): Promise<{ high: number | null; low: number | null }> {
  try {
    // Pull the last ~2 days of bars so the overnight window (prior 16:00 →
    // now) is always covered regardless of when this runs pre-market.
    const r = await fetch(`${base}/api/snapshots/candles?daysBack=2&limit=2000`, {
      cache: "no-store",
    });
    if (!r.ok) return { high: null, low: null };
    const json = (await r.json()) as { rows?: Record<string, unknown>[] };
    const rows = Array.isArray(json.rows) ? json.rows : [];
    if (!rows.length) return { high: null, low: null };

    // Keep only overnight bars: time-of-day either >= 16:00 (evening session)
    // or < 09:30 (pre-open). slotKey time component is chars 11..16 ("hh:mm").
    const overnight = rows.filter((row) => {
      const slot = String(row.slotKey ?? "");
      const hhmm = slot.slice(11, 16);
      if (!hhmm) return false;
      return hhmm >= "16:00" || hhmm < "09:30";
    });
    const pool = overnight.length ? overnight : rows;

    const highs: number[] = [];
    const lows: number[] = [];
    for (const row of pool) {
      const hi = Number(row.high);
      const lo = Number(row.low);
      if (Number.isFinite(hi) && hi > 0) highs.push(hi);
      if (Number.isFinite(lo) && lo > 0) lows.push(lo);
    }
    if (!highs.length || !lows.length) return { high: null, low: null };
    return { high: Math.max(...highs), low: Math.min(...lows) };
  } catch {
    return { high: null, low: null };
  }
}

export async function GET() {
  const base = proxyBase();
  const out: DailyInput = {
    spxSpot: null,
    gammaFlip: null,
    callWall: null,
    putWall: null,
    expectedMove: null,
    expectedMoveExpiry: null,
    netGex: null,
    esOvernightHigh: null,
    esOvernightLow: null,
    updatedAt: Date.now(),
  };

  // GEX frame: spot / walls / flip / net GEX. Same /proxy/gex the heatmap uses.
  let spotForEm = 0;
  try {
    const r = await fetch(`${base}/proxy/gex`, { cache: "no-store" });
    if (r.ok) {
      const p = (await r.json()) as Record<string, unknown>;
      const spot = Number(p.spot ?? 0);
      out.spxSpot = spot > 0 ? spot : null;
      spotForEm = spot;
      out.callWall = p.callWall != null ? Number(p.callWall) || null : null;
      out.putWall = p.putWall != null ? Number(p.putWall) || null : null;
      out.gammaFlip = p.gexFlip != null ? Number(p.gexFlip) || null : null;
      const totals = p.totals as Record<string, unknown> | null | undefined;
      const totalGex = totals ? Number(totals.totalGEX ?? 0) : Number(p.totalNetGex ?? 0);
      out.netGex = Number.isFinite(totalGex) && totalGex !== 0 ? totalGex / 1e9 : null;
    }
  } catch {
    /* leave nulls */
  }

  // EM + ES overnight in parallel (independent of each other).
  const [em, es] = await Promise.all([
    computeExpectedMove(base, spotForEm),
    computeEsOvernight(base),
  ]);
  out.expectedMove = em.em;
  out.expectedMoveExpiry = em.expiry;
  out.esOvernightHigh = es.high;
  out.esOvernightLow = es.low;

  return NextResponse.json(
    { data: out },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
