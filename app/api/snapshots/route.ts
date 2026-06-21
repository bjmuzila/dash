import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Estimated-Moves / Zones snapshots. Migrated from browser IndexedDB so they
// persist across browsers, profiles, and origin/domain changes. One row per
// saved snapshot; the full Snapshot shape (rows / zoneLevels / expirations) is
// kept in `payload` (JSONB), with a few columns promoted for cheap filter
// (view) and ordering (ts).

let _tableEnsured = false;

async function ensureTable(pool: Awaited<ReturnType<typeof getDb>>) {
  if (_tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS em_snapshots (
      id SERIAL PRIMARY KEY,
      view TEXT NOT NULL DEFAULT 'estimated',
      period TEXT,
      ts BIGINT NOT NULL,
      date TEXT,
      time TEXT,
      target_date_label TEXT,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_em_snapshots_view_ts ON em_snapshots(view, ts DESC)`);
  _tableEnsured = true;
}

// Reconstruct the client-facing Snapshot object from a stored row.
function rowToSnapshot(r: Record<string, unknown>) {
  const payload = (r.payload as Record<string, unknown>) || {};
  return {
    id: r.id,
    timestamp: Number(r.ts),
    date: r.date,
    time: r.time,
    period: r.period,
    view: r.view,
    targetDateLabel: r.target_date_label ?? undefined,
    ...payload, // rows / zoneLevels / expirations
  };
}

export async function GET(req: NextRequest) {
  try {
    const pool = await getDb();
    await ensureTable(pool);
    const view = (req.nextUrl.searchParams.get("view") || "").trim();
    const period = (req.nextUrl.searchParams.get("period") || "").trim();
    let res;
    if (view) {
      res = await pool.query("SELECT * FROM em_snapshots WHERE view = $1 ORDER BY ts DESC", [view]);
    } else if (period) {
      // Back-compat with the legacy estimated-moves.js (?period=weekly).
      res = await pool.query("SELECT * FROM em_snapshots WHERE period = $1 ORDER BY ts DESC", [period]);
    } else {
      res = await pool.query("SELECT * FROM em_snapshots ORDER BY ts DESC");
    }
    return NextResponse.json(res.rows.map(rowToSnapshot));
  } catch (err) {
    console.error("[/api/snapshots GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const view = String(body.view || "estimated");
    const now = new Date();
    const ts = Number(body.timestamp) || now.getTime();
    const date = body.date || now.toLocaleDateString("en-US");
    const time =
      body.time ||
      now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const period = body.period ?? null;
    const targetDateLabel = body.targetDateLabel ?? null;

    // Everything that isn't a promoted column lives in payload.
    const rest: Record<string, unknown> = { ...body };
    for (const k of ["id", "timestamp", "date", "time", "period", "view", "targetDateLabel"]) {
      delete rest[k];
    }
    const payload = { period, targetDateLabel, ...rest };

    const pool = await getDb();
    await ensureTable(pool);
    const res = await pool.query(
      `INSERT INTO em_snapshots (view, period, ts, date, time, target_date_label, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [view, period, ts, date, time, targetDateLabel, JSON.stringify(payload)]
    );
    return NextResponse.json(rowToSnapshot(res.rows[0]), { status: 201 });
  } catch (err) {
    console.error("[/api/snapshots POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const pool = await getDb();
    await ensureTable(pool);
    await pool.query("DELETE FROM em_snapshots WHERE id = $1", [id]);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[/api/snapshots DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
