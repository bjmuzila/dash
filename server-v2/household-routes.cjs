'use strict';
/**
 * server-v2/household-routes.cjs — every /api/hh/* route for budget.cbedge.net.
 *
 * Kept OUT of api-router.js on purpose: that file is already 8k lines, and the
 * household app is a separate product with a separate auth system. api-router
 * touches this in exactly two places:
 *   1. an `auth: 'household'` branch in enforceAuth()
 *   2. one require + one call, right before the dispatcher
 *
 * Routes:
 *   POST /api/hh/auth/login            public     — sets hh_session
 *   POST /api/hh/auth/logout           public     — clears it
 *   GET  /api/hh/auth/me               public     — 200 {user} or 401, no redirect
 *   POST /api/hh/auth/change-password  household
 *   GET  /api/hh/health                public     — deploy smoke test
 *   GET  /api/hh/today                 household  — the composed Today payload
 *   GET  /api/hh/tasks                 household  — ?scope=open|done|all
 *   POST /api/hh/tasks                 household  — action dispatch
 *   GET  /api/hh/notes                 household
 *   POST /api/hh/notes                 household  — action dispatch
 *   GET  /api/hh/settings              household
 *   POST /api/hh/settings              household
 *
 * There is deliberately NO signup route. Accounts are created with
 * server-v2/scripts/hh-user.js. Two people, forever.
 *
 * ── THE VISIBILITY RULE ────────────────────────────────────────────────────
 * Every household row carries owner_id + visibility ('private' | 'shared').
 *
 *   read : owner_id = :me OR visibility = 'shared'
 *   write: owner_id = :me OR visibility = 'shared'
 *
 * Shared means both people can see AND edit — a shared list only one person can
 * change is useless. Private means only its owner, full stop.
 *
 * This predicate is defined ONCE below as VISIBLE and reused by every query. Do
 * not hand-roll it per route: a single query that forgets the visibility clause
 * leaks the other person's private rows, and that is the one bug this app must
 * never have.
 */

const hh = require('./_lib-household.cjs');
// Optional by design: without Google config this loads fine, reports
// configured:false, and the calendar card says "not set up" instead of
// offering a Connect button that would dead-end at Google.
let gcal = null;
try { gcal = require('./_lib-google-calendar.cjs'); }
catch (e) { console.warn('[household] google-calendar lib not loaded:', e.message); }
// The budget, read from the SAME tables /owner/budget uses. Optional like the
// rest: without the DB bundle the routes simply don't register.
let hbudget = null;
try { hbudget = require('./_lib-household-budget.cjs'); }
catch (e) { console.warn('[household] budget lib not loaded:', e.message); }
let hroutines = null;
try { hroutines = require('./_lib-household-routines.cjs'); }
catch (e) { console.warn('[household] routines lib not loaded:', e.message); }
let hprojects = null;
try { hprojects = require('./_lib-household-projects.cjs'); }
catch (e) { console.warn('[household] projects lib not loaded:', e.message); }

// THE access predicate. $1 is always the caller's hh_users.id.
const VISIBLE = `(owner_id = $1 OR visibility = 'shared')`;

// due_date is cast to TEXT deliberately. It is a Postgres DATE — a calendar
// day, not an instant — but `pg` hydrates it into a JS Date at UTC midnight,
// which JSON-serialises to "2026-08-10T00:00:00.000Z". Any client east or west
// of UTC then renders the wrong day: in Eastern that is 8pm on Aug 9, so every
// due date would display one day early and "due today" would look overdue.
// Sending 'YYYY-MM-DD' kills the entire class of bug at the source, and it is
// the same shape an <input type="date"> expects. Do not "simplify" this back.
const TASK_COLS = `id, owner_id, visibility, title, notes,
  to_char(due_date, 'YYYY-MM-DD') AS due_date, starred,
  project, project_id, done_at, created_at, updated_at, touched_at`;

function registerHouseholdRoutes({ register, send, readJson }) {
  if (!hh.available()) {
    console.warn('[household] no DB layer — /api/hh/* not registered');
    return 0;
  }

  const NO_STORE = 'no-store, must-revalidate';
  const nostore = { 'Cache-Control': NO_STORE };
  let n = 0;
  const add = (path, def) => { register(path, def); n++; };

  const authHeaders = (cookie) => (cookie ? { ...nostore, 'Set-Cookie': cookie } : nostore);

  const publicUser = (u) => ({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    budgetProfileKey: u.budget_profile_key,
    tz: u.tz,
    mustChangePassword: !!u.must_change_password,
  });

  // Dates are compared in the user's timezone, not UTC. Without this a task due
  // "today" flips to overdue at 8pm ET, when UTC rolls over.
  const todayIn = (tz) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const m = {};
    p.forEach((x) => { m[x.type] = x.value; });
    return `${m.year}-${m.month}-${m.day}`;
  };

  const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
  const vis = (v) => (v === 'shared' ? 'shared' : 'private');
  // A date input arrives as 'YYYY-MM-DD' or empty. Anything else is dropped
  // rather than passed to Postgres, so a malformed value can't throw a 500.
  const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);

  // ═══════════════════════════════════════════════════════════════════════════
  // Auth
  // ═══════════════════════════════════════════════════════════════════════════

  add('/api/hh/auth/login', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 8192);
        const result = await hh.login({ email: body?.email, password: body?.password, req });
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true, user: publicUser(result.user) }, authHeaders(result.cookie));
      } catch (err) { send(res, 500, { error: String(err?.message || err) }, nostore); }
    },
  });

  // Public so a stale/invalid cookie can still be cleared instead of 401ing
  // into a state where you can't sign out.
  add('/api/hh/auth/logout', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try { await hh.destroySession(req); } catch { /* clear the cookie regardless */ }
      send(res, 200, { ok: true }, authHeaders(hh.clearCookie()));
    },
  });

  // Public + 401 rather than auth:'household', so a signed-out visitor gets
  // clean JSON the SPA can render a login form for — no redirect, no HTML.
  add('/api/hh/auth/me', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      const u = await hh.userFromRequest(req);
      if (!u) { send(res, 401, { error: 'no-session' }, nostore); return; }
      let cookie = null;
      if (hh.shouldSlide(u)) {
        try {
          const r = await hh.refreshSession(req);
          if (r) cookie = hh.sessionCookie(r.token, hh.SESSION_DAYS * 24 * 60 * 60);
        } catch { /* keep the existing cookie */ }
      }
      send(res, 200, { user: publicUser(u) }, authHeaders(cookie));
    },
  });

  add('/api/hh/auth/change-password', {
    auth: 'household', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        const body = await readJson(req, 8192);
        const result = await hh.changePassword({
          userId: access.hhUser.id,
          currentPassword: body?.currentPassword,
          newPassword: body?.newPassword,
          req,
        });
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true }, authHeaders(result.cookie));
      } catch (err) { send(res, 500, { error: String(err?.message || err) }, nostore); }
    },
  });

  add('/api/hh/health', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      try {
        const users = await hh.listUsers();
        send(res, 200, { ok: true, users: users.length }, nostore);
      } catch (err) { send(res, 500, { ok: false, error: String(err?.message || err) }, nostore); }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Tasks
  // ═══════════════════════════════════════════════════════════════════════════

  // Open tasks, ordered the way a human reads a list: overdue and due-soon
  // first, undated last, newest-added breaking ties. NULLS LAST is the whole
  // trick — without it Postgres sorts undated tasks to the very top, which
  // buries everything that actually has a deadline.
  const OPEN_ORDER = `ORDER BY due_date ASC NULLS LAST, starred DESC, created_at DESC`;

  async function listTasks(me, scope) {
    const p = hh.pool();
    const where =
      scope === 'done' ? `${VISIBLE} AND done_at IS NOT NULL`
      : scope === 'all' ? VISIBLE
      : `${VISIBLE} AND done_at IS NULL`;
    const order = scope === 'done' ? `ORDER BY done_at DESC` : OPEN_ORDER;
    const { rows } = await p.query(
      `SELECT ${TASK_COLS} FROM hh_tasks WHERE ${where} ${order} LIMIT 500`, [me]);
    return rows;
  }

  add('/api/hh/tasks', {
    auth: 'household', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      const me = access.hhUser.id;
      const p = hh.pool();
      try {
        if (req.method === 'GET') {
          const scope = new URL(req.url || '/', 'http://localhost').searchParams.get('scope') || 'open';
          send(res, 200, { tasks: await listTasks(me, scope) }, nostore);
          return;
        }

        const body = await readJson(req, 64_000);
        const action = str(body?.action, 40);

        if (action === 'create') {
          const title = str(body?.title, 300);
          if (!title) { send(res, 400, { error: 'A task needs a title.' }, nostore); return; }
          const { rows } = await p.query(
            `INSERT INTO hh_tasks (owner_id, visibility, title, notes, due_date, starred, project, project_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${TASK_COLS}`,
            [me, vis(body?.visibility), title, str(body?.notes, 4000) || null,
             dateOrNull(body?.dueDate), !!body?.starred, str(body?.project, 120) || null,
             Number(body?.projectId) > 0 ? Number(body.projectId) : null]);
          send(res, 200, { ok: true, task: rows[0] }, nostore);
          return;
        }

        const id = Number(body?.id ?? 0);
        if (!Number.isInteger(id) || id <= 0) {
          send(res, 400, { error: 'Missing task id.' }, nostore); return;
        }

        if (action === 'update') {
          // Only the fields actually present are touched, so a partial edit from
          // one screen can't blank a field another screen owns. touched_at moves
          // on every edit — that is what Slipping measures.
          const sets = [];
          const vals = [me, id];
          const put = (sql, v) => { vals.push(v); sets.push(`${sql}=$${vals.length}`); };
          if (body?.title !== undefined) {
            const t = str(body.title, 300);
            if (!t) { send(res, 400, { error: 'A task needs a title.' }, nostore); return; }
            put('title', t);
          }
          if (body?.notes !== undefined) put('notes', str(body.notes, 4000) || null);
          if (body?.dueDate !== undefined) put('due_date', dateOrNull(body.dueDate));
          if (body?.starred !== undefined) put('starred', !!body.starred);
          if (body?.project !== undefined) put('project', str(body.project, 120) || null);
          if (body?.visibility !== undefined) put('visibility', vis(body.visibility));
          if (body?.projectId !== undefined) put('project_id', Number(body.projectId) > 0 ? Number(body.projectId) : null);
          if (!sets.length) { send(res, 400, { error: 'Nothing to update.' }, nostore); return; }
          const { rows } = await p.query(
            `UPDATE hh_tasks SET ${sets.join(', ')}, updated_at=now(), touched_at=now()
              WHERE id=$2 AND ${VISIBLE} RETURNING ${TASK_COLS}`, vals);
          if (!rows[0]) { send(res, 404, { error: 'Not found.' }, nostore); return; }
          send(res, 200, { ok: true, task: rows[0] }, nostore);
          return;
        }

        if (action === 'toggleDone') {
          const { rows } = await p.query(
            `UPDATE hh_tasks
                SET done_at = CASE WHEN done_at IS NULL THEN now() ELSE NULL END,
                    updated_at=now(), touched_at=now()
              WHERE id=$2 AND ${VISIBLE} RETURNING ${TASK_COLS}`, [me, id]);
          if (!rows[0]) { send(res, 404, { error: 'Not found.' }, nostore); return; }
          send(res, 200, { ok: true, task: rows[0] }, nostore);
          return;
        }

        if (action === 'toggleStar') {
          const { rows } = await p.query(
            `UPDATE hh_tasks SET starred = NOT starred, updated_at=now(), touched_at=now()
              WHERE id=$2 AND ${VISIBLE} RETURNING ${TASK_COLS}`, [me, id]);
          if (!rows[0]) { send(res, 404, { error: 'Not found.' }, nostore); return; }
          send(res, 200, { ok: true, task: rows[0] }, nostore);
          return;
        }

        // "I looked at this, stop calling it slipping" — resets the clock
        // without pretending the task changed.
        if (action === 'touch') {
          const { rows } = await p.query(
            `UPDATE hh_tasks SET touched_at=now() WHERE id=$2 AND ${VISIBLE} RETURNING ${TASK_COLS}`,
            [me, id]);
          if (!rows[0]) { send(res, 404, { error: 'Not found.' }, nostore); return; }
          send(res, 200, { ok: true, task: rows[0] }, nostore);
          return;
        }

        if (action === 'delete') {
          // Deliberately stricter than VISIBLE: you can complete or edit a
          // shared task, but only its owner can destroy it. Deletion is the one
          // action with no undo.
          const { rowCount } = await p.query(
            `DELETE FROM hh_tasks WHERE id=$2 AND owner_id=$1`, [me, id]);
          if (!rowCount) {
            send(res, 403, { error: 'Only the person who added it can delete it.' }, nostore);
            return;
          }
          send(res, 200, { ok: true }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { send(res, 500, { error: String(err?.message || err) }, nostore); }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Notes (the Resurfacing pool)
  // ═══════════════════════════════════════════════════════════════════════════

  add('/api/hh/notes', {
    auth: 'household', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      const me = access.hhUser.id;
      const p = hh.pool();
      try {
        if (req.method === 'GET') {
          const { rows } = await p.query(
            `SELECT id, owner_id, visibility, kind, body, created_at, last_surfaced_at
               FROM hh_notes WHERE ${VISIBLE} ORDER BY created_at DESC LIMIT 500`, [me]);
          send(res, 200, { notes: rows }, nostore);
          return;
        }
        const body = await readJson(req, 64_000);
        const action = str(body?.action, 40);

        if (action === 'create') {
          const text = str(body?.body, 4000);
          if (!text) { send(res, 400, { error: 'Nothing to save.' }, nostore); return; }
          const kind = ['note', 'quote', 'journal'].includes(body?.kind) ? body.kind : 'note';
          const { rows } = await p.query(
            `INSERT INTO hh_notes (owner_id, visibility, kind, body) VALUES ($1,$2,$3,$4)
             RETURNING id, owner_id, visibility, kind, body, created_at, last_surfaced_at`,
            [me, vis(body?.visibility), kind, text]);
          send(res, 200, { ok: true, note: rows[0] }, nostore);
          return;
        }

        if (action === 'delete') {
          const id = Number(body?.id ?? 0);
          const { rowCount } = await p.query(
            `DELETE FROM hh_notes WHERE id=$2 AND owner_id=$1`, [me, id]);
          if (!rowCount) { send(res, 403, { error: 'Only the person who saved it can delete it.' }, nostore); return; }
          send(res, 200, { ok: true }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { send(res, 500, { error: String(err?.message || err) }, nostore); }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Settings
  // ═══════════════════════════════════════════════════════════════════════════

  add('/api/hh/settings', {
    auth: 'household', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      const me = access.hhUser.id;
      try {
        if (req.method === 'GET') {
          send(res, 200, { settings: await hh.getSettings(me) }, nostore);
          return;
        }
        const body = await readJson(req, 8192);
        if (body?.slippingDays !== undefined) {
          const d = Number(body.slippingDays);
          // Clamped rather than rejected: 0 would flag every task the moment
          // it's created, and there's no sane reason to go past a year.
          if (!Number.isFinite(d) || d < 1 || d > 365) {
            send(res, 400, { error: 'Slipping days must be between 1 and 365.' }, nostore);
            return;
          }
          await hh.setSetting(me, 'slippingDays', Math.round(d));
        }
        send(res, 200, { ok: true, settings: await hh.getSettings(me) }, nostore);
      } catch (err) { send(res, 500, { error: String(err?.message || err) }, nostore); }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Google Calendar (read-only)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // /connect and /callback are BROWSER NAVIGATIONS, not fetches. They are
  // registered auth:'public' and do their own session check, because a
  // navigation that 401s with JSON dumps raw text on the screen — these must
  // always end in a redirect a person can read.
  //
  // The hh_session cookie is SameSite=Lax, which permits top-level GET
  // navigations, so it IS present when Google redirects back here. (It would
  // NOT survive a POST callback — do not change the response_type to one that
  // posts.)

  const redirect = (res, to) => {
    res.statusCode = 302;
    res.setHeader('Location', to);
    res.setHeader('Cache-Control', NO_STORE);
    res.end();
  };

  if (gcal) {
    add('/api/hh/calendar/connect', {
      auth: 'public', methods: ['GET'],
      async handler(req, res) {
        const u = await hh.userFromRequest(req);
        if (!u) { redirect(res, '/'); return; }
        if (!gcal.configured()) { redirect(res, '/settings?calendar=unconfigured'); return; }
        redirect(res, gcal.authUrl(u.id));
      },
    });

    add('/api/hh/calendar/callback', {
      auth: 'public', methods: ['GET'],
      async handler(req, res) {
        try {
          const url = new URL(req.url || '/', 'http://localhost');
          const err = url.searchParams.get('error');
          // The user pressed Cancel on Google's consent screen. Not an error
          // worth a scary page — just send them back.
          if (err) { redirect(res, `/settings?calendar=${encodeURIComponent(err)}`); return; }

          const u = await hh.userFromRequest(req);
          if (!u) { redirect(res, '/'); return; }

          const state = gcal.verifyState(url.searchParams.get('state'));
          // The state is HMAC-signed by us AND must match the signed-in user.
          // Signature alone would let someone paste their own callback URL into
          // the other person's browser and bind THEIR calendar to that account.
          if (!state || state.uid !== u.id) {
            redirect(res, '/settings?calendar=bad-state'); return;
          }

          const code = url.searchParams.get('code');
          if (!code) { redirect(res, '/settings?calendar=no-code'); return; }

          await gcal.connect(u.id, code);
          redirect(res, '/settings?calendar=connected');
        } catch (e) {
          console.warn('[household] calendar callback failed:', e?.message || e);
          redirect(res, `/settings?calendar=${encodeURIComponent(String(e?.message || 'failed').slice(0, 120))}`);
        }
      },
    });

    add('/api/hh/calendar/status', {
      auth: 'household', methods: ['GET'],
      async handler(req, res, _ctx, access) {
        send(res, 200, await gcal.status(access.hhUser.id), nostore);
      },
    });

    // Every calendar the connected account can see. A shared family calendar is
    // a SEPARATE calendar in this list, not part of `primary` — which is why
    // reading only primary would never show one of its events.
    add('/api/hh/calendar/calendars', {
      auth: 'household', methods: ['GET'],
      async handler(req, res, _ctx, access) {
        send(res, 200, await gcal.listCalendars(access.hhUser.id), nostore);
      },
    });

    // Which calendars to show, and whether the household sees them.
    add('/api/hh/calendar/select', {
      auth: 'household', methods: ['POST'],
      async handler(req, res, _ctx, access) {
        try {
          const body = await readJson(req, 32_000);
          const calendarIds = Array.isArray(body?.calendarIds) ? body.calendarIds : undefined;
          const shareWithHousehold = typeof body?.shareWithHousehold === 'boolean'
            ? body.shareWithHousehold : undefined;
          if (calendarIds === undefined && shareWithHousehold === undefined) {
            send(res, 400, { error: 'Nothing to update.' }, nostore); return;
          }
          const okUpd = await gcal.saveSelection(access.hhUser.id, { calendarIds, shareWithHousehold });
          if (!okUpd) { send(res, 404, { error: 'No Google connection to update.' }, nostore); return; }
          send(res, 200, await gcal.listCalendars(access.hhUser.id), nostore);
        } catch (err) { send(res, 500, { error: String(err?.message || err) }, nostore); }
      },
    });

    add('/api/hh/calendar/disconnect', {
      auth: 'household', methods: ['POST'],
      async handler(req, res, _ctx, access) {
        try { await gcal.disconnect(access.hhUser.id); send(res, 200, { ok: true }, nostore); }
        catch (err) { send(res, 500, { error: String(err?.message || err) }, nostore); }
      },
    });

    // Fetched by the client SEPARATELY from /api/hh/today, on purpose. A call
    // out to Google can take half a second; folding it into Today would hold
    // the entire screen hostage to a third party. Today paints from our own
    // database immediately and the calendar card fills in when it fills in.
    add('/api/hh/calendar/events', {
      auth: 'household', methods: ['GET'],
      async handler(req, res, _ctx, access) {
        const u = access.hhUser;
        const qDate = new URL(req.url || '/', 'http://localhost').searchParams.get('date');
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(qDate || '')) ? qDate : todayIn(u.tz);
        // Always 200 with a shaped body. The card renders its own state from
        // `error`; a non-200 here would just become a red screen for a calendar
        // hiccup nobody needs to act on.
        send(res, 200, { date, ...(await gcal.eventsForDay(u.id, u.tz, date)) }, nostore);
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Projects, milestones, time
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Progress is measured from MILESTONES, never from task counts — see the
  // header of _lib-household-projects.cjs. Milestones and time entries inherit
  // their permission from the PROJECT, resolved by joining rather than trusting
  // an id from the client.

  if (hprojects && hprojects.available()) {
    add('/api/hh/projects', {
      auth: 'household', methods: ['GET', 'POST'],
      async handler(req, res, _ctx, access) {
        const u = access.hhUser;
        try {
          if (req.method === 'GET') {
            const q = new URL(req.url || '/', 'http://localhost').searchParams;
            const id = Number(q.get('id') || 0);
            if (id > 0) {
              const p = await hprojects.getProject(u.id, id);
              if (!p) { send(res, 404, { error: 'Not found.' }, nostore); return; }
              send(res, 200, { project: p }, nostore); return;
            }
            send(res, 200, {
              projects: await hprojects.listProjects(u.id, { includeArchived: q.get('archived') === '1' }),
            }, nostore);
            return;
          }

          const body = await readJson(req, 64_000);
          const action = str(body?.action, 40);
          const id = Number(body?.id ?? 0);

          switch (action) {
            case 'create':
              send(res, 200, { ok: true, project: await hprojects.createProject(u.id, {
                name: body?.name, description: body?.description, visibility: body?.visibility,
                targetDate: body?.targetDate, color: body?.color, status: body?.status,
              }) }, nostore);
              return;
            case 'update':
              send(res, 200, { ok: true, project: await hprojects.updateProject(u.id, id, {
                name: body?.name, description: body?.description, visibility: body?.visibility,
                status: body?.status, color: body?.color, targetDate: body?.targetDate,
              }) }, nostore);
              return;
            case 'archive':
              send(res, 200, { ok: true, project: await hprojects.archiveProject(u.id, id, body?.archived !== false) }, nostore);
              return;
            case 'delete':
              await hprojects.deleteProject(u.id, id);
              send(res, 200, { ok: true }, nostore); return;
            case 'addMilestone':
              send(res, 200, { ok: true, milestone: await hprojects.addMilestone(u.id, id, body?.title) }, nostore);
              return;
            case 'toggleMilestone':
              send(res, 200, { ok: true, milestone: await hprojects.toggleMilestone(u.id, Number(body?.milestoneId)) }, nostore);
              return;
            case 'updateMilestone':
              send(res, 200, { ok: true, milestone: await hprojects.updateMilestone(u.id, Number(body?.milestoneId), body?.title) }, nostore);
              return;
            case 'deleteMilestone':
              await hprojects.deleteMilestone(u.id, Number(body?.milestoneId));
              send(res, 200, { ok: true }, nostore); return;
            case 'logTime':
              send(res, 200, { ok: true, entry: await hprojects.logTime(u.id, id, {
                minutes: body?.minutes, day: body?.day, note: body?.note,
              }, u.tz) }, nostore);
              return;
            case 'deleteTime':
              await hprojects.deleteTime(u.id, Number(body?.entryId));
              send(res, 200, { ok: true }, nostore); return;
            default:
              send(res, 400, { error: `Unknown action: ${action}` }, nostore);
          }
        } catch (err) {
          send(res, 400, { error: String(err?.message || err) }, nostore);
        }
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Routines & habits
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Deliberately NOT part of /api/hh/tasks. A routine is a recurring intention
  // that never completes; a task is done once and gone. Mixing them leaves your
  // to-do list permanently full of things you do every day, or makes habits
  // vanish the moment you tick them.

  if (hroutines && hroutines.available()) {
    add('/api/hh/routines', {
      auth: 'household', methods: ['GET', 'POST'],
      async handler(req, res, _ctx, access) {
        const u = access.hhUser;
        try {
          if (req.method === 'GET') {
            const d = new URL(req.url || '/', 'http://localhost').searchParams.get('date');
            send(res, 200, await hroutines.getRoutines(u.id, u.tz, d), nostore);
            return;
          }
          const body = await readJson(req, 32_000);
          const action = str(body?.action, 40);

          if (action === 'create') {
            send(res, 200, { ok: true, routine: await hroutines.create(u.id, {
              title: body?.title, block: body?.block, visibility: body?.visibility,
            }) }, nostore);
            return;
          }

          const id = Number(body?.id ?? 0);
          if (!Number.isInteger(id) || id <= 0) { send(res, 400, { error: 'Missing id.' }, nostore); return; }

          if (action === 'toggle') {
            send(res, 200, { ok: true, ...(await hroutines.toggle(u.id, id, u.tz, body?.date)) }, nostore);
            return;
          }
          if (action === 'update') {
            send(res, 200, { ok: true, routine: await hroutines.update(u.id, id, {
              title: body?.title, block: body?.block,
              visibility: body?.visibility, sortOrder: body?.sortOrder,
            }) }, nostore);
            return;
          }
          if (action === 'archive') { await hroutines.archive(u.id, id); send(res, 200, { ok: true }, nostore); return; }
          if (action === 'delete') { await hroutines.remove(u.id, id); send(res, 200, { ok: true }, nostore); return; }

          send(res, 400, { error: `Unknown action: ${action}` }, nostore);
        } catch (err) {
          send(res, 400, { error: String(err?.message || err) }, nostore);
        }
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Budget
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Scoped by the signed-in user's budget_profile_key, which defaults to 'owner'
  // — the single profile /api/budget has always used. So this reads the EXISTING
  // register with no migration, and a payment entered here appears on
  // /owner/budget immediately (and vice versa). There is no second budget.
  //
  // Recurring bills are expanded at read time from the rules, using logic ported
  // verbatim from the desktop page. Marking one paid materialises it as a real
  // row under `__recur__:<ruleId>:<date>`, which is exactly how the desktop
  // records it — so neither surface can double-pay a bill the other settled.

  if (hbudget && hbudget.available()) {
    add('/api/hh/budget', {
      auth: 'household', methods: ['GET', 'POST'],
      async handler(req, res, _ctx, access) {
        const u = access.hhUser;
        const key = u.budget_profile_key || 'owner';
        try {
          if (req.method === 'GET') {
            const month = new URL(req.url || '/', 'http://localhost').searchParams.get('month');
            send(res, 200, await hbudget.getMonth(key, month, u.tz), nostore);
            return;
          }

          const body = await readJson(req, 64_000);
          const action = str(body?.action, 40);

          if (action === 'addRow') {
            const row = await hbudget.addRow(key, {
              date: body?.date, label: body?.label, bank: body?.bank,
              amount: body?.amount, kind: body?.kind,
            });
            send(res, 200, { ok: true, row }, nostore); return;
          }
          if (action === 'markBillPaid') {
            const out = await hbudget.markBillPaid(key, {
              tag: body?.tag, date: body?.date, label: body?.label,
              bank: body?.bank, amount: body?.amount,
            });
            send(res, 200, { ok: true, ...out }, nostore); return;
          }
          if (action === 'updateRow') {
            await hbudget.updateRow(key, Number(body?.id), {
              date: body?.date, label: body?.label, bank: body?.bank, amount: body?.amount,
            });
            send(res, 200, { ok: true }, nostore); return;
          }
          if (action === 'deleteRow') {
            await hbudget.deleteRow(key, Number(body?.id));
            send(res, 200, { ok: true }, nostore); return;
          }
          if (action === 'setDailyBalance') {
            const row = await hbudget.setDailyBalance(key, {
              day: body?.day, coastal: body?.coastal, truist: body?.truist, secu: body?.secu,
            });
            send(res, 200, { ok: true, dailyBalance: row }, nostore); return;
          }
          if (action === 'setCategory') {
            await hbudget.setRowCategory(key, Number(body?.id), body?.categoryId);
            send(res, 200, { ok: true }, nostore); return;
          }

          send(res, 400, { error: `Unknown action: ${action}` }, nostore);
        } catch (err) {
          // These throw human-readable messages ("Pick a date.", "Give it a
          // name.") — surfaced as 400s so the phone can show them verbatim
          // instead of a generic failure.
          send(res, 400, { error: String(err?.message || err) }, nostore);
        }
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Today — one round trip for the whole screen
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Composed server-side on purpose. The alternative is the phone firing five
  // requests over a mobile connection and painting the screen in five stages;
  // this way it paints once. Every query below is scoped by VISIBLE.
  add('/api/hh/today', {
    auth: 'household', methods: ['GET'],
    async handler(req, res, _ctx, access) {
      const me = access.hhUser.id;
      const p = hh.pool();
      try {
        const settings = await hh.getSettings(me);
        const slippingDays = Number(settings.slippingDays) || 7;
        const today = todayIn(access.hhUser.tz);

        const [top3, open, slipping, counts, people] = await Promise.all([
          // Top 3 — starred and open. Capped at 3 by design: a "top 3" of nine
          // items is just a list.
          p.query(
            `SELECT ${TASK_COLS} FROM hh_tasks
              WHERE ${VISIBLE} AND done_at IS NULL AND starred = TRUE
              ${OPEN_ORDER} LIMIT 3`, [me]),
          p.query(
            `SELECT ${TASK_COLS} FROM hh_tasks
              WHERE ${VISIBLE} AND done_at IS NULL ${OPEN_ORDER} LIMIT 200`, [me]),
          // Slipping — open, untouched for N days. Starred items are excluded:
          // they're already at the top of the screen, so flagging them again is
          // noise, not a nudge.
          p.query(
            `SELECT ${TASK_COLS} FROM hh_tasks
              WHERE ${VISIBLE} AND done_at IS NULL AND starred = FALSE
                AND touched_at < now() - ($2::int * interval '1 day')
              ORDER BY touched_at ASC LIMIT 10`, [me, slippingDays]),
          p.query(
            `SELECT
               COUNT(*) FILTER (WHERE done_at IS NULL)::int AS open,
               COUNT(*) FILTER (WHERE done_at IS NULL AND due_date < $2::date)::int AS overdue,
               COUNT(*) FILTER (WHERE done_at IS NULL AND due_date = $2::date)::int AS due_today,
               COUNT(*) FILTER (WHERE done_at >= date_trunc('day', now()))::int AS done_today
             FROM hh_tasks WHERE ${VISIBLE}`, [me, today]),
          // Both household members, so the UI can label a shared row with whose
          // it is without a lookup per row.
          hh.listUsers(),
        ]);

        // Resurfacing — one saved note, rotating daily. Chosen by day-number
        // modulo the pool size rather than at random, so it stays stable if you
        // reload the screen ten times in a morning, and still moves tomorrow.
        let resurfacing = null;
        const { rows: noteRows } = await p.query(
          `SELECT id, owner_id, kind, body, created_at FROM hh_notes
            WHERE ${VISIBLE} ORDER BY id ASC`, [me]);
        if (noteRows.length) {
          const dayNum = Math.floor(new Date(`${today}T00:00:00Z`).getTime() / 86_400_000);
          resurfacing = noteRows[dayNum % noteRows.length];
          p.query(`UPDATE hh_notes SET last_surfaced_at=now() WHERE id=$1`, [resurfacing.id])
            .catch(() => { /* cosmetic; never fail the screen over it */ });
        }

        send(res, 200, {
          today,
          tz: access.hhUser.tz,
          slippingDays,
          top3: top3.rows,
          open: open.rows,
          slipping: slipping.rows,
          counts: counts.rows[0] || { open: 0, overdue: 0, due_today: 0, done_today: 0 },
          resurfacing,
          people: people.map((u) => ({ id: u.id, displayName: u.display_name })),
          // Whether to show a Connect button or fetch events. The events
          // themselves come from /api/hh/calendar/events so a slow Google call
          // never delays this response.
          calendar: gcal
            ? await gcal.status(access.hhUser.id).catch(() => ({ configured: false, connected: false }))
            : { configured: false, connected: false },
          // Balances + what's due next, from the same budget tables. Wrapped
          // so a budget hiccup degrades one card instead of the whole screen.
          routines: hroutines && hroutines.available()
            ? await hroutines.summary(access.hhUser.id, access.hhUser.tz).catch(() => null)
            : null,
          money: hbudget && hbudget.available()
            ? await hbudget.summary(access.hhUser.budget_profile_key || 'owner', access.hhUser.tz)
                .catch(() => null)
            : null,
        }, nostore);
      } catch (err) { send(res, 500, { error: String(err?.message || err) }, nostore); }
    },
  });

  return n;
}

module.exports = { registerHouseholdRoutes };
