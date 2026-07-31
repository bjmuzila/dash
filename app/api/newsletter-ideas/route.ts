import { NextRequest, NextResponse } from "next/server";
import { getServerIsOwner } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";

/**
 * /api/newsletter-ideas — the owner idea log the weekly newsletter is built
 * from. Drop an idea (one line), the notes behind it, and any screenshots on
 * any day; at the end of the week the owner Newsletter page lists the whole
 * week so the letter gets written from real notes instead of memory.
 *
 * Screenshots live in newsletter_idea_shots as BYTEA and are served one at a
 * time from /api/newsletter-ideas/shot?id=N, so this list JSON stays small no
 * matter how many images pile up.
 *
 * server-v2/api-router.js carries an identical registration; whichever layer is
 * active (API_ROUTER=1 → the router, otherwise Next) serves the same contract.
 */

export const dynamic = "force-dynamic";

type Pool = Awaited<ReturnType<typeof getDb>>;

let ensured = false;
async function ensureTables(pool: Pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS newsletter_ideas (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      day DATE NOT NULL DEFAULT CURRENT_DATE,
      week_start DATE NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_newsletter_ideas_week ON newsletter_ideas(week_start)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS newsletter_idea_shots (
      id SERIAL PRIMARY KEY,
      idea_id INTEGER NOT NULL REFERENCES newsletter_ideas(id) ON DELETE CASCADE,
      mime TEXT NOT NULL DEFAULT 'image/jpeg',
      bytes BYTEA NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_newsletter_idea_shots_idea ON newsletter_idea_shots(idea_id)");
  ensured = true;
}

// ET-anchored "today" and the Monday that owns a given day — must match the
// client and the api-router copy or ideas land in the wrong week.
function todayET(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).toISOString().slice(0, 10);
}
function mondayOf(ds: string): string {
  const d = new Date(`${ds}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

/** "data:image/png;base64,AAAA…" → { mime, buf }. Anything else → null. */
function parseDataUrl(s: unknown): { mime: string; buf: Buffer } | null {
  const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(String(s || ""));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!mime.startsWith("image/")) return null;
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
  return { mime, buf };
}

const IDEA_SELECT = `
  SELECT i.id, i.title, i.body, i.used,
         to_char(i.day, 'YYYY-MM-DD')        AS day,
         to_char(i.week_start, 'YYYY-MM-DD') AS week_start,
         i.created_at,
         COALESCE(
           json_agg(json_build_object('id', s.id, 'caption', s.caption)
                    ORDER BY s.sort_order, s.id) FILTER (WHERE s.id IS NOT NULL),
           '[]'
         ) AS shots
    FROM newsletter_ideas i
    LEFT JOIN newsletter_idea_shots s ON s.idea_id = i.id`;

export async function GET(req: NextRequest) {
  if (!(await getServerIsOwner())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const pool = await getDb();
    await ensureTables(pool);
    // ?week=YYYY-MM-DD (a Monday) filters to that week; ?week=all → everything.
    const raw = (req.nextUrl.searchParams.get("week") || "").trim();
    const week = !raw ? mondayOf(todayET()) : raw === "all" ? "" : mondayOf(raw);
    const params = week ? [week] : [];
    const [ideas, weeks] = await Promise.all([
      pool.query(
        `${IDEA_SELECT}
         ${week ? "WHERE i.week_start = $1" : ""}
         GROUP BY i.id
         ORDER BY i.day DESC, i.id DESC`,
        params,
      ),
      pool.query(`
        SELECT to_char(week_start, 'YYYY-MM-DD') AS week, COUNT(*)::int AS n
          FROM newsletter_ideas
         GROUP BY week_start
         ORDER BY week_start DESC
         LIMIT 52`),
    ]);
    return NextResponse.json({ week: week || "all", ideas: ideas.rows, weeks: weeks.rows });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await getServerIsOwner())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const pool = await getDb();
    await ensureTables(pool);
    const body = await req.json();
    const action = String(body?.action ?? "");
    const idOf = (v: unknown) => {
      const n = parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const one = async (id: number) => {
      const { rows } = await pool.query(`${IDEA_SELECT} WHERE i.id = $1 GROUP BY i.id`, [id]);
      return rows[0] ?? null;
    };

    if (action === "create") {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.day ?? "")) ? String(body.day) : todayET();
      const { rows } = await pool.query(
        `INSERT INTO newsletter_ideas (title, body, day, week_start) VALUES ($1, $2, $3, $4) RETURNING id`,
        [String(body?.title ?? "").slice(0, 300), String(body?.body ?? ""), day, mondayOf(day)],
      );
      const id = rows[0].id as number;
      const shots = Array.isArray(body?.shots) ? body.shots.slice(0, 12) : [];
      for (let i = 0; i < shots.length; i++) {
        const img = parseDataUrl(shots[i]?.dataUrl);
        if (!img) continue;
        await pool.query(
          `INSERT INTO newsletter_idea_shots (idea_id, mime, bytes, caption, sort_order) VALUES ($1, $2, $3, $4, $5)`,
          [id, img.mime, img.buf, String(shots[i]?.caption ?? "").slice(0, 300), i],
        );
      }
      return NextResponse.json({ ok: true, idea: await one(id) });
    }

    if (action === "update") {
      const id = idOf(body?.id);
      if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.day ?? "")) ? String(body.day) : null;
      await pool.query(
        `UPDATE newsletter_ideas SET
           title      = COALESCE($2, title),
           body       = COALESCE($3, body),
           day        = COALESCE($4::date, day),
           week_start = COALESCE($5::date, week_start),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [
          id,
          body?.title == null ? null : String(body.title).slice(0, 300),
          body?.body == null ? null : String(body.body),
          day,
          day ? mondayOf(day) : null,
        ],
      );
      return NextResponse.json({ ok: true, idea: await one(id) });
    }

    if (action === "used") {
      const id = idOf(body?.id);
      if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
      await pool.query("UPDATE newsletter_ideas SET used = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id, !!body?.used]);
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const id = idOf(body?.id);
      if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
      await pool.query("DELETE FROM newsletter_ideas WHERE id = $1", [id]);
      return NextResponse.json({ ok: true });
    }

    if (action === "addShot") {
      const ideaId = idOf(body?.ideaId);
      const img = parseDataUrl(body?.dataUrl);
      if (!ideaId) return NextResponse.json({ error: "missing ideaId" }, { status: 400 });
      if (!img) return NextResponse.json({ error: "bad image" }, { status: 400 });
      const { rows: next } = await pool.query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM newsletter_idea_shots WHERE idea_id = $1",
        [ideaId],
      );
      const { rows } = await pool.query(
        `INSERT INTO newsletter_idea_shots (idea_id, mime, bytes, caption, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, caption`,
        [ideaId, img.mime, img.buf, String(body?.caption ?? "").slice(0, 300), next[0].n],
      );
      return NextResponse.json({ ok: true, shot: rows[0] });
    }

    if (action === "shotCaption") {
      const id = idOf(body?.id);
      if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
      await pool.query("UPDATE newsletter_idea_shots SET caption = $2 WHERE id = $1", [id, String(body?.caption ?? "").slice(0, 300)]);
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteShot") {
      const id = idOf(body?.id);
      if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
      await pool.query("DELETE FROM newsletter_idea_shots WHERE id = $1", [id]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
