'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VELA ALERTS — today's fired alerts, behind the bell in Vela's toolbar
 * (2026-10-08, Brandon: "old alerts needs to go on the bell in the toolbar.
 * historical. save for the day only. in postgresql").
 *
 * Every alert that rings on a Vela chart — a Level alert (★ Volt crossed…), a
 * CB Script alertcondition() / alert(), or one of Vela's own chart alerts — is
 * written here by the page (cbedge-v3/src/pages/vela/alertBell.ts), so the bell
 * shows the day's alerts after a reload, on another tab, or on the phone.
 *
 *   GET    /api/vela/alerts   today's alerts for the signed-in account, newest first
 *   POST   /api/vela/alerts   one fired alert { key, kind, symbol, title, text, meta, at }
 *   DELETE /api/vela/alerts   clear today's (the bell's Clear button)
 *
 * TODAY ONLY. A row carries its New York trading day; reads are that day only,
 * and anything older is deleted — on the first write of a new day and once an
 * hour. This table is a day's scratch, deliberately: nothing here is history
 * anyone keeps.
 *
 * ONE ROW PER RING. `key` is the page's own id for the alert (the alert, the
 * symbol and the bar it fired on), unique per account and day, so two open tabs
 * that both see the same cross write it once.
 *
 * Per account: every query filters on user_id. A request with no account (the
 * internal token) is refused rather than written under nobody.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MAX_PER_DAY = 500;
const KINDS = new Set(['level', 'script', 'chart']);
const PRUNE_MS = 60 * 60_000;

const str = (v, n) => (v == null ? null : String(v).slice(0, n));

function registerVelaAlertRoutes({ register, send, readJson, libDb }) {
  if (!libDb) return 0;
  const q = (sql, params = []) => libDb.queryAll(sql, params);

  let schema = null;
  function ensureSchema() {
    if (!schema) {
      schema = (async () => {
        await q(`CREATE TABLE IF NOT EXISTS vela_alerts (
          id BIGSERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          day DATE NOT NULL,
          at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          key TEXT NOT NULL,
          kind TEXT NOT NULL,
          symbol TEXT,
          title TEXT,
          text TEXT,
          meta TEXT
        )`);
        await q('CREATE UNIQUE INDEX IF NOT EXISTS vela_alerts_user_day_key ON vela_alerts (user_id, day, key)');
        await q('CREATE INDEX IF NOT EXISTS vela_alerts_day_idx ON vela_alerts (day)');
      })().catch((e) => { schema = null; throw e; });
    }
    return schema;
  }

  const TODAY = `(NOW() AT TIME ZONE 'America/New_York')::date`;

  // anything before today goes — at most once an hour, and on the first write of a day
  let prunedAt = 0;
  let prunedDay = '';
  async function prune(day) {
    if (day === prunedDay && Date.now() - prunedAt < PRUNE_MS) return;
    prunedAt = Date.now();
    prunedDay = day;
    await q(`DELETE FROM vela_alerts WHERE day < ${TODAY}`).catch(() => {});
  }
  setInterval(() => {
    if (!schema) return;
    schema.then(() => q(`DELETE FROM vela_alerts WHERE day < ${TODAY}`)).catch(() => {});
  }, PRUNE_MS).unref?.();

  const rowOut = (r) => ({
    key: r.key,
    kind: r.kind,
    symbol: r.symbol,
    title: r.title,
    text: r.text,
    meta: r.meta,
    at: Number(r.at_ms),
  });

  register('/api/vela/alerts', {
    auth: 'subscriber', methods: ['GET', 'POST', 'DELETE'],
    async handler(req, res, ctx, verdict) {
      const userId = String(verdict?.userId || '').trim();
      if (!userId) return send(res, 400, { error: 'no account on this request' });
      try {
        await ensureSchema();
        if (req.method === 'GET') {
          const rows = await q(
            `SELECT key, kind, symbol, title, text, meta, (EXTRACT(EPOCH FROM at) * 1000)::bigint AS at_ms
               FROM vela_alerts WHERE user_id = ? AND day = ${TODAY}
              ORDER BY at DESC LIMIT ${MAX_PER_DAY}`,
            [userId],
          );
          const d = await q(`SELECT ${TODAY}::text AS day`);
          return send(res, 200, { day: d[0]?.day ?? null, alerts: rows.map(rowOut) }, { 'Cache-Control': 'no-store' });
        }
        if (req.method === 'DELETE') {
          const r = await q(`DELETE FROM vela_alerts WHERE user_id = ? AND day = ${TODAY} RETURNING 1`, [userId]);
          return send(res, 200, { ok: true, cleared: r.length }, { 'Cache-Control': 'no-store' });
        }
        // POST
        const b = await readJson(req, 16 * 1024).catch(() => null);
        const key = str(b?.key, 200);
        const kind = KINDS.has(b?.kind) ? b.kind : null;
        if (!key || !kind) return send(res, 400, { error: 'key and kind are required' });
        const at = Number(b?.at);
        // the ring's own time, when it is plausible (within a day of now); else now
        const atMs = Number.isFinite(at) && Math.abs(Date.now() - at) < 86_400_000 ? at : Date.now();
        const d = await q(`SELECT ${TODAY}::text AS day`);
        const day = d[0]?.day;
        await prune(day);
        const n = await q(`SELECT count(*)::int AS n FROM vela_alerts WHERE user_id = ? AND day = ${TODAY}`, [userId]);
        if ((n[0]?.n ?? 0) >= MAX_PER_DAY) return send(res, 429, { error: `at most ${MAX_PER_DAY} alerts a day are kept` });
        const r = await q(
          `INSERT INTO vela_alerts (user_id, day, at, key, kind, symbol, title, text, meta)
           VALUES (?, ${TODAY}, to_timestamp(?::double precision / 1000.0), ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, day, key) DO NOTHING RETURNING 1`,
          [userId, atMs, key, kind, str(b?.symbol, 40), str(b?.title, 200), str(b?.text, 500), str(b?.meta, 200)],
        );
        return send(res, 200, { ok: true, added: r.length > 0 }, { 'Cache-Control': 'no-store' });
      } catch (e) {
        return send(res, 500, { error: String(e?.message || e).slice(0, 200) });
      }
    },
  });
  return 1;
}

module.exports = { registerVelaAlertRoutes };
