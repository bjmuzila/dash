'use strict';
/**
 * server-v2/_lib-daily-markets.cjs — the Markets tab on daily.cbedge.net.
 *
 * Two feeds, the same two the owner's trading dashboard (cbedge.net) shows: the
 * economic calendar and the earnings calendar. They look alike on screen and are
 * nothing alike underneath, which is most of what this file is about.
 *
 * ── EARNINGS: SOMEONE ELSE'S TABLE, READ ONLY ─────────────────────────────
 *
 * earnings_calendar is written by server-v2/earnings-calendar-recorder.js, which
 * runs inside the trading dashboard's process: a Saturday sweep of Nasdaq's
 * calendar API plus a boot backfill, DELETEing each day before re-inserting it.
 * That recorder OWNS the table. This module only ever SELECTs.
 *
 * Nothing here may write a row, create the table, or call the scraper. Two
 * writers against a table whose update strategy is "delete the day, then insert
 * it again" is not a merge conflict, it is a window that renders empty for
 * whoever reads it mid-sweep — and a second process hitting Nasdaq is how the
 * economic feed below got rate-limited in the first place. If the recorder has
 * never run on this deployment the table simply does not exist, and that is a
 * reported note, not a 500.
 *
 * ── ECONOMIC CALENDAR: NOT IN POSTGRES, AND HANDLE WITH CARE ──────────────
 *
 * OBSERVED FAILURE (2026-07-27, api-router.js /api/calendar): faireconomy's CDN
 * answered `429 Rate Limited` with an HTML error page, because a 20-second
 * poller sat in front of an UNCACHED feed and one VPS IP was issuing thousands
 * of requests a day against a file that changes a few times an hour. The panel
 * then fell through to a saved events.json last touched in June and rendered
 * "No events this week."
 *
 * Adding a second container that polls the same CDN is exactly how that happens
 * again, so this module reaches upstream as close to never as it can:
 *
 *   1. Read the SHARED CACHE FILE the trading dashboard already maintains.
 *      docker-compose mounts the same ./state directory into this container
 *      READ-ONLY at /app/state. If its savedAt is within SHARED_FRESH_MS, that
 *      is the answer and no network call happens at all. This is the normal
 *      path and it should stay the normal path.
 *   2. Only when that file is missing or stale do we fetch upstream ourselves —
 *      at most once per FETCH_TTL_MS per process, with BACKOFF_MS of silence
 *      after a hard failure. What we fetch is persisted to daily_kv so a
 *      container restart resumes from storage instead of sending a fresh
 *      request the moment it boots.
 *   3. If both fail we serve the newest thing we hold and SAY SO. Every return
 *      carries a `warning` — see the note on staleWarning() for why that field
 *      is not decoration.
 *
 * We never write the shared file. The mount is read-only, and even if it were
 * not, the dashboard's writer and ours would take turns clobbering each other's
 * accumulated week.
 *
 * REQUIRED ENV
 *   DATABASE_URL     — via _lib-daily.cjs / _lib-db.cjs. Earnings reads and the
 *                      daily_kv econ cache both need it.
 *   ECON_CACHE_PATH  — optional. Where the shared econ-calendar-cache.json is
 *                      mounted. Defaults to <cwd>/state/econ-calendar-cache.json,
 *                      which is what docker-compose provides.
 */

const fs = require('node:fs');
const path = require('node:path');

const daily = require('./_lib-daily.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// VERIFIED 2026-07-27 in api-router.js: thisweek is the ONLY file faireconomy
// publishes at this host. ff_calendar_nextweek.json, ff_calendar_lastweek.json
// and ff_calendar_thismonth.json all 404 — do not add them back.
const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const SHARED_CACHE_PATH = process.env.ECON_CACHE_PATH
  || path.join(process.cwd(), 'state', 'econ-calendar-cache.json');

/**
 * How fresh the shared file must be for us to accept it and stop. An hour is
 * deliberately looser than the dashboard's own 30-minute refresh: it means a
 * single missed refresh over there still does not make this container reach for
 * the network, and the feed only publishes a few times an hour anyway.
 */
const SHARED_FRESH_MS = 60 * 60 * 1000;

/** Floor between two upstream fetches from THIS process. faireconomy's own
 *  guidance is roughly half an hour, and this is the number that keeps a busy
 *  Markets tab from turning into the 20-second poller all over again. */
const FETCH_TTL_MS = 30 * 60 * 1000;

/** Silence after a hard failure. A CDN that just rate-limited us does not want
 *  a retry in ten seconds; it wants us to go away for a while. */
const BACKOFF_MS = 15 * 60 * 1000;

const FF_TIMEOUT_MS = 10_000;

/** How much history the accumulating cache keeps. Two weeks covers a Sunday
 *  rollover plus the "already happened" rows the tab dims rather than hides. */
const CACHE_RETAIN_DAYS = 14;

/** The row in daily_kv that holds our own copy of the econ feed. */
const KV_ECON_KEY = 'econ-calendar-cache';

const ET = 'America/New_York';

// ---------------------------------------------------------------------------
// daily_kv
// ---------------------------------------------------------------------------

/**
 * A small key/value table for state that belongs to the DEPLOYMENT rather than
 * to a household — here, our fallback copy of the economic calendar.
 *
 * Deliberately NOT household-scoped, and that is safe for exactly one reason:
 * the economic calendar is public information, identical for every customer.
 * Nothing tenant-specific may ever be stored here; the moment a value differs
 * per household it belongs in a table with a household_id, per the rule in
 * _lib-daily.cjs.
 *
 * Its own memoised bootstrap rather than a line in daily.ensureSchema(), so the
 * markets schema lives next to the markets logic — the same reason the budget
 * tables are created in _lib-daily-budget.cjs.
 */
let kvReady = null;
async function ensureKvSchema() {
  if (kvReady) return kvReady;
  kvReady = (async () => {
    await daily.pool().query(`
      CREATE TABLE IF NOT EXISTS daily_kv (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    return true;
  })().catch((e) => { kvReady = null; throw e; });
  return kvReady;
}

async function kvGet(key) {
  try {
    await ensureKvSchema();
    const { rows } = await daily.pool().query(`SELECT value FROM daily_kv WHERE key=$1`, [key]);
    return rows[0]?.value ?? null;
  } catch (e) {
    // A database hiccup must not escalate into "no economic calendar". The
    // caller still has the shared file and whatever is in memory.
    console.warn('[daily-markets] daily_kv read failed:', e.message);
    return null;
  }
}

async function kvPut(key, value) {
  try {
    await ensureKvSchema();
    await daily.pool().query(
      `INSERT INTO daily_kv (key, value, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [key, JSON.stringify(value)]);
  } catch (e) {
    // Losing the persisted copy costs one extra upstream fetch after the next
    // restart. Failing the request over it would cost the whole tab.
    console.warn('[daily-markets] daily_kv write failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// ET time helpers
// ---------------------------------------------------------------------------

/**
 * An ISO instant rendered as New York wall clock.
 *
 * Intl does the DST lookup for the specific instant, which is the entire point:
 * the code this replaces hardcoded '-04:00' and so displayed every event an
 * hour out for the four months of the year that are not daylight time. There is
 * no offset written down anywhere in this file, and none should ever be added.
 */
function toET(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return {
    date: new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(d),
    // 24-hour for sorting and comparison...
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone: ET, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d),
    // ...12-hour for the human reading the tab.
    time_formatted: new Intl.DateTimeFormat('en-US', {
      timeZone: ET, hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(d),
  };
}

/** Today in ET as YYYY-MM-DD. Never new Date().toISOString().slice(0,10), which
 *  rolls the date over at 8pm Eastern and puts tomorrow's events under today. */
function etToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(new Date());
}

/**
 * The rolling ET window the Markets tab renders, as YYYY-MM-DD strings.
 * Date-only UTC arithmetic on a midnight anchor, so a DST boundary falling
 * inside the window cannot skip or repeat a day the way adding 86.4e6 to a
 * local timestamp would.
 */
function etWindowDays(days = 7, from = etToday()) {
  const [y, m, d] = from.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length: days }, (_, i) =>
    new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

// ---------------------------------------------------------------------------
// Earnings — SELECT only, from the recorder's table
// ---------------------------------------------------------------------------

/**
 * `date` comes back through to_char rather than as a DATE.
 *
 * node-postgres turns a DATE into a JS Date at UTC midnight; serialise that to
 * JSON and a browser in New York renders it as the previous evening, so every
 * name lands one row too early on the tab. A plain 'YYYY-MM-DD' string has no
 * timezone to be wrong about.
 *
 * min_mcap is not selected on purpose: it is the recorder's own bookkeeping
 * (which cap this row was captured under, so it knows when to re-sweep) and
 * means nothing to someone reading the tab.
 */
const EARNINGS_COLS = `to_char(date, 'YYYY-MM-DD') AS date,
  symbol, company, session, market_cap, eps_est`;

/** Postgres `undefined_table`. The one error here that is expected rather than
 *  broken — see missingTableNote(). */
const UNDEFINED_TABLE = '42P01';

const MISSING_TABLE_NOTE =
  'The earnings calendar hasn’t been set up on this deployment yet — it is filled in by the CB Edge recorder.';

/**
 * Everything returns { rows, note } even on the happy path, where note is null.
 *
 * A bare array cannot tell the tab the difference between "no large-cap names
 * report this week", which happens, and "the recorder has never run here", which
 * looks identical and is a deployment being quietly broken. That is the same
 * distinction the econ side spent six weeks failing to make, and it is cheaper
 * to keep the shapes honest than to explain the silence later.
 */
async function earningsWeek({ from, to } = {}) {
  const start = String(from || etToday());
  const end = String(to || etWindowDays(7, start)[6]);
  try {
    const { rows } = await daily.pool().query(
      `SELECT ${EARNINGS_COLS}
         FROM earnings_calendar
        WHERE date >= $1 AND date <= $2
        ORDER BY date ASC, market_cap DESC`,
      [start, end]);
    return { rows, from: start, to: end, note: null };
  } catch (e) {
    if (e && e.code === UNDEFINED_TABLE) {
      return { rows: [], from: start, to: end, note: MISSING_TABLE_NOTE };
    }
    // Anything else is a real database problem, but the Markets tab is one card
    // on a screen full of other cards — it degrades, it does not take the page
    // down with it.
    console.warn('[daily-markets] earnings week query failed:', e.message);
    return { rows: [], from: start, to: end, note: 'The earnings calendar couldn’t be loaded just now.' };
  }
}

/** One ET day, same shape and same sort. Market cap descending is what puts the
 *  name anyone actually cares about at the top of the day. */
async function earningsForDay(day) {
  const d = String(day || etToday());
  try {
    const { rows } = await daily.pool().query(
      `SELECT ${EARNINGS_COLS}
         FROM earnings_calendar
        WHERE date = $1
        ORDER BY date ASC, market_cap DESC`,
      [d]);
    return { rows, day: d, note: null };
  } catch (e) {
    if (e && e.code === UNDEFINED_TABLE) return { rows: [], day: d, note: MISSING_TABLE_NOTE };
    console.warn('[daily-markets] earnings day query failed:', e.message);
    return { rows: [], day: d, note: 'The earnings calendar couldn’t be loaded just now.' };
  }
}

// ---------------------------------------------------------------------------
// Economic calendar — shared file first, upstream reluctantly, warn always
// ---------------------------------------------------------------------------

/**
 * faireconomy answers a rate limit with a full HTML error page. Putting 200
 * characters of that into the error string is how "<!DOCTYPE html> <html>
 * <head>..." ended up inside a user-facing warning banner. Keep the <title>
 * ("Rate Limited"), which is the only informative part, and drop the markup.
 */
function briefDetail(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/^<(!doctype|html)/i.test(t)) {
    const title = t.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    return title ? `: ${title}` : ': HTML error page';
  }
  return `: ${t.slice(0, 120)}`;
}

async function fetchUpstream() {
  // No spoofed "Referer: forexfactory.com". A cross-origin Referer onto the
  // faireconomy CDN buys nothing and is one of the signals that gets an IP
  // classified as a scraper — the last thing we want while staying out of a 429.
  // An honest, complete User-Agent is enough.
  const res = await fetch(FF_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    },
    signal: AbortSignal.timeout(FF_TIMEOUT_MS),
  });
  const name = FF_URL.split('/').pop();
  if (!res.ok) {
    const detail = await res.text().then(briefDetail).catch(() => '');
    throw new Error(`${name} ${res.status}${detail}`);
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`${name}: non-array payload`);
  if (!raw.length) throw new Error(`${name}: returned no events`);
  return raw;
}

const eventKey = (ev) => `${ev.date}|${ev.country}|${ev.title}`;

/**
 * Merge a freshly fetched week into what we already hold, rather than replacing
 * it.
 *
 * The upstream file is Sun–Sat but the tab renders a rolling today→today+6
 * window, so the tail of that window is a week upstream has not published yet.
 * Replacing on every fetch would empty the back half of the window every Sunday.
 * Incoming rows win on a key collision so forecast and actual values revise in
 * place as the week plays out.
 */
function mergeEvents(existing, incoming) {
  const cutoff = Date.now() - CACHE_RETAIN_DAYS * 86_400_000;
  const byKey = new Map();
  for (const ev of existing || []) byKey.set(eventKey(ev), ev);
  for (const ev of incoming || []) byKey.set(eventKey(ev), ev);
  return [...byKey.values()]
    .filter((ev) => { const t = Date.parse(ev.date); return !Number.isFinite(t) || t >= cutoff; })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Raw upstream rows → what the tab renders, in ET. Rows with an unparseable
 *  date are dropped rather than rendered at the epoch. */
function normalize(list) {
  const out = [];
  for (const ev of list || []) {
    const et = toET(ev.date);
    if (!et) continue;
    out.push({
      date: et.date,
      time: et.time,
      time_formatted: et.time_formatted,
      title: ev.title ?? '',
      country: ev.country ?? '',
      impact: ev.impact ?? '',
      forecast: ev.forecast ?? '',
      previous: ev.previous ?? '',
      actual: ev.actual ?? '',
    });
  }
  return out.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)));
}

/**
 * The shared file the trading dashboard writes, re-parsed only when it changes.
 *
 * Keyed on mtime and size rather than a timer: the dashboard refreshes that file
 * on its own schedule, and a TTL of our own would either re-parse a few hundred
 * kilobytes on every page load or serve an hour-old parse with a fresh file
 * sitting right there on disk. A stat is cheap; a stale answer is not.
 */
let sharedParsed = null; // { mtimeMs, size, events, savedAt }
function readSharedCache() {
  try {
    const st = fs.statSync(SHARED_CACHE_PATH);
    if (sharedParsed && sharedParsed.mtimeMs === st.mtimeMs && sharedParsed.size === st.size) {
      return sharedParsed;
    }
    const j = JSON.parse(fs.readFileSync(SHARED_CACHE_PATH, 'utf-8'));
    if (!Array.isArray(j?.events) || !j.events.length) return null;
    sharedParsed = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      events: j.events,
      savedAt: String(j.savedAt ?? 'unknown'),
    };
    return sharedParsed;
  } catch {
    // Missing, unreadable, or mid-write by the other container. All three mean
    // the same thing to us — fall through to the next source.
    return null;
  }
}

const savedAtMs = (savedAt) => {
  const t = Date.parse(String(savedAt || ''));
  return Number.isFinite(t) ? t : 0;
};

/** In-process copy of the newest events we know about, whatever their origin.
 *  Also what a fetch merges into. */
let memCache = null;       // { events, savedAt }
let lastFetchAt = 0;
let backoffUntil = 0;
let kvSeeded = false;

/**
 * How old the data is, said in a sentence a person can act on.
 *
 * The route this replaces answered HTTP 200 even when it was completely broken,
 * so `res.ok` was true, the events array was empty, and the panel rendered a
 * hard upstream failure as an ordinary quiet week. It stayed broken for six
 * weeks because nothing on screen ever said otherwise. Anything returned from
 * here that is not live carries a warning, in plain language, every time.
 */
function staleWarning(savedAt, why) {
  const ms = savedAtMs(savedAt);
  const age = ms
    ? (() => {
        const mins = Math.round((Date.now() - ms) / 60_000);
        if (mins < 90) return `about ${Math.max(1, mins)} minutes ago`;
        const hrs = Math.round(mins / 60);
        return hrs < 36 ? `about ${hrs} hours ago` : `about ${Math.round(hrs / 24)} days ago`;
      })()
    : 'at an unknown time';
  const tail = why ? ` The live feed is not answering (${why}).` : '';
  return `This economic calendar was last updated ${age}, so it may be out of date.${tail}`;
}

/**
 * The economic calendar, always shaped { events, source, savedAt, warning }.
 *
 * `source` is one of:
 *   shared-cache — the file the trading dashboard maintains, and fresh. Normal.
 *   upstream     — we fetched it ourselves, because that file was stale or gone.
 *   db-cache     — our own persisted copy from daily_kv or memory; upstream is
 *                  unavailable or we are inside the fetch floor.
 *   unavailable  — we have nothing at all. events is [] and warning says why.
 *
 * Never throws. A Markets tab that 500s is worse than one that admits its data
 * is two hours old.
 */
async function econCalendar() {
  const now = Date.now();

  // 1. The shared file, if it is fresh. The overwhelmingly common path, and the
  //    one that costs nothing — no network, and usually not even a parse.
  const shared = readSharedCache();
  if (shared && now - savedAtMs(shared.savedAt) < SHARED_FRESH_MS) {
    memCache = { events: shared.events, savedAt: shared.savedAt };
    return {
      events: normalize(shared.events),
      source: 'shared-cache',
      savedAt: shared.savedAt,
      warning: null,
    };
  }

  // 2. Seed from daily_kv once per process before deciding to fetch. A redeploy
  //    that immediately fired a request upstream would turn every container
  //    restart into another hit on a CDN we are trying not to annoy.
  if (!kvSeeded) {
    kvSeeded = true;
    const stored = await kvGet(KV_ECON_KEY);
    if (Array.isArray(stored?.events) && stored.events.length) {
      const storedAt = String(stored.savedAt ?? 'unknown');
      if (savedAtMs(storedAt) > savedAtMs(memCache?.savedAt)) {
        memCache = { events: stored.events, savedAt: storedAt };
      }
      // Treat the stored copy's age as our own last fetch, so a container that
      // restarts twice in a minute does not fetch twice in a minute.
      lastFetchAt = Math.max(lastFetchAt, savedAtMs(storedAt));
    }
  }

  // The best thing we hold that is not the fresh shared file: our own cache, or
  // that same shared file gone stale — whichever was saved more recently.
  let best = memCache;
  if (shared && savedAtMs(shared.savedAt) > savedAtMs(best?.savedAt)) {
    best = { events: shared.events, savedAt: shared.savedAt };
  }

  // 3. Our own fetch, behind two gates. FETCH_TTL_MS is the one that matters in
  //    normal operation; BACKOFF_MS is what stops a burst of retries against a
  //    CDN that has just told us to go away.
  const inBackoff = now < backoffUntil;
  const withinFloor = now - lastFetchAt < FETCH_TTL_MS;

  if (!inBackoff && !withinFloor) {
    lastFetchAt = now; // stamped BEFORE awaiting, so concurrent requests during a
                       // slow fetch do not each start one of their own
    try {
      const fetched = await fetchUpstream();
      const events = mergeEvents(best?.events ?? [], fetched);
      const savedAt = new Date(now).toISOString();
      memCache = { events, savedAt };
      backoffUntil = 0;
      // Persisted so the next restart resumes from Postgres rather than from the
      // network. Awaited but never fatal — see kvPut.
      await kvPut(KV_ECON_KEY, { events, savedAt });
      return { events: normalize(events), source: 'upstream', savedAt, warning: null };
    } catch (err) {
      backoffUntil = now + BACKOFF_MS;
      const why = err?.message || String(err);
      console.warn(`[daily-markets] econ fetch failed, backing off ${Math.round(BACKOFF_MS / 60_000)}m: ${why}`);
      if (best) {
        return {
          events: normalize(best.events),
          source: 'db-cache',
          savedAt: best.savedAt,
          warning: staleWarning(best.savedAt, why),
        };
      }
      return {
        events: [],
        source: 'unavailable',
        savedAt: null,
        warning: `The economic calendar couldn’t be loaded and there is no saved copy to fall back on (${why}).`,
      };
    }
  }

  // 4. We are not allowed to fetch right now. Serve the newest thing we have and
  //    flag it — a stale calendar clearly labelled beats a blank one that looks
  //    like a quiet week.
  if (best) {
    const why = inBackoff
      ? 'the live feed recently failed and we are waiting before trying again'
      : null;
    return {
      events: normalize(best.events),
      source: 'db-cache',
      savedAt: best.savedAt,
      warning: staleWarning(best.savedAt, why),
    };
  }

  return {
    events: [],
    source: 'unavailable',
    savedAt: null,
    warning: inBackoff
      ? 'The economic calendar feed recently failed and we are waiting a few minutes before trying again.'
      : 'The economic calendar isn’t available yet on this deployment.',
  };
}

// ---------------------------------------------------------------------------
// What the Markets tab actually renders
// ---------------------------------------------------------------------------

/**
 * Both feeds for the next 7 ET days, in one call and one round trip each.
 *
 * The tab renders exactly this window, so the filtering belongs here rather than
 * in the client: econCalendar() holds up to two weeks of accumulated events, and
 * shipping all of it to a phone so the phone can throw most of it away is a lot
 * of bytes for nothing.
 *
 * The two feeds are fetched together but never share a failure — the earnings
 * table being absent must not blank the economic calendar, and vice versa.
 * Both halves carry their own note/warning for the same reason.
 */
async function weekAhead() {
  const days = etWindowDays(7);
  const [econ, earnings] = await Promise.all([
    econCalendar(),
    earningsWeek({ from: days[0], to: days[6] }),
  ]);
  const window = new Set(days);
  return {
    days,
    econ: { ...econ, events: econ.events.filter((e) => window.has(e.date)) },
    earnings,
  };
}

module.exports = {
  econCalendar,
  earningsWeek,
  earningsForDay,
  weekAhead,
  ensureKvSchema,
  // exported for tests and for other daily modules that need deployment-scoped
  // (never tenant-scoped — see the daily_kv note) storage
  kvGet, kvPut,
  _toET: toET,
  _etToday: etToday,
  _etWindowDays: etWindowDays,
  _mergeEvents: mergeEvents,
  _briefDetail: briefDetail,
};
