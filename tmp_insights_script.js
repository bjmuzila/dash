
// ── SENTIMENT HEAT-CHECK TELEMETRY ──────────────────────────────────
(function(){
  const sv = { trin:0.95, avol:462, dvol:312, adv:468, dec:334 };
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function walk(v,step,mn,mx){ return clamp(v+(Math.random()-.5)*2*step,mn,mx); }
  function renderSentiment(){
    sv.trin = walk(sv.trin, 0.06, 0.40, 2.00);
    sv.avol = walk(sv.avol, 15,   100,  900);
    sv.dvol = walk(sv.dvol, 15,   100,  900);
    sv.adv  = walk(sv.adv,  12,    50,  450);
    sv.dec  = walk(sv.dec,  12,    50,  450);
    // TRIN
    const tv = document.getElementById('t10-trin-val');
    const tb = document.getElementById('t10-trin-bar');
    if(tv && tb){
      tv.innerText = sv.trin.toFixed(2);
      tb.style.width = Math.min(100,Math.max(10,(sv.trin/2.0)*100))+'%';
      const c = sv.trin<0.85?'#10b981':sv.trin>1.25?'#f43f5e':'#f59e0b';
      tb.style.background = c; tv.style.color = c;
    }
    // Vol split
    const vt = sv.avol+sv.dvol, vp = vt>0?(sv.avol/vt)*100:50;
    const vb = document.getElementById('t10-vol-bar');
    if(vb) vb.style.width = vp.toFixed(1)+'%';
    const vup = document.getElementById('t10-vol-up-pct'); if(vup) vup.innerText = vp.toFixed(0)+'% Advancing Vol';
    const vdn = document.getElementById('t10-vol-dn-pct'); if(vdn) vdn.innerText = (100-vp).toFixed(0)+'% Declining Vol';
    const vur = document.getElementById('t10-vol-up-raw'); if(vur) vur.innerText = Math.round(sv.avol)+'M';
    const vdr = document.getElementById('t10-vol-dn-raw'); if(vdr) vdr.innerText = Math.round(sv.dvol)+'M';
    // Breadth
    const bt = sv.adv+sv.dec, bp = bt>0?(sv.adv/bt)*100:50;
    const bb = document.getElementById('t10-breadth-bar');
    if(bb) bb.style.width = bp.toFixed(1)+'%';
    const bh = document.getElementById('t10-breadth-higher'); if(bh) bh.innerText = bp.toFixed(0)+'% Higher';
    const bl = document.getElementById('t10-breadth-lower');  if(bl) bl.innerText  = (100-bp).toFixed(0)+'% Lower';
    const ar = document.getElementById('t10-adv-raw'); if(ar) ar.innerText = Math.round(sv.adv);
    const dr = document.getElementById('t10-dec-raw'); if(dr) dr.innerText = Math.round(sv.dec);
  }
  renderSentiment();
  setInterval(renderSentiment, 2000);
})();
// ────────────────────────────────────────────────────────────────────

// Refresh Exposure Stack
window.refreshExposureStack = function() {
  const btn = document.getElementById('exp-refresh-btn');
  if (btn) {
    btn.style.opacity = '0.5';
    btn.textContent = '…';
  }
  updateExposureStack();
  updateSliderBars();
  setTimeout(() => {
    if (btn) {
      btn.style.opacity = '1';
      btn.textContent = 'Refresh';
    }
    const timeEl = document.getElementById('exp-refresh-time');
    if (timeEl) {
      const now = new Date();
      timeEl.textContent = 'Last: ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }, 300);
};

window.refreshExposureStack = async function() {
  const btn = document.getElementById('exp-refresh-btn') || document.getElementById('insights-refresh-btn');
  const timeEl = document.getElementById('insights-refresh-time') || document.getElementById('exp-refresh-time');
  if (!btn) return;
  const setButtonState = (text, bg, color, borderColor, opacity = '1') => {
    btn.textContent = text;
    btn.style.background = bg;
    btn.style.color = color;
    btn.style.borderColor = borderColor;
    btn.style.opacity = opacity;
  };
  btn.disabled = true;
  setButtonState('...', 'rgba(0,229,255,.12)', 'var(--cyan)', 'rgba(0,229,255,.65)', '0.75');
  try {
    if (typeof window.insightsRefreshAll === 'function') {
      await window.insightsRefreshAll();
    } else {
      if (typeof window.fetchGEX === 'function') await window.fetchGEX();
      if (typeof window.renderInsights0DTE === 'function') window.renderInsights0DTE();
      if (typeof window.updateExposureStack === 'function') window.updateExposureStack();
    }
    const now = new Date();
    if (timeEl) timeEl.textContent = 'Last refresh: ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setButtonState('✓', 'rgba(0,230,118,.12)', '#00e676', 'rgba(0,230,118,.55)', '1');
    setTimeout(() => setButtonState('Refresh', 'rgba(0,229,255,.08)', 'var(--cyan)', 'rgba(0,229,255,.45)', '1'), 1200);
  } catch (err) {
    console.error('Exposure stack refresh failed:', err);
    if (timeEl) timeEl.textContent = 'Last refresh: error';
    setButtonState('ERR', 'rgba(255,71,87,.12)', '#ff4757', 'rgba(255,71,87,.55)', '1');
    setTimeout(() => setButtonState('Refresh', 'rgba(0,229,255,.08)', 'var(--cyan)', 'rgba(0,229,255,.45)', '1'), 1400);
  } finally {
    btn.disabled = false;
  }
};

// Copy Exposure Stack screenshot
window.copyExposureScreenshot = async function() {
  const btn = document.getElementById('exp-copy-shot-btn');
  const target = document.getElementById('exposure-data-boxes') || document.getElementById('page-insights');
  
  if (!target || typeof html2canvas === 'undefined') {
    if (btn) btn.textContent = 'ERR';
    return;
  }
  
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
  
  try {
    const shot = await html2canvas(target, {
      backgroundColor: '#05080d',
      scale: 2,
      useCORS: true,
      logging: false,
      allowTaint: true,
      width: target.scrollWidth,
      height: target.scrollHeight,
      onclone: (doc) => {
        const root = doc.getElementById('page-insights');
        if (!root) return;
        root.style.display = 'flex';
        root.style.flex = '1';
        root.style.minHeight = '0';
        root.style.height = 'auto';
        root.style.overflow = 'visible';
        root.style.background = '#05080d';
        const source = doc.getElementById('exposure-data-boxes') || doc.getElementById('insights-share-source');
        if (source) {
          source.style.display = 'block';
          source.style.position = 'relative';
          source.style.overflow = 'visible';
          source.style.minHeight = '0';
        }
        const left = doc.getElementById('insights-share-left');
        if (left) {
          left.style.position = 'relative';
          left.style.inset = 'auto';
          left.style.overflow = 'visible';
          left.style.minHeight = 'fit-content';
        }
        const main = doc.getElementById('insights-share-main');
        if (main) {
          main.style.maxWidth = '980px';
          main.style.width = '980px';
          main.style.height = 'auto';
          main.style.overflow = 'visible';
        }
        const loading = doc.getElementById('exposure-main-loading');
        if (loading) loading.remove();
        doc.querySelectorAll('#exp-copy-shot-btn,#exp-share-x-btn,#exp-share-discord-btn').forEach((el) => el.remove());
      }
    });
    
    shot.toBlob(async blob => {
      try {
        await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
        if (btn) {
          btn.textContent = '✓';
          btn.style.color = '#00e676';
          setTimeout(() => { btn.textContent = 'COPY SHOT'; btn.style.color = '#00e5ff'; }, 1500);
        }
      } catch (e) {
        if (btn) {
          btn.textContent = 'ERR';
          btn.style.color = '#ff4757';
          setTimeout(() => { btn.textContent = 'COPY SHOT'; btn.style.color = '#00e5ff'; }, 1500);
        }
      }
    }, 'image/png');
  } catch (e) {
    if (btn) {
      btn.textContent = 'ERR';
      btn.style.color = '#ff4757';
      setTimeout(() => { btn.textContent = 'COPY SHOT'; btn.style.color = '#00e5ff'; }, 1500);
    }
  }
};

// Share to X or Discord
window.shareExposure = async function(platform) {
  const btn = platform === 'x' 
    ? document.getElementById('exp-share-x-btn')
    : document.getElementById('exp-share-discord-btn');
  
  const originalText = btn ? btn.textContent : '';
  const originalColor = btn ? btn.style.color : '#7289da';
  
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
  
  if (platform === 'x') {
    setTimeout(() => {
      if (btn) { btn.textContent = originalText; btn.style.color = originalColor; }
      window.open('https://twitter.com/intent/tweet?text=SPX+Exposure+Stack', '_blank');
    }, 300);
    return;
  }
  
  // Discord
  if (platform === 'discord') {
    try {
      const target = document.getElementById('exposure-data-boxes') || document.getElementById('page-insights');
      if (!target || typeof html2canvas === 'undefined') throw new Error('Missing dependencies');
      
      const shot = await html2canvas(target, {
        backgroundColor: '#05080d',
        scale: 2,
        useCORS: true,
        logging: false,
        width: target.scrollWidth,
        height: target.scrollHeight,
        allowTaint: true,
        onclone: (doc) => {
          const root = doc.getElementById('page-insights');
          if (!root) return;
          root.style.display = 'flex';
          root.style.flex = '1';
          root.style.minHeight = '0';
          root.style.height = 'auto';
          root.style.overflow = 'visible';
          root.style.background = '#05080d';
          const source = doc.getElementById('exposure-data-boxes') || doc.getElementById('insights-share-source');
          if (source) {
            source.style.display = 'block';
            source.style.position = 'relative';
            source.style.overflow = 'visible';
            source.style.minHeight = '0';
          }
          const left = doc.getElementById('insights-share-left');
          if (left) {
            left.style.position = 'relative';
            left.style.inset = 'auto';
            left.style.overflow = 'visible';
            left.style.minHeight = 'fit-content';
          }
          const main = doc.getElementById('insights-share-main');
          if (main) {
            main.style.maxWidth = '980px';
            main.style.width = '980px';
            main.style.height = 'auto';
            main.style.overflow = 'visible';
          }
          const loading = doc.getElementById('exposure-main-loading');
          if (loading) loading.remove();
          doc.querySelectorAll('#exp-copy-shot-btn,#exp-share-x-btn,#exp-share-discord-btn').forEach((el) => el.remove());
        }
      });
      
      shot.toBlob(async blob => {
        try {
          const form = new FormData();
          form.append('payload_json', JSON.stringify({ content: 'SPX Exposure Stack' }));
          form.append('files[0]', blob, 'exposure-stack.png');
          
          const res = await fetch('/proxy/api/webhooks/1466249857122570454/REDACTED', {
            method: 'POST',
            body: form
          });
          
          if (res.ok) {
            if (btn) {
              btn.textContent = '✓';
              btn.style.color = '#00e676';
              setTimeout(() => { btn.textContent = originalText; btn.style.color = originalColor; }, 1500);
            }
          } else {
            throw new Error('Webhook failed');
          }
        } catch (e) {
          if (btn) {
            btn.textContent = 'ERR';
            btn.style.color = '#ff4757';
            setTimeout(() => { btn.textContent = originalText; btn.style.color = originalColor; }, 1500);
          }
        }
      }, 'image/png');
    } catch (e) {
      if (btn) {
        btn.textContent = 'ERR';
        btn.style.color = '#ff4757';
        setTimeout(() => { btn.textContent = originalText; btn.style.color = originalColor; }, 1500);
      }
    }
  }
};


// TAB SWITCHING
// GREEKS TIMELINE & BUY/SELL LOGIC
async function fetchGreeksHistory() {
  try {
    if (window.intradayHistory && Array.isArray(window.intradayHistory) && window.intradayHistory.length > 0) {
      return window.intradayHistory;
    }
    return [];
  } catch (e) {
    console.error('Greeks history fetch failed:', e);
    return [];
  }
}

function calculateBuySellScore(gexB, dex, chex, vex) {
  const gexPos = gexB > 0.5 ? 75 : gexB > 0 ? 55 : gexB > -0.5 ? 35 : 15;
  const dexPos = dex > 0 ? 65 : 35;
  const chexPos = chex > 0 ? 70 : 30;
  const vexPos = Math.abs(vex) < 0.5 ? 70 : Math.abs(vex) < 1.0 ? 50 : 30;
  const buyScore = Math.round(gexPos * 0.35 + dexPos * 0.25 + chexPos * 0.25 + vexPos * 0.15);
  return { buyScore, sellScore: 100 - buyScore };
}


function updateInsightsInstitutionalAnalysis(gexData, dexData, chexData, vexData, buyData) {
  if (!gexData || !Array.isArray(gexData) || gexData.length === 0) return;

  const latestGex = Number(gexData[gexData.length - 1]) || 0;
  const latestDex = Number(dexData[dexData.length - 1]) || 0;
  const latestBuy = Number(buyData?.[buyData.length - 1]) || 0;
  const prevDex = Number(window.__insightsPrevDex);
  const dexDelta = Number.isFinite(prevDex) ? latestDex - prevDex : 0;
  window.__insightsPrevDex = latestDex;

  const dexTrend = dexDelta > 0 ? 'INCREASING' : dexDelta < 0 ? 'DECREASING' : 'STABLE';
  const dexColor = dexDelta > 0 ? '#10b981' : dexDelta < 0 ? '#ef4444' : '#cbd5e1';
  const gexStatus = latestGex >= 0 ? 'STABLE GAMMA' : 'VOL EXPANSION';
  const gexColor = latestGex >= 0 ? '#10b981' : '#ef4444';
  const deltaSlope = latestDex > 0 ? 'BULLISH DELTA' : latestDex < 0 ? 'BEARISH SHIELD' : 'NEUTRAL DELTA';
  const deltaColor = latestDex > 0 ? '#06b6d4' : latestDex < 0 ? '#ef4444' : '#cbd5e1';

  let playbookText = 'Dealer hedging is balanced. Watch for the next shift in GEX or DEX to define the session.';
  if (latestGex > 0 && latestDex > 0) playbookText = 'Long Gamma / Bullish Delta: compressed tape. Dealers buy dips and sell rallies, creating a supportive liquidity cushion.';
  else if (latestGex < 0 && latestDex < 0) playbookText = 'Short Gamma / Bearish Delta: expansion regime. Dealer hedging follows the move and can accelerate downside liquidity gaps.';
  else if (latestGex > 0 && latestDex < 0) playbookText = 'Asymmetric Protection: gamma buffers remain intact, but negative delta hedging can keep rallies capped while pullbacks stay cushioned.';
  else if (latestGex < 0 && latestDex > 0) playbookText = 'Short Squeeze Potential: dealers are short gamma but long delta, so upside buying can force fast hedge-chasing higher.';

  const el1 = document.getElementById('ia-dex-velocity');
  if (el1) {
    const arrow = dexDelta > 0 ? 'UP' : dexDelta < 0 ? 'DOWN' : 'FLAT';
    el1.textContent = `${arrow} ${dexTrend}`;
    el1.style.color = dexColor;
    el1.style.borderColor = dexColor + '80';
    el1.style.background = dexColor + '26';
  }

  const el2 = document.getElementById('ia-gamma-regime');
  if (el2) { el2.textContent = gexStatus; el2.style.color = gexColor; el2.style.borderColor = gexColor + '80'; el2.style.background = gexColor + '26'; }

  const el3 = document.getElementById('ia-delta-regime');
  if (el3) { el3.textContent = deltaSlope; el3.style.color = deltaColor; el3.style.borderColor = deltaColor + '80'; el3.style.background = deltaColor + '26'; }

  if (typeof window.renderInstitutionalFeed === 'function') window.renderInstitutionalFeed(latestGex, latestDex, dexDelta, latestBuy, Number(chexData?.[chexData.length - 1]) || 0, Number(vexData?.[vexData.length - 1]) || 0);
  renderGammaBuySellChart(latestBuy);

  updateGammaLogic(latestGex, latestDex, dexDelta);
}

let ibState = {
  ibHigh: null,
  ibLow: null,
  ibMid: null,
  currentPrice: null,
  lowFormedFirst: null,
  highBroken: false,
  lowBroken: false,
  ibClosedAt1030: false,
  tradingDate: null
};

const IB_STORAGE_KEY = 'insights-ib-state-v1';

function getEasternTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    ymd: `${map.year}-${map.month}-${map.day}`
  };
}

function persistIBState() {
  try {
    localStorage.setItem(IB_STORAGE_KEY, JSON.stringify(ibState));
  } catch (e) {}
}

function resetIBStateForDay(ymd) {
  ibState.ibHigh = null;
  ibState.ibLow = null;
  ibState.ibMid = null;
  ibState.currentPrice = null;
  ibState.lowFormedFirst = null;
  ibState.highBroken = false;
  ibState.lowBroken = false;
  ibState.ibClosedAt1030 = false;
  ibState.tradingDate = ymd;
  persistIBState();
}

function restoreIBStateForDate(ymd) {
  try {
    const raw = localStorage.getItem(IB_STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || saved.tradingDate !== ymd) return false;
    Object.assign(ibState, {
      ibHigh: typeof saved.ibHigh === 'number' ? saved.ibHigh : null,
      ibLow: typeof saved.ibLow === 'number' ? saved.ibLow : null,
      ibMid: typeof saved.ibMid === 'number' ? saved.ibMid : null,
      currentPrice: typeof saved.currentPrice === 'number' ? saved.currentPrice : null,
      lowFormedFirst: typeof saved.lowFormedFirst === 'boolean' ? saved.lowFormedFirst : null,
      highBroken: !!saved.highBroken,
      lowBroken: !!saved.lowBroken,
      ibClosedAt1030: !!saved.ibClosedAt1030,
      tradingDate: saved.tradingDate
    });
    return true;
  } catch (e) {
    return false;
  }
}

function updateRule1Analysis() {
  const status = document.getElementById('rule-1-status');
  if (!status) return;
  if (ibState.highBroken || ibState.lowBroken) {
    status.innerHTML = `<strong style="color:#00e676">✓ Breakout Detected</strong><br>IB was broken as predicted. 99.4% inside-day probability confirmed.`;
  }
}

function updateRule2Analysis() {
  const status = document.getElementById('rule-2-status');
  if (!status) return;
  if (ibState.ibMid && ibState.currentPrice) {
    const aboveMid = ibState.currentPrice > ibState.ibMid;
    const prob = aboveMid ? '83.5%' : '94.9%';
    const breakType = aboveMid ? 'IB High' : 'IB Low';
    status.innerHTML = `<strong style="color:#ffb300">Price is ${aboveMid ? 'ABOVE' : 'BELOW'} midpoint</strong><br>${prob} probability of ${breakType} break`;
  }
}

function updateRule3Analysis() {
  const status = document.getElementById('rule-3-status');
  if (!status) return;
  status.innerHTML = `<strong style="color:#7cff6b">10:30 AM passed</strong><br>If no breakout yet, shift to range-bound premium decay. 84.1% of breaks occur within 30 min of IB close.`;
}

function updateRule4Analysis() {
  const status = document.getElementById('rule-4-status');
  if (!status) return;
  if (ibState.lowFormedFirst) {
    status.innerHTML = `<strong style="color:#ff5ec4">Low formed first (path dependency)</strong><br>78.79% chance of IB High break | 19.7% chance of IB Low break. Upside skew active.`;
  } else {
    status.innerHTML = `<strong style="color:#ff5ec4">High formed first</strong><br>Higher downside risk. Watch for mean-reversion late session.`;
  }
}

function updateRule5Analysis() {
  const status = document.getElementById('rule-5-status');
  if (!status) return;
  status.innerHTML = `<strong style="color:#00e676">First break detected</strong><br>Watch for double-cross whiplash. ES: 40.1% | NQ: 23.5% probability of opposite boundary breach.`;
}

function renderPersistedIBState() {
  const highEl = document.getElementById('ib-high');
  const lowEl = document.getElementById('ib-low');
  const midEl = document.getElementById('ib-mid');
  const sizeEl = document.getElementById('ib-size');
  const priceEl = document.getElementById('ib-price');
  const positionEl = document.getElementById('ib-position');

  if (ibState.ibHigh !== null && ibState.ibLow !== null) {
    ibState.ibMid = (ibState.ibHigh + ibState.ibLow) / 2;
    if (highEl) highEl.textContent = ibState.ibHigh.toFixed(2);
    if (lowEl) lowEl.textContent = ibState.ibLow.toFixed(2);
    if (midEl) midEl.textContent = ibState.ibMid.toFixed(2);
    if (sizeEl) sizeEl.textContent = (ibState.ibHigh - ibState.ibLow).toFixed(2);
  }

  if (ibState.currentPrice !== null && ibState.ibMid !== null) {
    const diff = ibState.currentPrice - ibState.ibMid;
    const position = diff >= 0 ? 'ABOVE' : 'BELOW';
    const color = diff >= 0 ? '#00e676' : '#ff5ec4';
    if (priceEl) priceEl.textContent = ibState.currentPrice.toFixed(2);
    if (positionEl) positionEl.innerHTML = `<span style="color:${color}">${position} <span style="font-size:11px;opacity:.8">(${diff >= 0 ? '+' : ''}${diff.toFixed(2)})</span></span>`;
  }

  if (ibState.ibClosedAt1030) updateRule3Analysis();
  if (ibState.highBroken || ibState.lowBroken) {
    updateRule1Analysis();
    updateRule2Analysis();
    updateRule4Analysis();
    updateRule5Analysis();
  }
}

function updateIBDashboard(price, timestamp) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return;
  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) timestamp = new Date();

  const et = getEasternTimeParts(timestamp);
  if (ibState.tradingDate !== et.ymd) {
    resetIBStateForDay(et.ymd);
  }

  ibState.currentPrice = price;

  const hour = et.hour;
  const minute = et.minute;
  const timeInMins = hour * 60 + minute;
  const ibStart = 9 * 60 + 30;
  const ibEnd = 10 * 60 + 30;
  const inIBWindow = timeInMins >= ibStart && timeInMins < ibEnd;

  const priceEl = document.getElementById('ib-price');
  const timeEl = document.getElementById('ib-time');
  if (priceEl) priceEl.textContent = price.toFixed(2);
  if (timeEl) timeEl.textContent = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  if (inIBWindow) {
    if (ibState.ibHigh === null || price > ibState.ibHigh) ibState.ibHigh = price;
    if (ibState.ibLow === null || price < ibState.ibLow) ibState.ibLow = price;
  }

  if (ibState.ibHigh !== null && ibState.ibLow !== null) {
    ibState.ibMid = (ibState.ibHigh + ibState.ibLow) / 2;
    const highEl = document.getElementById('ib-high');
    const lowEl = document.getElementById('ib-low');
    const midEl = document.getElementById('ib-mid');
    const sizeEl = document.getElementById('ib-size');
    if (highEl) highEl.textContent = ibState.ibHigh.toFixed(2);
    if (lowEl) lowEl.textContent = ibState.ibLow.toFixed(2);
    if (midEl) midEl.textContent = ibState.ibMid.toFixed(2);
    if (sizeEl) sizeEl.textContent = (ibState.ibHigh - ibState.ibLow).toFixed(2);
  }

  if (ibState.lowFormedFirst === null && ibState.ibLow !== null && ibState.ibHigh !== null && ibState.ibHigh > ibState.ibLow) {
    ibState.lowFormedFirst = true;
  }

  if (ibState.ibHigh !== null && price > ibState.ibHigh) {
    ibState.highBroken = true;
    updateRule1Analysis();
    updateRule2Analysis();
  }
  if (ibState.ibLow !== null && price < ibState.ibLow) {
    ibState.lowBroken = true;
    updateRule1Analysis();
    updateRule2Analysis();
  }

  if (ibState.ibMid !== null) {
    const diff = price - ibState.ibMid;
    const position = diff >= 0 ? 'ABOVE' : 'BELOW';
    const color = diff >= 0 ? '#00e676' : '#ff5ec4';
    const positionEl = document.getElementById('ib-position');
    if (positionEl) positionEl.innerHTML = `<span style="color:${color}">${position} <span style="font-size:11px;opacity:.8">(${diff >= 0 ? '+' : ''}${diff.toFixed(2)})</span></span>`;
  }

  if (timeInMins >= ibEnd && !ibState.ibClosedAt1030) {
    ibState.ibClosedAt1030 = true;
    updateRule3Analysis();
  }

  if (ibState.lowBroken || ibState.highBroken) {
    updateRule4Analysis();
    updateRule5Analysis();
  }

  persistIBState();
}

const initialIBDate = getEasternTimeParts().ymd;
if (!restoreIBStateForDate(initialIBDate)) {
  resetIBStateForDay(initialIBDate);
} else {
  renderPersistedIBState();
}
// Always try to seed/correct IB from candle history on load
setTimeout(() => { if (typeof window.seedIBFromCandles === 'function') window.seedIBFromCandles(); }, 500);

window.updateIBDashboard = updateIBDashboard;

async function seedIBFromCandles() {
  try {
    const et = getEasternTimeParts();
    console.log('[IB Seed] ET now:', et);

    function etWallToUtcMs(year, month, day, hour, minute) {
      const probe = Date.UTC(year, month - 1, day, hour + 4, minute);
      const check = getEasternTimeParts(new Date(probe));
      if (check.hour === hour && check.minute === minute) return probe;
      return Date.UTC(year, month - 1, day, hour + 5, minute);
    }

    const ibStartMs = etWallToUtcMs(et.year, et.month, et.day, 9, 30);
    const ibEndMs   = etWallToUtcMs(et.year, et.month, et.day, 10, 30);
    const nowMs = Date.now();
    console.log('[IB Seed] ibStartMs:', new Date(ibStartMs).toISOString(), 'ibEndMs:', new Date(ibEndMs).toISOString(), 'now:', new Date(nowMs).toISOString());

    if (nowMs < ibStartMs) { console.log('[IB Seed] before 9:30 ET, skipping'); return; }

    const url = `/proxy/api/dxlink/candles?symbol=/ESM6{=1m}&start=${ibStartMs}&count=60`;
    console.log('[IB Seed] fetching:', url);
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(fetchTimeout);
    console.log('[IB Seed] response status:', res.status);
    if (!res.ok) { console.warn('[IB Seed] non-ok response'); return; }
    const json = await res.json();
    console.log('[IB Seed] json.candles length:', json?.candles?.length, 'empty:', json?.empty, 'error:', json?.error);
    const candles = json?.candles;
    if (!Array.isArray(candles) || candles.length === 0) { console.warn('[IB Seed] no candles returned'); return; }

    console.log('[IB Seed] first candle:', candles[0], 'last candle:', candles[candles.length-1]);

    const ibCandles = candles.filter(c => c.datetime >= ibStartMs && c.datetime < ibEndMs);
    console.log('[IB Seed] ibCandles after filter:', ibCandles.length);
    if (ibCandles.length === 0) { console.warn('[IB Seed] all candles filtered out'); return; }

    let high = -Infinity;
    let low  = +Infinity;
    for (const c of ibCandles) {
      if (c.high > high) high = c.high;
      if (c.low  < low)  low  = c.low;
    }

    if (!Number.isFinite(high) || !Number.isFinite(low) || high <= 0 || low <= 0) return;

    // Only seed if current ibState doesn't already have better data
    if (ibState.ibHigh === null || high > ibState.ibHigh) ibState.ibHigh = high;
    if (ibState.ibLow  === null || low  < ibState.ibLow)  ibState.ibLow  = low;
    ibState.ibMid = (ibState.ibHigh + ibState.ibLow) / 2;

    // Mark IB as closed if we're past 10:30
    const timeInMins = et.hour * 60 + et.minute;
    if (timeInMins >= 10 * 60 + 30) ibState.ibClosedAt1030 = true;

    // Seed lowFormedFirst from candle path
    if (ibState.lowFormedFirst === null && ibCandles.length >= 2) {
      // Find which extreme was hit first by scanning candles in order
      let firstHighTime = null, firstLowTime = null;
      for (const c of ibCandles) {
        if (firstHighTime === null && c.high >= ibState.ibHigh) firstHighTime = c.datetime;
        if (firstLowTime  === null && c.low  <= ibState.ibLow)  firstLowTime  = c.datetime;
        if (firstHighTime !== null && firstLowTime !== null) break;
      }
      if (firstHighTime !== null && firstLowTime !== null) {
        ibState.lowFormedFirst = firstLowTime < firstHighTime;
      }
    }

    persistIBState();
    renderPersistedIBState();
    console.log(`[IB Seed] High=${ibState.ibHigh} Low=${ibState.ibLow} from ${ibCandles.length} candles`);
  } catch (e) {
    console.warn('[IB Seed] failed:', e);
  }
}
window.seedIBFromCandles = seedIBFromCandles;

async function fetchESPrice() {
  try {
    if (window.esPrice > 1000) return window.esPrice;
    const sources = [
      async () => {
        const q = await fetch('/proxy/api/tt/quotes-batch?future[]=%2FESM6').then(r => r.ok ? r.json() : null);
        const items = q?.data?.items || [];
        const es = items.find(i => i.symbol === '/ESM6' || i.symbol === '/ES:XCME' || i.symbol === '/ESM26') || items[0] || null;
        return parseFloat(es?.last || es?.mark || es?.mid || 0);
      },
      async () => {
        const q = await fetch('/proxy/api/marketdata/v1/pricehistory?symbol=%2FESM6').then(r => r.ok ? r.json() : null);
        const candles = Array.isArray(q?.candles) ? q.candles : Array.isArray(q?.data?.items) ? q.data.items : [];
        const last = candles[candles.length - 1];
        return parseFloat(last?.close || last?.last || last?.price || 0);
      },
      async () => {
        const q = await fetch('/proxy/api/tt/gex').then(r => r.ok ? r.json() : null);
        return parseFloat(q?.data?.spot || 0);
      }
    ];
    for (const getPrice of sources) {
      const price = await getPrice().catch(() => 0);
      if (Number.isFinite(price) && price > 0) return price;
    }
  } catch (e) {}
  return null;
}

async function refreshIBPrice() {
  const now = new Date();
  const btn = document.getElementById('ib-refresh-btn');
  const status = document.getElementById('ib-refresh-status');
  const originalText = btn ? btn.textContent : 'Refresh';
  const originalStyle = btn ? {
    background: btn.style.background,
    color: btn.style.color,
    borderColor: btn.style.borderColor,
    boxShadow: btn.style.boxShadow,
    transform: btn.style.transform,
  } : null;
  const setButtonState = (text, bg, color, borderColor) => {
    if (!btn) return;
    btn.textContent = text;
    btn.style.background = bg;
    btn.style.color = color;
    btn.style.borderColor = borderColor;
  };
  const restoreButton = () => {
    if (!btn) return;
    btn.textContent = originalText;
    if (originalStyle) {
      btn.style.background = originalStyle.background || 'rgba(0,229,255,.08)';
      btn.style.color = originalStyle.color || 'var(--cyan)';
      btn.style.borderColor = originalStyle.borderColor || 'rgba(0,229,255,.45)';
      btn.style.boxShadow = originalStyle.boxShadow || 'none';
      btn.style.transform = originalStyle.transform || 'translateY(0)';
    }
    btn.disabled = false;
  };
  if (btn) {
    btn.disabled = true;
    setButtonState('…', 'rgba(0,229,255,.18)', '#ffb300', 'rgba(0,229,255,.8)');
    btn.style.boxShadow = '0 0 0 1px rgba(0,229,255,.2), 0 0 14px rgba(0,229,255,.16)';
    btn.style.transform = 'translateY(-1px)';
  }
  try {
    const price = await fetchESPrice();
    if (price && Number.isFinite(price) && price > 0) {
      updateIBDashboard(price, now);
      if (status) status.textContent = 'Last refresh: ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setButtonState('✓', 'rgba(0,200,136,.18)', '#00e676', 'rgba(0,200,136,.65)');
      btn.style.boxShadow = '0 0 0 1px rgba(0,200,136,.2), 0 0 16px rgba(0,200,136,.18)';
      btn.style.transform = 'translateY(-1px)';
    } else {
      if (status) status.textContent = 'Last refresh: no live price';
      setButtonState('NO DATA', 'rgba(251,191,36,.14)', '#ffb300', 'rgba(251,191,36,.55)');
      btn.style.boxShadow = '0 0 0 1px rgba(251,191,36,.18)';
      btn.style.transform = 'translateY(0)';
    }
  } catch (e) {
    if (status) status.textContent = 'Last refresh: error';
    setButtonState('ERR', 'rgba(248,113,113,.14)', '#ff4757', 'rgba(248,113,113,.55)');
    if (btn) {
      btn.style.boxShadow = '0 0 0 1px rgba(248,113,113,.18)';
      btn.style.transform = 'translateY(0)';
    }
  } finally {
    setTimeout(restoreButton, 1500);
  }
}

window.refreshIBPrice = refreshIBPrice;

setInterval(async () => {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (day === 0 || day === 6) return;
  if (hour < 6 || hour >= 22) return;

  const price = (window.esPrice > 1000) ? window.esPrice : await fetchESPrice();
  if (price && typeof price === 'number' && price > 0) {
    if (window.currentInsightsTab === 'ib' && document.getElementById('ib-main')) {
      updateIBDashboard(price, now);
    }
    const volSpotEl = document.getElementById('vol-spot');
    if (volSpotEl && volSpotEl.textContent === '--') {
      volSpotEl.textContent = price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
}, 2000);

async function refreshExposureStack() {
  const btn = document.getElementById('exp-refresh-btn') || document.getElementById('insights-refresh-btn');
  const stamp = document.getElementById('insights-refresh-time') || document.getElementById('exp-refresh-time');
  const setButtonState = (text, bg, color, borderColor, opacity = '1') => {
    if (!btn) return;
    btn.textContent = text;
    btn.style.background = bg;
    btn.style.color = color;
    btn.style.borderColor = borderColor;
    btn.style.opacity = opacity;
  };
  if (btn) {
    btn.disabled = true;
    setButtonState('...', 'rgba(0,229,255,.12)', 'var(--cyan)', 'rgba(0,229,255,.65)', '0.75');
  }
  try {
    if (typeof window.insightsRefreshAll === 'function') {
      await window.insightsRefreshAll();
    } else {
      if (typeof window.fetchGEX === 'function') {
        await window.fetchGEX();
      }
      if (typeof window.renderInsights0DTE === 'function') {
        window.renderInsights0DTE();
      }
      updateExposureStack();
    }
    if (stamp) {
      stamp.textContent = 'Last refresh: ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    setButtonState('✓', 'rgba(0,230,118,.12)', '#00e676', 'rgba(0,230,118,.55)', '1');
    setTimeout(() => {
      if (btn && !btn.disabled) {
        setButtonState('Refresh', 'rgba(0,229,255,.08)', 'var(--cyan)', 'rgba(0,229,255,.45)', '1');
      }
    }, 1200);
  } catch (error) {
    console.error('Exposure stack refresh failed:', error);
    if (stamp) stamp.textContent = 'Last refresh: error';
    setButtonState('ERR', 'rgba(255,71,87,.12)', '#ff4757', 'rgba(255,71,87,.55)', '1');
    setTimeout(() => {
      if (btn && !btn.disabled) {
        setButtonState('Refresh', 'rgba(0,229,255,.08)', 'var(--cyan)', 'rgba(0,229,255,.45)', '1');
      }
    }, 1400);
  } finally {
    if (btn) {
      btn.disabled = false;
    }
  }
}
window.refreshExposureStack = refreshExposureStack;

async function copyExposureScreenshot() {
  const btn = document.getElementById('exp-copy-shot-btn');
  const target = document.getElementById('exposure-data-boxes') || document.getElementById('page-insights');
  if (!target) return;
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
  try {
    if (typeof html2canvas === 'undefined') throw new Error('html2canvas not loaded');
    const canvas = await html2canvas(target, {
      backgroundColor: '#05080d',
      scale: 2,
      useCORS: true,
      logging: false,
      allowTaint: true,
      width: target.scrollWidth,
      height: target.scrollHeight,
      onclone: (doc) => {
        const root = doc.getElementById('page-insights');
        if (!root) return;
        root.style.display = 'flex';
        root.style.flex = '1';
        root.style.minHeight = '0';
        root.style.height = 'auto';
        root.style.overflow = 'visible';
        root.style.background = '#05080d';
        const source = doc.getElementById('exposure-data-boxes') || doc.getElementById('insights-share-source');
        if (source) {
          source.style.display = 'block';
          source.style.position = 'relative';
          source.style.overflow = 'visible';
          source.style.minHeight = '0';
        }
        const left = doc.getElementById('insights-share-left');
        if (left) {
          left.style.position = 'relative';
          left.style.inset = 'auto';
          left.style.overflow = 'visible';
          left.style.minHeight = 'fit-content';
        }
        const main = doc.getElementById('insights-share-main');
        if (main) {
          main.style.maxWidth = '980px';
          main.style.width = '980px';
          main.style.height = 'auto';
          main.style.overflow = 'visible';
        }
        const loading = doc.getElementById('exposure-main-loading');
        if (loading) loading.remove();
        doc.querySelectorAll('#exp-copy-shot-btn,#exp-share-x-btn,#exp-share-discord-btn').forEach((el) => el.remove());
      }
    });
    canvas.toBlob(async blob => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        if (btn) { btn.textContent = '✓'; btn.style.color = '#00e676'; setTimeout(() => { btn.textContent = 'COPY SHOT'; btn.style.color = '#00e5ff'; }, 1500); }
      } catch (e) {
        if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(() => { btn.textContent = 'COPY SHOT'; btn.style.color = '#00e5ff'; }, 1500); }
      }
    }, 'image/png');
  } catch (e) {
    console.error('copyExposureScreenshot:', e);
    if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(() => { btn.textContent = 'COPY SHOT'; btn.style.color = '#00e5ff'; }, 1500); }
  }
}

async function copyIBScreenshot() {
  const btn = document.getElementById('ib-copy-shot-btn');
  const target = document.getElementById('ib-main');
  if (!target) return;
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
  try {
    if (typeof html2canvas === 'undefined') throw new Error('html2canvas not loaded');
    const canvas = await html2canvas(target, { backgroundColor: '#05080d', scale: 2, useCORS: true, logging: false });
    canvas.toBlob(async blob => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        if (btn) { btn.textContent = '✓'; btn.style.color = '#00e676'; setTimeout(() => { btn.textContent = 'COPY SHOT'; btn.style.color = '#00e5ff'; }, 1500); }
      } catch (e) {
        if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(() => { btn.textContent = 'COPY SHOT'; btn.style.color = '#00e5ff'; }, 1500); }
      }
    }, 'image/png');
  } catch (e) {
    console.error('copyIBScreenshot:', e);
    if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(() => { btn.textContent = 'COPY SHOT'; btn.style.color = '#00e5ff'; }, 1500); }
  }
}

async function shareExposure(platform) {
  const btn = platform === 'x' ? document.getElementById('exp-share-x-btn') : document.getElementById('exp-share-discord-btn');
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
  if (platform === 'x') {
    setTimeout(() => { if (btn) { btn.textContent = 'X'; btn.style.color = '#00e5ff'; } window.open('https://twitter.com/intent/tweet?text=SPX+Exposure+Stack+Analysis', '_blank'); }, 300);
    return;
  }
  const target = document.getElementById('exposure-data-boxes') || document.getElementById('page-insights');
  try {
    const canvas = await html2canvas(target, {
      backgroundColor: '#05080d',
      scale: 2,
      useCORS: true,
      logging: false,
      allowTaint: true,
      width: target.scrollWidth,
      height: target.scrollHeight,
      onclone: (doc) => {
        const root = doc.getElementById('page-insights');
        if (!root) return;
        root.style.display = 'flex';
        root.style.flex = '1';
        root.style.minHeight = '0';
        root.style.height = 'auto';
        root.style.overflow = 'visible';
        root.style.background = '#05080d';
        const source = doc.getElementById('exposure-data-boxes') || doc.getElementById('insights-share-source');
        if (source) {
          source.style.display = 'block';
          source.style.position = 'relative';
          source.style.overflow = 'visible';
          source.style.minHeight = '0';
        }
        const left = doc.getElementById('insights-share-left');
        if (left) {
          left.style.position = 'relative';
          left.style.inset = 'auto';
          left.style.overflow = 'visible';
          left.style.minHeight = 'fit-content';
        }
        const main = doc.getElementById('insights-share-main');
        if (main) {
          main.style.maxWidth = '980px';
          main.style.width = '980px';
          main.style.height = 'auto';
          main.style.overflow = 'visible';
        }
        const loading = doc.getElementById('exposure-main-loading');
        if (loading) loading.remove();
        doc.querySelectorAll('#exp-copy-shot-btn,#exp-share-x-btn,#exp-share-discord-btn').forEach((el) => el.remove());
      }
    });
    canvas.toBlob(async blob => {
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ content: 'SPX Exposure Stack' }));
      form.append('files[0]', blob, 'exposure.png');
      const res = await fetch('/proxy/api/webhooks/1466249857122570454/REDACTED', { method: 'POST', body: form });
      if (res.ok && btn) { btn.textContent = '✓'; btn.style.color = '#00e676'; setTimeout(() => { btn.textContent = 'Discord'; btn.style.color = '#7289da'; }, 1500); }
      else if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(() => { btn.textContent = 'Discord'; btn.style.color = '#7289da'; }, 1500); }
    }, 'image/png');
  } catch (e) {
    console.error('shareExposure:', e);
    if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(() => { btn.textContent = 'Discord'; btn.style.color = '#7289da'; }, 1500); }
  }
}

function shareIB(platform) {
  alert(`Share to ${platform} - requires webhook configuration`);
}

// Safety exports for the Exposure Stack buttons.
// If an earlier script block fails to load, keep the button handlers alive.
window.copyExposureScreenshot = window.copyExposureScreenshot || copyExposureScreenshot;
window.shareExposure = window.shareExposure || shareExposure;

function intradayFilterMetric(btn, metric) {
  const buttons = btn.parentElement.querySelectorAll('button');
  buttons.forEach(b => {
    b.style.background = b.dataset.metric === metric ? 'rgba(255,255,255,.1)' : 'transparent';
    b.style.opacity = b.dataset.metric === metric ? '1' : '0.6';
  });
  
  // Filter chart datasets based on selected metric
  if (!window._greeksChartInstance) return;
  const chart = window._greeksChartInstance;
  const datasetLabels = ['Buy %', 'GEX ($B)', 'DEX ($B)', 'CHEX ($B)', 'VEX ($B)'];
  const metricMap = {
    'all': [0, 1, 2, 3, 4],
    'gex': [0, 1],
    'dex': [0, 2],
    'chex': [0, 3],
    'vex': [0, 4],
    'buy%': [0]
  };
  
  const visibleIndices = metricMap[metric] || metricMap['all'];
  chart.data.datasets.forEach((ds, i) => {
    ds.hidden = !visibleIndices.includes(i);
  });
  chart.update();
}

function updateGammaLogic(gex, dex, dexVel) {
  const titleEl = document.getElementById('gamma-regime-title');
  const descEl = document.getElementById('gamma-regime-desc');
  const badgeEl = document.getElementById('gamma-regime-badge');
  const gexStatusEl = document.getElementById('gamma-gex-status');
  const gexLabelEl = document.getElementById('gamma-gex-label');
  const dexStatusEl = document.getElementById('gamma-dex-status');
  const dexLabelEl = document.getElementById('gamma-dex-label');
  const playbookEl = document.querySelector('[id*="playbook"]');
  
  let regime = 'NEUTRAL';
  let desc = 'Monitoring market conditions...';
  let badgeColor = '#a1a1aa';
  
  if (gex > 2 && dex > 5) {
    regime = 'LONG GAMMA';
    desc = 'Dealers are long gamma. Volatility likely suppressed. Expect mean reversion on extremes.';
    badgeColor = '#10b981';
  } else if (gex < -2 && dex < -5) {
    regime = 'SHORT GAMMA';
    desc = 'Dealers are short gamma. Volatility likely elevated. Expect large moves.';
    badgeColor = '#ef4444';
  } else if (gex > 0 && dex > 0) {
    regime = 'BULLISH POSTURE';
    desc = 'Net long exposure. Protecting upside, targeting higher prices.';
    badgeColor = '#06b6d4';
  } else if (gex < 0 && dex < 0) {
    regime = 'BEARISH POSTURE';
    desc = 'Net short exposure. Hedging downside, targeting lower prices.';
    badgeColor = '#f59e0b';
  }
  
  if (titleEl) titleEl.textContent = regime;
  if (descEl) descEl.textContent = desc;
  if (badgeEl) { badgeEl.textContent = regime; badgeEl.style.color = badgeColor; badgeEl.style.background = badgeColor + '26'; }
  
  const formatGammaLogicValue = value => {
    const num = Number(value) || 0;
    const abs = Math.abs(num);
    const sign = num >= 0 ? '+' : '-';
    if (abs >= 1) return sign + abs.toFixed(2) + 'B';
    return sign + (abs * 1000).toFixed(0) + 'M';
  };

  if (gexStatusEl) gexStatusEl.textContent = formatGammaLogicValue(gex);
  if (gexLabelEl) gexLabelEl.textContent = gex > 0 ? 'Vol Controlled' : 'Vol Elevated';
  
  if (dexStatusEl) dexStatusEl.textContent = formatGammaLogicValue(dex);
  if (dexLabelEl) dexLabelEl.textContent = dex > 0 ? 'Trend Protective' : 'Trend Defensive';
  
  if (playbookEl) playbookEl.textContent = desc;
}

async function renderGammaBuySellChart(currentBuyScore = null) {
  const canvas = document.getElementById('gamma-buy-sell-canvas');
  if (!canvas) return;
  const labelEl = document.getElementById('gamma-buy-sell-label');
  const timeEl = document.getElementById('gamma-buy-sell-time');
  const hintEl = document.getElementById('gamma-buy-sell-time-hint');
  const pctEl = document.getElementById('gamma-buy-sell-pct');
  const wrapEl = document.getElementById('gamma-buy-sell-wrap');
  const tooltipEl = document.getElementById('gamma-buy-sell-tooltip');
  const tooltipTitleEl = document.getElementById('gamma-buy-sell-tooltip-title');
  const tooltipBodyEl = document.getElementById('gamma-buy-sell-tooltip-body');
  const parent = canvas.parentElement;
  const width = Math.max(240, Math.floor(parent?.clientWidth || 240));
  const height = Math.max(140, Math.floor(parent?.clientHeight || 140));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  let history = [];
  try {
    if (typeof getBuySellHistoryRows === 'function') {
      const rows = await getBuySellHistoryRows();
      history = (Array.isArray(rows) ? rows : []).map(row => ({
        key: row.slotKey || row.key || row.timestamp,
        time: row.time || '--',
        buyPct: Number(row.buyPct)
      }));
    }
  } catch (err) {
    console.error('Gamma buy/sell DB history failed:', err);
  }
  if (!history.length) {
    history = (typeof insightsReadHistoryEvents === 'function' ? insightsReadHistoryEvents() : [])
      .map(event => ({
        key: event.key,
        time: event.time,
        buyPct: Number(event.buyPct)
      }));
  }
  history = history
    .filter(event => event && Number.isFinite(Number(event.buyPct)))
    .sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')))
    .slice(-24);

  if (Number.isFinite(currentBuyScore)) {
    const currentSlot = typeof insightsHistorySlot === 'function' ? insightsHistorySlot(new Date()) : null;
    const currentKey = currentSlot?.key || `live-${Date.now()}`;
    if (!history.length || history[history.length - 1]?.key !== currentKey) {
      history.push({
        key: currentKey,
        time: currentSlot?.label || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        buyPct: currentBuyScore
      });
    }
  }

  if (!history.length) {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#07111a');
    bg.addColorStop(1, '#05080d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for buy/sell history...', width / 2, height / 2);
    if (hintEl) hintEl.textContent = 'Waiting for historical data.';
    if (labelEl) labelEl.textContent = '--';
    if (timeEl) timeEl.textContent = '--';
    return;
  }

  const pad = { left: 36, right: 14, top: 12, bottom: 24 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const yFor = value => pad.top + (100 - value) / 100 * chartH;
  const xFor = index => pad.left + (history.length === 1 ? chartW / 2 : (index / (history.length - 1)) * chartW);
  const points = history.map((point, index) => ({
    ...point,
    buyPct: Number(point.buyPct) || 0,
    sellPct: 100 - (Number(point.buyPct) || 0),
    x: xFor(index),
    y: yFor(Number(point.buyPct) || 0)
  }));

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#07111a');
  bg.addColorStop(1, '#05080d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.font = '9px Arial';
  ctx.textBaseline = 'middle';
  [0, 25, 50, 75, 100].forEach(level => {
    const y = yFor(level);
    ctx.strokeStyle = level === 50 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.06)';
    ctx.lineWidth = level === 50 ? 1.25 : 1;
    ctx.setLineDash(level === 50 ? [4, 4] : []);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = level === 50 ? '#e4e4e7' : '#94a3b8';
    ctx.textAlign = 'right';
    ctx.fillText(`${level}%`, pad.left - 8, y);
  });
  ctx.setLineDash([]);

  const first = points[0];
  const mid = points[Math.floor(points.length / 2)];
  const last = points[points.length - 1];
  ctx.font = '8px Arial';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(first.time || '--', first.x, height - 6);
  if (mid && mid !== first && mid !== last) ctx.fillText(mid.time || '--', mid.x, height - 6);
  ctx.fillText(last.time || '--', last.x, height - 6);

  const area = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  area.addColorStop(0, 'rgba(0,230,118,.30)');
  area.addColorStop(1, 'rgba(0,230,118,0)');
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(points[points.length - 1].x, height - pad.bottom);
  ctx.lineTo(points[0].x, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = area;
  ctx.fill();

  ctx.strokeStyle = '#00e676';
  ctx.lineWidth = 2.25;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  points.forEach(point => {
    ctx.fillStyle = '#05080d';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#00e676';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.1, 0, Math.PI * 2);
    ctx.fill();
  });

  const lastX = last.x;
  const lastY = last.y;
  ctx.shadowColor = 'rgba(0,230,118,.8)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#00e676';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 6.5, 0, Math.PI * 2);
  ctx.stroke();

  const now = Date.now();
  const canUpdateCurrent = !window.__gammaBuySellCurrentLastUpdate || (now - window.__gammaBuySellCurrentLastUpdate) >= 30000;
  if (labelEl && canUpdateCurrent) {
    const buyPct = Math.round(Number(last.buyPct) || 0);
    const sellPct = 100 - buyPct;
    labelEl.textContent = `${buyPct}% Buy / ${sellPct}% Sell`;
    labelEl.style.color = buyPct >= 50 ? '#00e676' : '#ff4757';
    if (pctEl) pctEl.textContent = `${buyPct}%`;
    window.__gammaBuySellCurrentLastUpdate = now;
  }
  if (timeEl) timeEl.textContent = last.time || '--';
  if (hintEl) hintEl.textContent = `Showing ${history.length} intraday points · Updated ${new Date(now).toLocaleTimeString('en-US', { hour12: false })}`;

  if (canvas.__gammaHoverBound) {
    canvas.removeEventListener('mousemove', canvas.__gammaHoverMove);
    canvas.removeEventListener('mouseleave', canvas.__gammaHoverLeave);
  }
  const showTooltip = event => {
    if (!wrapEl || !tooltipEl || !tooltipTitleEl || !tooltipBodyEl) return;
    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const nearest = points.reduce((best, point) => {
      const dist = Math.abs(point.x - localX);
      return !best || dist < best.dist ? { point, dist } : best;
    }, null)?.point;
    if (!nearest) return;
    tooltipTitleEl.textContent = `${Math.round(nearest.buyPct)}% Buy at ${nearest.time || '--'}`;
    tooltipTitleEl.style.color = nearest.buyPct >= 50 ? '#00e676' : '#ff4757';
    tooltipBodyEl.textContent = `Sell ${Math.round(nearest.sellPct)}% | Bias: ${nearest.buyPct >= 50 ? 'Buy' : 'Sell'}`;
    tooltipEl.style.display = 'block';
    const wrapRect = wrapEl.getBoundingClientRect();
    const x = Math.max(10, Math.min(wrapRect.width - 10, event.clientX - wrapRect.left));
    const y = Math.max(8, event.clientY - wrapRect.top - 14);
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
    tooltipEl.style.transform = x > wrapRect.width * 0.6 ? 'translate(-100%, -100%)' : 'translate(0, -100%)';
  };
  const hideTooltip = () => {
    if (tooltipEl) tooltipEl.style.display = 'none';
  };
  canvas.addEventListener('mousemove', showTooltip);
  canvas.addEventListener('mouseleave', hideTooltip);
  canvas.__gammaHoverBound = true;
  canvas.__gammaHoverMove = showTooltip;
  canvas.__gammaHoverLeave = hideTooltip;
}

function updateGammaLogic(gex, dex, dexVel) {
  const titleEl = document.getElementById('gamma-regime-title');
  const descEl = document.getElementById('gamma-regime-desc');
  const gexStatusEl = document.getElementById('gamma-gex-status');
  const gexLabelEl = document.getElementById('gamma-gex-label');
  const dexStatusEl = document.getElementById('gamma-dex-status');
  const dexLabelEl = document.getElementById('gamma-dex-label');
  const playbookEl = document.querySelector('[id*="playbook"]');

  let regime = 'NEUTRAL';
  let desc = 'Waiting for live dealer-hedging data...';

  if (gex >= 0 && dex > 0) {
    regime = 'LONG GAMMA';
    desc = 'Long Gamma / Bullish Delta: dealers buy dips and sell rallies, compressing volatility and supporting price near key levels.';
  } else if (gex < 0 && dex < 0) {
    regime = 'SHORT GAMMA';
    desc = 'Short Gamma / Bearish Delta: hedging follows the move, so volatility can expand quickly and directional breaks can accelerate.';
  } else if (gex >= 0 && dex < 0) {
    regime = 'CHOPPY TRADING';
    desc = 'Asymmetric Protection: gamma still stabilizes pullbacks, but negative delta hedging can lean against rallies and keep the tape choppy.';
  } else if (gex < 0 && dex > 0) {
    regime = 'VULNERABLE PEAKS';
    desc = 'Short Squeeze Potential: short gamma with positive delta can force rapid upside hedge-chasing if buyers take control.';
  }

  const formatGammaLogicValue = value => {
    const num = Number(value) || 0;
    const abs = Math.abs(num);
    const sign = num >= 0 ? '+' : '-';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  };

  if (titleEl) titleEl.textContent = regime;
  if (descEl) descEl.textContent = desc;
  if (gexStatusEl) gexStatusEl.textContent = formatGammaLogicValue(gex);
  if (gexLabelEl) gexLabelEl.textContent = gex >= 0 ? 'Vol Controlled' : 'Vol Expansion';
  if (dexStatusEl) dexStatusEl.textContent = formatGammaLogicValue(dex);
  if (dexLabelEl) dexLabelEl.textContent = dex > 0 ? 'Bullish Delta' : dex < 0 ? 'Bearish Shield' : 'Neutral Delta';
  if (playbookEl) playbookEl.textContent = desc;
}

// Update slider bars to show intraday range + current position + flip point
function updateSliderBars() {
  const state = window.__insightsGreekRangeState?.metrics;
  if (!state) return;

  function formatBillions(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '--';
    const normalized = Math.abs(num) >= 1e6 ? num / 1e9 : num;
    return (normalized >= 0 ? '+' : '') + normalized.toFixed(3) + 'B';
  }
  
  // Helper to set slider position
  function updateSlider(prefix, metric) {
    if (!metric) return;
    const value = Number(metric.current ?? metric.high ?? 0);

    const valueEl = document.getElementById(`greeks-${prefix}-value`);
    if (valueEl) valueEl.textContent = formatBillions(value);
  }
  
  updateSlider('gex', state.gex);
  updateSlider('dex', state.dex);
  updateSlider('chex', state.chex);
  updateSlider('vex', state.vex);
  updateSlider('gexvex', state.gexvex);

  if (!window.__insightsGreekHistory) {
    window.__insightsGreekHistory = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
  }
  renderGreekSparklines();
}

async function hydrateGreekSparklineHistoryFromDB() {
  if (window.__insightsGreekHistoryLoading) return;
  if (typeof DB === 'undefined' || !DB?.db || typeof DB.queryGreeksTimeSeries_Today !== 'function') return;
  window.__insightsGreekHistoryLoading = true;
  try {
    let records = await DB.queryGreeksTimeSeries_Today('');
    if (!Array.isArray(records) || !records.length) {
      if (typeof DB.queryGreeksTimeSeries_Hours === 'function') {
        records = await DB.queryGreeksTimeSeries_Hours(24, '');
      }
    }
    if (!Array.isArray(records) || !records.length) return;
    const history = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
    records
      .slice()
      .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0))
      .forEach(record => {
        const ts  = Number(record?.timestamp || 0);
        const gex = Number(record?.gex);
        const dex = Number(record?.dex);
        const chex = Number(record?.chex);
        const vex = Number(record?.vex);
        if (Number.isFinite(gex))  history.gex.push({ ts, value: gex });
        if (Number.isFinite(dex))  history.dex.push({ ts, value: dex });
        if (Number.isFinite(chex)) history.chex.push({ ts, value: chex });
        if (Number.isFinite(vex))  history.vex.push({ ts, value: vex });
        if (Number.isFinite(gex) || Number.isFinite(vex)) history.gexvex.push({ ts, value: (Number.isFinite(gex) ? gex : 0) + (Number.isFinite(vex) ? vex : 0) });
      });
    // Merge DB history with any live points already appended this session
    const existing = window.__insightsGreekHistory || {};
    const merged = {};
    ['gex','dex','chex','vex','gexvex'].forEach(k => {
      const dbPts  = history[k] || [];
      const livePts = (existing[k] || []).filter(p => p.ts > (dbPts.length ? dbPts[dbPts.length-1].ts : 0));
      merged[k] = dbPts.concat(livePts);
    });
    window.__insightsGreekHistory = merged;
  } catch (err) {
    console.warn('Greek sparkline DB hydrate failed:', err);
  } finally {
    window.__insightsGreekHistoryLoading = false;
    if (window.__insightsGreekHistory) renderGreekSparklines();
  }
}

function renderGreekSparklineCanvas(canvasId, values, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const parent = canvas.parentElement;
  const width = Math.max(180, Math.floor(parent?.clientWidth || 180));
  const height = Math.max(56, Math.floor(parent?.clientHeight || 56));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#07111a');
  bg.addColorStop(1, '#05080d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const points = (values || [])
    .map(point => point && typeof point === 'object'
      ? { ts: Number(point.ts || 0), value: Number(point.value) }
      : { ts: 0, value: Number(point) })
    .filter(point => Number.isFinite(point.value));

  if (points.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Awaiting history…', width / 2, height / 2);
    return;
  }

  let min = Math.min(...points.map(p => p.value));
  let max = Math.max(...points.map(p => p.value));
  if (min === max) {
    min -= Math.abs(min || 1);
    max += Math.abs(max || 1);
  }
  const padY = (max - min) * 0.12;
  min -= padY;
  max += padY;
  if (min > 0) min = 0;
  if (max < 0) max = 0;
  const range = max - min || 1;
  const pad = { left: 16, right: 10, top: 8, bottom: 12 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const yFor = v => pad.top + (max - v) / range * chartH;
  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;
  const xFor = ts => {
    const date = new Date(ts || Date.now());
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const map = {};
    for (const part of parts) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    const mins = Number(map.hour) * 60 + Number(map.minute);
    const rel = Math.max(0, Math.min(1, (mins - marketOpen) / (marketClose - marketOpen)));
    return pad.left + rel * chartW;
  };

  const pts = points.map(p => ({ x: xFor(p.ts), y: yFor(p.value), v: p.value, ts: p.ts }));
  const lastPoint = pts[pts.length - 1];

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const midX = (prev.x + cur.x) / 2;
    const midY = (prev.y + cur.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
  }
  ctx.lineTo(lastPoint.x, lastPoint.y);
  ctx.stroke();

  // End dot on last point
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const hourLabels = ['9', '10', '11', '12', '1', '2', '3', '4'];
  const labelY = height - 2;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '8px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  hourLabels.forEach((label, idx) => {
    const hour24 = idx < 4 ? 9 + idx : idx - 4 + 13;
    const mins = hour24 * 60;
    const rel = Math.max(0, Math.min(1, (mins - marketOpen) / (marketClose - marketOpen)));
    const x = pad.left + rel * chartW;
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

async function updateExposureStack() {
  if (window.currentInsightsTab && window.currentInsightsTab !== 'exposure') return;
  if (typeof window.renderInsights0DTE === 'function') window.renderInsights0DTE();

  const rowsResult = typeof window.getInsights0DTERows === 'function' ? window.getInsights0DTERows() : null;
  const rows = Array.isArray(rowsResult?.rows) ? rowsResult.rows : [];

  const totals = rows.reduce((memo, row) => {
    memo.gex += Number(row?.netGEX) || 0;
    memo.dex += Number(row?.netDEX) || 0;
    memo.chex += Number(row?.netCHEX) || 0;
    memo.vex += Number(row?.netVEX) || 0;
    return memo;
  }, { gex: 0, dex: 0, chex: 0, vex: 0 });
  totals.gexvex = totals.gex + totals.vex;

  await hydrateGreekSparklineHistoryFromDB();

  // Always update the buy/sell meter
  const { buyScore } = calculateBuySellScore(totals.gex, totals.dex, totals.chex, totals.vex);
  const barEl = document.getElementById('gamma-buy-sell-bar');
  const pctEl = document.getElementById('gamma-buy-sell-pct');
  const labelEl = document.getElementById('gamma-buy-sell-label');
  if (barEl) {
    barEl.style.width = `${buyScore}%`;
    barEl.style.background = buyScore >= 50
      ? 'linear-gradient(90deg,#ff4757 0%,#ffb300 48%,#00e676 100%)'
      : 'linear-gradient(90deg,#00e676 0%,#ffb300 52%,#ff4757 100%)';
  }
  if (pctEl) { pctEl.textContent = `${buyScore}%`; pctEl.style.color = buyScore >= 50 ? '#00e676' : '#ff4757'; }
  if (labelEl) { labelEl.textContent = `${buyScore}% Buy / ${100 - buyScore}% Sell`; labelEl.style.color = buyScore >= 50 ? '#00e676' : '#ff4757'; }
  // Mirror to gexvex active regime bar
  const gvBar = document.getElementById('gexvex-buysell-bar');
  const gvPct = document.getElementById('gexvex-buysell-pct');
  if (gvBar) { gvBar.style.width = `${buyScore}%`; }
  if (gvPct) { gvPct.textContent = `${buyScore}% Buy`; gvPct.style.color = buyScore >= 50 ? '#00e676' : '#ff4757'; }
  try { renderGammaBuySellChart(buyScore); } catch (e) {}

  if (!rows.length) return;

  const state = window.__insightsGreekRangeState?.metrics;
  if (state) {
    ['gex', 'dex', 'chex', 'vex'].forEach(key => {
      if (state[key]) state[key].current = totals[key];
    });
    // gexvex is derived — track intraday range dynamically
    if (!state.gexvex) state.gexvex = { low: totals.gexvex, high: totals.gexvex, current: totals.gexvex };
    state.gexvex.current = totals.gexvex;
    if (totals.gexvex < state.gexvex.low) state.gexvex.low = totals.gexvex;
    if (totals.gexvex > state.gexvex.high) state.gexvex.high = totals.gexvex;
  }
  // Update gexvex note
  const gexvexNote = document.getElementById('greeks-gexvex-note');
  if (gexvexNote) {
    const gv = totals.gexvex;
    gexvexNote.textContent = gv > 0
      ? 'Combined exposure is positive. Dealers stabilizing and vol dampening in effect.'
      : gv < 0
      ? 'Combined exposure is negative. Amplification regime — expect directional moves.'
      : 'Combined exposure near zero. Mixed signals.';
  }
  // Append live point to intraday history so sparklines track in real-time
  if (!window.__insightsGreekHistory) {
    window.__insightsGreekHistory = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
  }
  const _liveTs = Date.now();
  const _h = window.__insightsGreekHistory;
  // Throttle: only append if last point is >30s old
  const _lastTs = _h.gex.length ? (_h.gex[_h.gex.length-1].ts || 0) : 0;
  if (_liveTs - _lastTs > 30000) {
    _h.gex.push({ ts: _liveTs, value: totals.gex });
    _h.dex.push({ ts: _liveTs, value: totals.dex });
    _h.chex.push({ ts: _liveTs, value: totals.chex });
    _h.vex.push({ ts: _liveTs, value: totals.vex });
    _h.gexvex.push({ ts: _liveTs, value: totals.gexvex });
  }
  updateSliderBars();
  renderGreekSparklines();
  updateGammaLogic(totals.gex, totals.dex, 0);
  if (typeof updateGexVexRegime === 'function') updateGexVexRegime(totals.gex, totals.vex);
  updateInsightsInstitutionalAnalysis([totals.gex], [totals.dex], [totals.chex], [totals.vex], [buyScore]);
}
window.updateExposureStack = updateExposureStack;

// Poll intradayHistory every 2 seconds
setInterval(() => {
  if (window.currentInsightsTab === 'exposure' || !window.currentInsightsTab) {
    updateExposureStack();
  }
}, 2000);

window.addEventListener('resize', () => {
  try { renderGammaBuySellChart(); } catch (e) {}
  try { renderGreekSparklines(); } catch (e) {}
});

// GEX + VEX Regime logic
function updateGexVexRegime(gex, vex) {
  const REGIMES = [
    { id: 'bullish',    name: 'Strongly Bullish',     badge: 'STRONGLY BULLISH', color: '#00e676', test: (g,v) => g > 0 && v > 0,                desc: 'Stabilization + vol-crush buying flow. Melt-ups, buy-the-dip, low-volatility grind.' },
    { id: 'pinning',    name: 'Stable / Pinning',     badge: 'STABLE / PINNING', color: '#00e5ff', test: (g,v) => g > 0 && Math.abs(v) < 1e6,    desc: 'Dealers dampen moves, price sticks near key levels. Range-bound, mean-reversion plays.' },
    { id: 'explosive',  name: 'Explosive / Volatile', badge: 'EXPLOSIVE',        color: '#ff4757', test: (g,v) => g < 0 && v < 0,                desc: 'Amplification in both price & vol. Big directional breaks, trend days.' },
    { id: 'conflicted1',name: 'Conflicted (G↑ V↓)',  badge: 'CONFLICTED',       color: '#ffb300', test: (g,v) => g > 0 && v < 0,                desc: 'Gamma tries to stabilize, Vanna fights it. Choppy, whipsaw, event-driven reversals.' },
    { id: 'conflicted2',name: 'Conflicted (G↓ V↑)',  badge: 'CONFLICTED',       color: '#ff8c00', test: (g,v) => g < 0 && v > 0,                desc: 'Gamma amplifies, Vanna counters. Unpredictable, fakeouts common.' }
  ];

  const active = REGIMES.find(r => r.test(gex, vex)) || REGIMES[4];

  // Highlight active row
  const rowMap = { bullish: 'gvr-bullish', pinning: 'gvr-pinning', explosive: 'gvr-explosive', conflicted1: 'gvr-conflicted1', conflicted2: 'gvr-conflicted2' };
  REGIMES.forEach(r => {
    const row = document.getElementById('gvr-' + r.id.replace(/\d/g, '') + (r.id.match(/\d/) ? r.id.match(/\d/)[0] : ''));
    if (!row) return;
    row.style.background = r.id === active.id ? 'rgba(255,255,255,.06)' : 'transparent';
    row.style.outline = r.id === active.id ? '1px solid rgba(255,255,255,.12)' : 'none';
  });

  const nameEl = document.getElementById('gexvex-regime-name');
  const descEl = document.getElementById('gexvex-regime-desc');
  const badgeEl = document.getElementById('gexvex-regime-badge');
  const activeBox = document.getElementById('gexvex-active-regime');
  const activeNameEl = document.getElementById('gexvex-active-name');
  const activeDescEl = document.getElementById('gexvex-active-desc');
  if (activeBox) { activeBox.style.borderColor = active.color + '55'; activeBox.style.background = active.color + '10'; }
  if (activeNameEl) { activeNameEl.textContent = active.name; activeNameEl.style.color = active.color; }
  if (activeDescEl) activeDescEl.textContent = active.desc;
  if (badgeEl) { badgeEl.textContent = active.badge; badgeEl.style.color = active.color; badgeEl.style.borderColor = active.color + '55'; badgeEl.style.background = active.color + '20'; }
}
window.updateGexVexRegime = updateGexVexRegime;

// ── Override shell's switchInsightsTab ──────────────────────────────────────
window.switchInsightsTab = function(tabName) {
  window.currentInsightsTab = tabName;

  // Tab button highlights - scoped to page-insights only
  var root = document.getElementById('page-insights') || document;
  ['exposure','top10','ib','chain'].forEach(function(t) {
    var btn = root.querySelector('#tab-' + t);
    if (btn) {
      btn.style.borderBottomColor = t === tabName ? 'rgba(0,229,255,.45)' : 'transparent';
      btn.style.color = t === tabName ? 'var(--cyan)' : 'var(--text2)';
    }
  });

  var ibMain      = document.getElementById('ib-main');
  var leftSidebar = document.getElementById('insights-share-left');
  var expHeader   = document.getElementById('exposure-header');
  var expContent  = document.getElementById('exposure-content');
  var top10Shell  = document.getElementById('top10-shell');
  var chainMain   = document.getElementById('chain-main');

  if (tabName === 'exposure') {
    if (leftSidebar) { leftSidebar.style.display = 'flex'; leftSidebar.style.flexDirection = 'column'; }
    if (ibMain)      ibMain.style.display = 'none';
    if (expHeader)   expHeader.style.display = 'flex';
    if (expContent)  expContent.style.display = 'block';
    if (top10Shell)  top10Shell.style.display = 'none';
    if (chainMain)   chainMain.style.display = 'none';
    if (typeof hydrateGreekSparklineHistoryFromDB === 'function') hydrateGreekSparklineHistoryFromDB();
  } else if (tabName === 'top10') {
    if (leftSidebar) leftSidebar.style.display = 'none';
    if (ibMain)      ibMain.style.display = 'none';
    if (expHeader)   expHeader.style.display = 'none';
    if (expContent)  expContent.style.display = 'none';
    if (top10Shell)  { top10Shell.style.display = 'flex'; top10Shell.style.flexDirection = 'column'; }
    if (chainMain)   chainMain.style.display = 'none';
    setTimeout(function() { if (typeof window.top10FetchAndRender === 'function') window.top10FetchAndRender(); }, 10);
  } else if (tabName === 'ib') {
    if (leftSidebar) leftSidebar.style.display = 'none';
    if (ibMain)      { ibMain.style.display = 'flex'; ibMain.style.flexDirection = 'column'; }
    if (expHeader)   expHeader.style.display = 'none';
    if (expContent)  expContent.style.display = 'none';
    if (top10Shell)  top10Shell.style.display = 'none';
    if (chainMain)   chainMain.style.display = 'none';
    if (typeof window.seedIBFromCandles === 'function') window.seedIBFromCandles();
    if (typeof window.refreshIBPrice === 'function') window.refreshIBPrice();
  } else if (tabName === 'chain') {
    if (leftSidebar) leftSidebar.style.display = 'none';
    if (ibMain)      ibMain.style.display = 'none';
    if (expHeader)   expHeader.style.display = 'none';
    if (expContent)  expContent.style.display = 'none';
    if (top10Shell)  top10Shell.style.display = 'none';
    if (chainMain)   { chainMain.style.display = 'flex'; chainMain.style.flexDirection = 'column'; }
    if (typeof window.chainInit === 'function') window.chainInit();
  }
};

// ── OPTIONS CHAIN · /proxy/api/tt/chains/<TICKER> ─────────────────────────────
(function() {
  'use strict';

  // ── ticker list (from positions.txt) ──────────────────────────────────────
  var TICKER_LIST = [
    'SPX','SPY','QQQ','NDX','IWM','RSP',
    'AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA',
    'ABNB','AFRM','ARM','BA','BABA','CCJ','CHWY','COIN','COST','CRCL','CRM','CRWD','CRWV',
    'DJT','FDX','GME','GS','HIMS','HOOD','IBIT','INTC','IREN',
    'LAC','LLY','MA','MARA','MCD','MRK','MRNA','MU',
    'NIO','NKE','NNE','NOK','NXE','OKLO','OPEN','OXY',
    'PDD','PFE','PLTR','PTON','RBLX','RIOT','RKLB','ROKU',
    'SE','SMH','SMCI','SNDK','SNOW','SOFI','SOUN','SOXL',
    'TGT','TQQQ','TSM','TTD','TSLL',
    'U','UNH','UPS','UPST','V','XPEV','XYZ',
    'ASTS','AVGO','BYND','CMG','CWVX','ETHA','FBL','FIG','HIMZ',
    'LLYX','MSFU','NFLX','NVDX','OSCR','PONY','QBTS','QUBT','RGTI','RIVN','SLV','UUUU'
  ].sort();

  // ── state ──────────────────────────────────────────────────────────────────
  var _expirations  = [];
  var _expiryCache  = {};
  var _activeExpiry = null;
  var _activeTicker = 'SPX';
  var _strikes      = [];
  var _liveData     = {};
  var _spot         = 0;
  var _ws           = null;
  var _kaTimer      = null;
  var _subSymbols   = [];
  var _renderTimer  = null;
  var _priceMode    = 'mid';
  var _chainIntensity = 1.4;
  var CHAN_Q = 81;
  var CHAN_G = 82;

  // ── column config ──────────────────────────────────────────────────────────
  // Net greek columns sit between calls and puts (no per-side greek cols)
  var CALL_COLS = ['symbol','oi','vol','bid','ask','last','mid','iv','delta'];
  var PUT_COLS  = ['delta','iv','mid','last','bid','ask','vol','oi','symbol'];
  var NET_COLS  = ['gex','dex','chex','vex']; // combined call-put net, centered
  var COL_W = { symbol:'96px', oi:'70px', vol:'88px', bid:'62px', ask:'62px', last:'62px', mid:'62px', iv:'62px', delta:'60px', gex:'88px', dex:'88px', chex:'88px', vex:'88px' };
  var COL_LABELS = { symbol:'Symbol', oi:'OI', vol:'Vol', bid:'Bid', ask:'Ask', last:'Last', mid:'Mid', iv:'IV', delta:'Δ', gex:'NET GEX', dex:'NET DEX', chex:'NET CHEX', vex:'NET VEX' };

  function colsCSS() {
    var p = CALL_COLS.map(function(c) { return COL_W[c]; });
    NET_COLS.forEach(function(c) { p.push(COL_W[c]); });
    p.push('72px'); // strike
    PUT_COLS.forEach(function(c) { p.push(COL_W[c]); });
    return p.join(' ');
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  function fp(v, d) { var n = parseFloat(v); return isFinite(n) ? n.toFixed(d==null?2:d) : '--'; }
  function fpPct(v) { var n = parseFloat(v); return isFinite(n) ? (n*100).toFixed(1)+'%' : '--'; }
  function fmtDelta(v) { var n = parseFloat(v); return isFinite(n) ? (n>=0?'+':'')+n.toFixed(3) : '--'; }
  function fmtWhole(v) { var n = parseFloat(v); return isFinite(n) ? Math.round(n).toLocaleString('en-US') : '--'; }
  function fmtMoney(v) {
    var n = parseFloat(v);
    if (!isFinite(n)) return '--';
    var s = n >= 0 ? '+' : '-';
    var a = Math.abs(n);
    return s + '$' + (a/1e6).toFixed(2) + 'M';
  }

  function setStatus(state, msg) {
    var dot = el('chain-status-dot'), txt = el('chain-status-txt');
    var colors = { live:'#00e676', loading:'#ffb300', err:'#ff4757', idle:'#1e293b' };
    if (dot) dot.style.background = colors[state] || '#1e293b';
    if (txt) { txt.textContent = msg || state.toUpperCase(); txt.style.color = colors[state] || '#e4e4e7'; }
  }

  function todayETStr() {
    var parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    var m = {}; parts.forEach(function(p){m[p.type]=p.value;});
    return m.year+'-'+m.month+'-'+m.day;
  }

  function daysTo(dateStr) {
    return Math.round((new Date(dateStr) - new Date(todayETStr())) / 86400000);
  }

  function setPriceMode(mode) {
    _priceMode = mode === 'last' ? 'last' : 'mid';
    var lastBtn = el('chain-price-last');
    var midBtn = el('chain-price-mid');
    if (lastBtn) {
      lastBtn.style.background = _priceMode === 'last' ? '#00e5ff22' : 'transparent';
      lastBtn.style.borderColor = _priceMode === 'last' ? '#00e5ff' : 'rgba(255,255,255,.12)';
      lastBtn.style.color = _priceMode === 'last' ? '#00e5ff' : '#64748b';
    }
    if (midBtn) {
      midBtn.style.background = _priceMode === 'mid' ? '#00e5ff22' : 'transparent';
      midBtn.style.borderColor = _priceMode === 'mid' ? '#00e5ff' : 'rgba(255,255,255,.12)';
      midBtn.style.color = _priceMode === 'mid' ? '#00e5ff' : '#64748b';
    }
    renderTable();
  }

  function setChainIntensity(val) {
    var next = Math.max(0.2, Math.min(3, parseFloat(val) || 1.4));
    _chainIntensity = next;
    var slider = el('chain-intensity');
    var label = el('chain-intensity-val');
    if (slider && slider.value !== String(next)) slider.value = String(next);
    if (label) label.textContent = next.toFixed(2) + 'x';
    renderTable();
  }

  // -- build ticker datalist + input -------------------------------------------
  function buildTickerDropdown() {
    var input = el('chain-ticker-select');
    var dl    = el('chain-ticker-list');
    if (!dl || dl.children.length > 0) return;
    TICKER_LIST.forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t;
      dl.appendChild(opt);
    });
    if (input && !input._bound) {
      input._bound = true;
      input.addEventListener('input', function() { this.value = this.value.toUpperCase(); });
      function onTickerConfirm() {
        var v = input.value.trim().toUpperCase();
        if (!v) return;
        if (v === _activeTicker && _expirations.length) return;
        _activeTicker = v;
        var lbl = el('chain-ticker-label');
        if (lbl) lbl.textContent = v;
        _expirations = []; _activeExpiry = null;
        fetchExpirations();
      }
      input.addEventListener('change', onTickerConfirm);
      input.addEventListener('blur', onTickerConfirm);
    }
  }

  // ── fetch expirations and populate expiry dropdown ─────────────────────────
  function fetchExpirations(cb) {
    if (_expiryCache[_activeTicker] && _expiryCache[_activeTicker].length) {
      _expirations = _expiryCache[_activeTicker].slice();
      var expSelCached = el('chain-expiry-select');
      if (expSelCached) {
        expSelCached.innerHTML = '<option value="" style="background:#0a0e14;color:#e4e4e7">-- Expiry --</option>';
        _expirations.forEach(function(exp) {
          var opt = document.createElement('option');
          opt.value = exp.date;
          opt.textContent = exp.label;
          opt.style.background = '#0a0e14';
          opt.style.color = '#e4e4e7';
          expSelCached.appendChild(opt);
        });
      }
      setStatus('idle', 'READY');
      if (cb) cb(_expirations, { data: { items: _expirations } });
      return;
    }
    setStatus('loading', 'LOADING...');
    var expSel = el('chain-expiry-select');
    if (expSel) expSel.innerHTML = '<option value="">Loading...</option>';

    fetch('/proxy/api/tt/expirations/' + encodeURIComponent(_activeTicker))
      .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP '+r.status); })
      .then(function(json) {
        var items = (json.data && json.data.items) ? json.data.items : [];

        var seen = {};
        _expirations = [];
        items.forEach(function(item) {
          var d = item['expiration-date'] || '';
          if (!d || seen[d]) return;
          seen[d] = true;
          var dt = daysTo(d);
          var mmdd = d.slice(5); // MM-DD
          var dte  = dt <= 7 ? dt + 'DTE' : dt + 'DTE';
          var label = dte + '  ' + mmdd;
          _expirations.push({ date:d, daysTo:dt, label:label, type: item['expiration-type'] || '' });
        });
        _expirations.sort(function(a,b){ return a.daysTo - b.daysTo; });

        // Filter to 0-7DTE + weeklies/Fridays only after that
        var filtered = _expirations.filter(function(e) {
          if (e.daysTo <= 7) return true;
          // Use expiration-type if available, else fall back to Friday check
          var expType = (e.type || '').toLowerCase();
          if (expType === 'weekly' || expType === 'monthly') return true;
          var parts = e.date.split('-');
          var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
          return d.getDay() === 5;
        });

        if (expSel) {
          expSel.innerHTML = '<option value="" style="background:#0a0e14;color:#e4e4e7">-- Expiry --</option>';
          filtered.forEach(function(exp) {
            var opt = document.createElement('option');
            opt.value = exp.date;
            opt.textContent = exp.label;
            opt.style.background = '#0a0e14';
            opt.style.color = '#e4e4e7';
            expSel.appendChild(opt);
          });
          // Auto-select 0DTE if available
          var dte0 = filtered.filter(function(e){ return e.daysTo===0; })[0];
          if (dte0) { expSel.value = dte0.date; _activeExpiry = dte0.date; }
        }

        setStatus('idle', 'READY');
        _expiryCache[_activeTicker] = _expirations.slice();
        if (cb) cb(items, json);
      })
      .catch(function(e) {
        setStatus('err', 'ERR: '+e);
        if (expSel) expSel.innerHTML = '<option value="">Error loading</option>';
      });
  }

  // ── fetch strikes for a specific expiry ────────────────────────────────────
  // Flow: (1) fetch chain with noSubscribe to get streamer symbols
  //       (2) POST symbols to /proxy/dxlink/subscribe with Quote+Greeks+Trade
  //       (3) wait 3s for proxy caches to fill
  //       (4) fetch chain again — now bid/ask/greeks are in the response
  function getChainRangePct(underlyingPrice) {
    var px = parseFloat(underlyingPrice);
    if (!isFinite(px) || px <= 0) return 'all';
    return Math.max(1, Math.round(px * 0.30));
  }

  function loadExpiry(expDate) {
    setStatus('loading', 'LOADING...');
    var bodyEl = el('chain-body');
    if (bodyEl) bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:13px;color:#64748b;font-family:Arial">Subscribing quotes...</div>';

    var baseUrl = '/proxy/api/tt/chains/' + encodeURIComponent(_activeTicker) + '?expiration=' + expDate;
    var isSPY = /^SPY$/i.test(_activeTicker);

    // Step 1: fetch with noSubscribe=1 to get strike/streamer symbols fast
    fetch(baseUrl + '&noSubscribe=1&range=all')
      .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP '+r.status); })
      .then(function(json) {
        var items = (json.data && json.data.items) ? json.data.items : [];
        var targetItems = items.filter(function(i){ return i['expiration-date']===expDate; });
        var preStrikes = buildStrikes(targetItems.length ? targetItems : items);
        updateSpot(json.data && json.data.underlyingPrice);
        var chainRange = getChainRangePct(json.data && json.data.underlyingPrice);
        var chainRangeQS = chainRange === 'all' ? 'all' : String(chainRange);

        // Collect all streamer symbols
        var allSyms = [];
        preStrikes.forEach(function(r) {
          if (r.callSym) allSyms.push(r.callSym);
          if (r.putSym)  allSyms.push(r.putSym);
        });

        if (!allSyms.length || isSPY) {
          // SPY or empty — just use what we have, connect WS
          _strikes = preStrikes;
          renderHeader();
          renderTable();
          setTimeout(connectDxLink, 400);
          setStatus('live', 'LIVE');
          return;
        }

        // Step 2: subscribe Quote+Greeks+Trade for all symbols
        var feedTypesBySymbol = {};
        allSyms.forEach(function(s) { feedTypesBySymbol[s] = ['Quote','Greeks','Trade']; });
        if (bodyEl) bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:13px;color:#64748b;font-family:Arial">Waiting for quotes...</div>';

        fetch('/proxy/dxlink/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: allSyms, feedTypesBySymbol: feedTypesBySymbol })
        }).catch(function(){});

        // Step 3: wait 3s for proxy caches to fill, then re-fetch with live data baked in
        setTimeout(function() {
          if (bodyEl) bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:13px;color:#64748b;font-family:Arial">Loading chain...</div>';
          fetch(baseUrl + '&range=' + chainRangeQS)
            .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP '+r.status); })
            .then(function(json2) {
              var items2 = (json2.data && json2.data.items) ? json2.data.items : [];
              var target2 = items2.filter(function(i){ return i['expiration-date']===expDate; });
              _strikes = buildStrikes(target2.length ? target2 : items2);
              updateSpot(json2.data && json2.data.underlyingPrice);
              renderHeader();
              renderTable();
              setTimeout(connectDxLink, 200);
              setStatus('live', 'LIVE');
            })
            .catch(function(e) { setStatus('err', 'ERR: '+e); });
        }, 3000);
      })
      .catch(function(e) { setStatus('err', 'ERR: '+e); });
  }

  // ── parse response items into strike rows ──────────────────────────────────
  // Each item: { expiration-date, strike-price, call: { symbol, streamer-symbol, bid, ask, last, delta, iv... }, put: {...} }
  function buildStrikes(expGroups) {
    var map = {};
    // Each expGroup: { 'expiration-date', strikes: [{ 'strike-price', call:{...}, put:{...} }] }
    expGroups.forEach(function(expGroup) {
      var strikeRows = expGroup.strikes || [];
      strikeRows.forEach(function(item) {
        var strike = parseFloat(item['strike-price'] || 0);
        if (!strike) return;
        var key = strike.toFixed(2);
        if (!map[key]) map[key] = { strike:strike, callSym:null, putSym:null, callTT:null, putTT:null };
        var r = map[key];
        function safeFloat(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
        function safeInt(v)   { var n = parseInt(v,10); return isFinite(n) ? n : null; }
        if (item.call) {
          r.callTT  = item.call.symbol || '';
          r.callSym = item.call['streamer-symbol'] || item.call.symbol || '';
          if (r.callSym) _liveData[r.callSym] = {
            bid:   safeFloat(item.call.bid),
            ask:   safeFloat(item.call.ask),
            last:  safeFloat(item.call.last),
            iv:    safeFloat(item.call['implied-volatility']),
            delta: safeFloat(item.call.delta),
            gamma: safeFloat(item.call.gamma),
            theta: safeFloat(item.call.theta),
            vega:  safeFloat(item.call.vega),
            oi:    safeInt(item.call['open-interest']),
            vol:   safeInt(item.call.volume),
            size:  null
          };
        }
        if (item.put) {
          r.putTT  = item.put.symbol || '';
          r.putSym = item.put['streamer-symbol'] || item.put.symbol || '';
          if (r.putSym) _liveData[r.putSym] = {
            bid:   safeFloat(item.put.bid),
            ask:   safeFloat(item.put.ask),
            last:  safeFloat(item.put.last),
            iv:    safeFloat(item.put['implied-volatility']),
            delta: safeFloat(item.put.delta),
            gamma: safeFloat(item.put.gamma),
            theta: safeFloat(item.put.theta),
            vega:  safeFloat(item.put.vega),
            oi:    safeInt(item.put['open-interest']),
            vol:   safeInt(item.put.volume),
            size:  null
          };
        }
      });
    });
    return Object.values(map).sort(function(a,b){ return a.strike - b.strike; });
  }

  function updateSpot(price) {
    var p = parseFloat(price);
    if (isFinite(p) && p > 0) {
      _spot = p;
      var spotEl = el('chain-spot');
      if (spotEl) spotEl.textContent = p.toFixed(2);
    } else if (window.esPrice > 1000) {
      _spot = window.esPrice;
    }
  }

  // ── expiry dropdown handler ────────────────────────────────────────────────
  function bindExpirySelect() {
    var expSel = el('chain-expiry-select');
    if (!expSel || expSel._bound) return;
    expSel._bound = true;
    expSel.addEventListener('change', function() {
      _activeExpiry = this.value || null;
      if (_activeExpiry) loadExpiry(_activeExpiry);
    });
  }

  window._chainSelectExpiry = function(date) {
    _activeExpiry = date;
    var expSel = el('chain-expiry-select');
    if (expSel) expSel.value = date;
  };
  window.setChainIntensity = setChainIntensity;

  // ── render column header ───────────────────────────────────────────────────
  function renderHeader() {
    var hdr = el('chain-header');
    if (!hdr) return;
    var cols = colsCSS();
    hdr.setAttribute('style', 'display:grid;grid-template-columns:'+cols+';background:var(--bg2);border-bottom:2px solid var(--border2);flex-shrink:0;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase');

    var callH = CALL_COLS.map(function(c) {
      return '<div style="padding:5px 6px;text-align:'+(c==='symbol'?'left':'right')+';color:#2298cf;font-family:Arial">'+(COL_LABELS[c]||c)+'</div>';
    });
    var netH = NET_COLS.map(function(c) {
      return '<div style="padding:5px 6px;text-align:center;color:#a78bfa;font-family:Arial">'+(COL_LABELS[c]||c)+'</div>';
    });
    var strikeH = '<div style="padding:5px 6px;text-align:center;color:#e4e4e7;font-family:Arial">Strike</div>';
    var putH = PUT_COLS.map(function(c) {
      return '<div style="padding:5px 6px;text-align:'+(c==='symbol'?'right':'right')+';color:#ff7c88;font-family:Arial">'+(COL_LABELS[c]||c)+'</div>';
    });
    hdr.innerHTML = callH.join('') + netH.join('') + strikeH + putH.join('');
  }

  // ── render rows ────────────────────────────────────────────────────────────
  function renderTable() {
    var bodyEl = el('chain-body');
    if (!bodyEl) return;
    if (!_strikes.length) {
      bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:13px;color:#ff4757;font-family:Arial">No strikes returned</div>';
      return;
    }
    var cols = colsCSS();
    var spot = _spot;
    var atmStrike = spot > 0 ? _strikes.reduce(function(best, r) {
      return Math.abs(r.strike-spot) < Math.abs(best.strike-spot) ? r : best;
    }, _strikes[0]).strike : 0;
    var maxAbs = { gex: 1, dex: 1, chex: 1, vex: 1 };
    var baseSpot = _spot > 0 ? _spot : (window.esPrice > 1000 ? window.esPrice : 0);
    _strikes.forEach(function(row) {
      var cd = _liveData[row.callSym] || {};
      var pd = _liveData[row.putSym] || {};
      var cc = (parseFloat(cd.oi)||0) + (parseFloat(cd.vol)||0);
      var pc = (parseFloat(pd.oi)||0) + (parseFloat(pd.vol)||0);
      var gex  = Math.abs(((parseFloat(cd.gamma)||0)*(parseFloat(cd.delta)||0)*(parseFloat(cd.vol)||0) - (parseFloat(pd.gamma)||0)*Math.abs(parseFloat(pd.delta)||0)*(parseFloat(pd.vol)||0)) * baseSpot * baseSpot * 0.01 * 100);
      var dex  = Math.abs((Math.abs(parseFloat(cd.delta)||0)*cc - Math.abs(parseFloat(pd.delta)||0)*pc) * baseSpot * 100);
      var chex = Math.abs((-(parseFloat(cd.theta)||0)*cc + (parseFloat(pd.theta)||0)*pc) * baseSpot * 100);
      var vex  = Math.abs(((parseFloat(cd.vega)||0)*cc - (parseFloat(pd.vega)||0)*pc) * baseSpot * 100);
      if (gex > maxAbs.gex) maxAbs.gex = gex;
      if (dex > maxAbs.dex) maxAbs.dex = dex;
      if (chex > maxAbs.chex) maxAbs.chex = chex;
      if (vex > maxAbs.vex) maxAbs.vex = vex;
    });
    function metricBg(value, maxValue) {
      var n = parseFloat(value) || 0;
      if (!n) return 'transparent';
      var ratio = Math.min(Math.abs(n) / Math.max(maxValue, 1) * (0.35 + _chainIntensity * 0.65), 1);
      var alpha = 0.08 + Math.pow(ratio, 1.45) * 0.82;
      return n >= 0 ? 'rgba(0,229,255,' + alpha.toFixed(2) + ')' : 'rgba(255,71,87,' + alpha.toFixed(2) + ')';
    }

    // Sort descending — highest strike on top
    var sortedStrikes = _strikes.slice().sort(function(a,b){ return b.strike - a.strike; });

    var html = sortedStrikes.map(function(row) {
      var isATM = row.strike === atmStrike;
      var cd = _liveData[row.callSym] || {};
      var pd = _liveData[row.putSym]  || {};
      var rowBg = isATM ? 'background:rgba(255,179,0,.07);border-top:1px solid rgba(255,179,0,.25);border-bottom:1px solid rgba(255,179,0,.25)' : 'border-bottom:1px solid rgba(30,48,80,.35)';
      var spot = _spot > 0 ? _spot : (window.esPrice > 1000 ? window.esPrice : 0);

      // ── net greeks (call - put) ──
      var callContracts = (parseFloat(cd.oi) || 0) + (parseFloat(cd.vol) || 0);
      var putContracts  = (parseFloat(pd.oi) || 0) + (parseFloat(pd.vol) || 0);
      var netGex  = ((parseFloat(cd.gamma)||0) * (parseFloat(cd.delta)||0) * (parseFloat(cd.vol)||0) - (parseFloat(pd.gamma)||0) * Math.abs(parseFloat(pd.delta)||0) * (parseFloat(pd.vol)||0)) * spot * spot * 0.01 * 100;
      var netDex  = (Math.abs(parseFloat(cd.delta)||0) * callContracts - Math.abs(parseFloat(pd.delta)||0) * putContracts) * spot * 100;
      var netChex = (-(parseFloat(cd.theta)||0) * callContracts + (parseFloat(pd.theta)||0) * putContracts) * spot * 100;
      var netVex  = ((parseFloat(cd.vega)||0) * callContracts - (parseFloat(pd.vega)||0) * putContracts) * spot * 100;

      function cell(col, d, side) {
        var v='--', color='#a8b8cc', align='right';
        var mid = (d.bid != null && d.ask != null && isFinite(d.bid) && isFinite(d.ask)) ? ((d.bid + d.ask) / 2) : null;
        if (col==='symbol') {
          v = (row.strike%1===0 ? row.strike.toFixed(0) : row.strike.toFixed(2)) + ' ' + (side==='call'?'C':'P');
          color = side==='call' ? '#4db8ff' : '#ff7c88'; align = side==='call' ? 'left' : 'right';
        }
        else if (col==='last')  { v=fp(d.last,2);       color='#e4e4e7'; }
        else if (col==='mid')   { v=fp(mid,2);           color='#e4e4e7'; }
        else if (col==='bid')   { v=fp(d.bid,2);         color='#f87171'; }
        else if (col==='ask')   { v=fp(d.ask,2);         color='#4ade80'; }
        else if (col==='iv')    { v=fpPct(d.iv);         color='#7278ca'; }
        else if (col==='delta') { v=fmtDelta(d.delta);   color=parseFloat(d.delta)>=0?'#00e676':'#ff4757'; }
        else if (col==='oi')    { v=fmtWhole(d.oi);      color='#94a3b8'; }
        else if (col==='vol')   { v=fmtWhole(d.vol);     color='#e4e4e7'; }
        var extra = col==='symbol' ? 'min-width:0;' : '';
        return '<div style="padding:5px 8px;font-size:13px;font-family:Arial,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'+extra+'text-align:'+align+';color:'+color+'">'+v+'</div>';
      }

      function netCell(val, maxVal) {
        var v = val ? fmtMoney(val) : '--';
        var bg = metricBg(val, maxVal);
        return '<div style="padding:5px 8px;font-size:12px;font-family:Arial,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;color:#ffffff;background:'+bg+';font-weight:700">'+v+'</div>';
      }

      var strikeColor = isATM ? '#ffb300' : '#94a3b8';
      var strikeCell = '<div style="padding:4px 6px;font-size:13px;font-weight:800;font-family:Arial,monospace;text-align:center;color:'+strikeColor+';border-left:1px solid rgba(255,255,255,.06);border-right:1px solid rgba(255,255,255,.06)'+(isATM?';background:rgba(255,179,0,.12)':'')+'">'
        + row.strike.toFixed(row.strike%1===0?0:2)
        + '</div>';

      var callCells = CALL_COLS.map(function(c){ return cell(c, cd, 'call'); }).join('');
      var putCells  = PUT_COLS.map(function(c){  return cell(c, pd, 'put');  }).join('');
      var netCells  = netCell(netGex, maxAbs.gex) + netCell(netDex, maxAbs.dex) + netCell(netChex, maxAbs.chex) + netCell(netVex, maxAbs.vex);

      return '<div style="display:grid;grid-template-columns:'+cols+';'+rowBg+'" data-strike="'+row.strike+'">'+callCells+netCells+strikeCell+putCells+'</div>';
    }).join('');

    bodyEl.innerHTML = html;

    // Auto-center only until the user starts scrolling the chain.
    if (atmStrike > 0 && !window.__chainAutoCenterBlocked) {
      setTimeout(function() {
        var rows = bodyEl.querySelectorAll('[data-strike]');
        var closest = null, minDist = Infinity;
        rows.forEach(function(r) {
          var d = Math.abs(parseFloat(r.dataset.strike) - atmStrike);
          if (d < minDist) { minDist=d; closest=r; }
        });
        if (closest) closest.scrollIntoView({ block:'center' });
      }, 60);
    }

    // Update timestamp
    var tsEl = el('chain-last-update');
    if (tsEl) tsEl.textContent = new Date().toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  }

  // ── dxLink live updates (via proxy WS bridge) ────────────────────────────
  function connectDxLink() {
    if (_ws && _ws.readyState === 1) { sendSubscriptions(); return; }
    if (_ws) { try { _ws.close(); } catch(e) {} _ws = null; }

    _ws = new WebSocket('ws://localhost:3001/ws/dxlink');
    _ws.onopen = function() {
      setStatus('live', 'LIVE');
      sendSubscriptions();
    };
    _ws.onmessage = function(e) { handleMsg(e.data); };
    _ws.onclose   = function() { setStatus('idle', 'DISCONNECTED'); _ws = null; };
    _ws.onerror   = function() { setStatus('err', 'WS ERR'); };
  }

  function sendSubscriptions() {
    if (!_ws || _ws.readyState !== 1) return;
    _subSymbols = [];
    _strikes.forEach(function(r) {
      if (r.callSym) _subSymbols.push(r.callSym);
      if (r.putSym)  _subSymbols.push(r.putSym);
    });
    if (!_subSymbols.length) return;

    // Proxy WS bridge expects: { type:'subscribe', symbols:[...], feedTypesBySymbol:{sym:[types]} }
    var feedTypesBySymbol = {};
    _subSymbols.forEach(function(s) { feedTypesBySymbol[s] = ['Quote','Greeks']; });
    _ws.send(JSON.stringify({
      type: 'subscribe',
      symbols: _subSymbols,
      feedTypesBySymbol: feedTypesBySymbol
    }));
  }

  function handleMsg(raw) {
    var msg; try { msg = JSON.parse(raw); } catch(e) { return; }
    if (msg.type !== 'FEED_DATA') return;

    // Proxy broadcasts: { type:'FEED_DATA', data: [ {eventType, eventSymbol, ...fields}, ... ] }
    var data = msg.data;
    if (!Array.isArray(data)) return;
    var changed = false;
    data.forEach(function(ev) {
      if (!ev || !ev.eventSymbol) return;
      var t = ev.eventType;
      if (t === 'Quote')  { applyQuote(ev);  changed = true; }
      if (t === 'Greeks') { applyGreeks(ev); changed = true; }
    });
    if (changed) scheduleRender();
  }

  function applyQuote(ev) {
    var sym=ev.eventSymbol;
    if (!_liveData[sym]) _liveData[sym]={};
    var d=_liveData[sym];
    if (ev.bidPrice  != null) d.bid  = ev.bidPrice;
    if (ev.askPrice  != null) d.ask  = ev.askPrice;
    if (ev.lastPrice != null) d.last = ev.lastPrice;
    if (ev.lastSize  != null) d.size = ev.lastSize;
  }

  function applyGreeks(ev) {
    var sym = ev.eventSymbol;
    if (!_liveData[sym]) _liveData[sym] = {};
    var d = _liveData[sym];
    // proxy broadcasts: volatility, delta, gamma, theta, rho, vega
    if (ev.volatility != null) d.iv    = ev.volatility;
    if (ev.delta      != null) d.delta = ev.delta;
    if (ev.gamma      != null) d.gamma = ev.gamma;
    if (ev.theta      != null) d.theta = ev.theta;
    if (ev.vega       != null) d.vega  = ev.vega;
  }

  function scheduleRender() {
    if (_renderTimer) return;
    _renderTimer = setTimeout(function() {
      _renderTimer = null;
      if (window.esPrice > 1000) _spot = window.esPrice;
      renderTable();
    }, 120);
  }

  // ── public ─────────────────────────────────────────────────────────────────
  window.chainInit = function() {
    buildTickerDropdown();
    bindExpirySelect();
    setPriceMode(_priceMode);
    var bodyEl = el('chain-body');
    if (bodyEl && !bodyEl._userScrollBound) {
      bodyEl._userScrollBound = true;
      ['wheel', 'touchstart', 'pointerdown', 'mousedown', 'scroll'].forEach(function(type) {
        bodyEl.addEventListener(type, function() {
          window.__chainAutoCenterBlocked = true;
        }, { passive: true });
      });
    }
  };

  window.chainGo = function() {
    var tickerInput = el('chain-ticker-select');
    var expSel      = el('chain-expiry-select');
    var ticker = tickerInput ? tickerInput.value.trim().toUpperCase() : 'SPX';
    var expiry = expSel ? expSel.value : null;
    var lbl = el('chain-ticker-label');
    if (lbl) lbl.textContent = ticker || 'SPX';

    // If ticker changed, re-fetch expirations then load
    if (ticker !== _activeTicker || !_expirations.length) {
      _activeTicker = ticker || 'SPX';
      _expirations = []; _activeExpiry = null;
      fetchExpirations(function() {
        var expSel2 = el('chain-expiry-select');
        var e = expSel2 ? expSel2.value : null;
        if (e) { _activeExpiry = e; loadExpiry(e); }
        else setStatus('idle', 'PICK EXPIRY');
      });
    } else {
      // Expirations already loaded — just load selected expiry
      if (!expiry) { setStatus('err', 'SELECT EXPIRY'); return; }
      _activeExpiry = expiry;
      loadExpiry(expiry);
    }
  };

  window.chainLoad = window.chainGo; // backward compat

  // ── screenshot / share ───────────────────────────────────────────────────
  var CHAIN_DISCORD_WEBHOOK = '/proxy/api/discord-webhook';
  var html2canvasPromise = null;

  function loadHtml2Canvas() {
    if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = function() { resolve(window.html2canvas); };
      s.onerror = function() { reject(new Error('html2canvas failed to load')); };
      document.head.appendChild(s);
    });
    return html2canvasPromise;
  }

  function chainBtnState(btn, text, color) {
    if (!btn) return;
    btn.textContent = text;
    btn.style.color = color;
  }

  function chainBtnRestore(btn, orig, color) {
    setTimeout(function() { chainBtnState(btn, orig, color); }, 1500);
  }

  function inlineComputedStyles(source, clone) {
    if (!(source instanceof Element) || !(clone instanceof Element)) return;
    var computed = window.getComputedStyle(source);
    for (var i = 0; i < computed.length; i++) {
      var prop = computed[i];
      clone.style.setProperty(prop, computed.getPropertyValue(prop), computed.getPropertyPriority(prop));
    }
    var sourceKids = source.children || [];
    var cloneKids = clone.children || [];
    for (var j = 0; j < sourceKids.length; j += 1) inlineComputedStyles(sourceKids[j], cloneKids[j]);
  }

  function captureChain(cb) {
    var chainMain = document.getElementById('chain-main');
    var target = document.getElementById('chain-capture-zone');
    if (!target) { cb(new Error('no target'), null); return; }
    var headerRow = document.getElementById('chain-header');

    // Show screenshot header with current ticker/expiry/time
    var hdr    = document.getElementById('chain-shot-header');
    var ticker = document.getElementById('chain-shot-ticker');
    var expiry = document.getElementById('chain-shot-expiry');
    var time   = document.getElementById('chain-shot-time');
    if (ticker) ticker.textContent = _activeTicker || 'SPX';
    if (expiry) expiry.textContent = _activeExpiry  || '--';
    if (time)   time.textContent   = new Date().toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) + ' ET';
    if (hdr)    hdr.style.display  = 'flex';

    loadHtml2Canvas().then(function(html2canvasFn) {
      var prev = {};
      function stash(el, prop) {
        if (!el) return;
        prev[prop] = el.style.cssText;
      }
      stash(chainMain, 'main');
      stash(target, 'target');
      stash(headerRow, 'header');
      stash(hdr, 'shot');
      try {
        if (chainMain) {
          chainMain.style.overflow = 'visible';
          chainMain.style.position = 'relative';
          chainMain.style.height = 'auto';
          chainMain.style.minHeight = '0';
        }
        if (target) {
          target.style.overflow = 'visible';
          target.style.maxHeight = 'none';
          target.style.minHeight = '0';
        }
        if (headerRow) {
          headerRow.style.position = 'sticky';
          headerRow.style.top = '0';
          headerRow.style.zIndex = '20';
        }

        html2canvasFn(chainMain || target, {
          backgroundColor: '#05080d',
          scale: 2,
          useCORS: true,
          logging: false,
          allowTaint: true
        }).then(function(canvas) {
          if (chainMain && prev.main !== undefined) chainMain.style.cssText = prev.main;
          if (target && prev.target !== undefined) target.style.cssText = prev.target;
          if (headerRow && prev.header !== undefined) headerRow.style.cssText = prev.header;
          if (hdr && prev.shot !== undefined) hdr.style.cssText = prev.shot;
          canvas.toBlob(function(blob) { cb(null, blob); }, 'image/png');
        }).catch(function(e) {
          if (chainMain && prev.main !== undefined) chainMain.style.cssText = prev.main;
          if (target && prev.target !== undefined) target.style.cssText = prev.target;
          if (headerRow && prev.header !== undefined) headerRow.style.cssText = prev.header;
          if (hdr && prev.shot !== undefined) hdr.style.cssText = prev.shot;
          cb(e, null);
        });
      } catch (err) {
        if (chainMain && prev.main !== undefined) chainMain.style.cssText = prev.main;
        if (target && prev.target !== undefined) target.style.cssText = prev.target;
        if (headerRow && prev.header !== undefined) headerRow.style.cssText = prev.header;
        if (hdr && prev.shot !== undefined) hdr.style.cssText = prev.shot;
        cb(err, null);
      }
    }).catch(function(err) {
      if (hdr) hdr.style.display = 'none';
      cb(err || new Error('html2canvas unavailable'), null);
    });
  }

  async function writeChainBlobToClipboard(blob) {
    if (!blob) throw new Error('No blob');
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
      return true;
    }
    var url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
    return false;
  }

  window.chainCopyScreenshot = function() {
    var btn = document.getElementById('chain-copy-btn');
    var orig = btn ? btn.textContent : 'COPY';
    chainBtnState(btn, '…', '#ffb300');
    captureChain(function(err, blob) {
      if (err || !blob) { chainBtnState(btn, 'ERR', '#ff4757'); chainBtnRestore(btn, orig, '#00e5ff'); return; }
      writeChainBlobToClipboard(blob).then(function() {
        chainBtnState(btn, '✓', '#00e676');
        chainBtnRestore(btn, orig, '#00e5ff');
      }).catch(function() {
        chainBtnState(btn, 'ERR', '#ff4757');
        chainBtnRestore(btn, orig, '#00e5ff');
      });
    });
  };

  window.chainShare = function(platform) {
    var btn = platform === 'x'
      ? document.getElementById('chain-share-x-btn')
      : document.getElementById('chain-share-discord-btn');
    var origColor = platform === 'x' ? '#00e5ff' : '#7289da';
    var orig = btn ? btn.textContent : platform.toUpperCase();
    chainBtnState(btn, '…', '#ffb300');

    if (platform === 'x') {
      setTimeout(function() {
        chainBtnState(btn, orig, origColor);
        var ticker = _activeTicker || 'SPX';
        var expiry = _activeExpiry || '';
        window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(ticker + ' Options Chain ' + expiry), '_blank');
      }, 300);
      return;
    }

    captureChain(function(err, blob) {
      if (err || !blob) { chainBtnState(btn, 'ERR', '#ff4757'); chainBtnRestore(btn, orig, origColor); return; }
      var form = new FormData();
      var ticker = _activeTicker || 'SPX';
      var expiry = _activeExpiry || '';
      form.append('payload_json', JSON.stringify({ content: ticker + ' Options Chain ' + expiry }));
      form.append('files[0]', blob, 'chain-' + ticker + '-' + expiry + '.png');
      fetch(CHAIN_DISCORD_WEBHOOK, { method: 'POST', body: form }).then(function(res) {
        if (res.ok) {
          chainBtnState(btn, '✓', '#00e676');
          chainBtnRestore(btn, orig, origColor);
        } else { throw new Error('webhook ' + res.status); }
      }).catch(function() {
        chainBtnState(btn, 'ERR', '#ff4757');
        chainBtnRestore(btn, orig, origColor);
      });
    });
  };

  document.addEventListener('click', function(e) {
    var copyBtn = e.target && e.target.closest ? e.target.closest('#chain-copy-btn') : null;
    var xBtn = e.target && e.target.closest ? e.target.closest('#chain-share-x-btn') : null;
    var dBtn = e.target && e.target.closest ? e.target.closest('#chain-share-discord-btn') : null;
    if (copyBtn) { e.preventDefault(); window.chainCopyScreenshot(); }
    if (xBtn) { e.preventDefault(); window.chainShare('x'); }
    if (dBtn) { e.preventDefault(); window.chainShare('discord'); }
  }, true);

  window.chainCopyScreenshot = function() {
    var btn = document.getElementById('chain-copy-btn');
    if (btn) { btn.textContent = '...'; btn.style.color = '#ffb300'; }
    var target = document.getElementById('chain-capture-zone');
    if (!target) {
      if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(function(){ btn.textContent = 'COPY'; btn.style.color = '#00e5ff'; }, 1500); }
      return;
    }

    captureChain(function(err, blob) {
      if (err || !blob) {
        console.error('[Chain] copy capture failed:', err);
        if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(function(){ btn.textContent = 'COPY'; btn.style.color = '#00e5ff'; }, 1500); }
        return;
      }

      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(function() {
          if (btn) { btn.textContent = 'OK'; btn.style.color = '#00e676'; setTimeout(function(){ btn.textContent = 'COPY'; btn.style.color = '#00e5ff'; }, 1500); }
        }).catch(function(err2) {
          console.warn('[Chain] clipboard write failed, opening image instead:', err2);
          var url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
          if (btn) { btn.textContent = 'OK'; btn.style.color = '#00e676'; setTimeout(function(){ btn.textContent = 'COPY'; btn.style.color = '#00e5ff'; }, 1500); }
        });
      } else {
        var url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
        if (btn) { btn.textContent = 'OK'; btn.style.color = '#00e676'; setTimeout(function(){ btn.textContent = 'COPY'; btn.style.color = '#00e5ff'; }, 1500); }
      }
    });
  };

  window.chainShare = function(platform) {
    var btn = platform === 'x' ? document.getElementById('chain-share-x-btn') : document.getElementById('chain-share-discord-btn');
    var restore = platform === 'x' ? '#00e5ff' : '#7289da';
    var label = platform === 'x' ? 'X' : 'DISCORD';
    if (btn) { btn.textContent = '...'; btn.style.color = '#ffb300'; }

    if (platform === 'x') {
      var ticker = _activeTicker || 'SPX';
      var expiry = _activeExpiry || '';
      setTimeout(function() {
        if (btn) { btn.textContent = label; btn.style.color = restore; }
        window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(ticker + ' Options Chain ' + expiry), '_blank');
      }, 200);
      return;
    }

    captureChain(function(err, blob) {
      if (err || !blob) {
        console.error('[Chain] discord capture failed:', err);
        if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(function(){ btn.textContent = label; btn.style.color = restore; }, 1500); }
        return;
      }
      var form = new FormData();
      var ticker = _activeTicker || 'SPX';
      var expiry = _activeExpiry || '';
      form.append('payload_json', JSON.stringify({ content: ticker + ' Options Chain ' + expiry }));
      form.append('files[0]', blob, 'chain-' + ticker + '-' + expiry + '.png');
      fetch(CHAIN_DISCORD_WEBHOOK, { method: 'POST', body: form }).then(function(res) {
        if (!res.ok) throw new Error('webhook ' + res.status);
        if (btn) { btn.textContent = 'OK'; btn.style.color = '#00e676'; setTimeout(function(){ btn.textContent = label; btn.style.color = restore; }, 1500); }
      }).catch(function(err2) {
        console.error('[Chain] discord webhook failed:', err2);
        if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(function(){ btn.textContent = label; btn.style.color = restore; }, 1500); }
      });
    });
  };

})();
// ── END OPTIONS CHAIN ──────────────────────────────────────────────────────

// Initialize tab state on load
(function() {
  if (typeof window.switchInsightsTab === 'function') {
    window.switchInsightsTab(window.currentInsightsTab || 'exposure');
  }
})();
