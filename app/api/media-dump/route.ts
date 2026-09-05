import { NextRequest, NextResponse } from "next/server";
import { getServerIsOwner } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";

/**
 * /api/media-dump — the owner media dump: paste or drop a screenshot, give it a
 * caption, and it stays put so it can be pulled up and mentioned later.
 *
 * This replaced /api/newsletter-ideas. That one was shaped around a weekly
 * letter — ideas bucketed into Monday-anchored weeks, screenshots hanging off an
 * idea. The letter is gone, and the only part that ever got used was "keep this
 * image with a note on it", so the week and the parent idea are gone with it.
 * Now the ITEM is the unit: one file, one caption, optional note, optional tags.
 *
 * Bytes live in media_dump_items as BYTEA and are streamed one at a time from
 * /api/media-dump/file?id=N, so this list JSON stays small no matter how much
 * media piles up. Nothing touches localStorage — a cleared cache or a different
 * machine still sees everything.
 *
 * GET  ?q=&tag=&limit=&offset=  → { items, tags, total }
 * POST { action: create | update | pin | delete }
 */

export const dynamic = "force-dynamic";

type Pool = Awaited<ReturnType<typeof getDb>>;

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_BATCH = 24;
const DEFAULT_LIMIT = 200;

let ensured = false;
async function ensureTables(pool: Pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_dump_items (
      id SERIAL PRIMARY KEY,
      caption TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      tags TEXT[] NOT NULL DEFAULT '{}',
      kind TEXT NOT NULL DEFAULT 'image',
      mime TEXT NOT NULL DEFAULT 'image/jpeg',
      filename TEXT NOT NULL DEFAULT '',
      bytes BYTEA NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
      day DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_media_dump_created ON media_dump_items(created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_media_dump_tags ON media_dump_items USING GIN(tags)");
  ensured = true;
}

/** ET-anchored "today" — the day a paste is filed under. */
function todayET(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).toISOString().slice(0, 10);
}

/** "data:image/png;base64,AAAA…" → { mime, buf }. Anything else → null. */
function parseDataUrl(s: unknown): { mime: string; buf: Buffer } | null {
  const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(String(s || ""));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > MAX_BYTES) return null;
  return { mime, buf };
}

/** Free-text in → a clean, de-duped, lowercase tag list. */
function normTags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[,\n]/);
  const out: string[] = [];
  for (const t of raw) {
    const s = String(t ?? "").trim().replace(/^#/, "").toLowerCase().slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

// bytes deliberately excluded — the list must never carry image payloads.
const ITEM_SELECT = `
  SELECT id, caption, note, tags, kind, mime, filename, byte_size, pinned,
         to_char(day, 'YYYY-MM-DD') AS day, created_at
    FROM media_dump_items`;

export async function GET(req: NextRequest) {
  if (!(await getServerIsOwner())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const pool = await getDb();
    await ensureTables(pool);

    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim().slice(0, 200);
    const tag = (sp.get("tag") || "").trim().toLowerCase().slice(0, 40);
    const limit = Math.min(500, Math.max(1, parseInt(sp.get("limit") || "", 10) || DEFAULT_LIMIT));
    const offset = Math.max(0, parseInt(sp.get("offset") || "", 10) || 0);

    const where: string[] = [];
    const params: unknown[] = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(caption ILIKE $${params.length} OR note ILIKE $${params.length} OR filename ILIKE $${params.length})`);
    }
    if (tag) {
      params.push(tag);
      where.push(`$${params.length} = ANY(tags)`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [items, total, tags] = await Promise.all([
      pool.query(
        `${ITEM_SELECT} ${whereSql}
         ORDER BY pinned DESC, created_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(byte_size), 0)::bigint AS bytes FROM media_dump_items`),
      pool.query(`
        SELECT t AS tag, COUNT(*)::int AS n
          FROM media_dump_items, UNNEST(tags) AS t
         GROUP BY t
         ORDER BY n DESC, t ASC
         LIMIT 60`),
    ]);

    return NextResponse.json({
      items: items.rows,
      tags: tags.rows,
      total: total.rows[0]?.n ?? 0,
      totalBytes: Number(total.rows[0]?.bytes ?? 0),
    });
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
      const { rows } = await pool.query(`${ITEM_SELECT} WHERE id = $1`, [id]);
      return rows[0] ?? null;
    };

    // create — one POST carries the whole drop, captions and all, so a paste of
    // six screenshots is one round trip instead of six.
    if (action === "create") {
      const incoming = Array.isArray(body?.items)
        ? body.items.slice(0, MAX_BATCH)
        : [{ dataUrl: body?.dataUrl, caption: body?.caption, note: body?.note, tags: body?.tags, filename: body?.filename }];
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.day ?? "")) ? String(body.day) : todayET();
      const sharedTags = normTags(body?.tags);
      const created: unknown[] = [];
      let rejected = 0;

      for (const it of incoming) {
        const img = parseDataUrl(it?.dataUrl);
        if (!img) { rejected++; continue; }
        const tags = normTags(it?.tags).length ? normTags(it?.tags) : sharedTags;
        const { rows } = await pool.query(
          `INSERT INTO media_dump_items (caption, note, tags, kind, mime, filename, bytes, byte_size, day)
           VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            String(it?.caption ?? "").slice(0, 400),
            String(it?.note ?? "").slice(0, 8000),
            tags,
            img.mime.startsWith("image/") ? "image" : "file",
            img.mime,
            String(it?.filename ?? "").slice(0, 200),
            img.buf,
            img.buf.length,
            day,
          ],
        );
        created.push(await one(rows[0].id as number));
      }
      if (!created.length) return NextResponse.json({ error: "nothing saved — file missing or over 12 MB" }, { status: 400 });
      return NextResponse.json({ ok: true, items: created, rejected });
    }

    if (action === "update") {
      const id = idOf(body?.id);
      if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
      await pool.query(
        `UPDATE media_dump_items SET
           caption    = COALESCE($2, caption),
           note       = COALESCE($3, note),
           tags       = COALESCE($4::text[], tags),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [
          id,
          body?.caption == null ? null : String(body.caption).slice(0, 400),
          body?.note == null ? null : String(body.note).slice(0, 8000),
          body?.tags == null ? null : normTags(body.tags),
        ],
      );
      return NextResponse.json({ ok: true, item: await one(id) });
    }

    if (action === "pin") {
      const id = idOf(body?.id);
      if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
      await pool.query("UPDATE media_dump_items SET pinned = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id, !!body?.pinned]);
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const id = idOf(body?.id);
      if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
      await pool.query("DELETE FROM media_dump_items WHERE id = $1", [id]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
