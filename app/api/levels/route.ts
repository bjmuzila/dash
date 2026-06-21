import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Per-ticker weekly levels pushed from the backend Estimated Moves page and
// read by the customer-facing /em page. One row per ticker; backend overwrites
// it each week (and intraday on refresh). NULL-aware upsert mirrors es-stats.

let _tableEnsured = false;

// Most-recent Saturday 09:00 ET boundary. The weekly em is "frozen" once it has
// been written on/after this instant; an untrusted (browser) push must not move
// an em that is already frozen for the current week.
function lastSaturday9amET(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get("weekday") || "Sun"];
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  // minutes since this week's Saturday 09:00 (negative until Sat reaches 9am)
  const minsSinceSat9 = ((dow - 6) * 24 * 60) + hour * 60 + minute - 9 * 60;
  // if we haven't reached Saturday 9am yet this week, roll back to last week's
  const offsetMin = minsSinceSat9 >= 0 ? minsSinceSat9 : minsSinceSat9 + 7 * 24 * 60;
  return new Date(now.getTime() - offsetMin * 60 * 1000);
}

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
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      em_updated_at TIMESTAMPTZ
    )
  `);
  // Back-fill the column for tables created before em_updated_at existed.
  await pool.query(
    `ALTER TABLE ticker_levels ADD COLUMN IF NOT EXISTS em_updated_at TIMESTAMPTZ`
  );
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

    // The weekly em is FROZEN at the Saturday-9am-ET publish and must hold until
    // the next Saturday run. Only the trusted publisher (internal token) may
    // (re)write em. An untrusted caller — the backend Estimated Moves dashboard
    // recomputing live — may still seed em for a ticker that has NO frozen value
    // this week, but can never overwrite an em already frozen for the week.
    // Zones / pivot / labels are unaffected and can refresh anytime.
    const token = req.headers.get("x-internal-token") || "";
    const trusted = !!process.env.INTERNAL_API_TOKEN && token === process.env.INTERNAL_API_TOKEN;
    const weekStart = lastSaturday9amET();

    await pool.query(
      `INSERT INTO ticker_levels
        (ticker, label, close, em, up, down, buy_near, buy_far, sell_near, sell_far, pivot, exp_label, em_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
               CASE WHEN $4::text IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END)
       ON CONFLICT(ticker) DO UPDATE SET
         label     = CASE WHEN EXCLUDED.label     IS NOT NULL THEN EXCLUDED.label     ELSE ticker_levels.label     END,
         buy_near  = CASE WHEN EXCLUDED.buy_near  IS NOT NULL THEN EXCLUDED.buy_near  ELSE ticker_levels.buy_near  END,
         buy_far   = CASE WHEN EXCLUDED.buy_far   IS NOT NULL THEN EXCLUDED.buy_far   ELSE ticker_levels.buy_far   END,
         sell_near = CASE WHEN EXCLUDED.sell_near IS NOT NULL THEN EXCLUDED.sell_near ELSE ticker_levels.sell_near END,
         sell_far  = CASE WHEN EXCLUDED.sell_far  IS NOT NULL THEN EXCLUDED.sell_far  ELSE ticker_levels.sell_far  END,
         pivot     = CASE WHEN EXCLUDED.pivot     IS NOT NULL THEN EXCLUDED.pivot     ELSE ticker_levels.pivot     END,
         exp_label = CASE WHEN EXCLUDED.exp_label IS NOT NULL THEN EXCLUDED.exp_label ELSE ticker_levels.exp_label END,
         updated_at = CURRENT_TIMESTAMP,
         -- em (and the close/up/down it implies) is write-once per week. It only
         -- changes when the supplied em is non-null AND the caller is either the
         -- trusted publisher ($13) OR the row has no em frozen since this week's
         -- Saturday-9am boundary ($14). Otherwise the frozen value is kept.
         em = CASE WHEN EXCLUDED.em IS NOT NULL
                     AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                   THEN EXCLUDED.em ELSE ticker_levels.em END,
         close = CASE WHEN EXCLUDED.close IS NOT NULL
                     AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                   THEN EXCLUDED.close ELSE ticker_levels.close END,
         up = CASE WHEN EXCLUDED.up IS NOT NULL
                     AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                   THEN EXCLUDED.up ELSE ticker_levels.up END,
         down = CASE WHEN EXCLUDED.down IS NOT NULL
                     AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                   THEN EXCLUDED.down ELSE ticker_levels.down END,
         -- Advance em_updated_at only when em actually changed (same guard).
         em_updated_at = CASE WHEN EXCLUDED.em IS NOT NULL
                     AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                   THEN CURRENT_TIMESTAMP ELSE ticker_levels.em_updated_at END`,
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
        trusted,        // $13 — trusted publisher may always (re)write em
        weekStart,      // $14 — this week's Saturday-9am ET freeze boundary
      ]
    );
    return NextResponse.json({ ok: true, ticker });
  } catch (err) {
    console.error("[/api/levels POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
