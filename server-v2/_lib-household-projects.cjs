'use strict';
/**
 * server-v2/_lib-household-projects.cjs — projects, milestones, time logging.
 *
 * ── WHY PROGRESS COMES FROM MILESTONES, NOT TASKS ─────────────────────────
 * A project with 40 small tasks and 3 real milestones shows 80% complete once
 * you've cleared the easy tasks — which is precisely the lie a progress bar
 * exists to prevent. Milestones are the few things that actually mean progress,
 * so they are what the bar measures. Tasks are listed and counted separately.
 *
 * A project with no milestones reports null progress rather than 0% or 100% —
 * "I don't know yet" is honest; either number would be a guess.
 *
 * Same visibility rule as the rest of the app: yours, or shared with you.
 * Because milestones and time entries hang off a project, their permission is
 * the PROJECT's — checked by joining, never by trusting an id from the client.
 */

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[hh-projects] _lib-db.cjs not loaded:', e.message); }

const available = () => !!libDb;

const VISIBLE = `(owner_id = $1 OR visibility = 'shared')`;
const STATUSES = ['active', 'someday', 'done'];
const normStatus = (v) => (STATUSES.includes(v) ? v : 'active');

const PROJECT_COLS = `id, owner_id, visibility, name, description, status, color,
  to_char(target_date, 'YYYY-MM-DD') AS target_date, created_at, updated_at, archived_at`;

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

function todayIn(tz = 'America/New_York') {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  p.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

/** Resolve a project the caller may actually touch, or null. */
async function visibleProject(userId, projectId) {
  const { rows } = await libDb.getPool().query(
    `SELECT ${PROJECT_COLS} FROM hh_projects WHERE id=$2 AND ${VISIBLE}`, [userId, projectId]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * All visible projects with progress, task counts and logged time.
 *
 * Three aggregate queries, not three per project. With a dozen projects the
 * per-project version is 37 round trips on a phone.
 */
async function listProjects(userId, { includeArchived = false } = {}) {
  const pool = libDb.getPool();
  const where = includeArchived ? VISIBLE : `${VISIBLE} AND archived_at IS NULL`;

  const [{ rows: projects }, { rows: ms }, { rows: tasks }, { rows: time }] = await Promise.all([
    pool.query(`SELECT ${PROJECT_COLS} FROM hh_projects WHERE ${where}
                 ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'someday' THEN 1 ELSE 2 END,
                          target_date ASC NULLS LAST, id DESC`, [userId]),
    pool.query(`SELECT m.project_id,
                       COUNT(*)::int AS total,
                       COUNT(m.done_at)::int AS done
                  FROM hh_milestones m JOIN hh_projects p ON p.id = m.project_id
                 WHERE (p.owner_id = $1 OR p.visibility = 'shared')
                 GROUP BY m.project_id`, [userId]),
    pool.query(`SELECT t.project_id,
                       COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE t.done_at IS NULL)::int AS open
                  FROM hh_tasks t
                 WHERE t.project_id IS NOT NULL AND (t.owner_id = $1 OR t.visibility = 'shared')
                 GROUP BY t.project_id`, [userId]),
    pool.query(`SELECT l.project_id, SUM(l.minutes)::int AS minutes
                  FROM hh_time_log l JOIN hh_projects p ON p.id = l.project_id
                 WHERE (p.owner_id = $1 OR p.visibility = 'shared')
                 GROUP BY l.project_id`, [userId]),
  ]);

  const msBy = new Map(ms.map((r) => [r.project_id, r]));
  const tBy = new Map(tasks.map((r) => [r.project_id, r]));
  const timeBy = new Map(time.map((r) => [r.project_id, r]));

  return projects.map((p) => {
    const m = msBy.get(p.id) || { total: 0, done: 0 };
    const t = tBy.get(p.id) || { total: 0, open: 0 };
    return {
      ...p,
      milestones: { total: m.total, done: m.done },
      tasks: { total: t.total, open: t.open },
      minutes: timeBy.get(p.id)?.minutes || 0,
      // null, not 0 — a project with no milestones has unknown progress, and
      // either number would be a guess dressed up as a fact.
      progress: m.total > 0 ? Math.round((m.done / m.total) * 100) : null,
    };
  });
}

/** One project with its milestones, tasks and recent time entries. */
async function getProject(userId, projectId) {
  const pool = libDb.getPool();
  const project = await visibleProject(userId, projectId);
  if (!project) return null;

  const [{ rows: milestones }, { rows: tasks }, { rows: time }, { rows: totals }] = await Promise.all([
    pool.query(`SELECT id, title, sort_order, done_at, done_by
                  FROM hh_milestones WHERE project_id=$1 ORDER BY sort_order, id`, [projectId]),
    pool.query(`SELECT id, owner_id, visibility, title,
                       to_char(due_date,'YYYY-MM-DD') AS due_date, starred, done_at
                  FROM hh_tasks
                 WHERE project_id=$2 AND (owner_id = $1 OR visibility = 'shared')
                 ORDER BY done_at NULLS FIRST, due_date ASC NULLS LAST, id`, [userId, projectId]),
    pool.query(`SELECT l.id, to_char(l.day,'YYYY-MM-DD') AS day, l.minutes, l.note, l.user_id
                  FROM hh_time_log l WHERE l.project_id=$1 ORDER BY l.day DESC, l.id DESC LIMIT 50`, [projectId]),
    pool.query(`SELECT COALESCE(SUM(minutes),0)::int AS total,
                       COALESCE(SUM(minutes) FILTER (WHERE day >= (CURRENT_DATE - 7)),0)::int AS week
                  FROM hh_time_log WHERE project_id=$1`, [projectId]),
  ]);

  const done = milestones.filter((m) => m.done_at).length;
  return {
    ...project,
    milestones,
    tasks,
    timeEntries: time,
    minutes: totals[0]?.total || 0,
    minutesThisWeek: totals[0]?.week || 0,
    progress: milestones.length ? Math.round((done / milestones.length) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// Write — projects
// ---------------------------------------------------------------------------

async function createProject(userId, { name, description, visibility, targetDate, color, status }) {
  const n = str(name, 200);
  if (!n) throw new Error('Give the project a name.');
  const { rows } = await libDb.getPool().query(
    `INSERT INTO hh_projects (owner_id, visibility, name, description, status, color, target_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${PROJECT_COLS}`,
    [userId, visibility === 'shared' ? 'shared' : 'private', n,
     str(description, 4000) || null, normStatus(status), str(color, 20) || null,
     isDate(targetDate) ? targetDate : null]);
  return rows[0];
}

async function updateProject(userId, id, patch) {
  const sets = [];
  const vals = [userId, id];
  const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.name !== undefined) {
    const n = str(patch.name, 200);
    if (!n) throw new Error('Give the project a name.');
    put('name', n);
  }
  if (patch.description !== undefined) put('description', str(patch.description, 4000) || null);
  if (patch.visibility !== undefined) put('visibility', patch.visibility === 'shared' ? 'shared' : 'private');
  if (patch.status !== undefined) put('status', normStatus(patch.status));
  if (patch.color !== undefined) put('color', str(patch.color, 20) || null);
  if (patch.targetDate !== undefined) put('target_date', isDate(patch.targetDate) ? patch.targetDate : null);
  if (!sets.length) throw new Error('Nothing to update.');
  const { rows } = await libDb.getPool().query(
    `UPDATE hh_projects SET ${sets.join(', ')}, updated_at=now()
      WHERE id=$2 AND ${VISIBLE} RETURNING ${PROJECT_COLS}`, vals);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

/** Archive hides it and keeps everything. Deleting a project takes its
 *  milestones, task links and logged hours with it, so it is owner-only. */
async function archiveProject(userId, id, archived = true) {
  const { rows } = await libDb.getPool().query(
    `UPDATE hh_projects SET archived_at = ${archived ? 'now()' : 'NULL'}, updated_at=now()
      WHERE id=$2 AND owner_id=$1 RETURNING ${PROJECT_COLS}`, [userId, id]);
  if (!rows[0]) throw new Error('Only the person who created it can archive it.');
  return rows[0];
}

async function deleteProject(userId, id) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_projects WHERE id=$2 AND owner_id=$1`, [userId, id]);
  if (!rowCount) throw new Error('Only the person who created it can delete it.');
  return true;
}

// ---------------------------------------------------------------------------
// Write — milestones
// ---------------------------------------------------------------------------

async function addMilestone(userId, projectId, title) {
  const pool = libDb.getPool();
  // Permission comes from the PROJECT. Without this check anyone could append a
  // milestone to the other person's private project by guessing an id.
  if (!await visibleProject(userId, projectId)) throw new Error('Not found.');
  const t = str(title, 200);
  if (!t) throw new Error('Give the milestone a name.');
  const { rows: [max] } = await pool.query(
    `SELECT COALESCE(MAX(sort_order),0) AS m FROM hh_milestones WHERE project_id=$1`, [projectId]);
  const { rows } = await pool.query(
    `INSERT INTO hh_milestones (project_id, title, sort_order) VALUES ($1,$2,$3)
     RETURNING id, title, sort_order, done_at, done_by`,
    [projectId, t, Number(max.m) + 10]);
  return rows[0];
}

async function toggleMilestone(userId, milestoneId) {
  const pool = libDb.getPool();
  const { rows: [m] } = await pool.query(
    `SELECT m.id FROM hh_milestones m JOIN hh_projects p ON p.id = m.project_id
      WHERE m.id=$2 AND (p.owner_id=$1 OR p.visibility='shared')`, [userId, milestoneId]);
  if (!m) throw new Error('Not found.');
  const { rows } = await pool.query(
    `UPDATE hh_milestones
        SET done_at = CASE WHEN done_at IS NULL THEN now() ELSE NULL END,
            done_by = CASE WHEN done_at IS NULL THEN $2::int ELSE NULL END
      WHERE id=$1 RETURNING id, title, sort_order, done_at, done_by`, [milestoneId, userId]);
  return rows[0];
}

async function updateMilestone(userId, milestoneId, title) {
  const pool = libDb.getPool();
  const t = str(title, 200);
  if (!t) throw new Error('Give the milestone a name.');
  const { rows } = await pool.query(
    `UPDATE hh_milestones m SET title=$3 FROM hh_projects p
      WHERE m.id=$2 AND p.id = m.project_id AND (p.owner_id=$1 OR p.visibility='shared')
      RETURNING m.id, m.title, m.sort_order, m.done_at, m.done_by`, [userId, milestoneId, t]);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

async function deleteMilestone(userId, milestoneId) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_milestones m USING hh_projects p
      WHERE m.id=$2 AND p.id = m.project_id AND (p.owner_id=$1 OR p.visibility='shared')`,
    [userId, milestoneId]);
  if (!rowCount) throw new Error('Not found.');
  return true;
}

// ---------------------------------------------------------------------------
// Write — time
// ---------------------------------------------------------------------------

/**
 * Log time against a project, in whole minutes.
 *
 * Capped at 24h per entry: anything larger is a typo (an extra zero on "90"),
 * and a single bad row silently ruins every total that reads from it.
 */
async function logTime(userId, projectId, { minutes, day, note }, tz = 'America/New_York') {
  if (!await visibleProject(userId, projectId)) throw new Error('Not found.');
  const mins = Math.round(Number(minutes));
  if (!Number.isFinite(mins) || mins === 0) throw new Error('How long did you work?');
  if (Math.abs(mins) > 24 * 60) throw new Error("That's more than a day — check the number.");
  const d = isDate(day) ? day : todayIn(tz);
  const { rows } = await libDb.getPool().query(
    `INSERT INTO hh_time_log (project_id, user_id, day, minutes, note)
     VALUES ($1,$2,$3::date,$4,$5)
     RETURNING id, to_char(day,'YYYY-MM-DD') AS day, minutes, note, user_id`,
    [projectId, userId, d, mins, str(note, 500) || null]);
  return rows[0];
}

/** Only whoever logged it can remove it — someone else's hours aren't yours. */
async function deleteTime(userId, entryId) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_time_log WHERE id=$2 AND user_id=$1`, [userId, entryId]);
  if (!rowCount) throw new Error('Only the person who logged it can remove it.');
  return true;
}

/** Compact list for attaching a task to a project. */
async function projectOptions(userId) {
  const { rows } = await libDb.getPool().query(
    `SELECT id, name, color FROM hh_projects
      WHERE ${VISIBLE} AND archived_at IS NULL AND status <> 'done' ORDER BY name`, [userId]);
  return rows;
}

module.exports = {
  available,
  listProjects, getProject, projectOptions,
  createProject, updateProject, archiveProject, deleteProject,
  addMilestone, toggleMilestone, updateMilestone, deleteMilestone,
  logTime, deleteTime,
  todayIn,
};
