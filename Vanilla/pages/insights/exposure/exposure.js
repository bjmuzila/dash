// ── Signal Feed ─────────────────────────────────────────────────────────────
// Keeps the last N signals. New signal slides in at the top, old ones fade down.
// The containing box never grows — overflow:hidden clips naturally.
(function() {
  const MAX_SIGNALS = 10; // Reduced from 20 to avoid noise
  const signals = []; // [{text, color, time, id}]
  let feedEl = null;
  let dotEl  = null;
  let dotTimer = null;
  let idSeq = 0;
  let lastSignalTexts = {}; // Track recent signal texts to prevent duplicates within 90s

  function getEl() {
    feedEl = feedEl || document.getElementById('signal-feed');
    dotEl  = dotEl  || document.getElementById('signal-feed-dot');
    return feedEl;
  }

  function flashDot() {
    const d = dotEl || document.getElementById('signal-feed-dot');
    if (!d) return;
    d.style.opacity = '1';
    if (dotTimer) clearTimeout(dotTimer);
    dotTimer = setTimeout(() => { d.style.opacity = '0'; dotTimer = null; }, 1200);
  }

  function renderFeed() {
    const el = getEl();
    if (!el) return;
    // Build from newest (top) to oldest (bottom)
    // Each row: time badge + text, fades with age
    el.innerHTML = '';
    signals.forEach((s, i) => {
      const age = i; // 0 = newest
      const opacity = Math.max(0.28, 1 - age * 0.18);
      const row = document.createElement('div');
      row.style.cssText = [
        'display:flex',
        'align-items:flex-start',
        'gap:6px',
        `opacity:${opacity}`,
        'padding:4px 0',
        'border-bottom:1px solid rgba(255,255,255,.04)',
        'transition:opacity .4s',
        'min-height:0',
        'flex-shrink:0'
      ].join(';');
      const badge = document.createElement('span');
      badge.style.cssText = [
        `color:${s.color}`,
        'font-size:13px',
        'font-weight:800',
        'font-family:monospace',
        'white-space:nowrap',
        'padding-top:1px',
        'flex-shrink:0'
      ].join(';');
      badge.textContent = s.time;
      const text = document.createElement('span');
      text.style.cssText = [
        'font-size:14px',
        'color:#d7e6e8',
        'line-height:1.45',
        'flex:1',
        'min-width:0'
      ].join(';');
      if (age === 0) {
        text.style.color = '#eef7ff';
        text.style.fontWeight = '700';
      }
      text.textContent = s.text;
      row.appendChild(badge);
      row.appendChild(text);
      el.appendChild(row);
    });
  }

  window.pushSignal = function(text, color) {
    if (!text) return;
    // Dedupe: skip if same text as the most recent signal
    if (signals.length > 0 && signals[0].text === text) return;
    // Rate-limit: skip if we've seen similar text in the last 90 seconds
    const now = Date.now();
    const textHash = String(text).substring(0, 50); // Use first 50 chars as key
    if (lastSignalTexts[textHash] && now - lastSignalTexts[textHash] < 90000) return;
    lastSignalTexts[textHash] = now;
    color = color || '#00e5ff';
    const time = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: 'America/New_York'
    });
    signals.unshift({ text, color, time, id: ++idSeq });
    if (signals.length > MAX_SIGNALS) signals.length = MAX_SIGNALS;
    flashDot();
    renderFeed();
  };

  // Seed with an initial placeholder until live data arrives
  window.pushSignal('Waiting for live exposure data…', '#4a6070');
})();

function getLiveExposureSnapshot() {
  const live = window.__liveExposureSnapshot || {};
  const level = window._levelMathContext || {};
  return {
    gex: Number.isFinite(Number(live.gex)) ? Number(live.gex) : (Number.isFinite(Number(level.totalGEX)) ? Number(level.totalGEX) : null),
    dex: Number.isFinite(Number(live.dex)) ? Number(live.dex) : (Number.isFinite(Number(level.totalDEX)) ? Number(level.totalDEX) : null),
    chex: Number.isFinite(Number(live.chex)) ? Number(live.chex) : (Number.isFinite(Number(level.totalCHEX)) ? Number(level.totalCHEX) : null),
    vex: Number.isFinite(Number(live.vex)) ? Number(live.vex) : (Number.isFinite(Number(level.totalVEX)) ? Number(level.totalVEX) : null),
  };
}

function getExposureDB() {
  return window.SharedDB || window.DB || null;
}

function formatExposureValue(value, unit = 'B') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${(n / (unit === 'M' ? 1e6 : 1e9)).toFixed(3)}${unit}`;
}

// Auto-scales to B/M/K based on magnitude — used for CHEX/VEX which vary widely with OI+vol
function formatExposureAutoScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(3)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(3)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(3)}K`;
  return `${n.toFixed(1)}`;
}

function normalizeExposureToRaw(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) < 1e6 ? n * 1e9 : n;
}

function getExposureRecordValue(record, keys) {
  for (const key of keys) {
    const value = Number(record?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function getGreekHistoryCandidates(metric, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return [];
  const candidates = new Set([n]);
  if (metric === 'gex' || metric === 'dex') {
    candidates.add(n * 1e9);
  } else {
    candidates.add(n * 1e3);
    candidates.add(n * 1e6);
    candidates.add(n * 1e9);
  }
  return Array.from(candidates).filter(Number.isFinite);
}

function pickGreekHistoryValue(metric, value, prevValue = null, anchorValue = null) {
  const candidates = getGreekHistoryCandidates(metric, value);
  if (!candidates.length) return null;
  const preferredRanges = {
    gex: [1e8, 5e10],
    dex: [1e8, 5e10],
    chex: [1e2, 5e8],
    vex: [1e2, 5e8]
  };
  const [preferredMin, preferredMax] = preferredRanges[metric] || [1, Number.MAX_SAFE_INTEGER];
  const reference = Number.isFinite(prevValue) && prevValue !== 0
    ? Math.abs(prevValue)
    : Number.isFinite(anchorValue) && anchorValue !== 0
      ? Math.abs(anchorValue)
      : null;
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate) => {
    const absCandidate = Math.abs(candidate);
    let score = 0;
    if (reference) {
      score += Math.abs(Math.log10((absCandidate + 1) / (reference + 1)));
    }
    if (absCandidate < preferredMin) {
      score += Math.log10((preferredMin + 1) / (absCandidate + 1));
    } else if (absCandidate > preferredMax) {
      score += Math.log10((absCandidate + 1) / (preferredMax + 1));
    }
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  });
  return best;
}

// For CHEX/VEX: proxy sends display-scale millions (e.g. 212.4 M), raw is ~1e8 scale
function normalizeExposureToRawM(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // If abs < 1e4, it's display-scale millions → multiply by 1e6
  // If abs >= 1e4, already raw (dollars)
  return Math.abs(n) < 1e4 ? n * 1e6 : n;
}

function normalizeExposureFromRecord(record) {
  // DB stores all values in billions (saveGreeksTimeSeries divides everything by 1e9).
  // So chex/vex from DB are also billions-scale (e.g. 0.212) — use ×1e9 for all.
  const gex = getExposureRecordValue(record, ['gexRaw'])
    ?? normalizeExposureToRaw(getExposureRecordValue(record, ['gex', 'netGEX', 'totalGEX']));
  const dex = getExposureRecordValue(record, ['dexRaw'])
    ?? normalizeExposureToRaw(getExposureRecordValue(record, ['dex', 'netDEX', 'totalDEX']));
  const chex = getExposureRecordValue(record, ['chexRaw'])
    ?? pickGreekHistoryValue('chex', getExposureRecordValue(record, ['chex', 'netCHEX', 'totalCHEX']));
  const vex = getExposureRecordValue(record, ['vexRaw'])
    ?? pickGreekHistoryValue('vex', getExposureRecordValue(record, ['vex', 'netVEX', 'totalVEX']));
  if ([gex, dex, chex, vex].some((v) => v === null)) return null;
  return {
    gex,
    dex,
    chex,
    vex,
    buyScore: Number(record?.buyScore || 0),
    sellScore: Number(record?.sellScore || 0),
    price: Number(record?.price || record?.spot || 0),
    ts: Number(record?.timestamp || record?.ts || Date.now())
  };
}

async function fetchLatestExposureSnapshot() {
  try {
    const resp = await fetch('/proxy/api/greeks-intraday', { cache: 'no-store' });
    if (!resp.ok) return null;
    const payload = await resp.json();
    const records = Array.isArray(payload?.records) ? payload.records : [];
    if (!records.length) return null;
    const latest = records[records.length - 1];
    if (!latest) return null;
    const snapshot = normalizeExposureFromRecord(latest);
    if (!snapshot) return null;
    snapshot.buyScore = Number(latest.buyPct || latest.buyScore || snapshot.buyScore || 0);
    snapshot.sellScore = Number(latest.sellScore || snapshot.sellScore || 0);
    window.__liveExposureSnapshot = snapshot;
    return snapshot;
  } catch (err) {
    return null;
  }
}

async function fetchLatestExposureSnapshotFromDB() {
  try {
    const db = getExposureDB();
    if (!db) return null;
    if (!db.db && typeof db.init === 'function') {
      await db.init().catch(() => null);
    }
    if (!db?.db) return null;
    let records = [];
    if (typeof db.queryGreeksTimeSeries_Today === 'function') {
      records = await db.queryGreeksTimeSeries_Today('').catch(() => []);
    }
    if ((!Array.isArray(records) || !records.length) && typeof db.queryGreeksTimeSeries_Hours === 'function') {
      records = await db.queryGreeksTimeSeries_Hours(24, '').catch(() => []);
    }
    if ((!Array.isArray(records) || !records.length) && typeof db._getAllRecords === 'function') {
      records = await db._getAllRecords('greeksTimeSeries').catch(() => []);
    }
    if (!Array.isArray(records) || !records.length) return null;
    const latest = records
      .slice()
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
      .pop();
    if (!latest) return null;
    const snapshot = normalizeExposureFromRecord(latest);
    if (!snapshot) return null;
    window.__liveExposureSnapshot = snapshot;
    return snapshot;
  } catch (err) {
    return null;
  }
}

function refreshExposureStack() {
  const btn = document.getElementById('exp-refresh-btn');
  const when = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const original = 'Refresh';
  if (btn) {
    setExposureBtnState(btn, '…', '#ffb300');
    btn.style.opacity = '0.75';
  }
  try {
  const values = getLiveExposureSnapshot();
  if (![values.gex, values.dex, values.chex, values.vex].every((v) => Number.isFinite(Number(v)))) {
    fetchLatestExposureSnapshot().then((snapshot) => {
      if (snapshot) {
        updateGreeksDisplay(snapshot);
        refreshExposureStack();
        return;
      }
      fetchLatestExposureSnapshotFromDB().then((dbSnapshot) => {
        if (dbSnapshot) {
          updateGreeksDisplay(dbSnapshot);
          refreshExposureStack();
        }
      });
    });
    return;
  }
  window.__liveExposureSnapshot = { ...window.__liveExposureSnapshot, ...values };

  const gexValue = getExposureValueEl('gex');
  const dexValue = getExposureValueEl('dex');
  const chexValue = getExposureValueEl('chex');
  const vexValue = getExposureValueEl('vex');
  const comboValue = document.getElementById('combo-value');
  const pressureValue = document.getElementById('pressure-value');
  const pressureBalance = document.getElementById('pressure-balance');
  const pressureBar = document.getElementById('pressure-bar');

  const rvolValue = document.getElementById('rvol-value');
  const rvolDesc = document.getElementById('rvol-desc');
  const dexVelocity = document.getElementById('dex-velocity');
  const analysisGamma = document.getElementById('analysis-gamma');
  const analysisDelta = document.getElementById('analysis-delta');
  const analysisRegime = document.getElementById('analysis-regime');
  const analysisRegimeTime = document.getElementById('analysis-regime-time');
  const analysisVelocityTime = document.getElementById('analysis-velocity-time');
  const analysisGammaTime = document.getElementById('analysis-gamma-time');
  const analysisDeltaTime = document.getElementById('analysis-delta-time');
  const sparkIds = {
    gex: 'greeks-gex-sparkline',
    dex: 'greeks-dex-sparkline',
    chex: 'greeks-chex-sparkline',
    vex: 'greeks-vex-sparkline',
    gexvex: 'greeks-gexvex-sparkline'
  };
  const mainTitle = document.getElementById('insights-main-title');
  const loading = document.getElementById('exposure-main-loading');
  if (btn) {
    setExposureBtnState(btn, '…', '#ffb300');
    btn.style.opacity = '0.75';
  }
  if (mainTitle) mainTitle.textContent = 'Exposure Stack';
  if (loading) loading.style.display = 'none';
  if (gexValue && Number.isFinite(Number(values.gex))) gexValue.textContent = formatExposureValue(values.gex, 'B');
  if (dexValue && Number.isFinite(Number(values.dex))) dexValue.textContent = formatExposureValue(values.dex, 'B');
  if (chexValue && Number.isFinite(Number(values.chex))) chexValue.textContent = formatExposureAutoScale(values.chex);
  if (vexValue && Number.isFinite(Number(values.vex))) vexValue.textContent = formatExposureAutoScale(values.vex);
  if (comboValue) comboValue.textContent = (Number.isFinite(Number(values.gex)) && Number.isFinite(Number(values.vex)))
    ? `${((Number(values.gex) + Number(values.vex)) / 1e9).toFixed(3)}B`
    : '--';
  // Buy/sell pressure: prefer the overview's live 0DTE chain score (most accurate),
  // then fall back to snapshot buyScore, then to GEX-sign estimate
  const overviewBuy  = Number.isFinite(window.__overviewBuyPct)  ? window.__overviewBuyPct  : null;
  const overviewSell = Number.isFinite(window.__overviewSellPct) ? window.__overviewSellPct : null;
  let buyPct = overviewBuy !== null ? Math.round(overviewBuy) : null;
  if (buyPct === null && Number.isFinite(Number(values.buyScore))) {
    const bs = Number(values.buyScore);
    // If buyScore is between 0-1, assume it's a decimal; multiply by 100
    // If buyScore is between 0-100, use it directly as a percentage
    buyPct = bs <= 1 ? Math.round(bs * 100) : Math.round(bs);
  }
  // Fallback to GEX-based estimate if no valid score
  if (buyPct === null) {
    buyPct = values.gex >= 0 ? 39 : 61;
  }
  const sellPct = overviewSell !== null ? Math.round(overviewSell) : (100 - buyPct);
  const pressureStr = `${buyPct}% Buy / ${sellPct}% Sell`;
  if (pressureValue) pressureValue.textContent = pressureStr;
  if (pressureBalance) pressureBalance.textContent = `${buyPct}%`;
  if (pressureBar) pressureBar.style.width = `${buyPct}%`;
  updateRelativeVolumeCard(when);
  if (dexVelocity) dexVelocity.textContent = Number(values.dex) >= 0 ? '↗ Increasing' : '↘ Decreasing';
  if (analysisGamma) analysisGamma.textContent = Number(values.gex) >= 0 ? 'LONG GAMMA' : 'SHORT GAMMA';
  if (analysisDelta) analysisDelta.textContent = Number(values.dex) >= 0 ? 'BULLISH' : 'BEARISH';
  const stamp = when;
  if (analysisVelocityTime) analysisVelocityTime.textContent = `Updated ${stamp}`;
  if (analysisGammaTime) analysisGammaTime.textContent = `Updated ${stamp}`;
  if (analysisDeltaTime) analysisDeltaTime.textContent = `Updated ${stamp}`;
  // Route through updateGreeksDisplay so history/sparklines have a single write path
  // Values are already raw-scale from __liveExposureSnapshot — pass as-is with a ts tag
  updateGreeksDisplay({ ...values, ts: Date.now() });
  updateGammaLogic(values.gex / 1e9, values.dex / 1e9, Number(values.dex) / 1e9 - Number((window.__lastDexValue || values.dex) / 1e9));
  window.__lastDexValue = values.dex;
  const time = document.getElementById('insights-refresh-time');
  if (time) time.textContent = `Last refresh: ${when}`;
    pulseExposureBtn(btn, original, '#00e5ff', true);
  } catch (err) {
    console.error('refreshExposureStack:', err);
    const time = document.getElementById('insights-refresh-time');
    if (time) time.textContent = 'Last refresh: error';
    pulseExposureBtn(btn, original, '#00e5ff', false);
  }
}

function scheduleExposureSparklineRefresh() {
  const delays = [0, 50, 150, 400, 1000];
  delays.forEach((delay) => {
    setTimeout(() => {
      renderGreekSparklines();
      drawRelativeVolumeSparkline();
    }, delay);
  });
}

function setExposureBtnState(btn, text, color) {
  if (!btn) return;
  btn.textContent = text;
  btn.style.color = color;
}

function restoreExposureBtn(btn, text, color, delay = 1500) {
  if (!btn) return;
  if (btn.__exposureRestoreTimer) clearTimeout(btn.__exposureRestoreTimer);
  btn.__exposureRestoreTimer = setTimeout(() => {
    setExposureBtnState(btn, text, color);
    btn.__exposureRestoreTimer = null;
  }, delay);
}

function pulseExposureBtn(btn, originalText, originalColor, success = true) {
  if (!btn) return;
  setExposureBtnState(btn, success ? '✓' : 'ERR', success ? '#00e676' : '#ff4757');
  restoreExposureBtn(btn, originalText, originalColor);
}

// ── ET helpers ──────────────────────────────────────────────────────────────
function getNowEt() {
  // Returns a plain Date object whose .getHours()/.getMinutes() reflect ET
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}
function getTodayEtStr() {
  const d = getNowEt();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Returns minutes-since-midnight for an ET Date-like object
function etMinutesOf(etDate) {
  return etDate.getHours() * 60 + etDate.getMinutes();
}
// Convert a UTC-ms timestamp to ET minutes-since-midnight
function utcMsToEtMinutes(ms) {
  const d = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return d.getHours() * 60 + d.getMinutes();
}

// ── Two-session model ─────────────────────────────────────────────────────────
// Day   session: 9:30am ET → 5:00pm ET  (570 → 1020 min)
// Night session: 5:00pm ET → 9:30am ET  (1020 → 570+1440 min, wraps midnight)
const DAY_OPEN   = 9 * 60 + 30;  // 570
const DAY_CLOSE  = 17 * 60;      // 1020
const NIGHT_OPEN = 17 * 60;      // 1020
const NIGHT_CLOSE = 9 * 60 + 30; // 570 (next day)

function getActiveSession() {
  const etMins = etMinutesOf(getNowEt());
  const isDay = etMins >= DAY_OPEN && etMins < DAY_CLOSE;
  if (isDay) {
    return {
      label:    'DAY',
      open:     DAY_OPEN,
      close:    DAY_CLOSE,
      span:     DAY_CLOSE - DAY_OPEN,       // 450 min
      elapsed:  Math.max(1, Math.min(etMins, DAY_CLOSE) - DAY_OPEN),
      // For sparkline x-axis wrap: night spans midnight so treat linearly
      wraps:    false
    };
  }
  // Night: etMins >= 1020 (17:00+) OR etMins < 570 (before 9:30)
  // Normalise etMins so 17:00 = 0, 9:30 next day = 930
  const nightElapsed = etMins >= NIGHT_OPEN
    ? etMins - NIGHT_OPEN
    : (1440 - NIGHT_OPEN) + etMins;
  const nightSpan = (1440 - NIGHT_OPEN) + NIGHT_CLOSE; // 930 min
  return {
    label:    'NIGHT',
    open:     NIGHT_OPEN,
    close:    NIGHT_CLOSE,
    span:     nightSpan,
    elapsed:  Math.max(1, nightElapsed),
    wraps:    true
  };
}

// ── Live intraday volume samples ─────────────────────────────────────────────
// Stores (etMin, cumVol) samples every ~30s. Used to draw the cumulative curve.
// Simple array of { min, cum } sorted by min. Max 200 points (~100 min coverage).
if (!window.__rvolSamples) window.__rvolSamples = [];
if (!window.__rvolLastDayVol) window.__rvolLastDayVol = 0;
if (!window.__rvolSampleDate) window.__rvolSampleDate = '';

function tickRvolFromLiveVolume(dayVolume) {
  if (!dayVolume || dayVolume <= 0) return;
  const todayStr = getTodayEtStr();
  // Reset on new day
  if (window.__rvolSampleDate !== todayStr) {
    window.__rvolSamples = [];
    window.__rvolLastDayVol = 0;
    window.__rvolSampleDate = todayStr;
  }
  // Only record when volume increases (it's cumulative)
  if (dayVolume <= window.__rvolLastDayVol) return;
  window.__rvolLastDayVol = dayVolume;
  const etMins = etMinutesOf(getNowEt());
  const samples = window.__rvolSamples;
  // Update existing entry for this minute or push new one
  const last = samples[samples.length - 1];
  if (last && last.min === etMins) {
    last.cum = dayVolume;
  } else {
    samples.push({ min: etMins, cum: dayVolume });
    if (samples.length > 200) samples.shift();
  }
}

function getLiveDayVolume() {
  const esKeys = ['/ES:XCME', '/ESM26', '/ES', '/ESU26', '/ESZ26'];
  for (const k of esKeys) {
    const v = Number(
      window.dxTradeCache?.[k]?.dayVolume ??
      window.dxSummaryCache?.[k]?.dayVolume ??
      window.dxQuoteCache?.[k]?.dayVolume ??
      window.dxQuoteCache?.[k]?.totalVolume ??
      0
    );
    if (v > 0) return v;
  }
  // Check quotesData / AppState fallbacks
  for (const k of esKeys) {
    const q = window.quotesData?.[k]?.quote;
    const v = Number(q?.dayVolume ?? q?.totalVolume ?? q?.volume ?? 0);
    if (v > 0) return v;
  }
  return Number(window.AppState?.esQuote?.dayVolume ?? window.AppState?.esQuote?.totalVolume ?? 0) || 0;
}

async function ensureDBReady() {
  if (typeof DB === 'undefined') return false;
  if (DB.db) return true;
  try { await DB.init(); return !!DB.db; } catch (e) { return false; }
}

async function getEsDayVolumeFromServer() {
  try {
    const symbols = ['/ESM26', '/ES:XCME', '/ES', '/ESU26', '/ESZ26'];
    for (const sym of symbols) {
      const r = await fetch(`/proxy/api/quote/${encodeURIComponent(sym)}`);
      if (!r.ok) continue;
      const d = await r.json();
      const vol = Number(d?.quote?.dayVolume || d?.quote?.totalVolume || d?.quote?.volume || 0);
      if (vol > 0) return vol;
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

async function updateRelativeVolumeCard(when) {
  // 1. Best live volume: dxTradeCache → dxSummaryCache → server API
  let dayVolume = getLiveDayVolume();
  if (!dayVolume) {
    dayVolume = await getEsDayVolumeFromServer();
  }
  // Feed into live bucket accumulator
  if (dayVolume > 0) tickRvolFromLiveVolume(dayVolume);

  // 2. Session timing — two sessions: Day 9:30→17:00, Night 17:00→9:30
  const etNow = getNowEt();
  const sess  = getActiveSession();
  const SESSION_OPEN_MIN = sess.open;
  const elapsedMins = sess.elapsed;
  const pace    = Math.max(0.001, elapsedMins / sess.span);
  const pctVal  = Math.max(0, Math.min(100, Math.round(pace * 100)));
  const estTime = etNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET';
  const sessLabel = sess.label === 'DAY' ? 'RTH 9:30–17:00 ET' : 'NIGHT 17:00–9:30 ET';

  // 3. Historical avg: sum prior-day candles from DB up to the same elapsed minutes
  let histAvgAtPace = 0;
  try {
    if ((await ensureDBReady()) && DB?.queryES15mCandles) {
      const todayStr = getTodayEtStr();
      const hist = await DB.queryES15mCandles(10);
      const byDay = {};
      for (const r of hist) {
        if (r.date === todayStr) continue;
        const slotMins = utcMsToEtMinutes(Number(r.timestamp || 0));
        // For day session: slotMins in [open, open+elapsed]
        // For night session: slot wraps midnight, check normalised elapsed
        let inWindow = false;
        if (!sess.wraps) {
          inWindow = slotMins >= SESSION_OPEN_MIN && slotMins <= SESSION_OPEN_MIN + elapsedMins;
        } else {
          const normalised = slotMins >= NIGHT_OPEN ? slotMins - NIGHT_OPEN : (1440 - NIGHT_OPEN) + slotMins;
          inWindow = normalised <= elapsedMins;
        }
        if (!inWindow) continue;
        byDay[r.date] = (byDay[r.date] || 0) + Number(r.volume || 0);
      }
      const dayVols = Object.values(byDay).filter(v => v > 0);
      if (dayVols.length) histAvgAtPace = dayVols.reduce((a, b) => a + b, 0) / dayVols.length;
    }
  } catch (_) {}

  const expectedAvg = histAvgAtPace || (dayVolume > 0 ? Math.round(dayVolume / pace) : 0);
  const rvol = (dayVolume > 0 && expectedAvg > 0) ? dayVolume / expectedAvg : 0;
  const rvolStr = rvol > 0 ? rvol.toFixed(2) + 'x' : '—';

  // Re-fetch elements after any async gaps so we never write to detached nodes
  const valueEl       = document.getElementById('rvol-value');
  const descEl        = document.getElementById('rvol-desc');
  const todayVolEl    = document.getElementById('rvol-today-vol');
  const expectedAvgEl = document.getElementById('rvol-expected-avg');
  const paceEl        = document.getElementById('rvol-session-pace');
  const timeEl        = document.getElementById('rvol-time');
  const liveClock     = document.getElementById('rvol-live-clock');
  const pacePct       = document.getElementById('rvol-pace-pct');
  const paceBar       = document.getElementById('rvol-pace-bar');

  if (valueEl) valueEl.innerHTML = `<span>${rvolStr}</span><span style="font-size:10px;font-family:system-ui,sans-serif;color:#ffd0d0;background:rgba(255,91,91,.14);border:1px solid rgba(255,91,91,.45);padding:3px 8px;border-radius:4px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">${dayVolume > 0 ? 'ACTIVE' : 'WAITING'}</span>`;
  if (descEl)        descEl.textContent        = dayVolume > 0 ? `${sessLabel} — ES volume live. Updated ${when}.` : `${sessLabel} — Waiting on ES volume.`;
  if (todayVolEl)    todayVolEl.textContent    = dayVolume > 0 ? dayVolume.toLocaleString() : '—';
  if (expectedAvgEl) expectedAvgEl.textContent = expectedAvg > 0 ? expectedAvg.toLocaleString() : '—';
  if (paceEl)        paceEl.textContent        = `${pctVal}% (${sessLabel})`;
  if (timeEl)        timeEl.textContent        = when;
  if (liveClock)     liveClock.textContent     = estTime;
  if (pacePct)       pacePct.textContent       = `${pctVal}%`;
  if (paceBar)       paceBar.style.width       = `${pctVal}%`;

  requestAnimationFrame(() => drawRelativeVolumeSparkline());
}

async function drawRelativeVolumeSparkline() {
  const canvas = document.getElementById('greeks-rvol-sparkline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    setTimeout(() => drawRelativeVolumeSparkline(), 200);
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const width  = Math.max(1, Math.floor(rect.width  * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width  = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);

  // Use active session window (day or night)
  const _sess       = getActiveSession();
  const SESSION_START = _sess.open;
  const SESSION_SPAN  = _sess.span;
  const todayStr = getTodayEtStr();
  const nowEtMin = etMinutesOf(getNowEt());

  // Normalise a raw ET-minutes value to session-relative offset (0 = session open)
  function toSessionOffset(etMin) {
    if (!_sess.wraps) return etMin - SESSION_START;
    return etMin >= NIGHT_OPEN ? etMin - NIGHT_OPEN : (1440 - NIGHT_OPEN) + etMin;
  }

  // ── 1. Today's curve from live samples ───────────────────────────────────
  // Filter samples that belong to the current session window
  const rawSamples = (window.__rvolSamples || [])
    .filter(s => {
      const off = toSessionOffset(s.min);
      return off >= 0 && off <= SESSION_SPAN;
    })
    .sort((a, b) => toSessionOffset(a.min) - toSessionOffset(b.min));

  const nowOff = toSessionOffset(nowEtMin);
  // Remap mins to session-relative offsets for the chart
  const liveSamples = rawSamples.map(s => ({ min: toSessionOffset(s.min), cum: s.cum }));

  // Always anchor at session open with 0 volume
  const todayCumulative = [{ min: 0, cum: 0 }, ...liveSamples];
  if (liveSamples.length > 0 && nowOff > liveSamples[liveSamples.length - 1].min) {
    todayCumulative.push({ min: nowOff, cum: liveSamples[liveSamples.length - 1].cum });
  }

  // ── 2. Historical avg from DB (prior days, 15m candles) ──────────────────
  const slotVolumes = {};
  const dayVolumeMap = {};
  try {
    if (await ensureDBReady() && DB?.queryES15mCandles) {
      const hist = await DB.queryES15mCandles(10);
      for (const r of hist) {
        if (r.date === todayStr) continue;
        const slotMin = _slotMinFromRecord(r);
        if (slotMin === null) continue;
        const off = toSessionOffset(slotMin);
        if (off < 0 || off > SESSION_SPAN) continue;
        const date = r.date;
        if (!dayVolumeMap[date]) dayVolumeMap[date] = {};
        dayVolumeMap[date][off] = Number(r.volume || 0);
      }
      for (const [, slotVols] of Object.entries(dayVolumeMap)) {
        const slots = Object.keys(slotVols).map(Number).sort((a, b) => a - b);
        let c = 0;
        for (const slot of slots) {
          c += slotVols[slot];
          if (!slotVolumes[slot]) slotVolumes[slot] = [];
          slotVolumes[slot].push(c);
        }
      }
    }
  } catch (_) {}

  const avgCumulative = Object.keys(slotVolumes).map(Number).sort((a, b) => a - b).map(slot => {
    const cums = slotVolumes[slot];
    return { min: slot, cum: cums.reduce((s, v) => s + v, 0) / cums.length };
  });

  // ── 3. Draw ──────────────────────────────────────────────────────────────
  if (todayCumulative.length < 2 && !avgCumulative.length) {
    drawRvolFallback(ctx, width, height, dpr);
    return;
  }

  const pad = { left: 4 * dpr, right: 4 * dpr, top: 6 * dpr, bottom: 6 * dpr };
  const chartW = width  - pad.left - pad.right;
  const chartH = height - pad.top  - pad.bottom;

  const allCums = [...todayCumulative.map(p => p.cum), ...avgCumulative.map(p => p.cum)];
  const maxCum = Math.max(1, ...allCums);

  // x = session-relative offset (already remapped to 0..SESSION_SPAN), y = cumulative volume
  const toXY = (offVal, cumVal) => ({
    x: pad.left + (Math.max(0, Math.min(SESSION_SPAN, offVal)) / SESSION_SPAN) * chartW,
    y: pad.top  + (1 - cumVal / maxCum) * chartH
  });

  // Update x-axis labels to match active session
  {
    function etMinToLabel(etMin) {
      const h = Math.floor(etMin / 60) % 24;
      const m = etMin % 60;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hh = ((h + 11) % 12 + 1);
      return `${hh}:${String(m).padStart(2,'0')} ${ampm}`;
    }
    const lblL = document.getElementById('rvol-xlabel-left');
    const lblM = document.getElementById('rvol-xlabel-mid');
    const lblR = document.getElementById('rvol-xlabel-right');
    if (lblL && lblM && lblR) {
      if (!_sess.wraps) {
        // Day: 9:30 → midpoint → 17:00
        const mid = _sess.open + Math.round(_sess.span / 2);
        lblL.textContent = etMinToLabel(_sess.open);
        lblM.textContent = etMinToLabel(mid);
        lblR.textContent = etMinToLabel(_sess.close);
      } else {
        // Night: 17:00 → midnight(ish) → 09:30
        const nightSpanHalf = Math.round(_sess.span / 2);
        const midRaw = (_sess.open + nightSpanHalf) % 1440;
        lblL.textContent = etMinToLabel(_sess.open);
        lblM.textContent = etMinToLabel(midRaw);
        lblR.textContent = etMinToLabel(_sess.close);
      }
    }
  }

  function drawLine(points, color, dashed, lineWidth) {
    if (points.length < 2) return;
    ctx.save();
    ctx.lineWidth   = (lineWidth || 1.5) * dpr;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = color;
    if (dashed) ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();
  }

  if (avgCumulative.length >= 2) {
    drawLine(avgCumulative.map(p => toXY(p.min, p.cum)), 'rgba(255,255,255,0.30)', true, 1.2);
  }

  if (todayCumulative.length >= 2) {
    const todayPts = todayCumulative.map(p => toXY(p.min, p.cum));
    const baseY = pad.top + chartH;

    const fill = ctx.createLinearGradient(0, pad.top, 0, baseY);
    fill.addColorStop(0, 'rgba(255,91,91,0.30)');
    fill.addColorStop(1, 'rgba(255,91,91,0.02)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(todayPts[0].x, baseY);
    todayPts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(todayPts[todayPts.length - 1].x, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.lineWidth   = 2 * dpr;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = 'rgb(255,91,91)';
    ctx.shadowColor = 'rgba(255,91,91,0.7)';
    ctx.shadowBlur  = 5 * dpr;
    ctx.beginPath();
    todayPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();

    const last = todayPts[todayPts.length - 1];
    ctx.save();
    ctx.fillStyle   = '#ffd0d0';
    ctx.shadowColor = '#ff5b5b';
    ctx.shadowBlur  = 8 * dpr;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Helper: extract ET minutes from a DB candle record
function _slotMinFromRecord(r) {
  if (r.slotKey) {
    const parts = String(r.slotKey).split('-');
    const timePart = parts[parts.length - 1];
    const [h, m] = timePart.split(':').map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  }
  const ts = Number(r.timestamp || r.ts || r.datetime || 0);
  if (!ts) return null;
  return utcMsToEtMinutes(ts);
}

function drawRvolFallback(ctx, width, height, dpr) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,91,91,.5)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(10 * dpr, height * 0.72);
  ctx.lineTo(width - 10 * dpr, height * 0.72);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.font = `${9 * dpr}px Arial`;
  ctx.textAlign = 'center';
  ctx.fillText('Waiting for ES volume data', width / 2, height / 2);
  ctx.restore();
}

async function copyExposureScreenshot() {
  const btn = document.getElementById('exp-copy-shot-btn');
  const target = document.getElementById('exposure-data-boxes') || document.getElementById('page-insights-exposure');
  const original = btn?.textContent || 'COPY SHOT';
  if (!target) return;
  setExposureBtnState(btn, '…', '#ffb300');
  try {
    const html2canvasFn = typeof window.loadHtml2CanvasSafe === 'function'
      ? await window.loadHtml2CanvasSafe()
      : (typeof html2canvas !== 'undefined' ? html2canvas : null);
    if (typeof html2canvasFn !== 'function') throw new Error('html2canvas not loaded');
    const canvas = await html2canvasFn(target, {
      backgroundColor: '#05080d',
      scale: 2,
      useCORS: true,
      logging: false,
      allowTaint: true,
      onclone(doc) {
        doc.querySelectorAll('#exp-refresh-btn,#exp-copy-shot-btn,#exp-share-x-btn,#exp-share-discord-btn').forEach((el) => el.remove());
      }
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to create image');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    pulseExposureBtn(btn, original, '#00e5ff', true);
  } catch (err) {
    console.error('copyExposureScreenshot:', err);
    pulseExposureBtn(btn, original, '#00e5ff', false);
  }
}

async function shareExposure(platform) {
  const btn = platform === 'x'
    ? document.getElementById('exp-share-x-btn')
    : document.getElementById('exp-share-discord-btn');
  const original = btn?.textContent || (platform === 'x' ? 'X' : 'DISCORD');
  const originalColor = platform === 'x' ? '#00e5ff' : '#7289da';
  setExposureBtnState(btn, '…', '#ffb300');
  if (platform === 'x') {
    setTimeout(() => {
      pulseExposureBtn(btn, original, originalColor, true);
      window.open('https://twitter.com/intent/tweet?text=SPX+Exposure+Stack', '_blank');
    }, 300);
    return;
  }
  try {
    const html2canvasFn = typeof window.loadHtml2CanvasSafe === 'function'
      ? await window.loadHtml2CanvasSafe()
      : (typeof html2canvas !== 'undefined' ? html2canvas : null);
    if (typeof html2canvasFn !== 'function') throw new Error('html2canvas not loaded');
    const target = document.getElementById('exposure-data-boxes') || document.getElementById('page-insights-exposure');
    if (!target) throw new Error('Missing exposure target');
    const canvas = await html2canvasFn(target, {
      backgroundColor: '#05080d',
      scale: 2,
      useCORS: true,
      logging: false,
      allowTaint: true,
      onclone(doc) {
        doc.querySelectorAll('#exp-refresh-btn,#exp-copy-shot-btn,#exp-share-x-btn,#exp-share-discord-btn').forEach((el) => el.remove());
      }
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to create image');
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: 'SPX Exposure Stack' }));
    form.append('files[0]', blob, 'exposure-stack.png');
    const res = await fetch('/proxy/api/webhooks/1466249857122570454/REDACTED', {
      method: 'POST',
      body: form
    });
    if (!res.ok) throw new Error('Webhook failed: ' + res.status);
    pulseExposureBtn(btn, original, originalColor, true);
  } catch (err) {
    console.error('shareExposure:', err);
    pulseExposureBtn(btn, original, originalColor, false);
  }
}

async function _seedCandlesFromProxy(symbol, saveMethod, daysBack, retries = 2) {
  if (!DB?.[saveMethod]) return false;
  const start = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 5000));
    try {
      const resp = await fetch(`/proxy/api/dxlink/candles?symbol=${encodeURIComponent(symbol)}&start=${start}&count=1000`);
      if (!resp.ok) continue;
      const payload = await resp.json();
      const candles = Array.isArray(payload?.candles) ? payload.candles : [];
      if (!candles.length) continue;
      for (const candle of candles) {
        const ts = Number(candle?.datetime ?? candle?.time ?? candle?.timestamp);
        if (!ts || !Number(candle?.volume)) continue;
        const d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const slotKey = `${date}-${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        try { await DB[saveMethod]({ timestamp: ts, date, slotKey, open: Number(candle.open||0), high: Number(candle.high||0), low: Number(candle.low||0), close: Number(candle.close||0), volume: Number(candle.volume||0), symbol }); } catch (_) {}
      }
      return true;
    } catch (_) {}
  }
  return false;
}

function seedES15mCandlesInBackground() {
  if (window.__es15mSeeded) return;
  window.__es15mSeeded = true;
  (async () => {
    try {
      if (!(await ensureDBReady())) return;
      const ok = await _seedCandlesFromProxy('/ES{=15m}', 'saveES15mCandle', 10);
      if (ok) {
        const when = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        updateRelativeVolumeCard(when);
      }
    } catch (_) {}
  })();
}

function seedES5mCandlesInBackground() {
  if (window.__es5mSeeded) return;
  window.__es5mSeeded = true;
  (async () => {
    try {
      if (!(await ensureDBReady()) || !DB?.saveES5mCandle) return;
      // 3 days of 5m candles for intraday RVOL detail
      await _seedCandlesFromProxy('/ES{=5m}', 'saveES5mCandle', 3);
    } catch (_) {}
  })();
}

// Save a live 5m candle tick when a new 5m bar boundary is crossed
if (!window.__es5mLiveTickBound) {
  window.__es5mLiveTickBound = true;
  window.__es5mLastBarSlot = '';
  setInterval(() => {
    try {
      const etNow = getNowEt();
      const etMins = etMinutesOf(etNow);
      if (etMins < 9 * 60 + 30 || etMins > 16 * 60) return;
      const vol = getLiveDayVolume();
      if (!vol) return;
      const barStartMin = Math.floor(etMins / 5) * 5;
      const date = getTodayEtStr();
      const slotKey = `${date}-${String(Math.floor(barStartMin/60)).padStart(2,'0')}:${String(barStartMin%60).padStart(2,'0')}`;
      if (slotKey === window.__es5mLastBarSlot) return;
      window.__es5mLastBarSlot = slotKey;
      if (typeof DB !== 'undefined' && DB?.saveES5mCandle) {
        DB.saveES5mCandle({ timestamp: Date.now(), date, slotKey, volume: vol, symbol: '/ES{=5m}' }).catch(() => {});
      }
    } catch (_) {}
  }, 60000); // check every minute; writes once per 5m bar
}

function resetRvolIntradayBucketsIfNewDay() {
  const today = getTodayEtStr();
  if (window.__rvolSampleDate && window.__rvolSampleDate !== today) {
    window.__rvolSamples = [];
    window.__rvolLastDayVol = 0;
    window.__rvolSampleDate = today;
  }
}

// ── Scheduled reset at 9:30am ET (market open) + 5:00pm ET (post-close) ──────
// Clears sparkline history and RVOL samples so charts start fresh each session.
function scheduleSessionResets() {
  if (window.__sessionResetScheduled) return;
  window.__sessionResetScheduled = true;

  function msUntilEtTime(h, m) {
    const now = getNowEt();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    let diff = target.getTime() - now.getTime();
    if (diff <= 0) diff += 24 * 60 * 60 * 1000; // next day
    return diff;
  }

  function doReset(label) {
    // Clear sparkline history so it rebuilds from this point forward
    window.__insightsGreekHistory = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
    window.__insightsGreekHistoryLoading = false;
    // Clear RVOL samples
    window.__rvolSamples = [];
    window.__rvolLastDayVol = 0;
    window.__rvolSampleDate = getTodayEtStr();
    // Clear session greek range so signals reset
    window.__sessionGreekRange = null;
    window.__lastGexBucket = undefined;
    window.__lastChexBucket = undefined;
    window.__lastVexBucket = undefined;
    window.__lastDexInvBucket = undefined;
    window.__lastComboRegime = undefined;
    window.__lastNeutralAlert = null;
    window.__lastPlaybookRegime = undefined;
    window.__playbookSeeded = false;
    // If 9:30am reset, re-hydrate from DB after a short delay (new data may already be in)
    if (label === '9:30am') {
      setTimeout(() => {
        hydrateGreekSparklineHistoryFromDB().catch(() => {});
      }, 5000);
    }
    renderGreekSparklines();
    drawRelativeVolumeSparkline();
  }

  function schedule930() {
    const ms = msUntilEtTime(9, 30);
    setTimeout(() => {
      doReset('9:30am');
      // Reschedule for next day
      setTimeout(schedule930, 100);
    }, ms);
  }

  function schedule5pm() {
    const ms = msUntilEtTime(17, 0);
    setTimeout(() => {
      doReset('5pm');
      setTimeout(schedule5pm, 100);
    }, ms);
  }

  schedule930();
  schedule5pm();
}

function initInsightsExposure() {
  // Reset intraday RVOL buckets and session greek ranges if new trading day
  resetRvolIntradayBucketsIfNewDay();
  const todayStr = getTodayEtStr();
  if (window.__sessionRangeDate !== todayStr) {
    window.__sessionRangeDate = todayStr;
    window.__sessionGreekRange = null;
    window.__dexHistory = [];
    window.__lastDexDir = undefined;
    window.__lastDexVelAlert = 0;
    window.__lastGexBucket = undefined;
    window.__lastChexBucket = undefined;
    window.__lastVexBucket = undefined;
    window.__lastDexInvBucket = undefined;
    window.__lastComboRegime = undefined;
    window.__lastNeutralAlert = null;
    window.__lastPlaybookRegime = undefined;
    window.__playbookSeeded = false;
  }

  // Schedule 9:30am and 5pm ET sparkline resets
  scheduleSessionResets();

  // Seed intraday buckets from live volume immediately on init
  const initVol = getLiveDayVolume();
  if (initVol > 0) tickRvolFromLiveVolume(initVol);

  // Hydrate sparkline history from DB first, then kick off the rest
  hydrateGreekSparklineHistoryFromDB().then(() => {
    scheduleExposureSparklineRefresh();
  }).catch(() => {});

  if (typeof dxSubscribe === 'function') {
    dxSubscribe(['/ES:XCME', '/ESM26', '/ESU26']);
  }
  fetchLatestExposureSnapshot().then((snapshot) => {
    if (snapshot) {
      updateGreeksDisplay(snapshot);
      return;
    }
    fetchLatestExposureSnapshotFromDB().then((dbSnapshot) => {
      if (dbSnapshot) updateGreeksDisplay(dbSnapshot);
    });
  });
  refreshExposureStack();
  setTimeout(refreshExposureStack, 0);
  scheduleExposureSparklineRefresh();
  setTimeout(seedES15mCandlesInBackground, 2000); // seed after card renders
  setTimeout(seedES5mCandlesInBackground, 3500);  // seed 5m candles shortly after
  setTimeout(() => {
    const live = window.__liveExposureSnapshot;
    if (live && [live.gex, live.dex, live.chex, live.vex].every((v) => Number.isFinite(Number(v)))) {
      persistExposureStackToDB(
        live.gex,
        live.dex,
        live.chex,
        live.vex,
        Number(live.buyScore || window.__lastExposureBuyScore || 0),
        Number(live.sellScore || window.__lastExposureSellScore || 0),
        Number(live.price || 0)
      );
    }
  }, 750);

  // Tick the top-right clock every second
  if (window.__exposureClockInterval) clearInterval(window.__exposureClockInterval);
  window.__exposureClockInterval = setInterval(() => {
    const el = document.getElementById('rvol-live-clock');
    if (!el) { clearInterval(window.__exposureClockInterval); window.__exposureClockInterval = null; return; }
    el.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' }) + ' EST';
  }, 1000);

  // Auto-refresh RVOL card every 30s as ES volume ticks in
  if (window.__exposureRvolInterval) clearInterval(window.__exposureRvolInterval);
  window.__exposureRvolInterval = setInterval(() => {
    const when = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (document.getElementById('rvol-value') || document.getElementById('rvol-desc')) {
      updateRelativeVolumeCard(when);
    } else {
      // Tab was unloaded, stop polling
      clearInterval(window.__exposureRvolInterval);
      window.__exposureRvolInterval = null;
    }
  }, 30000);

  // ── Auto-refresh Greeks every 30s (fetch latest from proxy + re-render) ──
  if (window.__exposureGreeksInterval) clearInterval(window.__exposureGreeksInterval);
  window.__exposureGreeksInterval = setInterval(async () => {
    if (!document.getElementById('gex-value')) {
      clearInterval(window.__exposureGreeksInterval);
      window.__exposureGreeksInterval = null;
      return;
    }
    // Fetch latest snapshot from proxy then update display
    const snapshot = await fetchLatestExposureSnapshot();
    if (snapshot) {
      updateGreeksDisplay(snapshot);
    } else {
      // Fallback: re-render with existing window snapshot
      refreshExposureStack();
    }
  }, 30000);

  // ── Live-tick watcher: if __liveExposureSnapshot is updated by any other
  //    module (overview, dxlink handlers, etc.), reflect it immediately.
  //    Also polls live ES volume and feeds the RVOL bucket accumulator. ──
  if (window.__exposureLiveTickInterval) clearInterval(window.__exposureLiveTickInterval);
  window.__exposureLiveTickWatchTs = 0;
  window.__exposureLiveTickInterval = setInterval(() => {
    if (!document.getElementById('gex-value')) {
      clearInterval(window.__exposureLiveTickInterval);
      window.__exposureLiveTickInterval = null;
      return;
    }
    // Greeks live tick
    const snap = window.__liveExposureSnapshot;
    if (snap) {
      const snapTs = Number(snap.ts || 0);
      if (snapTs > window.__exposureLiveTickWatchTs) {
        window.__exposureLiveTickWatchTs = snapTs;
        updateGreeksDisplay(snap);
      }
    }
    // RVOL live tick — feed dxTradeCache dayVolume into bucket accumulator
    const vol = getLiveDayVolume();
    if (vol > 0) tickRvolFromLiveVolume(vol);
  }, 2000); // check every 2s — fast enough to feel live without hammering DOM

  if (!window.__exposureSparklineResizeBound) {
    window.__exposureSparklineResizeBound = true;
    window.addEventListener('resize', () => {
      scheduleExposureSparklineRefresh();
    });
  }
}

async function hydrateGreekSparklineHistoryFromDB() {
  if (window.__insightsGreekHistoryLoading) return;
  const db = getExposureDB();
  window.__insightsGreekHistoryLoading = true;
  try {
    let records = [];

    // Primary: fetch from greeks_intraday via proxy (has gex/dex/chex/vex in display-scale)
    try {
      const resp = await fetch('/proxy/api/greeks-intraday', { cache: 'no-store' });
      if (resp.ok) {
        const payload = await resp.json();
        if (Array.isArray(payload?.records) && payload.records.length) {
          records = payload.records.map(r => ({
            timestamp: Number(r.ts || r.timestamp || 0),
            gexRaw: null,
            dexRaw: null,
            chexRaw: null,
            vexRaw: null,
            // greeks_intraday stores display-scale: gex/dex in billions, chex/vex in millions
            gex: Number(r.gex),
            dex: Number(r.dex),
            chex: Number(r.chex),
            vex: Number(r.vex),
          }));
        }
      }
    } catch (_) {}

    // Fallback: IndexedDB greeksTimeSeries
    if (!records.length && db && typeof db.queryGreeksTimeSeries_Today === 'function') {
      if (!db.db && typeof db.init === 'function') await db.init().catch(() => null);
      records = await db.queryGreeksTimeSeries_Today('').catch(() => []);
      if (!Array.isArray(records) || !records.length) {
        if (typeof db.queryGreeksTimeSeries_Hours === 'function') {
          records = await db.queryGreeksTimeSeries_Hours(72, '').catch(() => []);
        }
      }
      if ((!Array.isArray(records) || !records.length) && typeof db._getAllRecords === 'function') {
        records = await db._getAllRecords('greeksTimeSeries').catch(() => []);
      }
    }

    if (!Array.isArray(records) || !records.length) return;
    const history = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
    const anchors = window.__liveExposureSnapshot || {};
    const lastValues = { gex: null, dex: null, chex: null, vex: null };
    records
      .slice()
      .sort((a, b) => Number(a?.timestamp || a?.ts || 0) - Number(b?.timestamp || b?.ts || 0))
      .forEach((record) => {
        const ts = Number(record?.timestamp || record?.ts || Date.now());
        // gexRaw/dexRaw/chexRaw/vexRaw: already raw scale (from IndexedDB greeksTimeSeries)
        // record.gex from greeks_intraday: display-scale billions (e.g. 5.08) → multiply by 1e9
        // record.chex from greeks_intraday: display-scale millions (e.g. -171) → multiply by 1e6
        let gex = getExposureRecordValue(record, ['gexRaw']);
        if (gex === null) {
          const v = getExposureRecordValue(record, ['gex', 'netGEX', 'totalGEX']);
          if (v !== null) gex = Math.abs(v) < 1e6 ? v * 1e9 : v;
        }
        let dex = getExposureRecordValue(record, ['dexRaw']);
        if (dex === null) {
          const v = getExposureRecordValue(record, ['dex', 'netDEX', 'totalDEX']);
          if (v !== null) dex = Math.abs(v) < 1e6 ? v * 1e9 : v;
        }
        let chex = getExposureRecordValue(record, ['chexRaw']);
        if (chex === null) {
          const v = getExposureRecordValue(record, ['chex', 'netCHEX', 'totalCHEX']);
          if (v !== null) chex = Math.abs(v) < 1e4 ? v * 1e6 : v;
        }
        let vex = getExposureRecordValue(record, ['vexRaw']);
        if (vex === null) {
          const v = getExposureRecordValue(record, ['vex', 'netVEX', 'totalVEX']);
          if (v !== null) vex = Math.abs(v) < 1e4 ? v * 1e6 : v;
        }
        if (gex === null) gex = pickGreekHistoryValue('gex', null, lastValues.gex, anchors.gex);
        if (dex === null) dex = pickGreekHistoryValue('dex', null, lastValues.dex, anchors.dex);
        if (chex === null) chex = pickGreekHistoryValue('chex', null, lastValues.chex, anchors.chex);
        if (vex === null) vex = pickGreekHistoryValue('vex', null, lastValues.vex, anchors.vex);
        if (![gex, dex, chex, vex].every(Number.isFinite) || !Number.isFinite(ts)) return;
        lastValues.gex = gex;
        lastValues.dex = dex;
        lastValues.chex = chex;
        lastValues.vex = vex;
        history.gex.push({ ts, value: gex });
        history.dex.push({ ts, value: dex });
        history.chex.push({ ts, value: chex });
        history.vex.push({ ts, value: vex });
        if (Number.isFinite(gex) || Number.isFinite(vex)) {
          history.gexvex.push({ ts, value: (Number.isFinite(gex) ? gex : 0) + (Number.isFinite(vex) ? vex : 0) });
        }
      });
    const existing = window.__insightsGreekHistory || {};
    const merged = {};
    ['gex', 'dex', 'chex', 'vex', 'gexvex'].forEach((k) => {
      const dbPts = history[k] || [];
      const lastTs = dbPts.length ? dbPts[dbPts.length - 1].ts : 0;
      const livePts = (existing[k] || []).filter((p) => p.ts > lastTs);
      merged[k] = dbPts.concat(livePts);
    });
    window.__insightsGreekHistory = merged;
  } catch (err) {
    console.warn('Greek sparkline DB hydrate failed:', err);
  } finally {
    window.__insightsGreekHistoryLoading = false;
    const hist = window.__insightsGreekHistory;
    const hasRealData = hist && ['gex','dex','chex','vex'].some(k => (hist[k] || []).length > 1);
    if (!hasRealData) {
      const live = window.__liveExposureSnapshot;
      if (live && [live.gex, live.dex, live.chex, live.vex].every((v) => Number.isFinite(Number(v)))) {
        window.__insightsGreekHistory = {
          gex: [{ ts: Date.now() - 60000, value: live.gex }, { ts: Date.now(), value: live.gex }],
          dex: [{ ts: Date.now() - 60000, value: live.dex }, { ts: Date.now(), value: live.dex }],
          chex: [{ ts: Date.now() - 60000, value: live.chex }, { ts: Date.now(), value: live.chex }],
          vex: [{ ts: Date.now() - 60000, value: live.vex }, { ts: Date.now(), value: live.vex }],
          gexvex: [{ ts: Date.now() - 60000, value: Number(live.gex) + Number(live.vex) }, { ts: Date.now(), value: Number(live.gex) + Number(live.vex) }]
        };
        renderGreekSparklines();
        drawRelativeVolumeSparkline();
      } else {
        // No DB data — seed mock so sparklines show something until live data arrives
        seedMockGreekHistory();
      }
    } else {
      renderGreekSparklines();
      drawRelativeVolumeSparkline();
      scheduleExposureSparklineRefresh();
    }
  }
}

function seedMockGreekHistory() {
  if (window.__insightsGreekHistory && (window.__insightsGreekHistory.gex || []).length >= 4) {
    return;
  }
  // Build timestamps anchored to today's session (9:30am ET → now), spaced 30 min apart
  // so the sparkline x-axis renders correctly against real wall clock
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etOffsetMs = nowEt.getTime() - new Date().getTime();
  const sessionOpen = new Date(nowEt);
  sessionOpen.setHours(9, 30, 0, 0);
  const sessionOpenUtcMs = sessionOpen.getTime() - etOffsetMs;
  const STEP = 30 * 60 * 1000; // 30 min
  const mockVals = {
    gex:    [4.92e9, 4.89e9, 4.95e9, 4.91e9, 5.00e9, 5.04e9, 5.02e9, 5.08e9, 5.05e9, 5.11e9, 5.06e9, 5.15e9, 5.16e9, 5.18e9],
    dex:    [-7.75e9,-7.82e9,-7.70e9,-7.78e9,-7.66e9,-7.61e9,-7.68e9,-7.588e9,-7.64e9,-7.56e9,-7.62e9,-7.53e9,-7.55e9,-7.50e9],
    chex:   [-182e6,-188e6,-181e6,-176e6,-184e6,-178e6,-170e6,-171e6,-176e6,-169e6,-173e6,-168e6,-171e6,-166e6],
    vex:    [-8.1e6,-8.25e6,-8.0e6,-8.18e6,-7.92e6,-7.84e6,-7.98e6,-7.796e6,-7.88e6,-7.72e6,-7.83e6,-7.65e6,-7.796e6,-7.61e6],
    gexvex: [4.912e9,4.862e9,4.95e9,4.83e9,5.008e9,5.028e9,4.99e9,5.072e9,5.015e9,5.118e9,5.03e9,5.205e9,5.12e9,5.24e9]
  };
  const mock = {};
  for (const [key, vals] of Object.entries(mockVals)) {
    mock[key] = vals.map((value, i) => ({ ts: sessionOpenUtcMs + i * STEP, value }));
  }
  window.__insightsGreekHistory = mock;
  renderGreekSparklines();
  drawRelativeVolumeSparkline();
}

function ensureExposureHistorySeries() {
  if (!window.__insightsGreekHistory) {
    window.__insightsGreekHistory = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
  }
  return window.__insightsGreekHistory;
}

function renderGreekSparklineCanvas(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    setTimeout(() => renderGreekSparklines(), 100);
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  if (!Array.isArray(data) || !data.length) return;

  // Minimal padding
  const pad = { left: 4 * dpr, right: 4 * dpr, top: 5 * dpr, bottom: 5 * dpr };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const ordered = (Array.isArray(data) ? data : [])
    .map((d) => ({ ts: Number(d?.ts || d?.timestamp || 0), value: Number(d?.value ?? d) }))
    .filter((d) => Number.isFinite(d.ts) && Number.isFinite(d.value) && d.ts > 1000)
    .sort((a, b) => a.ts - b.ts);
  if (!ordered.length) return;

  const workingPts = ordered;
  const workingVals = workingPts.map(p => p.value);
  const absVals = workingVals.map((v) => Math.abs(v)).filter(Number.isFinite).sort((a, b) => a - b);
  const medianAbs = absVals.length ? absVals[Math.floor(absVals.length / 2)] : 0;
  const outlierCap = medianAbs > 0 ? Math.max(medianAbs * 20, 1) : null;
  const clippedVals = outlierCap
    ? workingVals.map((value) => Math.abs(value) > outlierCap ? Math.sign(value || 1) * outlierCap : value)
    : workingVals;
  const min = Math.min(...clippedVals);
  const max = Math.max(...clippedVals);
  // Pad value range so line doesn't hug edges
  const rawRange = max - min;
  const range = rawRange > 0 ? rawRange * 1.15 : Math.max(1, Math.abs(max) * 0.02);
  const mid = (max + min) / 2;
  const adjMin = mid - range / 2;
  const adjMax = mid + range / 2;

  // ── Time-proportional x (same as NET PREMIUM sparkline), index fallback ──
  const tMin = workingPts[0].ts, tMax = workingPts[workingPts.length - 1].ts;
  const tSpan = (tMax - tMin) || 1;
  const n = workingPts.length;
  const xOf = (p, i) => pad.left + (n === 1 ? chartW / 2 : (tMax > tMin ? (p.ts - tMin) / tSpan : i / (n - 1)) * chartW);
  const yOf  = (v) => pad.top  + (1 - (v - adjMin) / (adjMax - adjMin)) * chartH;

  const pts = workingPts.map((d, i) => ({ x: xOf(d, i), y: yOf(clippedVals[i]) }));
  if (pts.length === 0) return;

  const lastPoint = pts[pts.length - 1];

  // ── Zero reference line ──
  // Only draw if zero is within the visible y range
  if (adjMin < 0 && adjMax > 0) {
    const zeroY = yOf(0);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([3 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(pad.left + chartW, zeroY);
    ctx.stroke();
    ctx.restore();
  }

  // Fill under the line (gradient from color → transparent, baseline = bottom)
  const baselineY = pad.top + chartH;
  const grad = ctx.createLinearGradient(0, pad.top, 0, baselineY);
  const fillColor = color.startsWith('rgb(') ? color.replace('rgb(', 'rgba(').replace(')', ', 0.18)') : 'rgba(255,255,255,0.18)';
  grad.addColorStop(0, fillColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, baselineY);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(lastPoint.x, baselineY);
  ctx.closePath();
  ctx.fill();

  // Line
  ctx.save();
  ctx.lineWidth = 1.75 * dpr;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 4 * dpr;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();

  // Dot at latest point
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 * dpr;
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 2.5 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderGreekSparklines() {
  const histories = window.__insightsGreekHistory;
  if (!histories) return;
  renderGreekSparklineCanvas('greeks-gex-sparkline', histories.gex || [], 'rgb(0,200,136)');
  renderGreekSparklineCanvas('greeks-dex-sparkline', histories.dex || [], 'rgb(34,152,207)');
  renderGreekSparklineCanvas('greeks-chex-sparkline', histories.chex || [], 'rgb(218,92,190)');
  renderGreekSparklineCanvas('greeks-vex-sparkline', histories.vex || [], 'rgb(114,120,202)');
  renderGreekSparklineCanvas('greeks-gexvex-sparkline', histories.gexvex || [], 'rgb(255,140,0)');
}

function updateGammaLogic(gex, dex, dexVelocity) {
  const analysisRegime = document.getElementById('analysis-regime');
  const analysisRegimeTime = document.getElementById('analysis-regime-time');
  const analysisVelocityTime = document.getElementById('analysis-velocity-time');
  const analysisGammaTime = document.getElementById('analysis-gamma-time');
  const analysisDeltaTime = document.getElementById('analysis-delta-time');
  const regimeBadge = document.getElementById('gamma-regime-badge');
  const regimeTitle = document.getElementById('gamma-regime-title');
  const regimeDesc = document.getElementById('gamma-regime-desc');
  const gexStatus = document.getElementById('gamma-gex-status');
  const dexStatus = document.getElementById('gamma-dex-status');
  const gexLabel = document.getElementById('gamma-gex-label');
  const dexLabel = document.getElementById('gamma-dex-label');
  const playbook = document.getElementById('gamma-playbook');
  const regimeKey = gex >= 0 && dex > 0 ? 'LONG_GAMMA_BULLISH_DELTA'
    : gex < 0 && dex < 0 ? 'SHORT_GAMMA_BEARISH_DELTA'
    : gex >= 0 && dex < 0 ? 'LONG_GAMMA_BEARISH_DELTA'
    : 'SHORT_GAMMA_BULLISH_DELTA';
  const regimes = {
    LONG_GAMMA_BULLISH_DELTA: {
      name: 'Compression',
      badge: '#00e676',
      title: 'Long Gamma / Bullish Delta',
      desc: 'Ideal market conditions. Dealers trade against trends (buy dips, sell rallies). Price ranges highly compressed. Any pullback toward zero-flip triggers automated dealer buy-hedges to absorb selling pressure.',
      gexMsg: 'Stable - Dealers long gamma',
      dexMsg: 'Bullish - Net long underlying'
    },
    SHORT_GAMMA_BEARISH_DELTA: {
      name: 'Expansion',
      badge: '#ff5252',
      title: 'Short Gamma / Bearish Delta',
      desc: 'HIGH-RISK REGIME. Dealer hedging unanchored. Spot below critical flip-line. Small selling triggers rapid dealer selling, creating cascading liquidity gaps. Fast directional moves likely.',
      gexMsg: 'Unstable - Dealers short gamma',
      dexMsg: 'Bearish - Net short underlying'
    },
    LONG_GAMMA_BEARISH_DELTA: {
      name: 'Choppy Trading',
      badge: '#00e5ff',
      title: 'Long Gamma / Bearish Delta',
      desc: 'Asymmetric protection: Gamma buffers intact (buying dips cushioned), but delta negative (puts being hedged). Rallies face heavy resistance from dealer selling. Pullbacks highly cushioned. Range stays supported but upside gets sold into.',
      gexMsg: 'Stable - Dealers long gamma',
      dexMsg: 'Bearish - Net short underlying'
    },
    SHORT_GAMMA_BULLISH_DELTA: {
      name: 'Vulnerable Peaks',
      badge: '#ffb300',
      title: 'Short Gamma / Bullish Delta',
      desc: 'Volatile bullish state with short-squeeze potential. Dealers short gamma but net long spot. If buying wave starts, dealers must buy index rapidly to hedge short calls, triggering violent upward squeeze. Momentum can overshoot quickly if bids keep stepping up.',
      gexMsg: 'Unstable - Dealers short gamma',
      dexMsg: 'Bullish - Net long underlying'
    }
  };
  const regime = regimes[regimeKey];
  if (regimeBadge) {
    regimeBadge.textContent = regime.name.toUpperCase();
    regimeBadge.style.color = regime.badge || '#00e676';
    regimeBadge.style.background = (regime.badge || '#00e676') === '#00e676' ? 'rgba(0,230,118,.15)' : 'rgba(0,0,0,.18)';
  }
  if (regimeTitle) regimeTitle.textContent = regime.title;
  if (regimeDesc) regimeDesc.textContent = regime.desc;
  if (gexStatus) gexStatus.textContent = gex >= 0 ? 'LONG' : 'SHORT';
  if (dexStatus) dexStatus.textContent = dex > 0 ? 'BULLISH' : 'BEARISH';
  if (gexLabel) gexLabel.textContent = regime.gexMsg;
  if (dexLabel) dexLabel.textContent = regime.dexMsg;
  if (analysisRegime) analysisRegime.textContent = `${regime.name} - ${regime.title}`;
  if (analysisRegimeTime) analysisRegimeTime.textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  if (analysisVelocityTime) analysisVelocityTime.textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  if (analysisGammaTime) analysisGammaTime.textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  if (analysisDeltaTime) analysisDeltaTime.textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  // ── Session range tracking (for positional percentiles) ──────────────────
  // gex/dex/chex/vex here are in display-scale billions/billions/billions/billions
  // (passed as snap.gex/1e9 etc from callers)
  if (!window.__sessionGreekRange) window.__sessionGreekRange = {
    gex: { min: gex, max: gex },
    dex: { min: dex, max: dex },
    chex: { min: 0, max: 0 },
    vex:  { min: 0, max: 0 }
  };
  const sr = window.__sessionGreekRange;
  sr.gex.min = Math.min(sr.gex.min, gex); sr.gex.max = Math.max(sr.gex.max, gex);
  sr.dex.min = Math.min(sr.dex.min, dex); sr.dex.max = Math.max(sr.dex.max, dex);

  // Pull chex/vex from snapshot (in raw scale → convert to display billions for consistency)
  const snap = window.__liveExposureSnapshot || {};
  const chexB = Number.isFinite(snap.chex) ? snap.chex / 1e9 : 0;
  const vexB  = Number.isFinite(snap.vex)  ? snap.vex  / 1e9 : 0;
  sr.chex.min = Math.min(sr.chex.min, chexB); sr.chex.max = Math.max(sr.chex.max, chexB);
  sr.vex.min  = Math.min(sr.vex.min,  vexB);  sr.vex.max  = Math.max(sr.vex.max,  vexB);

  function sessionPos(val, min, max) {
    if (max === min) return 0.5;
    return Math.max(0, Math.min(1, (val - min) / (max - min)));
  }
  const gexPos  = sessionPos(gex,   sr.gex.min,  sr.gex.max);
  const dexPos  = sessionPos(dex,   sr.dex.min,  sr.dex.max);
  const chexPos = sessionPos(chexB, sr.chex.min, sr.chex.max);
  const vexPos  = sessionPos(vexB,  sr.vex.min,  sr.vex.max);

  // ── DEX velocity tracking across intervals ────────────────────────────────
  if (!window.__dexHistory) window.__dexHistory = [];
  window.__dexHistory.push({ ts: Date.now(), val: dex });
  if (window.__dexHistory.length > 20) window.__dexHistory.shift();

  // DEX change over last ~3 intervals (~90s)
  const dexHist = window.__dexHistory;
  const dexPrev3 = dexHist.length >= 4 ? dexHist[dexHist.length - 4].val : dexHist[0].val;
  const dexDelta = dex - dexPrev3; // in display billions

  // ── Playbook feed signals ─────────────────────────────────────────────────
  if (typeof window.pushSignal === 'function') {

    // 1. CRITICAL: DEX zero-line flip (highest priority)
    const dexDir = dex >= 0 ? 'POS' : 'NEG';
    if (window.__lastDexDir !== undefined && window.__lastDexDir !== dexDir) {
      const flipDir = dexDir === 'POS' ? 'Negative → Positive' : 'Positive → Negative';
      window.pushSignal(`⚡ CRITICAL: DEX zero-flip — ${flipDir}. Structural shift in dealer hedging. Aggressive directional momentum expected.`, '#ff3366');
    }
    window.__lastDexDir = dexDir;

    // 2. Rapid DEX velocity surge (abs change > $15B over ~3 intervals)
    const absDelta = Math.abs(dexDelta);
    const prevVelAlert = window.__lastDexVelAlert || 0;
    if (absDelta > 15 && Date.now() - prevVelAlert > 120000) {
      window.__lastDexVelAlert = Date.now();
      const dir = dexDelta > 0 ? 'higher' : 'lower';
      window.pushSignal(`DEX velocity surge: shifted $${absDelta.toFixed(1)}B ${dir} rapidly. Dealers chasing delta — avoid fighting the trend.`, '#ff5ed0');
    }

    // 3. GEX regime signals (throttled — only re-fire when positional bucket changes)
    const gexBucket = gex >= 0
      ? (gexPos > 0.65 ? 'HIGH_POS' : gexPos < 0.35 ? 'LOW_POS' : 'MID_POS')
      : (gexPos < 0.35 ? 'DEEP_NEG' : 'MID_NEG');
    if (window.__lastGexBucket !== gexBucket) {
      window.__lastGexBucket = gexBucket;
      if (gexBucket === 'HIGH_POS') {
        window.pushSignal(`GEX high positive (top 35% of session). Dealers suppressing vol — favor pinning and mean reversion. Fade extreme moves.`, '#00e676');
      } else if (gexBucket === 'LOW_POS') {
        window.pushSignal(`GEX positive but fading (bottom 35% of session). Mean reversion in play but dealer support weakening. Watch for directional break.`, '#a5f3c4');
      } else if (gexBucket === 'DEEP_NEG') {
        window.pushSignal(`GEX deeply negative (bottom 35% of session). Dealers forced to sell weakness — high vol environment. Favor momentum, tight stops.`, '#ff5252');
      }
    }

    // 4. CHEX strong support (throttled)
    const chexBucket = chexB >= 0 && chexPos > 0.7 ? 'STRONG_POS' : 'OTHER';
    if (window.__lastChexBucket !== chexBucket) {
      window.__lastChexBucket = chexBucket;
      if (chexBucket === 'STRONG_POS') {
        window.pushSignal(`CHEX at session highs — time decay supporting bids. Late-day structural buying pressure building.`, '#ff5ed0');
      }
    }

    // 5. VEX active upside (throttled)
    const vexBucket = vexB >= 0 && vexPos > 0.6 ? 'ACTIVE_POS' : 'OTHER';
    if (window.__lastVexBucket !== vexBucket) {
      window.__lastVexBucket = vexBucket;
      if (vexBucket === 'ACTIVE_POS') {
        window.pushSignal(`VEX elevated (top 40% of session). Dealers sensitive to IV moves — IV crush can fuel upside momentum.`, '#747cff');
      }
    }

    // 6. DEX static inventory pressure (only when no velocity surge active)
    if (absDelta <= 15) {
      const dexInvBucket = dexPos > 0.75 ? 'UPSIDE' : dexPos < 0.25 ? 'DOWNSIDE' : 'NEUTRAL';
      if (window.__lastDexInvBucket !== dexInvBucket) {
        window.__lastDexInvBucket = dexInvBucket;
        if (dexInvBucket === 'UPSIDE') {
          window.pushSignal(`DEX upside inventory pressure (top 25%). Dealers hold significant upside hedges near spot — watch for resistance at key levels.`, '#00b4ff');
        } else if (dexInvBucket === 'DOWNSIDE') {
          window.pushSignal(`DEX downside inventory pressure (bottom 25%). Heavy dealer short exposure — expect aggressive short-covering on any bid.`, '#ff5252');
        }
      }
    }

    // 7. High-impact combined regimes
    const prevCombo = window.__lastComboRegime;
    let comboKey = 'NEUTRAL';
    if (gex > 0 && gexPos > 0.65 && chexB > 0 && chexPos > 0.7 && vexB > 0 && vexPos > 0.6) {
      comboKey = 'DEALER_BULL';
    } else if (gex < 0 && gexPos < 0.35 && dex < 0 && dexPos < 0.25) {
      comboKey = 'DEALER_BEAR';
    }
    if (prevCombo !== comboKey) {
      window.__lastComboRegime = comboKey;
      if (comboKey === 'DEALER_BULL') {
        window.pushSignal(`Dealer-Supported Bullish Regime: High +GEX + Strong CHEX + Active VEX. Grind higher with low realized vol. Bias long, buy dips.`, '#00e676');
      } else if (comboKey === 'DEALER_BEAR') {
        window.pushSignal(`Dealer-Amplified Bearish Regime: Deep -GEX + Downside DEX. Risk of cascading moves. Reduce longs, favor shorts or vol products.`, '#ff5252');
      }
    }

    // 8. Fallback: neutral consolidation
    const isNeutral = Math.abs(gexPos - 0.5) < 0.15 && Math.abs(dexPos - 0.5) < 0.15 && absDelta <= 5;
    if (isNeutral && window.__lastNeutralAlert !== 'NEUTRAL') {
      window.__lastNeutralAlert = 'NEUTRAL';
      window.pushSignal(`Consolidation: Greeks hovering near session midrange. Balanced dealer flows — rely on price action and technicals.`, '#64748b');
    } else if (!isNeutral) {
      window.__lastNeutralAlert = null;
    }

    // 9. Regime change (base regime)
    const prevRegime = window.__lastPlaybookRegime;
    if (prevRegime !== regimeKey) {
      window.__lastPlaybookRegime = regimeKey;
      if (prevRegime !== undefined) {
        window.pushSignal(`Regime shift → ${regime.title}: ${regime.desc.split('.')[0]}.`, regime.badge);
      } else {
        // First load — just state current regime
        window.pushSignal(`Active regime: ${regime.title}`, regime.badge);
      }
    }
  }
}

function updateGreeksDisplay(data) {
  if (!data) return;
  // Normalize all incoming values to raw dollar scale (same as __liveExposureSnapshot contract)
  // GEX/DEX: proxy sends display-scale billions (e.g. -4.132) → raw ~1e9
  // CHEX/VEX: proxy sends display-scale millions (e.g. 212.4) → raw ~1e8
  const rawGex  = normalizeExposureToRaw(data.gex);
  const rawDex  = normalizeExposureToRaw(data.dex);
  const rawChex = normalizeExposureToRawM(data.chex);
  const rawVex  = normalizeExposureToRawM(data.vex);
  const next = (current, incoming) => incoming !== null && Number.isFinite(incoming) ? incoming : current;
  const incomingTs = Number(data.ts ?? Date.now());
  window.__liveExposureSnapshot = {
    ...(window.__liveExposureSnapshot || {}),
    gex:       next(window.__liveExposureSnapshot?.gex,       rawGex),
    dex:       next(window.__liveExposureSnapshot?.dex,       rawDex),
    chex:      next(window.__liveExposureSnapshot?.chex,      rawChex),
    vex:       next(window.__liveExposureSnapshot?.vex,       rawVex),
    buyScore:  next(window.__liveExposureSnapshot?.buyScore,  Number(data.buyScore  ?? data.buyPct  ?? null)),
    sellScore: next(window.__liveExposureSnapshot?.sellScore, Number(data.sellScore ?? null)),
    price:     next(window.__liveExposureSnapshot?.price,     Number(data.price     ?? data.spot    ?? null)),
    ts: incomingTs
  };
  const snap = window.__liveExposureSnapshot;

  // Update sparkline history with this new point (raw scale, same as hydrateGreekSparklineHistoryFromDB)
  if (!window.__insightsGreekHistory) window.__insightsGreekHistory = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
  const hist = window.__insightsGreekHistory;
  const stampKey = Math.floor(incomingTs / 5000);
  if (hist._lastDisplayStamp !== stampKey) {
    hist._lastDisplayStamp = stampKey;
    if (Number.isFinite(snap.gex))  hist.gex.push({ ts: incomingTs, value: snap.gex });
    if (Number.isFinite(snap.dex))  hist.dex.push({ ts: incomingTs, value: snap.dex });
    if (Number.isFinite(snap.chex)) hist.chex.push({ ts: incomingTs, value: snap.chex });
    if (Number.isFinite(snap.vex))  hist.vex.push({ ts: incomingTs, value: snap.vex });
    if (Number.isFinite(snap.gex) || Number.isFinite(snap.vex)) {
      hist.gexvex.push({ ts: incomingTs, value: (snap.gex || 0) + (snap.vex || 0) });
    }
    ['gex','dex','chex','vex','gexvex'].forEach(k => { if (hist[k].length > 800) hist[k].shift(); });
  }

  // Display using formatExposureValue which divides by 1e9/1e6 — raw values required
  // Only write non-null values to DOM to preserve any existing display values
  if (Number.isFinite(snap.gex) && snap.gex !== 0) {
    const gexEl = getExposureValueEl('gex');
    if (gexEl) gexEl.textContent = formatExposureValue(snap.gex, 'B');
  }
  if (Number.isFinite(snap.dex) && snap.dex !== 0) {
    const dexEl = getExposureValueEl('dex');
    if (dexEl) dexEl.textContent = formatExposureValue(snap.dex, 'B');
  }
  if (Number.isFinite(snap.chex) && snap.chex !== 0) {
    const chexEl = getExposureValueEl('chex');
    if (chexEl) chexEl.textContent = formatExposureAutoScale(snap.chex);
  }
  if (Number.isFinite(snap.vex) && snap.vex !== 0) {
    const vexEl = getExposureValueEl('vex');
    if (vexEl) vexEl.textContent = formatExposureAutoScale(snap.vex);
  }
  persistExposureStackToDB(snap.gex ?? 0, snap.dex ?? 0, snap.chex ?? 0, snap.vex ?? 0, Number(snap.buyScore || 0), Number(snap.sellScore || 0), Number(snap.price || 0));
  requestAnimationFrame(() => renderGreekSparklines());
  // On first live data, clear the placeholder and seed with current state
  if (!window.__playbookSeeded && typeof window.pushSignal === 'function') {
    window.__playbookSeeded = true;
    // Clear the "Waiting..." placeholder by reinitializing the feed
    const feedEl = document.getElementById('signal-feed');
    if (feedEl) feedEl.innerHTML = '';
  }
  updateGammaLogic(snap.gex / 1e9, snap.dex / 1e9, Number(data.dexVelocity || 0));
}

function getExposureValueEl(name) {
  return document.getElementById(`greeks-${name}-value`) || document.getElementById(`${name}-value`);
}

async function persistExposureStackToDB(gex, dex, chex, vex, buyScore = 0, sellScore = 0, price = 0) {
  try {
    const db = getExposureDB();
    if (!db || typeof db.saveGreeksTimeSeries !== 'function') return;
    if (!db.db && typeof db.init === 'function') {
      await db.init().catch(() => null);
    }
    if (!db?.db) return;
    const current = { gex: Number(gex || 0), dex: Number(dex || 0), chex: Number(chex || 0), vex: Number(vex || 0) };
    if (!Object.values(current).every(Number.isFinite)) return;
    if (current.gex === 0 && current.dex === 0 && current.chex === 0 && current.vex === 0) return;
    const last = window.__lastExposureDbSave || {};
    const sameValues = ['gex', 'dex', 'chex', 'vex'].every((key) => Math.abs((last[key] || 0) - current[key]) < 1e-9);
    if (sameValues && Date.now() - (last.ts || 0) < 15000) return;
    window.__lastExposureDbSave = { ts: Date.now(), ...current };
    await db.saveGreeksTimeSeries(current.gex, current.dex, current.chex, current.vex, buyScore, sellScore, 'SPXW', price);
  } catch (err) {
    console.error('persistExposureStackToDB:', err);
  }
}

window.refreshExposureStack = refreshExposureStack;
window.copyExposureScreenshot = copyExposureScreenshot;
window.shareExposure = shareExposure;
window.init_insights_exposure = initInsightsExposure;
window.hydrateGreekSparklineHistoryFromDB = hydrateGreekSparklineHistoryFromDB;
window.updateGammaLogic = updateGammaLogic;
window.updateGreeksDisplay = updateGreeksDisplay;
window.updateRelativeVolumeCard = updateRelativeVolumeCard;

if (!window.__exposureButtonsBound) {
  document.addEventListener('click', (event) => {
  const refreshBtn = event.target?.closest?.('#exp-refresh-btn');
  const copyBtn = event.target?.closest?.('#exp-copy-shot-btn');
  const xBtn = event.target?.closest?.('#exp-share-x-btn');
  const discordBtn = event.target?.closest?.('#exp-share-discord-btn');
  if (refreshBtn) { event.preventDefault(); refreshExposureStack(); }
  if (copyBtn) { event.preventDefault(); copyExposureScreenshot(); }
  if (xBtn) { event.preventDefault(); shareExposure('x'); }
  if (discordBtn) { event.preventDefault(); shareExposure('discord'); }
  }, true);
  window.__exposureButtonsBound = true;
}

// ── WEBSOCKET LISTENER — Real-time greeks updates ──
// Listen for GREEKS_INTRADAY broadcasts from proxy every 30 seconds
if (!window.__exposureGreeksListenerBound) {
  window.addEventListener('message', (event) => {
    try {
      const msg = event.data;
      // Normalize msg to snapshot object (handles both string and object formats)
      let snapshot = null;
      if (typeof msg === 'string') {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'GREEKS_INTRADAY' && parsed.data) snapshot = parsed.data;
        } catch (_) {}
      } else if (msg && msg.type === 'GREEKS_INTRADAY' && msg.data) {
        snapshot = msg.data;
      }
      if (snapshot) {
        // updateGreeksDisplay normalizes scale and handles history — don't push raw values here
        updateGreeksDisplay(snapshot);
        renderGreekSparklines();
      }
    } catch (e) {}
  });
  window.__exposureGreeksListenerBound = true;
}

if (window.PageRuntime?.register) {
  window.PageRuntime.register('exposure', () => {
    if (window.__exposureLiveTickInterval) {
      clearInterval(window.__exposureLiveTickInterval);
      window.__exposureLiveTickInterval = null;
    }
    if (window.__exposureClockInterval) {
      clearInterval(window.__exposureClockInterval);
      window.__exposureClockInterval = null;
    }
    if (window.__exposureRvolInterval) {
      clearInterval(window.__exposureRvolInterval);
      window.__exposureRvolInterval = null;
    }
    if (window.__exposureGreeksInterval) {
      clearInterval(window.__exposureGreeksInterval);
      window.__exposureGreeksInterval = null;
    }
  });
}
