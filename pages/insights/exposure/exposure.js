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

async function fetchLatestExposureSnapshot() {
  try {
    const resp = await fetch('/proxy/api/greeks-intraday', { cache: 'no-store' });
    if (!resp.ok) return null;
    const payload = await resp.json();
    const records = Array.isArray(payload?.records) ? payload.records : [];
    if (!records.length) return null;
    const latest = records[records.length - 1];
    if (!latest) return null;
    const snapshot = {
      gex: Number(latest.gex || 0),
      dex: Number(latest.dex || 0),
      chex: Number(latest.chex || 0),
      vex: Number(latest.vex || 0),
      buyScore: Number(latest.buyPct || latest.buyScore || 0),
      sellScore: Number(latest.sellScore || 0),
      price: Number(latest.spot || latest.price || 0),
      ts: Number(latest.ts || Date.now())
    };
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
    const snapshot = {
      gex: Number(latest.gex ?? latest.netGEX ?? latest.totalGEX ?? NaN),
      dex: Number(latest.dex ?? latest.netDEX ?? latest.totalDEX ?? NaN),
      chex: Number(latest.chex ?? latest.netCHEX ?? latest.totalCHEX ?? NaN),
      vex: Number(latest.vex ?? latest.netVEX ?? latest.totalVEX ?? NaN),
      buyScore: Number(latest.buyScore || 0),
      sellScore: Number(latest.sellScore || 0),
      price: Number(latest.price || 0),
      ts: Number(latest.timestamp || Date.now())
    };
    if (![snapshot.gex, snapshot.dex, snapshot.chex, snapshot.vex].every(Number.isFinite)) return null;
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
  const pressureNote = document.getElementById('pressure-note');
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
  if (pressureValue) pressureValue.textContent = values.gex >= 0 ? '39% Buy / 61% Sell' : '61% Buy / 39% Sell';
  if (pressureBalance) pressureBalance.textContent = values.gex >= 0 ? '39%' : '61%';
  if (pressureBar) pressureBar.style.width = values.gex >= 0 ? '39%' : '61%';
  if (pressureNote) pressureNote.textContent = values.gex >= 0
    ? 'Building institutional read from the latest dealer-hedging inputs.'
    : 'Hedging flows are leaning into downside pressure right now.';
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

function getEsVolumeSnapshot() {
  const esKeys = ['/ES:XCME', '/ESM26', '/ES'];
  // Client-side dxQuoteCache has Trade events merged in (dayVolume lives there)
  // dxSummaryCache also has dayVolume from Summary events
  const cached = esKeys
    .map(k => window.dxQuoteCache?.[k])
    .find(v => v?.dayVolume > 0) || {};
  const summaryCached = esKeys
    .map(k => window.dxSummaryCache?.[k])
    .find(v => v?.dayVolume > 0) || {};
  const alt =
    window.quotesData?.['/ESM26']?.quote ||
    window.quotesData?.['/ES:XCME']?.quote ||
    window.quotesData?.['/ES']?.quote ||
    window.AppState?.esQuote ||
    {};
  const dayVolume = Number(
    cached.dayVolume ??
    cached.totalVolume ??
    cached.volume ??
    summaryCached.dayVolume ??
    summaryCached.totalVolume ??
    summaryCached.volume ??
    alt.totalVolume ??
    alt.dayVolume ??
    alt.volume ??
    alt['day-volume'] ??
    0
  ) || 0;
  return { source: { ...alt, ...summaryCached, ...cached }, dayVolume };
}

async function ensureDBReady() {
  if (typeof DB === 'undefined') return false;
  if (DB.db) return true;
  try { await DB.init(); return !!DB.db; } catch (e) { return false; }
}

async function getEsDayVolumeFromDB() {
  try {
    if (!(await ensureDBReady()) || !DB?.queryES15mCandles) return 0;
    const _et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayEt = `${_et.getFullYear()}-${String(_et.getMonth()+1).padStart(2,'0')}-${String(_et.getDate()).padStart(2,'0')}`;
    const records = await DB.queryES15mCandles(1); // last 1 day
    const todayCandles = records.filter(r => r.date === todayEt);
    if (!todayCandles.length) return 0;
    return todayCandles.reduce((sum, r) => sum + Number(r.volume || 0), 0);
  } catch (e) {
    return 0;
  }
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
  let { dayVolume } = getEsVolumeSnapshot();
  if (!dayVolume) {
    // Race server API and DB in parallel - take whichever returns first with a value
    const [serverVol, dbVol] = await Promise.all([getEsDayVolumeFromServer(), getEsDayVolumeFromDB()]);
    dayVolume = serverVol || dbVol;
  }
  if (!dayVolume && window.dxQuoteCache) {
    const fallbackVol = ['/ES:XCME', '/ESM26', '/ES']
      .map((k) => window.dxQuoteCache?.[k])
      .find((v) => Number(v?.dayVolume || v?.totalVolume || v?.volume || 0) > 0);
    dayVolume = Number(fallbackVol?.dayVolume || fallbackVol?.totalVolume || fallbackVol?.volume || 0);
  }
  if (!dayVolume && window.dxSummaryCache) {
    const fallbackVol = ['/ES:XCME', '/ESM26', '/ES']
      .map((k) => window.dxSummaryCache?.[k])
      .find((v) => Number(v?.dayVolume || v?.totalVolume || v?.volume || 0) > 0);
    dayVolume = Number(fallbackVol?.dayVolume || fallbackVol?.totalVolume || fallbackVol?.volume || 0);
  }

  // Re-fetch elements by ID after async gap so we never write to detached nodes
  const valueEl      = document.getElementById('rvol-value');
  const descEl       = document.getElementById('rvol-desc');
  const todayVolEl   = document.getElementById('rvol-today-vol');
  const expectedAvgEl= document.getElementById('rvol-expected-avg');
  const paceEl       = document.getElementById('rvol-session-pace');
  const timeEl       = document.getElementById('rvol-time');
  const liveClock    = document.getElementById('rvol-live-clock');
  const pacePct      = document.getElementById('rvol-pace-pct');
  const paceBar      = document.getElementById('rvol-pace-bar');

  const now = new Date();
  const sessionOpen  = new Date(now); sessionOpen.setHours(9, 30, 0, 0);
  const sessionClose = new Date(now); sessionClose.setHours(16, 0, 0, 0);
  const elapsed   = Math.max(1, Math.min(now.getTime(), sessionClose.getTime()) - sessionOpen.getTime());
  const sessionMs = Math.max(1, sessionClose.getTime() - sessionOpen.getTime());
  const pace      = Math.max(0.001, elapsed / sessionMs);
  const pctVal    = Math.max(0, Math.min(100, Math.round(pace * 100)));
  const estTime   = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' }) + ' EST';

  // RVOL: compare today's cumulative vol against historical average at this time of day (from DB)
  // For now use pace-projected average as baseline until historical avg is available
  let rvol = 1.0;
  let expectedAvg = 0;
  if (dayVolume > 0) {
    // Get historical avg from DB candles for context
    let histAvgAtPace = 0;
    try {
      if ((await ensureDBReady()) && DB?.queryES15mCandles) {
        const hist = await DB.queryES15mCandles(10);
        const _et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const todayStr = `${_et.getFullYear()}-${String(_et.getMonth()+1).padStart(2,'0')}-${String(_et.getDate()).padStart(2,'0')}`;
        // For each prior day, sum volume up to the equivalent elapsed time slot
        const elapsedMs = elapsed;
        const sessionStartMs = sessionOpen.getTime();
        const byDay = {};
        for (const r of hist) {
          if (r.date === todayStr) continue;
          const ts = Number(r.timestamp || 0);
          const dayElapsed = ts - (new Date(ts).setHours(9, 30, 0, 0));
          if (dayElapsed <= elapsedMs) {
            byDay[r.date] = (byDay[r.date] || 0) + Number(r.volume || 0);
          }
        }
        const dayVols = Object.values(byDay).filter(v => v > 0);
        if (dayVols.length) histAvgAtPace = dayVols.reduce((a, b) => a + b, 0) / dayVols.length;
      }
    } catch (e) {}
    expectedAvg = histAvgAtPace || Math.round(dayVolume / pace);
    rvol = expectedAvg > 0 ? dayVolume / expectedAvg : 1.0;
  }

  const rvolStr = dayVolume > 0 ? rvol.toFixed(2) : '—';
  if (valueEl) valueEl.innerHTML = `<span>${dayVolume > 0 ? rvolStr + 'x' : '—'}</span><span style="font-size:10px;font-family:system-ui,sans-serif;color:#ffd0d0;background:rgba(255,91,91,.14);border:1px solid rgba(255,91,91,.45);padding:3px 8px;border-radius:4px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">ACTIVE</span>`;
  if (descEl) descEl.textContent = dayVolume > 0 ? `ES session volume tracking live. Updated ${when}.` : 'Waiting on ES volume data.';
  if (todayVolEl)    todayVolEl.textContent    = dayVolume ? dayVolume.toLocaleString() : '—';
  if (expectedAvgEl) expectedAvgEl.textContent = expectedAvg ? expectedAvg.toLocaleString() : '—';
  if (paceEl)    paceEl.textContent    = `${pctVal}%`;
  if (timeEl)    timeEl.textContent    = when;
  if (liveClock) liveClock.textContent = estTime;
  if (pacePct)   pacePct.textContent   = `${pctVal}%`;
  if (paceBar)   paceBar.style.width   = `${pctVal}%`;
  requestAnimationFrame(() => drawRelativeVolumeSparkline());
}

async function drawRelativeVolumeSparkline() {
  const canvas = document.getElementById('greeks-rvol-sparkline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    setTimeout(() => drawRelativeVolumeSparkline(), 100);
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

  // Load candle data from DB
  let records = [];
  try {
    if (await ensureDBReady() && DB?.queryES15mCandles) {
      records = await DB.queryES15mCandles(10);
    }
  } catch (e) {}
  if (!records.length) {
    drawRvolFallback(ctx, width, height, dpr);
    return;
  }
  if (!records.length) {
    drawRvolFallback(ctx, width, height, dpr);
    return;
  }

  const _nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayEt = `${_nowEt.getFullYear()}-${String(_nowEt.getMonth()+1).padStart(2,'0')}-${String(_nowEt.getDate()).padStart(2,'0')}`;
  const SESSION_START = 9 * 60 + 30; // 9:30 in minutes
  const SESSION_END   = 16 * 60;     // 16:00 in minutes

  // Slot key → array of per-day volumes (for avg line)
  const slotVolumes = {};
  const todaySlots = [];

  for (const r of records) {
    const slotMin = r.slotKey ? (() => {
      const parts = String(r.slotKey).split('-');
      const timePart = parts[parts.length - 1];
      const [h, m] = timePart.split(':').map(Number);
      return h * 60 + m;
    })() : (() => {
      const ts = Number(r.timestamp || r.ts || r.datetime || 0);
      if (!ts) return null;
      const dt = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      return dt.getHours() * 60 + dt.getMinutes();
    })();
    if (slotMin === null || slotMin < SESSION_START || slotMin > SESSION_END) continue;

    if (!slotVolumes[slotMin]) slotVolumes[slotMin] = [];
    if (r.date !== todayEt) slotVolumes[slotMin].push(Number(r.volume || 0));
    if (r.date === todayEt) todaySlots.push({ min: slotMin, vol: Number(r.volume || 0) });
  }

  // Sort today's candles and build cumulative curve
  todaySlots.sort((a, b) => a.min - b.min);
  const todayCumulative = [];
  let cum = 0;
  for (const s of todaySlots) {
    cum += s.vol;
    todayCumulative.push({ min: s.min, cum });
  }

  // Build avg cumulative curve using historical slot averages
  const allSlots = [...new Set(Object.keys(slotVolumes).map(Number))].sort((a, b) => a - b);
  const avgCumulative = [];
  let avgCum = 0;
  for (const slot of allSlots) {
    const vols = slotVolumes[slot];
    avgCum += vols.reduce((s, v) => s + v, 0) / vols.length;
    avgCumulative.push({ min: slot, cum: avgCum });
  }

  if (!todayCumulative.length && !avgCumulative.length) {
    drawRvolFallback(ctx, width, height, dpr);
    return;
  }

  const pad = { left: 12 * dpr, right: 10 * dpr, top: 8 * dpr, bottom: 12 * dpr };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const allCums = [...todayCumulative.map(p => p.cum), ...avgCumulative.map(p => p.cum)];
  const maxCum = Math.max(1, ...allCums);

  const toXY = (minVal, cumVal) => ({
    x: pad.left + ((minVal - SESSION_START) / (SESSION_END - SESSION_START)) * chartW,
    y: pad.top + (1 - cumVal / maxCum) * chartH
  });

  function drawLine(points, color, dashed) {
    if (!points.length) return;
    ctx.save();
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    if (dashed) ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();
  }

  // Avg line (dashed, muted)
  if (avgCumulative.length) {
    const avgPts = avgCumulative.map(p => toXY(p.min, p.cum));
    drawLine(avgPts, 'rgba(255,255,255,0.35)', true);
  }

  // Today line + fill
  if (todayCumulative.length) {
    const todayPts = todayCumulative.map(p => toXY(p.min, p.cum));

    const fill = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    fill.addColorStop(0, 'rgba(255,91,91,0.28)');
    fill.addColorStop(1, 'rgba(255,91,91,0)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(todayPts[0].x, height - pad.bottom);
    todayPts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(todayPts[todayPts.length - 1].x, height - pad.bottom);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.lineWidth = 2 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgb(255,91,91)';
    ctx.shadowColor = 'rgb(255,91,91)';
    ctx.shadowBlur = 6 * dpr;
    ctx.beginPath();
    todayPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();

    // Dot at current position
    ctx.save();
    ctx.fillStyle = '#ffd0d0';
    ctx.shadowColor = '#ff5b5b';
    ctx.shadowBlur = 8 * dpr;
    const last = todayPts[todayPts.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
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
      const existing = await DB.queryES15mCandles(1);
      if (existing.length) return; // already seeded
      const start = Date.now() - 10 * 24 * 60 * 60 * 1000;
      const resp = await fetch(`/proxy/api/dxlink/candles?symbol=${encodeURIComponent('/ES{=15m}')}&start=${start}`);
      if (!resp.ok) return;
      const payload = await resp.json();
      const candles = Array.isArray(payload?.candles) ? payload.candles : [];
      for (const candle of candles) {
        const ts = Number(candle?.datetime ?? candle?.time ?? candle?.timestamp);
        if (!ts || !Number(candle?.volume)) continue;
        const d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const slotKey = `${date}-${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        try { await DB.saveES15mCandle({ timestamp: ts, date, slotKey, open: Number(candle.open||0), high: Number(candle.high||0), low: Number(candle.low||0), close: Number(candle.close||0), volume: Number(candle.volume||0) }); } catch (_) {}
      }
      // Once seeded, refresh both the card values and the sparkline
      const when = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      updateRelativeVolumeCard(when);
    } catch (_) {}
  })();
}

function initInsightsExposure() {
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

  if (!window.__exposureSparklineResizeBound) {
    window.__exposureSparklineResizeBound = true;
    window.addEventListener('resize', () => {
      scheduleExposureSparklineRefresh();
    });
  }
}

async function hydrateGreekSparklineHistoryFromDB() {
  if (window.__insightsGreekHistoryLoading) return;
  if (typeof DB === 'undefined' || typeof DB.queryGreeksTimeSeries_Today !== 'function') {
    return;
  }
  window.__insightsGreekHistoryLoading = true;
  try {
    if (!DB.db && typeof DB.init === 'function') {
      await DB.init().catch(() => null);
    }
    let records = await DB.queryGreeksTimeSeries_Today('');
    if (!Array.isArray(records) || !records.length) {
      if (typeof DB.queryGreeksTimeSeries_Hours === 'function') {
        records = await DB.queryGreeksTimeSeries_Hours(24, '');
      }
    }
    if ((!Array.isArray(records) || !records.length) && typeof DB._getAllRecords === 'function') {
      records = await DB._getAllRecords('greeksTimeSeries').catch(() => []);
    }
    if (!Array.isArray(records) || !records.length) return;
    const history = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
    records
      .slice()
      .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0))
      .forEach((record) => {
        const ts = Number(record?.timestamp || 0);
        const gex = Number(record?.gex);
        const dex = Number(record?.dex);
        const chex = Number(record?.chex);
        const vex = Number(record?.vex);
        if (record?.source && record.source !== 'exposure-stack') return;
        if (Number.isFinite(gex)) history.gex.push({ ts, value: gex });
        if (Number.isFinite(dex)) history.dex.push({ ts, value: dex });
        if (Number.isFinite(chex)) history.chex.push({ ts, value: chex });
        if (Number.isFinite(vex)) history.vex.push({ ts, value: vex });
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
    const hasRealData = hist && ['gex','dex','chex','vex'].some(k => (hist[k] || []).length > 0);
    if (!hasRealData) {
      // No DB data — seed mock so sparklines show something until live data arrives
      seedMockGreekHistory();
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
  const mock = {
    gex: [
      { ts: 1, value: 4.92e9 }, { ts: 2, value: 4.89e9 }, { ts: 3, value: 4.95e9 },
      { ts: 4, value: 4.91e9 }, { ts: 5, value: 5.00e9 }, { ts: 6, value: 4.97e9 },
      { ts: 7, value: 5.04e9 }, { ts: 8, value: 5.02e9 }, { ts: 9, value: 5.08e9 },
      { ts: 10, value: 5.05e9 }, { ts: 11, value: 5.11e9 }, { ts: 12, value: 5.06e9 },
      { ts: 13, value: 5.15e9 }, { ts: 14, value: 5.13e9 }, { ts: 15, value: 5.18e9 },
      { ts: 16, value: 5.16e9 }
    ],
    dex: [
      { ts: 1, value: -7.75e9 }, { ts: 2, value: -7.82e9 }, { ts: 3, value: -7.70e9 },
      { ts: 4, value: -7.78e9 }, { ts: 5, value: -7.66e9 }, { ts: 6, value: -7.72e9 },
      { ts: 7, value: -7.61e9 }, { ts: 8, value: -7.68e9 }, { ts: 9, value: -7.588e9 },
      { ts: 10, value: -7.64e9 }, { ts: 11, value: -7.56e9 }, { ts: 12, value: -7.62e9 },
      { ts: 13, value: -7.53e9 }, { ts: 14, value: -7.58e9 }, { ts: 15, value: -7.50e9 },
      { ts: 16, value: -7.55e9 }
    ],
    chex: [
      { ts: 1, value: -182e6 }, { ts: 2, value: -188e6 }, { ts: 3, value: -181e6 },
      { ts: 4, value: -176e6 }, { ts: 5, value: -184e6 }, { ts: 6, value: -173e6 },
      { ts: 7, value: -178e6 }, { ts: 8, value: -170e6 }, { ts: 9, value: -171e6 },
      { ts: 10, value: -176e6 }, { ts: 11, value: -169e6 }, { ts: 12, value: -173e6 },
      { ts: 13, value: -168e6 }, { ts: 14, value: -171e6 }, { ts: 15, value: -166e6 },
      { ts: 16, value: -171e6 }
    ],
    vex: [
      { ts: 1, value: -8.1e6 }, { ts: 2, value: -8.25e6 }, { ts: 3, value: -8.0e6 },
      { ts: 4, value: -8.18e6 }, { ts: 5, value: -7.92e6 }, { ts: 6, value: -8.05e6 },
      { ts: 7, value: -7.84e6 }, { ts: 8, value: -7.98e6 }, { ts: 9, value: -7.796e6 },
      { ts: 10, value: -7.88e6 }, { ts: 11, value: -7.72e6 }, { ts: 12, value: -7.83e6 },
      { ts: 13, value: -7.65e6 }, { ts: 14, value: -7.77e6 }, { ts: 15, value: -7.61e6 },
      { ts: 16, value: -7.796e6 }
    ],
    gexvex: [
      { ts: 1, value: 4.912e9 }, { ts: 2, value: 4.862e9 }, { ts: 3, value: 4.95e9 },
      { ts: 4, value: 4.83e9 }, { ts: 5, value: 5.008e9 }, { ts: 6, value: 4.915e9 },
      { ts: 7, value: 5.028e9 }, { ts: 8, value: 4.99e9 }, { ts: 9, value: 5.072e9 },
      { ts: 10, value: 5.015e9 }, { ts: 11, value: 5.118e9 }, { ts: 12, value: 5.03e9 },
      { ts: 13, value: 5.205e9 }, { ts: 14, value: 5.09e9 }, { ts: 15, value: 5.24e9 },
      { ts: 16, value: 5.12e9 }
    ]
  };
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
  const pad = { left: 12 * dpr, right: 10 * dpr, top: 8 * dpr, bottom: 12 * dpr };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const ordered = (Array.isArray(data) ? data : [])
    .map((d) => ({ ts: Number(d?.ts || d?.timestamp || 0), value: Number(d?.value ?? d) }))
    .filter((d) => Number.isFinite(d.ts) && Number.isFinite(d.value))
    .sort((a, b) => a.ts - b.ts);
  if (!ordered.length) return;
  const values = ordered.map((d) => d.value);
  const positiveOnly = values.every((n) => n >= 0);
  const negativeOnly = values.every((n) => n <= 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, Math.abs(max) * 0.01);
  const minTs = ordered[0].ts;
  const maxTs = ordered[ordered.length - 1].ts;
  const tsRange = Math.max(1, maxTs - minTs);
  const pts = ordered.map((d) => ({
    x: pad.left + ((d.ts - minTs) / tsRange) * chartW,
    y: pad.top + (1 - ((d.value - min) / range)) * chartH
  }));
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
  ctx.lineTo(lastPoint.x, lastPoint.y);
  ctx.stroke();
  ctx.restore();

  const grad = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  const fillColor = color.startsWith('rgb(') ? color.replace('rgb(', 'rgba(').replace(')', ', 0.22)') : 'rgba(255,255,255,0.22)';
  grad.addColorStop(0, fillColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  const baseline = positiveOnly ? height - pad.bottom : negativeOnly ? pad.top : height - pad.bottom;
  ctx.moveTo(pts[0].x, baseline);
  for (let i = 0; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineTo(lastPoint.x, baseline);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 * dpr;
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 3 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#94a3b8';
  ctx.font = `${8 * dpr}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const labelY = height - 2 * dpr;
  const tickCount = Math.min(6, Math.max(2, ordered.length));
  for (let i = 0; i < tickCount; i++) {
    const rel = tickCount === 1 ? 0 : i / (tickCount - 1);
    const ts = minTs + rel * tsRange;
    const label = new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const x = pad.left + rel * chartW;
    ctx.fillText(label, x, labelY);
  }
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
  if (playbook) {
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let note = regime.desc;
    if (Math.abs(dexVelocity) >= 15) {
      note = `Rapid DEX velocity surge detected. ${dexVelocity > 0 ? 'Buying chase' : 'Selling chase'} is active.`;
    } else if ((gex > 0 && gex > 0.65) || (gex > 0 && gex >= 0.65)) {
      note = 'Positive GEX is currently high for the session. Dealers are suppressing volatility.';
    } else if (gex > 0 && gex < 0.35) {
      note = 'GEX remains positive but has drifted lower. Mean reversion still matters, but dealer support is weakening.';
    } else if (gex < 0 && gex < -0.35) {
      note = 'Deep negative gamma: dealers are forced to sell weakness. Momentum breakout conditions are elevated.';
    } else if (dex > 0 && dex > 0.75) {
      note = 'Upside inventory pressure is elevated. Watch for resistance at key levels.';
    } else if (dex < 0 && dex < 0.25) {
      note = 'Downside inventory pressure is heavy. Aggressive short-covering can appear on a bid.';
    } else {
      note = 'Consolidation / neutral. Dealer flows are balanced. Watch price action for the next shift.';
    }
    note += ` Updated ${time}.`;
    playbook.textContent = note;
  }
}

function updateGreeksDisplay(data) {
  if (!data) return;
  const next = (current, incoming) => Number.isFinite(Number(incoming)) ? Number(incoming) : current;
  window.__liveExposureSnapshot = {
    ...(window.__liveExposureSnapshot || {}),
    gex: next(window.__liveExposureSnapshot?.gex, data.gex),
    dex: next(window.__liveExposureSnapshot?.dex, data.dex),
    chex: next(window.__liveExposureSnapshot?.chex, data.chex),
    vex: next(window.__liveExposureSnapshot?.vex, data.vex),
    buyScore: next(window.__liveExposureSnapshot?.buyScore, data.buyScore),
    sellScore: next(window.__liveExposureSnapshot?.sellScore, data.sellScore),
    price: next(window.__liveExposureSnapshot?.price, data.price),
    ts: Number(data.ts ?? Date.now())
  };
  if (data.gex !== undefined) {
    const gexEl = getExposureValueEl('gex');
    if (gexEl) gexEl.textContent = (data.gex >= 0 ? '+' : '') + Number(data.gex).toFixed(3) + 'B';
  }
  if (data.dex !== undefined) {
    const dexEl = getExposureValueEl('dex');
    if (dexEl) dexEl.textContent = (data.dex >= 0 ? '+' : '') + Number(data.dex).toFixed(3) + 'B';
  }
  if (data.chex !== undefined) {
    const chexEl = getExposureValueEl('chex');
    if (chexEl) chexEl.textContent = (data.chex >= 0 ? '+' : '') + Number(data.chex).toFixed(3) + 'M';
  }
  if (data.vex !== undefined) {
    const vexEl = getExposureValueEl('vex');
    if (vexEl) vexEl.textContent = (data.vex >= 0 ? '+' : '') + Number(data.vex).toFixed(3) + 'M';
  }
  persistExposureStackToDB(data.gex ?? 0, data.dex ?? 0, data.chex ?? 0, data.vex ?? 0, Number(data.buyScore || 0), Number(data.sellScore || 0), Number(data.price || 0));
  requestAnimationFrame(() => renderGreekSparklines());
  updateGammaLogic(Number(data.gex || 0), Number(data.dex || 0), Number(data.dexVelocity || 0));
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
  window.PageRuntime.register('exposure', () => {});
}
