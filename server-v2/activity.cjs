'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Activity — what happened to the box, newest first (2026-10-10).
 *
 * Feeds the "Activity" card on owner → Vela Health. Brandon: "a timeline … the
 * confirmation and timestamp of the nightly reset and the vela search for a new
 * update showing it's up to date", plus every push with its version and one line.
 *
 * Four sources, none of which needs anything new on the host:
 *
 *   boots        This module appends one line to state/activity/events.jsonl
 *                every time the dashboard process starts. ./state is mounted at
 *                /app/state (docker-compose), so the record outlives the
 *                container. A boot inside NIGHTLY_WINDOW is the 2 AM restart
 *                (the host's nightly-restart.timer, /var/log/nightly-restart.log).
 *
 *   containers   docker-proxy (GET /containers* only) gives each container's
 *                State.StartedAt. vela-web and jobs have no process of ours to
 *                record a boot, so their start times are polled and appended to
 *                the same ledger the first time each one is seen.
 *
 *   deploys      deploy.sh mirrors its history.log into state/deploy-history.log
 *                (one tab-separated line per deploy, with the commit's one-line
 *                note when the push carried one).
 *
 *   vela library The same question the "Repowatch: Vela" scheduled task asks
 *                each morning — is there a newer @luxalgo/vela on npm — asked
 *                here at 07:59 ET so the answer lands on this page. The vela
 *                image installs without a lockfile, so a newer version that fits
 *                the cbedge-v3/package.json range is picked up by the next Vela
 *                build on its own; only one outside the range needs a bump.
 *
 * Reads are cheap (a tail of two small files, one cached Docker call). Nothing
 * here can take /healthz down: every source fails to { error } on its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

const ROLE = process.env.PROCESS_ROLE || 'all';
const STATE_DIR = process.env.STATE_DIR || path.join(__dirname, '..', 'state');
const DIR = path.join(STATE_DIR, 'activity');
const LEDGER = path.join(DIR, 'events.jsonl');
const DEPLOY_LOG = path.join(STATE_DIR, 'deploy-history.log');
const DOCKER = process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375';
const NPM_URL = 'https://registry.npmjs.org/@luxalgo/vela';
const VELA_PKG = path.join(__dirname, '..', 'cbedge-v3', 'package.json');

const NIGHTLY_WINDOW = { from: 1 * 60 + 55, to: 2 * 60 + 20 }; // 01:55–02:20 ET, minutes
const LIB_CHECK_AT = 7 * 60 + 59;                                // 07:59 ET, same as Repowatch
const WATCHED = ['vela', 'jobs'];                                // compose services polled via docker-proxy
const KEEP_LINES = 500;
const DAYS = 7;

let VERSION = null;
try { VERSION = require('../package.json').version || null; } catch { /* keep null */ }

/* ── ET helpers ───────────────────────────────────────────────────────────── */
function et(ms) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, min: (Number(g('hour')) % 24) * 60 + Number(g('minute')) };
}
/** Epoch ms of `min` minutes past midnight ET on an ET date (DST-safe). */
function etInstant(date, min) {
  let guess = Date.parse(`${date}T00:00:00Z`) + min * 60_000 + 4 * 3600_000;
  for (let i = 0; i < 2; i++) {
    const p = et(guess);
    const dayShift = p.date === date ? 0 : p.date < date ? 1440 : -1440;
    guess += (min - p.min + dayShift) * 60_000;
  }
  return guess;
}
const inNightly = (ms) => { const m = et(ms).min; return m >= NIGHTLY_WINDOW.from && m < NIGHTLY_WINDOW.to; };

/* ── the ledger ───────────────────────────────────────────────────────────── */
function readLedger() {
  try {
    return fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function append(ev) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify(ev) + '\n');
    // Trim now and then so the file never grows past a few hundred lines.
    if (Math.random() < 0.05) {
      const lines = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
      if (lines.length > KEEP_LINES) {
        const tmp = LEDGER + '.tmp';
        fs.writeFileSync(tmp, lines.slice(-KEEP_LINES).join('\n') + '\n');
        fs.renameSync(tmp, LEDGER);
      }
    }
  } catch (e) { console.warn('[activity] ledger write failed:', e.message); }
}

/* ── boots ────────────────────────────────────────────────────────────────── */
const BOOT_AT = Date.now();
if (ROLE !== 'jobs') append({ type: 'boot', at: new Date(BOOT_AT).toISOString(), version: VERSION });

/* ── containers via docker-proxy ──────────────────────────────────────────── */
let dockerState = { at: 0, error: null };
async function getJson(url, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`http ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function pollContainers() {
  try {
    const list = await getJson(`${DOCKER}/containers/json`);
    const seen = new Set(readLedger().filter((e) => e.type === 'container-start').map((e) => `${e.service}@${e.at}`));
    for (const c of list) {
      const service = c.Labels?.['com.docker.compose.service'];
      if (!WATCHED.includes(service)) continue;
      const info = await getJson(`${DOCKER}/containers/${c.Id}/json`);
      const at = info?.State?.StartedAt ? new Date(info.State.StartedAt).toISOString() : null;
      if (at && !seen.has(`${service}@${at}`)) append({ type: 'container-start', service, at });
    }
    dockerState = { at: Date.now(), error: null };
  } catch (e) {
    dockerState = { at: Date.now(), error: /abort/i.test(String(e)) ? 'timeout' : /ENOTFOUND|ECONNREFUSED|fetch failed/i.test(String(e?.cause || e)) ? 'unreachable' : String(e.message || e).slice(0, 80) };
  }
}

/* ── the Vela library check ───────────────────────────────────────────────── */
const parseV = (v) => (String(v).replace(/^[^\d]*/, '').split('-')[0].split('.').map((n) => Number(n) || 0));
const cmpV = (a, b) => { for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); return 0; };
/** Caret ranges only — the only kind cbedge-v3 uses for this dependency. */
function satisfiesCaret(range, v) {
  const base = parseV(range);
  const x = parseV(v);
  if (cmpV(x, base) < 0) return false;
  if (base[0] > 0) return x[0] === base[0];
  if (base[1] > 0) return x[0] === 0 && x[1] === base[1];
  return x[0] === 0 && x[1] === 0 && x[2] === base[2];
}
let libChecking = false;
async function checkVelaLib() {
  if (libChecking) return;
  libChecking = true;
  const at = new Date().toISOString();
  try {
    let range = null;
    try { range = JSON.parse(fs.readFileSync(VELA_PKG, 'utf8')).dependencies?.['@luxalgo/vela'] || null; } catch { /* reported below */ }
    const doc = await getJson(NPM_URL, 10_000);
    const latest = doc?.['dist-tags']?.latest || null;
    if (!latest) throw new Error('no dist-tags.latest');
    const base = range ? range.replace(/^[^\d]*/, '') : null;
    let status = 'unknown';
    if (base && cmpV(parseV(latest), parseV(base)) <= 0) status = 'up-to-date';
    else if (range && satisfiesCaret(range, latest)) status = 'in-range';
    else if (range) status = 'outside-range';
    append({ type: 'lib-check', at, range, latest, publishedAt: doc?.time?.[latest] || null, status });
  } catch (e) {
    append({ type: 'lib-check', at, status: 'error', error: String(e?.message || e).slice(0, 80) });
  } finally { libChecking = false; }
}

/* ── schedulers (web process only) ────────────────────────────────────────── */
if (ROLE !== 'jobs') {
  setTimeout(() => { pollContainers().catch(() => {}); }, 20_000).unref?.();
  setInterval(() => { pollContainers().catch(() => {}); }, 5 * 60_000).unref?.();
  // 07:59 ET daily, plus once at boot when the last check is over a day old
  // (a restart across 07:59 must not skip the day).
  const lastLib = () => readLedger().filter((e) => e.type === 'lib-check').pop();
  setTimeout(() => {
    const l = lastLib();
    if (!l || Date.now() - Date.parse(l.at) > 24 * 3600_000) checkVelaLib().catch(() => {});
  }, 45_000).unref?.();
  setInterval(() => {
    const now = et(Date.now());
    if (now.min < LIB_CHECK_AT) return;
    const l = lastLib();
    if (!l || et(Date.parse(l.at)).date !== now.date || et(Date.parse(l.at)).min < LIB_CHECK_AT) checkVelaLib().catch(() => {});
  }, 60_000).unref?.();
}

/* ── deploy-history.log ───────────────────────────────────────────────────── */
// <iso>\tok\t<ver>\tmode=..\tbuild=[..]\trecreate=[..]\t<n>s[\tnote=<text>]
// <iso>\tfailed\t<ver>\tmode=..\tauto-rollback|no-rollback
// <iso>\tbuild-failed\t<ver>
// <iso>\trollback\t<reason>\timages=<n>\tnow=<sha>
// <iso>\tnoop\t<ver>\t<from>-><to>
function readDeploys() {
  let text;
  try { text = fs.readFileSync(DEPLOY_LOG, 'utf8'); } catch { return { error: 'no-log', rows: [] }; }
  const rows = text.split('\n').filter(Boolean).slice(-200).map((line) => {
    const [iso, kind, ...rest] = line.split('\t');
    const kv = {};
    for (const r of rest) { const i = r.indexOf('='); if (i > 0) kv[r.slice(0, i)] = r.slice(i + 1); }
    const secs = rest.map((r) => /^(\d+)s$/.exec(r)).find(Boolean);
    return { at: iso, kind, version: /^v\d/.test(rest[0] || '') ? rest[0] : null, reason: kind === 'rollback' ? rest[0] : null, note: kv.note || null, secs: secs ? Number(secs[1]) : null, mode: kv.mode || null };
  }).filter((r) => Number.isFinite(Date.parse(r.at)));
  return { error: null, rows };
}

/* ── the feed ─────────────────────────────────────────────────────────────── */
const svcName = { vela: 'vela', jobs: 'jobs', dashboard: 'dashboard' };
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });

function section() {
  const now = Date.now();
  const since = now - DAYS * 86_400_000;
  const ledger = readLedger();
  const deploys = readDeploys();
  const items = [];

  // Deploys.
  for (const d of deploys.rows) {
    if (Date.parse(d.at) < since || d.kind === 'noop') continue;
    if (d.kind === 'ok') items.push({ at: d.at, kind: 'deploy', level: 'ok', title: d.version || 'deploy', note: d.note, detail: d.secs != null ? `live in ${d.secs}s` : null });
    else if (d.kind === 'failed' || d.kind === 'build-failed') items.push({ at: d.at, kind: 'deploy-failed', level: 'down', title: d.version || 'deploy', note: d.note, detail: d.kind === 'build-failed' ? 'build failed · old version kept' : 'unhealthy · rolled back' });
    else if (d.kind === 'rollback') items.push({ at: d.at, kind: 'rollback', level: 'warn', title: 'Rollback', detail: d.reason || null });
  }

  // Nightly restarts: one item per ET date, dashboard boot + container starts in the window.
  const starts = ledger.filter((e) => (e.type === 'boot' || e.type === 'container-start') && Date.parse(e.at) >= since);
  const nights = new Map();
  for (const e of starts) {
    if (!inNightly(Date.parse(e.at))) continue;
    const date = et(Date.parse(e.at)).date;
    const n = nights.get(date) || { date, parts: {} };
    const svc = e.type === 'boot' ? 'dashboard' : e.service;
    if (!n.parts[svc] || e.at < n.parts[svc]) n.parts[svc] = e.at;
    nights.set(date, n);
  }
  for (const n of nights.values()) {
    const ats = Object.values(n.parts).sort();
    const missing = ['dashboard', 'vela'].filter((s) => !n.parts[s]);
    items.push({
      at: ats[0], kind: 'nightly', level: missing.length ? 'warn' : 'ok',
      title: missing.length ? `Nightly restart · ${missing.join(' and ')} not seen` : 'Nightly restart',
      detail: Object.entries(n.parts).sort((a, b) => a[1].localeCompare(b[1])).map(([s, at]) => `${svcName[s] || s} ${clock(at)}`).join(' · '),
    });
  }
  // A night with no restart — only for windows that have closed AND that the
  // ledger was already running for (so the first deploy of this doesn't flag
  // every night before it existed).
  const firstAt = ledger.length ? Date.parse(ledger[0].at) : now;
  const dates = new Set();
  for (let d = 0; d < DAYS; d++) dates.add(et(now - d * 86_400_000).date);
  for (const date of dates) {
    if (nights.has(date)) continue;
    const openAt = etInstant(date, NIGHTLY_WINDOW.from);
    const closeAt = etInstant(date, NIGHTLY_WINDOW.to);
    if (closeAt > now || firstAt > openAt) continue;
    items.push({ at: new Date(closeAt).toISOString(), kind: 'nightly-missed', level: 'down', title: 'Nightly restart did not happen', detail: 'no dashboard or vela start between 1:55 and 2:20 AM' });
  }

  // Unexplained restarts: a boot or container start outside the nightly window
  // with no deploy within 15 min of it — a crash, OOM or autoheal.
  const deployTimes = deploys.rows.map((d) => Date.parse(d.at));
  for (const e of starts) {
    const t = Date.parse(e.at);
    if (inNightly(t) || deployTimes.some((d) => Math.abs(d - t) < 15 * 60_000)) continue;
    const svc = e.type === 'boot' ? 'dashboard' : e.service;
    items.push({ at: e.at, kind: 'restart', level: 'warn', title: `${svcName[svc] || svc} restarted`, detail: e.version ? `on ${e.version} · no deploy around it` : 'no deploy around it' });
  }

  // Vela library checks.
  const checks = ledger.filter((e) => e.type === 'lib-check');
  for (const c of checks) {
    if (Date.parse(c.at) < since) continue;
    if (c.status === 'error') items.push({ at: c.at, kind: 'lib-check', level: 'warn', title: 'Vela library check failed', detail: c.error });
    else if (c.status === 'up-to-date') items.push({ at: c.at, kind: 'lib-check', level: 'ok', title: 'Vela library is up to date', detail: `${c.latest} on npm · package.json ${c.range}` });
    else if (c.status === 'in-range') items.push({ at: c.at, kind: 'lib-check', level: 'ok', title: `Vela ${c.latest} on npm`, detail: `fits ${c.range} · the next Vela build picks it up` });
    else items.push({ at: c.at, kind: 'lib-check', level: 'warn', title: `Vela ${c.latest} available`, detail: `outside ${c.range} · bump cbedge-v3/package.json` });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  const lastNight = items.find((i) => i.kind === 'nightly' || i.kind === 'nightly-missed') || null;
  const lastLib = checks[checks.length - 1] || null;
  return {
    items: items.slice(0, 80),
    lastNightly: lastNight ? { at: lastNight.at, level: lastNight.level } : null,
    lastLibCheck: lastLib ? { at: lastLib.at, status: lastLib.status, latest: lastLib.latest || null, range: lastLib.range || null } : null,
    sources: {
      ledger: ledger.length ? 'ok' : 'empty',
      deployLog: deploys.error || 'ok',
      docker: dockerState.error || (dockerState.at ? 'ok' : 'pending'),
    },
  };
}

module.exports = { section, checkVelaLib, _satisfiesCaret: satisfiesCaret };
