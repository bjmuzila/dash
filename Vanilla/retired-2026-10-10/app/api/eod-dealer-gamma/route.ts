import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/eod-dealer-gamma?symbol=$SPX&limit=30
 * GET /api/eod-dealer-gamma?symbol=$SPX&date=2026-07-29
 *
 * Reads the EOD dealer-gamma-by-DTE snapshot written by
 * server-v2/eod-dte-gamma-recorder.js at the 15:55 ET window.
 *
 * Rows come back grouped by session. `buckets` are the five disjoint DTE
 * buckets; `rollups` (Ex-0DTE, All expirations) are SUMS of those buckets and
 * are deliberately kept in a separate array — a consumer that concatenated them
 * would double-count every contract.
 *
 * Mirrors the shape/behaviour of /api/eod-gex, which the test lab already reads.
 */

type Row = {
  date: string;
  bucket: string;
  label: string;
  dte_label: string;
  is_rollup: boolean;
  expirations: number;
  strikes: number;
  call_oi: string | number;
  put_oi: string | number;
  net_gamma: number;
  basis: string;
  measured_cov: number;
  spot: number | null;
};

type Entry = {
  bucket: string;
  label: string;
  dteLabel: string;
  expirations: number;
  strikes: number;
  callOi: number;
  putOi: number;
  netGamma: number;
  basis: string;
  measuredCoverage: number;
};

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const toEntry = (r: Row): Entry => ({
  bucket: r.bucket,
  label: r.label,
  dteLabel: r.dte_label,
  expirations: n(r.expirations),
  strikes: n(r.strikes),
  // BIGINT comes back as a string from pg; coerce before it reaches the client.
  callOi: n(r.call_oi),
  putOi: n(r.put_oi),
  netGamma: n(r.net_gamma),
  basis: r.basis,
  measuredCoverage: n(r.measured_cov),
});

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const symbol = sp.get("symbol") || "$SPX";
    const date = sp.get("date") || "";
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 30), 1), 365);

    const pool = getPool();

    // The table is created by the server-v2 recorder. If the recorder has not
    // run yet the relation won't exist — answer with an empty, well-formed
    // payload rather than a 500, so the UI can say "no snapshots yet".
    const exists = await pool.query(
      `SELECT to_regclass('public.eod_dte_gamma') IS NOT NULL AS ok`
    );
    if (!exists.rows[0]?.ok) {
      return NextResponse.json({ symbol, count: 0, sessions: [], pending: true });
    }

    const { rows } = date
      ? await pool.query<Row>(
          `SELECT date::text AS date, bucket, label, dte_label, is_rollup,
                  expirations, strikes, call_oi, put_oi, net_gamma, basis,
                  measured_cov, spot
             FROM eod_dte_gamma
            WHERE symbol = $1 AND date = $2::date
            ORDER BY sort_order`,
          [symbol, date]
        )
      : await pool.query<Row>(
          `WITH recent AS (
             SELECT DISTINCT date FROM eod_dte_gamma
              WHERE symbol = $1 ORDER BY date DESC LIMIT $2
           )
           SELECT g.date::text AS date, g.bucket, g.label, g.dte_label,
                  g.is_rollup, g.expirations, g.strikes, g.call_oi, g.put_oi,
                  g.net_gamma, g.basis, g.measured_cov, g.spot
             FROM eod_dte_gamma g
             JOIN recent r ON r.date = g.date
            WHERE g.symbol = $1
            ORDER BY g.date ASC, g.sort_order ASC`,
          [symbol, limit]
        );

    // Group by session, keeping buckets and rollups apart.
    const bySession = new Map<
      string,
      { date: string; spot: number; buckets: Entry[]; rollups: Entry[] }
    >();
    for (const r of rows) {
      if (!bySession.has(r.date)) {
        bySession.set(r.date, { date: r.date, spot: n(r.spot), buckets: [], rollups: [] });
      }
      const s = bySession.get(r.date)!;
      if (n(r.spot) > 0) s.spot = n(r.spot);
      (r.is_rollup ? s.rollups : s.buckets).push(toEntry(r));
    }

    const sessions = [...bySession.values()].map((s) => {
      const gross = s.buckets.reduce((a, b) => a + Math.abs(b.netGamma), 0);
      const net = s.buckets.reduce((a, b) => a + b.netGamma, 0);
      const zeroDte = s.buckets.find((b) => b.bucket === "0dte")?.netGamma ?? 0;
      return {
        ...s,
        totals: { net, gross, zeroDte, ex0dte: net - zeroDte },
        // Share of GROSS, so the five disjoint buckets sum to 100% even when
        // gamma straddles zero. A share of net would blow up near zero.
        buckets: s.buckets.map((b) => ({
          ...b,
          shareOfGross: gross > 0 ? Math.abs(b.netGamma) / gross : 0,
        })),
      };
    });

    return NextResponse.json({ symbol, count: sessions.length, sessions });
  } catch (err) {
    console.error("[/api/eod-dealer-gamma]", err);
    return NextResponse.json(
      { error: "Database error", detail: String(err) },
      { status: 500 }
    );
  }
}
