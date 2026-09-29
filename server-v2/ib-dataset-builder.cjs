'use strict';
/**
 * server-v2/ib-dataset-builder.cjs
 *
 * Keeps the Stat Prompter's IB datasets (ES + NQ) current, one session a day.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * public/data/ib-ES.json / ib-NQ.json are hand-exported snapshots — the last
 * export stopped at 2026-08-24 and nothing ever appended to them. This module
 * treats that file as the frozen BASELINE and computes every later session
 * from our own 5m futures candles (es_candles / nq_candles), then serves the
 * two merged together at GET /api/ib-dataset?symbol=ES|NQ.
 *
 * ── HOW A SESSION IS COMPUTED ────────────────────────────────────────────────
 * Same engine the export used: _lib-ibstats.cjs is lib/ibStats.ts compiled to
 * CommonJS (buildDays → enrich → analyzeBreak), then slimDay() below projects a
 * Day onto the exported SlimDay shape. Verified 2026-09-28 against the baseline
 * over every session the DB still holds (ES 2026-06-17 → 08-24, 49 sessions;
 * NQ 07-01 → 08-24, 39): ES matched on every field except one `first` tie and
 * one `bias` flip; NQ on every field except one session a point wide.
 *
 * Three things had to be matched to the export, and are NOT obvious from
 * lib/ibStats.ts alone — do not "fix" them:
 *   · Bar window 09:30 → 17:00 ET (min 570 ≤ t < 1020), not 16:00. The export
 *     fed the CME day through the 17:00 halt; cutting at 16:00 moved dayRange,
 *     firstTouchMin and the break stats on ~10% of sessions.
 *   · widthBucket is ALWAYS null in the export. The page rebuilds it client-side
 *     (backfillWidthBuckets), so filling it here would change nothing but make
 *     new days look different from old ones.
 *   · fcb.fibA.fail is false (not null) when fibA never hit; noMidReturn and
 *     fvgHitMid are not in lib/ibStats.ts — definitions below, fitted 100% on
 *     the 88 overlap sessions.
 *
 * atr / avgIB are taken from the MERGED series (baseline + stored days), with
 * the exact buildDays formula (mean of the prior 14 dayRanges / 20 widths), so
 * they never depend on how far back the candle tables still reach.
 * openType needs the prior session's high/low, so that one day's bars are read
 * too — from the SAME contract where it exists, so a quarterly roll does not
 * compare a Z open against a U range.
 *
 * ── STORAGE ──────────────────────────────────────────────────────────────────
 * ib_dataset_days(symbol, date, day JSONB, contract) — one row per session.
 * The candle tables are pruned (ES reaches back ~3 months), so computed days
 * are persisted once and kept. A day at or before the baseline's `to` is
 * ignored, so a future re-export of the JSON simply wins.
 *
 * ── WHEN ─────────────────────────────────────────────────────────────────────
 * A session is final at 17:10 ET (the window runs to 17:00). startPoller()
 * checks every 15 minutes; the route also refreshes when its cache is older
 * than 5 minutes. Missing days are backfilled automatically, oldest first.
 */

const fs = require('fs');
const path = require('path');
const ib = require('./_lib-ibstats.cjs');

const SYMBOLS = ['ES', 'NQ'];
const BAR_FROM_MIN = 570;   // 09:30 ET
const BAR_TO_MIN = 1020;    // 17:00 ET (exclusive) — see header
const FINAL_AFTER_MIN = 17 * 60 + 10;
const CACHE_MS = 5 * 60_000;
const POLL_MS = 15 * 60_000;

// ── time helpers ──────────────────────────────────────────────────────────────

const ET_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
function nowEt() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const g = (t) => Number(p.find((x) => x.type === t)?.value || 0);
  return { date: ET_YMD.format(new Date()), min: g('hour') * 60 + g('minute') };
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isWeekend(ymd) {
  const w = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
}

// ── baseline (the committed export) ───────────────────────────────────────────

const baselineCache = {};
function loadBaseline(sym) {
  if (baselineCache[sym]) return baselineCache[sym];
  const file = path.join(__dirname, '..', 'public', 'data', `ib-${sym}.json`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.days = (j.days || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  baselineCache[sym] = j;
  return j;
}

// ── slim projection (must match the export's SlimDay shape and key order) ─────

function slimBreak(fb) {
  if (!fb) return null;
  return {
    side: fb.side, breakMin: fb.breakMin, rExt: fb.rExt, rAdv: fb.rAdv,
    volSurge: fb.volSurge, failed: fb.failed, peakBeforeFail: fb.peakBeforeFail,
    fadeMid: fb.fadeMid, fadeOpp: fb.fadeOpp, retest: fb.retest, retestCont: fb.retestCont,
    hit: fb.hit,
    fibA: {
      hit: fb.fibA.hit, cont: fb.fibA.cont, fail: fb.fibA.fail ?? false,
      mfe: fb.fibA.mfe, barsToTouch: fb.fibA.barsToTouch,
    },
    fibB: { hit: fb.fibB.hit, cont: fb.fibB.cont },
  };
}

/** After the first close-confirmed break, price never traded back to the IB mid. */
function noMidReturn(d) {
  const f = d.firstCloseBreak;
  if (!f) return false;
  const rest = d.post.slice(f.i + 1);
  if (!rest.length) return false;
  return f.side === 'H'
    ? Math.min(...rest.map((b) => b.l)) > d.mid
    : Math.max(...rest.map((b) => b.h)) < d.mid;
}

/** With a 15m FVG in the IB, post-IB price reached the IB mid in the FVG's direction. */
function fvgHitMid(d) {
  if (!d.fvg || !d.post.length) return false;
  return d.fvg === 'bull'
    ? Math.max(...d.post.map((b) => b.h)) >= d.mid
    : Math.min(...d.post.map((b) => b.l)) <= d.mid;
}

function slimDay(d) {
  return {
    date: d.date,
    width: d.width,
    dayRange: d.dayHigh - d.dayLow,
    atr: d.atr,
    avgIB: d.avgIB,
    widthBucket: null,
    first: d.first,
    bias: d.bias,
    closeZone: d.closeZone,
    openType: d.openType,
    orbDir: d.orbDir,
    fvg: d.fvg,
    touchedH: d.touchedH,
    touchedL: d.touchedL,
    singleBreak: d.singleBreak,
    bothBroke: d.bothBroke,
    neitherBroke: d.neitherBroke,
    firstTouchSide: d.firstTouchSide,
    firstTouchMin: d.firstTouchBar ? d.firstTouchBar.min : null,
    containedAt2: d.containedAt2,
    containedBrokeLate: d.containedBrokeLate,
    noMidReturn: noMidReturn(d),
    fvgHitMid: fvgHitMid(d),
    fcb: slimBreak(d.firstCloseBreak),
  };
}

// ── candles ───────────────────────────────────────────────────────────────────

async function readBars(libDb, sym, date, contract) {
  const get = sym === 'NQ' ? libDb.getNqCandles : libDb.getEsCandles;
  const rows = await get(date, undefined, 5000, 5, contract);
  const bars = [];
  let used = '';
  for (const r of rows || []) {
    if (String(r.date).slice(0, 10) !== date) continue;
    const [H, M] = String(r.time || '').split(':').map(Number);
    const min = H * 60 + M;
    if (!Number.isFinite(min) || min < BAR_FROM_MIN || min >= BAR_TO_MIN) continue;
    const o = Number(r.open), h = Number(r.high), l = Number(r.low), c = Number(r.close);
    if (![o, h, l, c].every(Number.isFinite)) continue;
    bars.push({ date, min, o, h, l, c, v: Number(r.volume) || 0 });
    used = String(r.contract ?? used);
  }
  return { bars, contract: used };
}

// ── storage ───────────────────────────────────────────────────────────────────

let schema = null;
function ensureSchema(libDb) {
  if (!schema) {
    schema = libDb.queryAll(
      `CREATE TABLE IF NOT EXISTS ib_dataset_days (
         symbol     TEXT NOT NULL,
         date       DATE NOT NULL,
         day        JSONB NOT NULL,
         contract   TEXT,
         updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (symbol, date)
       )`,
      [],
    ).catch((e) => { schema = null; throw e; });
  }
  return schema;
}

async function readStored(libDb, sym, after) {
  await ensureSchema(libDb);
  const rows = await libDb.queryAll(
    `SELECT to_char(date, 'YYYY-MM-DD') AS d, day FROM ib_dataset_days
      WHERE symbol = ? AND date > ?::date ORDER BY date ASC`,
    [sym, after],
  );
  return rows.map((r) => (typeof r.day === 'string' ? JSON.parse(r.day) : r.day))
    .filter((d) => d && d.date);
}

async function store(libDb, sym, day, contract) {
  await ensureSchema(libDb);
  await libDb.queryAll(
    `INSERT INTO ib_dataset_days (symbol, date, day, contract, updated_at)
     VALUES (?, ?::date, ?::jsonb, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (symbol, date) DO UPDATE SET
       day = EXCLUDED.day, contract = EXCLUDED.contract, updated_at = CURRENT_TIMESTAMP`,
    [sym, day.date, JSON.stringify(day), contract || null],
  );
}

// ── compute ───────────────────────────────────────────────────────────────────

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** One session → SlimDay, or null when the tables do not hold a full session. */
async function computeDay(libDb, sym, date, prevDate, series) {
  const cur = await readBars(libDb, sym, date, 'latest');
  if (!cur.bars.length) return null;
  let prev = { bars: [] };
  if (prevDate) {
    if (cur.contract) prev = await readBars(libDb, sym, prevDate, cur.contract);
    if (!prev.bars.length) prev = await readBars(libDb, sym, prevDate, 'latest');
  }
  const days = ib.buildDays([...prev.bars, ...cur.bars]);
  const d = days.find((x) => x.date === date);
  if (!d) return null; // < 10 IB or post bars — not a complete session
  if (!days.some((x) => x.date === prevDate)) d.openType = null;

  // Rolling context from the merged series, buildDays' own formula.
  const prior = series.filter((x) => x.date < date);
  const p20 = prior.slice(-20), p14 = prior.slice(-14);
  d.avgIB = p20.length >= 5 ? mean(p20.map((x) => x.width)) : null;
  d.atr = p14.length >= 5 ? mean(p14.map((x) => x.dayRange)) : null;

  return { day: slimDay(d), contract: cur.contract };
}

const state = {};   // sym → { data, at, inflight }

async function refresh(libDb, sym) {
  const s = (state[sym] ||= { data: null, at: 0, inflight: null });
  if (s.inflight) return s.inflight;
  s.inflight = (async () => {
    const base = loadBaseline(sym);
    let stored = [];
    try { stored = libDb ? await readStored(libDb, sym, base.to) : []; }
    catch (e) { console.warn(`[ib-dataset] ${sym}: read failed (${e.message}) — serving the baseline`); }

    const series = [...base.days, ...stored];
    const have = new Set(series.map((d) => d.date));
    const now = nowEt();
    let added = 0;

    if (libDb) {
      for (let date = addDays(base.to, 1); date <= now.date; date = addDays(date, 1)) {
        if (have.has(date) || isWeekend(date)) continue;
        if (date === now.date && now.min < FINAL_AFTER_MIN) break;
        const prevDate = series.length ? series[series.length - 1].date : null;
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await computeDay(libDb, sym, date, prevDate, series);
          if (!r) continue; // holiday or no candles — tried again next pass
          // eslint-disable-next-line no-await-in-loop
          await store(libDb, sym, r.day, r.contract);
          series.push(r.day);
          have.add(date);
          added++;
        } catch (e) {
          console.warn(`[ib-dataset] ${sym} ${date}: ${e.message}`);
          break; // keep the series gap-free; retry the whole tail next pass
        }
      }
    }
    if (added) console.log(`[ib-dataset] ${sym}: +${added} session(s), through ${series[series.length - 1].date}`);

    const last = series[series.length - 1];
    s.data = {
      symbol: base.symbol || sym,
      window: base.window ?? 60,
      windowLabel: base.windowLabel || 'IB',
      barMinutes: base.barMinutes ?? 5,
      generated: now.date,
      sessions: series.length,
      from: series[0]?.date ?? base.from,
      to: last?.date ?? base.to,
      baselineTo: base.to,
      days: series,
    };
    s.at = Date.now();
    return s.data;
  })().finally(() => { s.inflight = null; });
  return s.inflight;
}

/** Merged dataset for the route. Recomputes at most every CACHE_MS. */
async function getDataset(libDb, sym) {
  const S = String(sym || 'ES').toUpperCase() === 'NQ' ? 'NQ' : 'ES';
  const s = state[S];
  if (s?.data && Date.now() - s.at < CACHE_MS) return s.data;
  return refresh(libDb, S);
}

let pollTimer = null;
function startPoller(libDb) {
  if (pollTimer || !libDb) return;
  const tick = () => {
    for (const sym of SYMBOLS) {
      refresh(libDb, sym).catch((e) => console.warn(`[ib-dataset] ${sym}: ${e.message}`));
    }
  };
  pollTimer = setInterval(tick, POLL_MS);
  pollTimer.unref?.();
  setTimeout(tick, 30_000).unref?.();
}

module.exports = { getDataset, refresh, startPoller, slimDay, SYMBOLS };
