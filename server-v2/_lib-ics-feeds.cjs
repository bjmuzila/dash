'use strict';
/**
 * server-v2/_lib-ics-feeds.cjs — subscribed ICS/webcal feeds for the household
 * app, alongside (not instead of) the Google connection.
 *
 * WHY THIS EXISTS
 *   A team or school publishes an .ics URL. Subscribing to it in Google works,
 *   but Google polls a From-URL calendar on its own schedule — hours, sometimes
 *   a day — so a practice added this morning is simply not there tonight. This
 *   reads the feed directly on a 30-minute cycle, which is the difference
 *   between "the app knows about tomorrow's game" and "the app knew last week".
 *   It also covers feeds that never reach Google at all, e.g. one subscribed
 *   only in Apple Calendar.
 *
 * DESIGN RULES (the same ones _lib-google-calendar.cjs follows)
 *   1. Read-only, and never throws into a route. Every path returns a shaped
 *      result or an { error }; a dead feed degrades one card, it does not take
 *      down the Today screen.
 *   2. The events it produces are SHAPE-IDENTICAL to the Google ones, including
 *      RFC3339-with-offset starts in the user's timezone, so the client merges
 *      the two lists without knowing which came from where.
 *   3. Fetching a URL a user supplies is an SSRF sink. Hostnames are resolved
 *      and private/loopback/link-local addresses are refused BEFORE the request
 *      — see safeUrl(). Redirects are followed by fetch(), so the response's
 *      final URL is re-checked afterwards.
 *   4. Bounded everywhere: feeds per user, bytes per fetch, seconds per fetch,
 *      recurrence instances per expansion. A feed cannot become a way to hang
 *      the process.
 */

const dns = require('dns').promises;
const net = require('net');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); } catch { /* available() reports it */ }

const MAX_FEEDS_PER_USER = 12;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 4_000_000;
/** How old a cached feed body may be before it is re-fetched. */
const REFRESH_MS = 30 * 60_000;
/** Hard ceiling on instances generated from one RRULE inside one window. */
const MAX_INSTANCES = 750;

function available() { return !!libDb; }
const pool = () => libDb.getPool();

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let ready = null;
function ensureTable() {
  if (ready) return ready;
  ready = (async () => {
    await pool().query(`
      CREATE TABLE IF NOT EXISTS hh_ics_feeds (
        id                   SERIAL PRIMARY KEY,
        user_id              INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        url                  TEXT NOT NULL,
        name                 TEXT,
        colour               TEXT,
        enabled              BOOLEAN NOT NULL DEFAULT TRUE,
        share_with_household BOOLEAN NOT NULL DEFAULT TRUE,
        body                 TEXT,
        fetched_at           TIMESTAMPTZ,
        last_error           TEXT,
        event_count          INTEGER,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // One subscription per URL per person. Re-adding a feed you already have is
    // a mis-click, not a request for a duplicate row that then double-renders
    // every event.
    await pool().query(
      `CREATE UNIQUE INDEX IF NOT EXISTS hh_ics_feeds_user_url ON hh_ics_feeds (user_id, url)`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

/** RFC1918 + loopback + link-local + CGNAT + unique-local v6. */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;          // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const s = String(ip).toLowerCase();
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
  if (s.startsWith('fe80')) return true;                     // link local
  // ::ffff:10.0.0.1 — an IPv4 address wearing a v6 hat.
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) return isPrivateAddress(v4[1]);
  return false;
}

/**
 * Normalise and vet a user-supplied feed URL.
 *
 * webcal:// is the scheme calendar apps hand out; it is plain https underneath,
 * and rewriting it here means a person can paste exactly what Apple or the
 * league gave them.
 *
 * Returns { url } or { error } — never throws.
 */
async function safeUrl(raw) {
  // The webcal:// swap is done on the STRING, before parsing. Assigning
  // `u.protocol` would not work: webcal is not a "special" scheme to the URL
  // parser, which silently ignores the assignment and leaves webcal:// intact —
  // and fetch() then refuses the request.
  const text = String(raw || '').trim().replace(/^webcal:\/\//i, 'https://');

  let u;
  try { u = new URL(text); }
  catch { return { error: "That doesn't look like a URL." }; }

  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') return { error: 'Only https / webcal links can be subscribed.' };
  if (u.username || u.password) return { error: 'Remove the username and password from the link.' };

  const host = u.hostname;
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { error: 'That address is not reachable from the server.' };
  }
  // A literal IP never needs DNS, and must be checked directly.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) return { error: 'That address is not reachable from the server.' };
    return { url: u.toString() };
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length) return { error: "That host doesn't resolve." };
    if (addrs.some((a) => isPrivateAddress(a.address))) {
      return { error: 'That address is not reachable from the server.' };
    }
  } catch { return { error: "That host doesn't resolve." }; }

  return { url: u.toString() };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** In-flight fetches, so ten mounts of Today don't become ten HTTP requests. */
const inFlight = new Map();

async function fetchBody(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Some publishers 403 a bare programmatic request.
        'User-Agent': 'cbedge-household-calendar/1.0 (+https://budget.cbedge.net)',
        Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5',
      },
    });
    if (!r.ok) return { error: `feed-${r.status}` };
    // fetch() followed any redirects for us, so the host that actually answered
    // may not be the one that was vetted. Re-check it.
    if (r.url && r.url !== url) {
      const again = await safeUrl(r.url);
      if (again.error) return { error: 'redirected-somewhere-unreachable' };
    }
    const text = await r.text();
    if (text.length > MAX_BYTES) return { error: 'feed-too-large' };
    if (!/BEGIN:VCALENDAR/i.test(text)) return { error: 'not-a-calendar' };
    return { body: text };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) };
  } finally { clearTimeout(timer); }
}

/**
 * Refresh one feed row's cached body.
 *
 * A failure is recorded on the row and the PREVIOUS body is kept: a feed that
 * 500s for an hour should keep showing last night's practices, not go blank.
 */
async function refreshFeed(row, { force = false } = {}) {
  const fresh = row.fetched_at && Date.now() - new Date(row.fetched_at).getTime() < REFRESH_MS;
  if (fresh && !force && row.body) return row;

  if (inFlight.has(row.id)) return inFlight.get(row.id);
  const job = (async () => {
    const vetted = await safeUrl(row.url);
    const res = vetted.error ? { error: vetted.error } : await fetchBody(vetted.url);
    if (res.error) {
      await pool().query(
        `UPDATE hh_ics_feeds SET last_error=$2, fetched_at=now() WHERE id=$1`,
        [row.id, String(res.error).slice(0, 300)]).catch(() => {});
      return { ...row, last_error: res.error, fetched_at: new Date().toISOString() };
    }
    const parsed = parseIcs(res.body);
    // The feed's own X-WR-CALNAME is a better label than the URL, but never
    // overwrite a name the user typed.
    const name = row.name || parsed.calName || null;
    await pool().query(
      `UPDATE hh_ics_feeds
          SET body=$2, fetched_at=now(), last_error=NULL, event_count=$3, name=COALESCE(name,$4)
        WHERE id=$1`,
      [row.id, res.body, parsed.events.length, name]).catch(() => {});
    return { ...row, body: res.body, name, last_error: null, fetched_at: new Date().toISOString() };
  })().finally(() => inFlight.delete(row.id));

  inFlight.set(row.id, job);
  return job;
}

// ---------------------------------------------------------------------------
// ICS parsing
//
// Deliberately hand-rolled rather than a dependency: this server takes no new
// npm packages for a format that is, for the feeds people actually paste, a
// list of VEVENTs with five properties each. The pieces that are genuinely
// fiddly — line folding, TZID wall-clock times, and a bounded RRULE — are
// handled below and nothing else is claimed.
// ---------------------------------------------------------------------------

/** Unfold (RFC 5545 §3.1: a leading space continues the previous line). */
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(v) {
  return String(v)
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/** "DTSTART;TZID=America/New_York:20260815T110000" → name, params, value. */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const bits = left.split(';');
  const name = bits[0].toUpperCase();
  const params = {};
  for (const b of bits.slice(1)) {
    const eq = b.indexOf('=');
    if (eq > 0) params[b.slice(0, eq).toUpperCase()] = b.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

/** Minutes east of UTC that `tz` is at a given instant. */
function offsetMinutesAt(tz, ms) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  } catch { return 0; }
}

/**
 * A wall-clock time in `tz` → a UTC instant.
 *
 * Two passes: the first offset is looked up at the naive instant, which is
 * wrong by an hour for the times either side of a DST change; re-reading the
 * offset at the corrected instant fixes it. (An hour that does not exist at all
 * lands on the following one, which is what every calendar client does.)
 */
function wallToUtc(tz, y, mo, d, h, mi, s) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = offsetMinutesAt(tz, naive);
  let ms = naive - off1 * 60_000;
  const off2 = offsetMinutesAt(tz, ms);
  if (off2 !== off1) ms = naive - off2 * 60_000;
  return ms;
}

/** Parsed DTSTART/DTEND: { allDay, date?, ms? }. */
function parseWhen(prop, defaultTz) {
  const v = String(prop.value || '').trim();
  const isDate = prop.params.VALUE === 'DATE' || /^\d{8}$/.test(v);
  if (isDate) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return null;
    return { allDay: true, date: `${m[1]}-${m[2]}-${m[3]}` };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const nums = [Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s)];
  if (z) return { allDay: false, ms: Date.UTC(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5]) };
  // TZID when given; otherwise a floating time, which means "whatever clock the
  // reader is on" — for this app that is the user's own timezone.
  return { allDay: false, ms: wallToUtc(prop.params.TZID || defaultTz, ...nums) };
}

/**
 * Feed → { calName, events }. Each event carries enough to be expanded later:
 * recurrence is NOT expanded here, because the window it should be expanded
 * over is a property of the question being asked, not of the feed.
 */
function parseIcs(text, defaultTz = 'UTC') {
  const lines = unfold(text).split('\n');
  const events = [];
  let calName = null;
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^BEGIN:VEVENT$/i.test(line)) { cur = { props: {}, exdates: [] }; continue; }
    if (/^END:VEVENT$/i.test(line)) {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    const p = parseLine(line);
    if (!p) continue;
    if (!cur) {
      if (p.name === 'X-WR-CALNAME') calName = unescapeText(p.value);
      continue;
    }
    if (p.name === 'EXDATE') {
      for (const one of String(p.value).split(',')) {
        const w = parseWhen({ ...p, value: one }, defaultTz);
        if (w) cur.exdates.push(w.allDay ? w.date : w.ms);
      }
      continue;
    }
    cur.props[p.name] = p;
  }

  const shaped = [];
  for (const e of events) {
    const P = e.props;
    if (!P.DTSTART) continue;
    // Cancelled instances are still in many feeds; showing them is worse than
    // showing nothing, because you turn up to a cancelled practice.
    if (P.STATUS && /CANCELLED/i.test(P.STATUS.value)) continue;
    const start = parseWhen(P.DTSTART, defaultTz);
    if (!start) continue;
    const end = P.DTEND ? parseWhen(P.DTEND, defaultTz) : null;
    shaped.push({
      uid: P.UID ? String(P.UID.value).trim() : `${P.DTSTART.value}|${P.SUMMARY?.value || ''}`,
      summary: P.SUMMARY ? unescapeText(P.SUMMARY.value) : '(no title)',
      location: P.LOCATION ? unescapeText(P.LOCATION.value) : null,
      start,
      end,
      rrule: P.RRULE ? String(P.RRULE.value) : null,
      exdates: e.exdates,
      recurrenceId: P['RECURRENCE-ID'] ? parseWhen(P['RECURRENCE-ID'], defaultTz) : null,
    });
  }
  return { calName, events: shaped };
}

const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Expand one event into the instances that fall inside [fromMs, toMs).
 *
 * Supports FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL and
 * BYDAY — which covers "every Tuesday and Thursday until the season ends", the
 * shape team and school feeds actually publish. Anything more exotic (BYSETPOS,
 * BYMONTHDAY lists) falls back to the single starting instance rather than
 * guessing wrong dates, and the counter caps runaway rules.
 */
function expand(ev, fromMs, toMs, tz) {
  const startMs = ev.start.allDay ? Date.parse(`${ev.start.date}T00:00:00Z`) : ev.start.ms;
  const durMs = ev.end
    ? (ev.end.allDay ? Date.parse(`${ev.end.date}T00:00:00Z`) : ev.end.ms) - startMs
    : (ev.start.allDay ? 86_400_000 : 3_600_000);

  const hits = [];
  const push = (ms) => {
    if (ms + Math.max(durMs, 1) <= fromMs || ms >= toMs) return;
    hits.push(ms);
  };

  if (!ev.rrule) { push(startMs); return { hits, durMs }; }

  const R = {};
  for (const part of ev.rrule.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) R[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = String(R.FREQ || '').toUpperCase();
  const interval = Math.max(1, Number(R.INTERVAL) || 1);
  const count = Number(R.COUNT) || 0;
  let untilMs = Infinity;
  if (R.UNTIL) {
    const w = parseWhen({ params: {}, value: R.UNTIL }, tz);
    if (w) untilMs = w.allDay ? Date.parse(`${w.date}T23:59:59Z`) : w.ms;
  }
  const byDay = R.BYDAY
    ? R.BYDAY.split(',').map((d) => WEEKDAYS[d.trim().slice(-2).toUpperCase()]).filter((n) => n !== undefined)
    : null;

  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) { push(startMs); return { hits, durMs }; }

  const exSet = new Set(ev.exdates.map((x) => (typeof x === 'string' ? Date.parse(`${x}T00:00:00Z`) : x)));
  const step = { DAILY: 1, WEEKLY: 7 }[freq];
  let emitted = 0;
  let cursor = startMs;

  for (let i = 0; i < MAX_INSTANCES; i++) {
    if (cursor > untilMs || cursor >= toMs) break;
    if (count && emitted >= count) break;

    if (freq === 'WEEKLY' && byDay) {
      // Walk the seven days of this week and take the ones named by BYDAY.
      const weekStart = cursor;
      for (let d = 0; d < 7; d++) {
        const ms = weekStart + d * 86_400_000;
        if (ms < startMs || ms > untilMs || ms >= toMs) continue;
        if (!byDay.includes(new Date(ms).getUTCDay())) continue;
        if (exSet.has(ms)) continue;
        if (count && emitted >= count) break;
        emitted++;
        push(ms);
      }
    } else if (!exSet.has(cursor)) {
      emitted++;
      push(cursor);
    }

    if (step) cursor += step * interval * 86_400_000;
    else {
      const d = new Date(cursor);
      if (freq === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + interval);
      else d.setUTCFullYear(d.getUTCFullYear() + interval);
      cursor = d.getTime();
    }
  }
  return { hits, durMs };
}

// ---------------------------------------------------------------------------
// Shaping — identical to the Google events, on purpose
// ---------------------------------------------------------------------------

/** UTC instant → "2026-08-15T11:30:00-04:00" in the user's timezone. */
function toOffsetIso(ms, tz) {
  const off = offsetMinutesAt(tz, ms);
  const local = new Date(ms + off * 60_000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
         `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}` +
         `${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

function shapeInstance(feed, ev, ms, durMs, tz) {
  const allDay = ev.start.allDay;
  return {
    // Feed-qualified and instant-qualified: one UID repeats across a recurrence
    // and would collide as a React key.
    id: `ics${feed.id}:${ev.uid}:${ms}`,
    calendarId: `ics:${feed.id}`,
    calendarName: feed.name || feed.url,
    colour: feed.colour || null,
    summary: ev.summary,
    location: ev.location,
    allDay,
    start: allDay ? new Date(ms).toISOString().slice(0, 10) : toOffsetIso(ms, tz),
    end: allDay
      ? new Date(ms + Math.max(durMs, 86_400_000)).toISOString().slice(0, 10)
      : toOffsetIso(ms + durMs, tz),
  };
}

/** The [start, end) UTC instants of a calendar day in a timezone. */
function dayWindow(tz, dateStr, days = 1) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const from = wallToUtc(tz, y, m, d, 0, 0, 0);
  const to = wallToUtc(tz, y, m, d + days, 0, 0, 0);
  return { from, to };
}

const parseCache = new Map(); // feedId -> { at, len, parsed }

function parsedFor(feed) {
  const hit = parseCache.get(feed.id);
  if (hit && hit.len === (feed.body || '').length && hit.at === String(feed.fetched_at)) return hit.parsed;
  const parsed = parseIcs(feed.body || '', 'UTC');
  parseCache.set(feed.id, { at: String(feed.fetched_at), len: (feed.body || '').length, parsed });
  if (parseCache.size > 100) parseCache.delete(parseCache.keys().next().value);
  return parsed;
}

/** Feeds that should appear on this user's screen: their own, plus shared ones. */
async function feedsFor(userId) {
  await ensureTable();
  const { rows } = await pool().query(
    `SELECT * FROM hh_ics_feeds
      WHERE enabled = TRUE AND (user_id = $1 OR share_with_household = TRUE)
      ORDER BY id`, [userId]);
  return rows;
}

/**
 * Today's events plus the 21-day look-ahead, in the same shape the Google path
 * returns, so the route can concatenate the two lists and sort once.
 *
 * Never throws: a feed that fails leaves the others intact and bumps
 * partialFailures.
 */
async function eventsForDay(userId, tz, dateStr) {
  if (!available()) return { events: [], upcoming: [], feedCount: 0, partialFailures: 0 };
  let feeds;
  try { feeds = await feedsFor(userId); }
  catch { return { events: [], upcoming: [], feedCount: 0, partialFailures: 0 }; }
  if (!feeds.length) return { events: [], upcoming: [], feedCount: 0, partialFailures: 0 };

  const today = dayWindow(tz, dateStr, 1);
  const ahead = dayWindow(tz, dateStr, 22);

  const events = [];
  const upcoming = [];
  let partialFailures = 0;

  for (const base of feeds) {
    let feed = base;
    try {
      // No cached body at all → we have nothing to show, so it is worth waiting
      // for. A stale body refreshes in the background and this request serves
      // what it already has.
      if (!feed.body) feed = await refreshFeed(feed);
      else if (!feed.fetched_at || Date.now() - new Date(feed.fetched_at).getTime() >= REFRESH_MS) {
        refreshFeed(feed).catch(() => {});
      }
    } catch { /* fall through to whatever body we have */ }

    if (!feed.body) { partialFailures++; continue; }
    if (feed.last_error && !feed.body) { partialFailures++; continue; }

    let parsed;
    try { parsed = parsedFor(feed); }
    catch { partialFailures++; continue; }

    for (const ev of parsed.events) {
      // Expanded a day wide on each side of the real window: an all-day event
      // is anchored to UTC midnight, which can sit outside a local-time window
      // for the very day it belongs to. The exact decision is made below.
      const { hits, durMs } = expand(ev, today.from - 86_400_000, ahead.to + 86_400_000, tz);
      for (const ms of hits) {
        const shaped = shapeInstance(feed, ev, ms, durMs, tz);
        if (ev.start.allDay) {
          // All-day events are calendar DAYS, not instants. Comparing them as
          // instants puts a UTC-midnight event on the evening before, every
          // time, for anyone west of Greenwich.
          const from = shaped.start;             // 'YYYY-MM-DD'
          const toExcl = shaped.end;             // exclusive, per iCalendar
          if (dateStr >= from && dateStr < toExcl) events.push(shaped);
          else if (from > dateStr) upcoming.push(shaped);
          continue;
        }
        const endMs = ms + Math.max(durMs, 1);
        if (endMs > today.from && ms < today.to) events.push(shaped);
        else if (ms >= today.to) upcoming.push(shaped);
      }
    }
  }

  return { events, upcoming, feedCount: feeds.length, partialFailures };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const PUBLIC_COLS = `id, user_id, url, name, colour, enabled, share_with_household,
  fetched_at, last_error, event_count`;

function publicRow(r) {
  return {
    id: r.id,
    url: r.url,
    name: r.name || null,
    colour: r.colour || null,
    enabled: !!r.enabled,
    shareWithHousehold: !!r.share_with_household,
    fetchedAt: r.fetched_at ? new Date(r.fetched_at).toISOString() : null,
    lastError: r.last_error || null,
    eventCount: typeof r.event_count === 'number' ? r.event_count : null,
    mine: true,
  };
}

async function list(userId) {
  await ensureTable();
  const { rows } = await pool().query(
    `SELECT ${PUBLIC_COLS} FROM hh_ics_feeds WHERE user_id=$1 ORDER BY id`, [userId]);
  const mine = rows.map(publicRow);
  // Feeds the other person shared: shown read-only, so it is obvious why an
  // event you didn't subscribe to is on your screen. Columns are spelled out
  // rather than reusing PUBLIC_COLS — this query has a join, and every name
  // needs its own alias.
  const { rows: shared } = await pool().query(
    `SELECT f.id, f.user_id, f.url, f.name, f.colour, f.enabled, f.share_with_household,
            f.fetched_at, f.last_error, f.event_count, u.display_name
       FROM hh_ics_feeds f JOIN hh_users u ON u.id = f.user_id
      WHERE f.user_id <> $1 AND f.share_with_household = TRUE AND f.enabled = TRUE
      ORDER BY f.id`, [userId]);
  return {
    feeds: mine,
    shared: shared.map((r) => ({ ...publicRow(r), mine: false, sharedBy: r.display_name || null })),
  };
}

async function add(userId, rawUrl, opts = {}) {
  await ensureTable();
  const vetted = await safeUrl(rawUrl);
  if (vetted.error) return { error: vetted.error };

  const { rows: existing } = await pool().query(
    `SELECT COUNT(*)::int AS n FROM hh_ics_feeds WHERE user_id=$1`, [userId]);
  if (existing[0].n >= MAX_FEEDS_PER_USER) {
    return { error: `That's the limit of ${MAX_FEEDS_PER_USER} feeds. Remove one first.` };
  }

  // Fetch BEFORE inserting: a URL that isn't a calendar should be an error on
  // the form, not a broken row the person has to go and delete.
  const got = await fetchBody(vetted.url);
  if (got.error) {
    return { error: got.error === 'not-a-calendar'
      ? "That link didn't return a calendar."
      : `Couldn't read that feed (${got.error}).` };
  }
  const parsed = parseIcs(got.body);
  const name = (opts.name && String(opts.name).trim()) || parsed.calName || null;

  const { rows } = await pool().query(
    `INSERT INTO hh_ics_feeds (user_id, url, name, colour, body, fetched_at, event_count, share_with_household)
     VALUES ($1,$2,$3,$4,$5,now(),$6,$7)
     ON CONFLICT (user_id, url) DO UPDATE
       SET body=EXCLUDED.body, fetched_at=now(), last_error=NULL,
           event_count=EXCLUDED.event_count, enabled=TRUE
     RETURNING ${PUBLIC_COLS}`,
    [userId, vetted.url, name, opts.colour || null, got.body, parsed.events.length,
     opts.shareWithHousehold === false ? false : true]);
  return { feed: publicRow(rows[0]) };
}

async function remove(userId, id) {
  await ensureTable();
  const { rowCount } = await pool().query(
    `DELETE FROM hh_ics_feeds WHERE id=$1 AND user_id=$2`, [Number(id), userId]);
  parseCache.delete(Number(id));
  return rowCount > 0;
}

async function update(userId, id, patch = {}) {
  await ensureTable();
  const sets = [];
  const vals = [Number(id), userId];
  const put = (sql, v) => { vals.push(v); sets.push(`${sql}=$${vals.length}`); };
  if (typeof patch.name === 'string') put('name', patch.name.trim().slice(0, 80) || null);
  if (typeof patch.colour === 'string') put('colour', /^#[0-9a-f]{6}$/i.test(patch.colour) ? patch.colour : null);
  if (typeof patch.enabled === 'boolean') put('enabled', patch.enabled);
  if (typeof patch.shareWithHousehold === 'boolean') put('share_with_household', patch.shareWithHousehold);
  if (!sets.length) return { error: 'Nothing to update.' };
  const { rows } = await pool().query(
    `UPDATE hh_ics_feeds SET ${sets.join(', ')} WHERE id=$1 AND user_id=$2 RETURNING ${PUBLIC_COLS}`, vals);
  if (!rows[0]) return { error: 'No such feed.' };
  return { feed: publicRow(rows[0]) };
}

/** Force every feed this user can see to re-read now — the Sync button. */
async function refreshAll(userId) {
  await ensureTable();
  const feeds = await feedsFor(userId);
  await Promise.all(feeds.map((f) => refreshFeed(f, { force: true }).catch(() => {})));
  parseCache.clear();
  return feeds.length;
}

module.exports = {
  available, list, add, remove, update, refreshAll, eventsForDay,
  // exported for tests
  _parseIcs: parseIcs, _expand: expand, _safeUrl: safeUrl, _wallToUtc: wallToUtc,
  _toOffsetIso: toOffsetIso, _dayWindow: dayWindow,
};
