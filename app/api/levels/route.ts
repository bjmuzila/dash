import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Per-ticker weekly levels pushed from the backend Estimated Moves page and
// read by the customer-facing /em page. One row per ticker; backend overwrites
// it each week (and intraday on refresh). NULL-aware upsert mirrors es-stats.

let _tableEnsured = false;

async function ensureTable(pool: Awaited<ReturnType<typeof getDb>>) {
  if (_tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticker_levels (
      id SERIAL PRIMARY KEY,
      ticker TEXT NOT NULL UNIQUE,
      label TEXT,
      close TEXT,
      em TEXT,
      up TEXT,
      down TEXT,
      buy_near TEXT,
      buy_far TEXT,
      sell_near TEXT,
      sell_far TEXT,
      pivot TEXT,
      exp_label TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  _tableEnsured = true;
}

export async function GET(req: NextRequest) {
  try {
    const pool = await getDb();
    await ensureTable(pool);

    const raw = (req.nextUrl.searchParams.get("ticker") || "").trim().toUpperCase();

    if (!raw) {
      const all = await pool.query("SELECT * FROM ticker_levels ORDER BY ticker ASC");
      return NextResponse.json(all.rows);
    }

    // Resolve common aliases to the stored key. Levels for the futures are saved
    // under ESU / NQU (the display labels), so a customer typing ES, /ES, ESM,
    // ESU26 etc. must still find them. Try the alias first, then the raw input.
    const cleaned = raw.replace(/[$]/g, "").replace(/^\//, "");
    const ALIAS: Record<string, string> = {
      ES: "ESU", ESM: "ESU", ESU6: "ESU", ESU26: "ESU", "/ES": "ESU",
      NQ: "NQU", NQM: "NQU", NQU6: "NQU", NQU26: "NQU", "/NQ": "NQU",
    };
    const candidates = [ALIAS[raw], ALIAS[cleaned], raw, cleaned].filter(Boolean);

    const result = await pool.query(
      "SELECT * FROM ticker_levels WHERE ticker = ANY($1) LIMIT 1",
      [candidates]
    );
    if (!result.rows.length) return NextResponse.json(null);
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("[/api/levels GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ticker = String(body.ticker || "").trim().toUpperCase();
    if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });

    const pool = await getDb();
    await ensureTable(pool);

    await pool.query(
      `INSERT INTO ticker_levels
        (ticker, label, close, em, up, down, buy_near, buy_far, sell_near, sell_far, pivot, exp_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(ticker) DO UPDATE SET
         label     = CASE WHEN EXCLUDED.label     IS NOT NULL THEN EXCLUDED.label     ELSE ticker_levels.label     END,
         close     = CASE WHEN EXCLUDED.close     IS NOT NULL THEN EXCLUDED.close     ELSE ticker_levels.close     END,
         em        = CASE WHEN EXCLUDED.em        IS NOT NULL THEN EXCLUDED.em        ELSE ticker_levels.em        END,
         up        = CASE WHEN EXCLUDED.up        IS NOT NULL THEN EXCLUDED.up        ELSE ticker_levels.up        END,
         down      = CASE WHEN EXCLUDED.down      IS NOT NULL THEN EXCLUDED.down      ELSE ticker_levels.down      END,
         buy_near  = CASE WHEN EXCLUDED.buy_near  IS NOT NULL THEN EXCLUDED.buy_near  ELSE ticker_levels.buy_near  END,
         buy_far   = CASE WHEN EXCLUDED.buy_far   IS NOT NULL THEN EXCLUDED.buy_far   ELSE ticker_levels.buy_far   END,
         sell_near = CASE WHEN EXCLUDED.sell_near IS NOT NULL THEN EXCLUDED.sell_near ELSE ticker_levels.sell_near END,
         sell_far  = CASE WHEN EXCLUDED.sell_far  IS NOT NULL THEN EXCLUDED.sell_far  ELSE ticker_levels.sell_far  END,
         pivot     = CASE WHEN EXCLUDED.pivot     IS NOT NULL THEN EXCLUDED.pivot     ELSE ticker_levels.pivot     END,
         exp_label = CASE WHEN EXCLUDED.exp_label IS NOT NULL THEN EXCLUDED.exp_label ELSE ticker_levels.exp_label END,
         updated_at = CURRENT_TIMESTAMP`,
      [
        ticker,
        body.label ?? null,
        body.close ?? null,
        body.em ?? null,
        body.up ?? null,
        body.down ?? null,
        body.buy_near ?? null,
        body.buy_far ?? null,
        body.sell_near ?? null,
        body.sell_far ?? null,
        body.pivot ?? null,
        body.exp_label ?? null,
      ]
    );
    return NextResponse.json({ ok: true, ticker });
  } catch (err) {
    console.error("[/api/levels POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
