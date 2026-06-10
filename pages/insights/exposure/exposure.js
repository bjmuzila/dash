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
        'font-size:11px',
        'font-weight:800',
        'font-family:monospace',
        'white-space:nowrap',
        'padding-top:1px',
        'flex-shrink:0'
      ].join(';');
      badge.textContent = s.time;
      const text = document.createElement('span');
      text.style.cssText = [
        'font-size:12px',
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

function normalizeExposureToRaw(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) < 1e6 ? n * 1e9 : n;
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
  const gex = normalizeExposureToRaw(record?.gex ?? record?.netGEX ?? record?.totalGEX);
  const dex = normalizeExposureToRaw(record?.dex ?? record?.netDEX ?? record?.totalDEX);
  const chex = normalizeExposureToRaw(record?.chex ?? record?.netCHEX ?? record?.totalCHEX);
  const vex = normalizeExposureToRaw(record?.vex ?? record?.netVEX ?? record?.totalVEX);
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
    setExposureBtnState(btn, '...', '#ffb300');
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
    setExposureBtnState(btn, '...', '#ffb300');
    btn.style.opacity = '0.75';
  }
  if (mainTitle) mainTitle.textContent = 'Exposure Stack';
  if (loading) loading.style.display = 'none';
  if (gexValue) gexValue.textContent = formatExposureValue(values.gex, 'B');
  if (dexValue) dexValue.textContent = formatExposureValue(values.dex, 'B');
  if (chexValue) chexValue.textContent = formatExposureValue(values.chex, 'M');
  if (vexValue) vexValue.textContent = formatExposureValue(values.vex, 'M');
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
  // Push a signal into the live feed with buy/sell breakdown
  if (typeof window.pushSignal === 'function') {
    const dominant = buyPct >= sellPct ? 'Buy' : 'Sell';
    const dominantPct = dominant === 'Buy' ? buyPct : sellPct;
    const gexDesc = values.gex >= 0
      ? 'dealers long gamma, vol suppressed'
      : 'dealers short gamma, momentum risk elevated';
    const signalText = `${pressureStr} — ${dominantPct}% ${dominant} pressure dominant. GEX ${values.gex >= 0 ? '+' : ''}${(values.gex / 1e9).toFixed(2)}B, ${gexDesc}.`;
    const signalColor = dominant === 'Buy' ? '#00e676' : '#ff5b5b';
    window.pushSignal(signalText, signalColor);
  }
  updateRelativeVolumeCard(when);
  if (dexVelocity) dexVelocity.textContent = Number(values.dex) >= 0 ? '↗ Increasing' : '↘ Decreasing';
  if (analysisGamma) analysisGamma.textContent = Number(values.gex) >= 0 ? 'LONG GAMMA' : 'SHORT GAMMA';
  if (analysisDelta) analysisDelta.textContent = Number(values.dex) >= 0 ? 'BULLISH' : 'BEARISH';
  const stamp = when;
  if (analysisVelocityTime) analysisVelocityTime.textContent = `Updated ${stamp}`;
  if (analysisGammaTime) analysisGammaTime.textContent = `Updated ${stamp}`;
  if (analysisDeltaTime) analysisDeltaTime.textContent = `Updated ${stamp}`;
  if (!window.__insightsGreekHistory) window.__insightsGreekHistory = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
  const hist = window.__insightsGreekHistory;
  const stampKey = Math.floor(Date.now() / 30000);
  if (hist._lastStamp !== stampKey) {
    hist._lastStamp = stampKey;
    hist.gex.push({ ts: Date.now(), value: values.gex });
    hist.dex.push({ ts: Date.now(), value: values.dex });
    hist.chex.push({ ts: Date.now(), value: values.chex });
    hist.vex.push({ ts: Date.now(), value: values.vex });
    hist.gexvex.push({ ts: Date.now(), value: values.gex + values.vex });
    ['gex', 'dex', 'chex', 'vex', 'gexvex'].forEach((k) => {
      if (hist[k].length > 96) hist[k].shift();
    });
  }
  renderGreekSparklines();
  if ([values.gex, values.dex, values.chex, values.vex].every((v) => Number.isFinite(Number(v)))) {
    persistExposureStackToDB(values.gex, values.dex, values.chex, values.vex, Number(window.__lastExposureBuyScore || 0), Number(window.__lastExposureSellScore || 0));
  }
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

// ── Live intraday 15m bucket accumulator ────────────────────────────────────
// Accumulates dxTradeCache dayVolume samples into 15-min buckets for today.
// Structure: { 'YYYY-MM-DD-HH:MM': { slotMin, vol, lastDayVol } }
if (!window.__rvolIntradayBuckets) window.__rvolIntradayBuckets = {};
if (!window.__rvolLastDayVol) window.__rvolLastDayVol = 0;

function tickRvolFromLiveVolume(dayVolume) {
  if (!dayVolume || dayVolume <= 0) return;
  const todayStr = getTodayEtStr();
  const etNow = getNowEt();
  const mins = etMinutesOf(etNow);
  // Round down to nearest 15-min slot
  const slotMin = Math.floor(mins / 15) * 15;
  const slotKey = `${todayStr}-${String(Math.floor(slotMin / 60)).padStart(2,'0')}:${String(slotMin % 60).padStart(2,'0')}`;

  // Detect volume increases only (dayVolume is cumulative within the session)
  const prev = window.__rvolLastDayVol || 0;
  if (dayVolume > prev) {
    window.__rvolLastDayVol = dayVolume;
    const existing = window.__rvolIntradayBuckets[slotKey];
    if (existing) {
      existing.vol = dayVolume - (existing.baseVol || 0);
      existing.cumVol = dayVolume;
    } else {
      // New slot: record baseline as cumulative from prior slots
      const priorCum = Object.values(window.__rvolIntradayBuckets)
        .filter(b => b.slotMin < slotMin && b.date === todayStr)
        .reduce((s, b) => Math.max(s, b.cumVol || 0), 0);
      window.__rvolIntradayBuckets[slotKey] = {
        date: todayStr, slotMin, slotKey,
        baseVol: priorCum || prev,
        vol: dayVolume - (priorCum || prev),
        cumVol: dayVolume
      };
    }
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

  // 2. Session timing — all in ET
  const etNow = getNowEt();
  const etMins = etMinutesOf(etNow);
  const SESSION_OPEN_MIN  = 9 * 60;   // 9:00 ET
  const SESSION_CLOSE_MIN = 16 * 60;  // 16:00 ET
  const sessionTotalMins  = SESSION_CLOSE_MIN - SESSION_OPEN_MIN; // 420 min
  const elapsedMins = Math.max(1, Math.min(etMins, SESSION_CLOSE_MIN) - SESSION_OPEN_MIN);
  const pace    = Math.max(0.001, elapsedMins / sessionTotalMins);
  const pctVal  = Math.max(0, Math.min(100, Math.round(pace * 100)));
  const estTime = etNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET';

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
        if (slotMins < SESSION_OPEN_MIN || slotMins > SESSION_OPEN_MIN + elapsedMins) continue;
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
  if (descEl)        descEl.textContent        = dayVolume > 0 ? `ES session volume tracking live. Updated ${when}.` : 'Waiting on ES volume data from dxLink.';
  if (todayVolEl)    todayVolEl.textContent    = dayVolume > 0 ? dayVolume.toLocaleString() : '—';
  if (expectedAvgEl) expectedAvgEl.textContent = expectedAvg > 0 ? expectedAvg.toLocaleString() : '—';
  if (paceEl)        paceEl.textContent        = `${pctVal}%`;
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

  const SESSION_START = 9 * 60;   // 9:00 ET in minutes
  const SESSION_END   = 16 * 60;  // 16:00 ET in minutes
  const SESSION_SPAN  = SESSION_END - SESSION_START; // 420 min
  const todayStr = getTodayEtStr();

  // ── 1. Build today's cumulative curve ────────────────────────────────────
  // Primary: live intraday buckets from tickRvolFromLiveVolume()
  // Fallback: DB candles for today
  let todaySlots = []; // [{min, vol}]

  const liveBuckets = Object.values(window.__rvolIntradayBuckets || {})
    .filter(b => b.date === todayStr && b.slotMin >= SESSION_START && b.slotMin <= SESSION_END)
    .sort((a, b) => a.slotMin - b.slotMin);

  if (liveBuckets.length > 0) {
    // Use cumVol of last bucket as the running total — build cumulative from that
    // Each bucket stores the cumulative day volume at that slot
    let prevCum = 0;
    for (const b of liveBuckets) {
      const slotVol = b.cumVol > prevCum ? b.cumVol - prevCum : Number(b.vol || 0);
      todaySlots.push({ min: b.slotMin, vol: slotVol });
      prevCum = b.cumVol || prevCum + slotVol;
    }
  } else {
    // Try DB candles for today
    try {
      if (await ensureDBReady() && DB?.queryES15mCandles) {
        const records = await DB.queryES15mCandles(1);
        for (const r of records) {
          if (r.date !== todayStr) continue;
          const slotMin = _slotMinFromRecord(r);
          if (slotMin === null || slotMin < SESSION_START || slotMin > SESSION_END) continue;
          todaySlots.push({ min: slotMin, vol: Number(r.volume || 0) });
        }
        todaySlots.sort((a, b) => a.min - b.min);
      }
    } catch (_) {}
  }

  // Build cumulative — always anchor at session open (0 vol) so single-point still draws a line
  const nowEtMin = etMinutesOf(getNowEt());
  const todayCumulative = [{ min: SESSION_START, cum: 0 }];
  let cum = 0;
  for (const s of todaySlots) {
    cum += s.vol;
    todayCumulative.push({ min: s.min, cum });
  }
  // Extend last point to current ET minute so the line reaches "now"
  if (todayCumulative.length > 1 && nowEtMin >= SESSION_START && nowEtMin <= SESSION_END) {
    const lastMin = todayCumulative[todayCumulative.length - 1].min;
    if (nowEtMin > lastMin) {
      todayCumulative.push({ min: nowEtMin, cum });
    }
  }

  // ── 2. Build historical avg cumulative from DB prior days ────────────────
  const slotVolumes = {}; // slotMin → [vol per prior day]
  const dayVolumes = {}; // date → slotMin → cum vol at that slot
  try {
    if (await ensureDBReady() && DB?.queryES15mCandles) {
      const hist = await DB.queryES15mCandles(10);
      for (const r of hist) {
        if (r.date === todayStr) continue;
        const slotMin = _slotMinFromRecord(r);
        if (slotMin === null || slotMin < SESSION_START || slotMin > SESSION_END) continue;
        const date = r.date;
        if (!dayVolumes[date]) dayVolumes[date] = {};
        dayVolumes[date][slotMin] = Number(r.volume || 0);
      }
      // For each date, convert to cumulative and flatten into per-slot volumes
      for (const [date, slotVols] of Object.entries(dayVolumes)) {
        const slots = Object.keys(slotVols).map(Number).sort((a, b) => a - b);
        let cum = 0;
        for (const slot of slots) {
          cum += slotVols[slot];
          if (!slotVolumes[slot]) slotVolumes[slot] = [];
          slotVolumes[slot].push(cum);
        }
      }
    }
  } catch (_) {}

  const allSlots = [...new Set(Object.keys(slotVolumes).map(Number))].sort((a, b) => a - b);
  const avgCumulative = [];
  for (const slot of allSlots) {
    const cums = slotVolumes[slot];
    const avgCum = cums.reduce((s, v) => s + v, 0) / cums.length;
    avgCumulative.push({ min: slot, cum: avgCum });
  }

  // ── 3. Draw ──────────────────────────────────────────────────────────────
  if (!todayCumulative.length && !avgCumulative.length) {
    drawRvolFallback(ctx, width, height, dpr);
    return;
  }

  const pad = { left: 4 * dpr, right: 4 * dpr, top: 6 * dpr, bottom: 6 * dpr };
  const chartW = width  - pad.left - pad.right;
  const chartH = height - pad.top  - pad.bottom;

  const allCums = [
    ...todayCumulative.map(p => p.cum),
    ...avgCumulative.map(p => p.cum)
  ];
  const maxCum = Math.max(1, ...allCums);

  // Map ET-minutes to canvas x; cumulative volume to canvas y
  const toXY = (minVal, cumVal) => ({
    x: pad.left + ((Math.min(SESSION_END, Math.max(SESSION_START, minVal)) - SESSION_START) / SESSION_SPAN) * chartW,
    y: pad.top  + (1 - cumVal / maxCum) * chartH
  });

  function drawLine(points, color, dashed, lineWidth) {
    if (points.length < 2) return;
    ctx.save();
    ctx.lineWidth  = (lineWidth || 1.5) * dpr;
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';
    ctx.strokeStyle = color;
    if (dashed) ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();
  }

  // Avg line (dashed, muted)
  if (avgCumulative.length >= 2) {
    drawLine(avgCumulative.map(p => toXY(p.min, p.cum)), 'rgba(255,255,255,0.30)', true, 1.2);
  }

  // Today line + fill
  if (todayCumulative.length >= 1) {
    const todayPts = todayCumulative.map(p => toXY(p.min, p.cum));
    const baseY = pad.top + chartH;

    // Gradient fill
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

    // Line
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

    // Dot at latest point
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
  setExposureBtnState(btn, '...', '#ffb300');
  try {
    if (typeof html2canvas === 'undefined') throw new Error('html2canvas not loaded');
    const canvas = await html2canvas(target, {
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
  setExposureBtnState(btn, '...', '#ffb300');
  if (platform === 'x') {
    setTimeout(() => {
      pulseExposureBtn(btn, original, originalColor, true);
      window.open('https://twitter.com/intent/tweet?text=SPX+Exposure+Stack', '_blank');
    }, 250);
    return;
  }
  try {
    if (typeof html2canvas === 'undefined') throw new Error('html2canvas not loaded');
    const target = document.getElementById('exposure-data-boxes') || document.getElementById('page-insights-exposure');
    if (!target) throw new Error('Missing exposure target');
    const canvas = await html2canvas(target, {
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

function seedES15mCandlesInBackground() {
  if (window.__es15mSeeded) return;
  window.__es15mSeeded = true;
  (async () => {
    try {
      if (!(await ensureDBReady()) || !DB?.queryES15mCandles || !DB?.saveES15mCandle) return;
      // Try dxlink candles endpoint (may 503 if history channel not ready — retry once)
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 5000));
        try {
          const start = Date.now() - 10 * 24 * 60 * 60 * 1000;
          const resp = await fetch(`/proxy/api/dxlink/candles?symbol=${encodeURIComponent('/ES{=15m}')}&start=${start}&count=480`);
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
            try { await DB.saveES15mCandle({ timestamp: ts, date, slotKey, open: Number(candle.open||0), high: Number(candle.high||0), low: Number(candle.low||0), close: Number(candle.close||0), volume: Number(candle.volume||0) }); } catch (_) {}
          }
          const when = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          updateRelativeVolumeCard(when);
          return; // success
        } catch (_) {}
      }
    } catch (_) {}
  })();
}

function resetRvolIntradayBucketsIfNewDay() {
  const today = getTodayEtStr();
  const bucketDates = new Set(Object.values(window.__rvolIntradayBuckets || {}).map(b => b.date));
  if (bucketDates.size > 0 && !bucketDates.has(today)) {
    // All existing buckets are from prior days — clear for the new day
    window.__rvolIntradayBuckets = {};
    window.__rvolLastDayVol = 0;
  }
}

function initInsightsExposure() {
  // Reset intraday RVOL buckets if we're on a new trading day
  resetRvolIntradayBucketsIfNewDay();

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
  if (!db || typeof db.queryGreeksTimeSeries_Today !== 'function') {
    return;
  }
  window.__insightsGreekHistoryLoading = true;
  try {
    if (!db.db && typeof db.init === 'function') {
      await db.init().catch(() => null);
    }
    let records = await db.queryGreeksTimeSeries_Today('').catch(() => []);
    if (!Array.isArray(records) || !records.length) {
      if (typeof db.queryGreeksTimeSeries_Hours === 'function') {
        records = await db.queryGreeksTimeSeries_Hours(72, '').catch(() => []);
      }
    }
    if ((!Array.isArray(records) || !records.length) && typeof db._getAllRecords === 'function') {
      records = await db._getAllRecords('greeksTimeSeries').catch(() => []);
    }
    if (!Array.isArray(records) || !records.length) return;
    const history = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
    records
      .slice()
      .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0))
      .forEach((record) => {
        const normalized = normalizeExposureFromRecord(record);
        if (!normalized) return;
        const ts = normalized.ts;
        if (Number.isFinite(normalized.gex)) history.gex.push({ ts, value: normalized.gex });
        if (Number.isFinite(normalized.dex)) history.dex.push({ ts, value: normalized.dex });
        if (Number.isFinite(normalized.chex)) history.chex.push({ ts, value: normalized.chex });
        if (Number.isFinite(normalized.vex)) history.vex.push({ ts, value: normalized.vex });
        if (Number.isFinite(normalized.gex) || Number.isFinite(normalized.vex)) {
          history.gexvex.push({ ts, value: (Number.isFinite(normalized.gex) ? normalized.gex : 0) + (Number.isFinite(normalized.vex) ? normalized.vex : 0) });
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
  // Build timestamps anchored to today's session (9:00am ET → now), spaced 30 min apart
  // so the sparkline x-axis renders correctly against real wall clock
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etOffsetMs = nowEt.getTime() - new Date().getTime();
  const sessionOpen = new Date(nowEt);
  sessionOpen.setHours(9, 0, 0, 0);
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
  const pad = { left: 12 * dpr, right: 10 * dpr, top: 8 * dpr, bottom: 14 * dpr };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  // ── Pin x-axis to 9:00am–4:00pm ET wall clock ──
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const sessionOpenEt = new Date(nowEt);
  sessionOpenEt.setHours(9, 0, 0, 0);
  const sessionCloseEt = new Date(nowEt);
  sessionCloseEt.setHours(16, 0, 0, 0);
  // Convert ET boundary back to UTC ms for comparison with stored timestamps
  const etOffsetMs = nowEt.getTime() - new Date().getTime(); // approx ET offset
  const sessionOpenMs = sessionOpenEt.getTime() - etOffsetMs;
  const sessionCloseMs = sessionCloseEt.getTime() - etOffsetMs;
  const tsRange = Math.max(1, sessionCloseMs - sessionOpenMs);

  const ordered = (Array.isArray(data) ? data : [])
    .map((d) => ({ ts: Number(d?.ts || d?.timestamp || 0), value: Number(d?.value ?? d) }))
    .filter((d) => Number.isFinite(d.ts) && Number.isFinite(d.value) && d.ts > 1000)
    .sort((a, b) => a.ts - b.ts);
  if (!ordered.length) return;

  // Filter to session window only (allow a small buffer for pre-market mock seeds)
  const sessionPts = ordered.filter(d => d.ts >= sessionOpenMs - 15 * 60 * 1000 && d.ts <= sessionCloseMs + 5 * 60 * 1000);
  const pts_src = sessionPts.length >= 2 ? sessionPts : ordered;

  // ── Remove outliers using IQR method ──
  const values = pts_src.map((d) => d.value);
  const sortedVals = [...values].sort((a, b) => a - b);
  const q1 = sortedVals[Math.floor(sortedVals.length * 0.25)];
  const q3 = sortedVals[Math.floor(sortedVals.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  const filteredPts = pts_src.filter(p => p.value >= lowerBound && p.value <= upperBound);
  const filteredValues = filteredPts.length > 0 ? filteredPts.map(p => p.value) : values;
  const positivesOnly = filteredValues.every((n) => n >= 0);
  const negativesOnly = filteredValues.every((n) => n <= 0);
  const min = Math.min(...filteredValues);
  const max = Math.max(...filteredValues);
  const range = max - min || Math.max(1, Math.abs(max) * 0.01);

  // Use real wall-clock x position relative to session window
  const tsxOf = (ts) => pad.left + Math.max(0, Math.min(1, (ts - sessionOpenMs) / tsRange)) * chartW;

  const pts = filteredPts.map((d) => ({
    x: tsxOf(d.ts),
    y: pad.top + (1 - ((d.value - min) / range)) * chartH
  }));

  if (pts.length === 0) return; // No valid points after filtering

  ctx.save();
  ctx.lineWidth = 2 * dpr;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 * dpr;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  const lastPoint = pts[pts.length - 1];
  ctx.stroke();
  ctx.restore();

  const grad = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  const fillColor = color.startsWith('rgb(') ? color.replace('rgb(', 'rgba(').replace(')', ', 0.22)') : 'rgba(255,255,255,0.22)';
  grad.addColorStop(0, fillColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  const baseline = positivesOnly ? height - pad.bottom : negativesOnly ? pad.top : height - pad.bottom;
  ctx.moveTo(pts[0].x, baseline);
  for (let i = 0; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineTo(lastPoint.x, baseline);
  ctx.closePath();
  ctx.fill();

  // Dot at current position
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 * dpr;
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 3 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Time axis labels: 9:00, 10:30, 12:00, 1:30, 3:00, 4:00
  const tickTimes = [
    { label: '9AM', offsetMin: 0 },
    { label: '10:30', offsetMin: 90 },
    { label: '12PM', offsetMin: 180 },
    { label: '1:30', offsetMin: 270 },
    { label: '3PM', offsetMin: 360 },
    { label: '4PM', offsetMin: 420 }
  ];
  ctx.fillStyle = '#94a3b8';
  ctx.font = `${7.5 * dpr}px Arial`;
  ctx.textBaseline = 'bottom';
  const labelY = height - 1 * dpr;
  tickTimes.forEach(({ label, offsetMin }) => {
    const x = pad.left + (offsetMin / 420) * chartW;
    ctx.textAlign = offsetMin === 0 ? 'left' : offsetMin === 420 ? 'right' : 'center';
    ctx.fillText(label, x, labelY);
  });
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
  if (typeof window.pushSignal === 'function') {
    let note = regime.desc;
    let noteColor = regime.badge || '#00e5ff';
    if (Math.abs(dexVelocity) >= 15) {
      note = `Rapid DEX velocity surge. ${dexVelocity > 0 ? 'Buying chase' : 'Selling chase'} active.`;
      noteColor = dexVelocity > 0 ? '#00e676' : '#ff5b5b';
    } else if (gex > 0 && gex >= 0.65) {
      note = 'High positive GEX — dealers suppressing volatility. Range compression in effect.';
      noteColor = '#00e676';
    } else if (gex > 0 && gex < 0.35) {
      note = 'GEX positive but drifting lower. Dealer support weakening — watch for range expansion.';
      noteColor = '#ffb300';
    } else if (gex < 0 && gex < -0.35) {
      note = 'Deep negative gamma — dealers selling weakness. Momentum breakout conditions elevated.';
      noteColor = '#ff5b5b';
    } else if (dex > 0 && dex > 0.75) {
      note = 'Upside delta pressure elevated. Resistance likely at key supply levels.';
      noteColor = '#00b4ff';
    } else if (dex < 0 && dex < -0.25) {
      note = 'Downside delta pressure heavy. Short-covering can appear aggressively on a bid.';
      noteColor = '#ff9800';
    }
    window.pushSignal(`[${regime.name}] ${note}`, noteColor);
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
  const stampKey = Math.floor(incomingTs / 30000);
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
  if (Number.isFinite(snap.gex)) {
    const gexEl = getExposureValueEl('gex');
    if (gexEl) gexEl.textContent = formatExposureValue(snap.gex, 'B');
  }
  if (Number.isFinite(snap.dex)) {
    const dexEl = getExposureValueEl('dex');
    if (dexEl) dexEl.textContent = formatExposureValue(snap.dex, 'B');
  }
  if (Number.isFinite(snap.chex)) {
    const chexEl = getExposureValueEl('chex');
    if (chexEl) chexEl.textContent = formatExposureValue(snap.chex, 'M');
  }
  if (Number.isFinite(snap.vex)) {
    const vexEl = getExposureValueEl('vex');
    if (vexEl) vexEl.textContent = formatExposureValue(snap.vex, 'M');
  }
  persistExposureStackToDB(snap.gex ?? 0, snap.dex ?? 0, snap.chex ?? 0, snap.vex ?? 0, Number(snap.buyScore || 0), Number(snap.sellScore || 0), Number(snap.price || 0));
  requestAnimationFrame(() => renderGreekSparklines());
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
      if (typeof msg === 'string') {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'GREEKS_INTRADAY' && parsed.data) {
          const snapshot = parsed.data;
          // Update history with new snapshot
          if (!window.__insightsGreekHistory) window.__insightsGreekHistory = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
          const hist = window.__insightsGreekHistory;
          if (snapshot.gex !== undefined) hist.gex.push({ ts: snapshot.ts, value: snapshot.gex });
          if (snapshot.dex !== undefined) hist.dex.push({ ts: snapshot.ts, value: snapshot.dex });
          if (snapshot.chex !== undefined) hist.chex.push({ ts: snapshot.ts, value: snapshot.chex });
          if (snapshot.vex !== undefined) hist.vex.push({ ts: snapshot.ts, value: snapshot.vex });
          if (snapshot.gex !== undefined || snapshot.vex !== undefined) {
            hist.gexvex.push({ ts: snapshot.ts, value: (snapshot.gex || 0) + (snapshot.vex || 0) });
          }
          // Keep max 800 points (~6.5 hours at 30s intervals)
          ['gex', 'dex', 'chex', 'vex', 'gexvex'].forEach(k => {
            if (hist[k].length > 800) hist[k].shift();
          });
          // Update display with latest snapshot
          updateGreeksDisplay(snapshot);
          persistExposureStackToDB(snapshot.gex ?? 0, snapshot.dex ?? 0, snapshot.chex ?? 0, snapshot.vex ?? 0, Number(snapshot.buyScore || 0), Number(snapshot.sellScore || 0), Number(snapshot.price || 0));
          // Re-render sparklines
          renderGreekSparklines();
        }
      } else if (msg && msg.type === 'GREEKS_INTRADAY' && msg.data) {
        const snapshot = msg.data;
        // Update history
        if (!window.__insightsGreekHistory) window.__insightsGreekHistory = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
        const hist = window.__insightsGreekHistory;
        if (snapshot.gex !== undefined) hist.gex.push({ ts: snapshot.ts, value: snapshot.gex });
        if (snapshot.dex !== undefined) hist.dex.push({ ts: snapshot.ts, value: snapshot.dex });
        if (snapshot.chex !== undefined) hist.chex.push({ ts: snapshot.ts, value: snapshot.chex });
        if (snapshot.vex !== undefined) hist.vex.push({ ts: snapshot.ts, value: snapshot.vex });
        if (snapshot.gex !== undefined || snapshot.vex !== undefined) {
          hist.gexvex.push({ ts: snapshot.ts, value: (snapshot.gex || 0) + (snapshot.vex || 0) });
        }
        // Keep max 800 points
        ['gex', 'dex', 'chex', 'vex', 'gexvex'].forEach(k => {
          if (hist[k].length > 800) hist[k].shift();
        });
        // Update display
        updateGreeksDisplay(snapshot);
        persistExposureStackToDB(snapshot.gex ?? 0, snapshot.dex ?? 0, snapshot.chex ?? 0, snapshot.vex ?? 0, Number(snapshot.buyScore || 0), Number(snapshot.sellScore || 0), Number(snapshot.price || 0));
        // Re-render sparklines
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
