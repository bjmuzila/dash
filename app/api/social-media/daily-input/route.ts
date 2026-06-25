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
  // Prior-day SPX cash close + the EM band centered on it.
  spxPrevClose: number | null;
  emUpper: number | null; // prevClose + expectedMove
  emLower: number | null; // prevClose - expectedMove
  // Per-strike net GEX around spot for the Explainer ladder (netGEX in $millions,
  // windowed to ±GEX_LADDER_HALF strikes around the ATM strike, sorted high→low).
  gexLadder: { strike: number; netGex: number }[];
  updatedAt: number;
}

// How many strikes above and below the ATM strike to include in the ladder.
const GEX_LADDER_HALF = 8;

interface GexRow { strike: number; netGEX: number }

// Pull a clean per-strike net-GEX ladder out of the /proxy/gex frame's gexRows.
// Returns netGEX in $millions, windowed around the strike nearest spot, sorted
// high→low (matching the dashboard ladder orientation). Empty array on any miss
// so the client can fall back to its visual taper.
function buildGexLadder(gexRows: unknown, spot: number): { strike: number; netGex: number }[] {
  if (!Array.isArray(gexRows) || !(spot > 0)) return [];
  const rows: GexRow[] = gexRows
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { strike: Number(o.strike ?? 0), netGEX: Number(o.netGEX ?? o.netGex ?? 0) };
    })
    .filter((r) => r.strike > 0 && Number.isFinite(r.netGEX));
  if (!rows.length) return [];
  rows.sort((a, b) => a.strike - b.strike);
  // Index of the strike nearest spot, then window ±GEX_LADDER_HALF around it.
  let atm = 0;
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(rows[i].strike - spot) < Math.abs(rows[atm].strike - spot)) atm = i;
  }
  const start = Math.max(0, atm - GEX_LADDER_HALF);
  const end = Math.min(rows.length, atm + GEX_LADDER_HALF + 1);
  return rows
    .slice(start, end)
    .sort((a, b) => b.strike - a.strike) // high → low (top of the ladder = highest strike)
    .map((r) => ({ strike: r.strike, netGex: r.netGEX / 1e6 }));
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
  gamma: number;
  oi: number;
  volume: number;
  expiration: string;
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
          gamma: Math.abs(Number(leg.gamma ?? 0)),
          oi: Number(leg["open-interest"] ?? leg.openInterest ?? leg.oi ?? 0),
          volume: Number(leg.volume ?? 0),
          expiration,
        });
      }
    }
  }
  const underlying = Number(
    data.underlyingPrice ?? data.underlying_price ?? root.underlyingPrice ?? 0
  );
  return { legs, underlying };
}

// ── Per-expiry GEX (0DTE / 1DTE) ─────────────────────────────────────────────
// Compute per-strike net GEX + walls + flip + total for ONE expiration's legs,
// using the dashboard's exact conventions (server-v2/computation/gex-calculator):
//   GEX = |gamma| × OI × spot²   (calls +, puts −)
//   flip = zero-crossing of cumulative net GEX (linear interpolation)
//   call wall = max +netGEX above spot · put wall = min −netGEX below spot
interface StrikeGex { strike: number; netGEX: number }
interface ExpiryGex {
  ladder: { strike: number; netGex: number }[]; // netGex in $millions, ±N around ATM, high→low
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
  netGex: number | null; // billions of $
}

function computeExpiryGex(legs: Leg[], spot: number): ExpiryGex | null {
  if (!legs.length || !(spot > 0)) return null;
  const byStrike = new Map<number, { call?: Leg; put?: Leg }>();
  for (const l of legs) {
    if (!(l.strike > 0)) continue;
    const e = byStrike.get(l.strike) ?? {};
    if (l.type === "CALL") e.call = l; else e.put = l;
    byStrike.set(l.strike, e);
  }
  const rows: StrikeGex[] = [];
  for (const [strike, s] of byStrike) {
    const callGEX = (s.call?.gamma ?? 0) * (s.call?.oi ?? 0) * spot * spot;
    const putGEX = -((s.put?.gamma ?? 0) * (s.put?.oi ?? 0) * spot * spot);
    rows.push({ strike, netGEX: callGEX + putGEX });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.strike - b.strike);

  // flip — cumulative net-GEX zero crossing
  let cum = 0, prevCum = 0, prevStrike: number | null = null, flip: number | null = null;
  for (const r of rows) {
    prevCum = cum;
    cum += r.netGEX;
    if (prevStrike !== null && prevCum < 0 && cum >= 0) {
      const range = cum - prevCum;
      flip = Math.abs(range) > 0 ? prevStrike + (r.strike - prevStrike) * (-prevCum / range) : r.strike;
      break;
    }
    prevStrike = r.strike;
  }

  const above = rows.filter((r) => r.strike > spot && r.netGEX > 0);
  const below = rows.filter((r) => r.strike < spot && r.netGEX < 0);
  const callWall = above.length ? above.reduce((b, r) => (r.netGEX > b.netGEX ? r : b)).strike : null;
  const putWall = below.length ? below.reduce((b, r) => (r.netGEX < b.netGEX ? r : b)).strike : null;
  const total = rows.reduce((s, r) => s + r.netGEX, 0);

  // ladder: window ±GEX_LADDER_HALF around the strike nearest spot, high→low, $M
  let atm = 0;
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(rows[i].strike - spot) < Math.abs(rows[atm].strike - spot)) atm = i;
  }
  const ladder = rows
    .slice(Math.max(0, atm - GEX_LADDER_HALF), Math.min(rows.length, atm + GEX_LADDER_HALF + 1))
    .sort((a, b) => b.strike - a.strike)
    .map((r) => ({ strike: r.strike, netGex: r.netGEX / 1e6 }));

  return {
    ladder,
    callWall,
    putWall,
    gammaFlip: flip,
    netGex: Number.isFinite(total) && total !== 0 ? total / 1e9 : null,
  };
}

// Resolve the SPX expiration for the requested DTE bucket. dte=0 → nearest
// expiration (front), dte=1 → the NEXT distinct expiration after the front.
// Returns the expiration date string (YYYY-MM-DD) or "" if unavailable.
async function resolveExpiry(base: string, dte: 0 | 1): Promise<string> {
  try {
    const r = await fetch(`${base}/proxy/api/tt/expirations/SPX`, { cache: "no-store" });
    if (!r.ok) return "";
    const json = (await r.json()) as { data?: unknown };
    // The adapter returns { data: { items: [{ "expiration-date" }] } }; also
    // tolerate a bare array or { data: [...] } shape defensively.
    const data = (json?.data ?? json) as Record<string, unknown> | unknown[];
    const raw: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>)?.items)
        ? ((data as Record<string, unknown>).items as unknown[])
        : [];
    const dates = raw
      .map((d) => {
        const o = (d ?? {}) as Record<string, unknown>;
        return String(o["expiration-date"] ?? o.expirationDate ?? o.expiration ?? o.date ?? (typeof d === "string" ? d : "") ?? "");
      })
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
      .sort();
    if (!dates.length) return "";
    return dte === 0 ? dates[0] : (dates[1] ?? dates[0]);
  } catch {
    return "";
  }
}

// Pull the full SPX chain for one expiration and return its parsed legs + spot.
async function fetchExpiryChain(base: string, expiration: string): Promise<{ legs: Leg[]; underlying: number }> {
  try {
    const q = expiration ? `?expiration=${encodeURIComponent(expiration)}` : "";
    const r = await fetch(`${base}/proxy/api/tt/chains/SPX${q}`, { cache: "no-store" });
    if (!r.ok) return { legs: [], underlying: 0 };
    const { legs, underlying } = flattenChain(await r.json());
    // The adapter may return all expirations — keep only the requested one.
    const filtered = expiration ? legs.filter((l) => l.expiration === expiration) : legs;
    return { legs: filtered.length ? filtered : legs, underlying };
  } catch {
    return { legs: [], underlying: 0 };
  }
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

export async function GET(req: Request) {
  const base = proxyBase();
  // DTE bucket: 0 = front/0DTE (default), 1 = next expiration. Drives which
  // expiration's chain the GEX ladder / walls / flip / net are computed from.
  const dteParam = new URL(req.url).searchParams.get("dte");
  const dte: 0 | 1 = dteParam === "1" ? 1 : 0;
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
    spxPrevClose: null,
    emUpper: null,
    emLower: null,
    gexLadder: [],
    updatedAt: Date.now(),
  };

  // GEX frame: spot / walls / flip / net GEX / prior close. Same /proxy/gex the
  // heatmap uses; prevClose = yesterday's 4pm SPX cash close.
  let spotForEm = 0;
  try {
    const r = await fetch(`${base}/proxy/gex`, { cache: "no-store" });
    if (r.ok) {
      const p = (await r.json()) as Record<string, unknown>;
      const spot = Number(p.spot ?? 0);
      out.spxSpot = spot > 0 ? spot : null;
      spotForEm = spot;
      const prevClose = Number(p.prevClose ?? 0);
      out.spxPrevClose = prevClose > 0 ? prevClose : null;
      out.callWall = p.callWall != null ? Number(p.callWall) || null : null;
      out.putWall = p.putWall != null ? Number(p.putWall) || null : null;
      out.gammaFlip = p.gexFlip != null ? Number(p.gexFlip) || null : null;
      const totals = p.totals as Record<string, unknown> | null | undefined;
      const totalGex = totals ? Number(totals.totalGEX ?? 0) : Number(p.totalNetGex ?? 0);
      out.netGex = Number.isFinite(totalGex) && totalGex !== 0 ? totalGex / 1e9 : null;
      out.gexLadder = buildGexLadder(p.gexRows, spot);
    }
  } catch {
    /* leave nulls */
  }

  // For 1DTE, override the GEX read (ladder / walls / flip / net) with a chain
  // computed for the NEXT expiration. 0DTE keeps the live /proxy/gex frame above
  // (front expiry, already authoritative). Best-effort: on any miss we keep the
  // 0DTE frame values rather than blanking the card.
  if (dte === 1) {
    try {
      const expiry = await resolveExpiry(base, 1);
      if (expiry) {
        const { legs, underlying } = await fetchExpiryChain(base, expiry);
        const spotForGex = out.spxSpot ?? (underlying > 0 ? underlying : spotForEm);
        const gx = computeExpiryGex(legs, spotForGex);
        if (gx) {
          out.gexLadder = gx.ladder;
          if (gx.callWall != null) out.callWall = gx.callWall;
          if (gx.putWall != null) out.putWall = gx.putWall;
          if (gx.gammaFlip != null) out.gammaFlip = gx.gammaFlip;
          if (gx.netGex != null) out.netGex = gx.netGex;
        }
      }
    } catch {
      /* keep front-expiry values */
    }
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

  // EM band centered on the PRIOR-DAY SPX close (not live spot). Upper/lower are
  // the expected range off yesterday's close.
  if (out.spxPrevClose != null && out.expectedMove != null) {
    out.emUpper = out.spxPrevClose + out.expectedMove;
    out.emLower = out.spxPrevClose - out.expectedMove;
  }

  return NextResponse.json(
    { data: out },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
