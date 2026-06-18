(() => {
  if (window.__initialBalanceModuleLoaded) return;
  window.__initialBalanceModuleLoaded = true;

  const logicRows = [
    {
      title: 'The Inside Day Exception',
      color: '#00e5ff',
      items: [
        'If the 60-minute RTH Initial Balance completes from 9:30 to 10:30 AM ET, the remainder of the session stays fully inside that range only 0.6% of the time.',
        'Operationally, the default expectation is at least one breakout. Do not build a plan that depends on the range holding.'
      ]
    },
    {
      title: 'ES Structural Asymmetry',
      color: '#ffb300',
      items: [
        'IB Low breaks more often than IB High on the long-term ES baseline.',
        'IB High break probability: 67.1%.',
        'IB Low break probability: 72.4%.'
      ]
    },
    {
      title: 'Cross-Asset Whiplash',
      color: '#00e676',
      items: [
        'If one side of the IB breaks early, there is still a meaningful risk of a full double breach.',
        'ES double breach probability: 40.1%.',
        'NQ double breach probability: 23.5%.'
      ]
    },
    {
      title: 'Midpoint Dominance',
      color: '#ff5ec4',
      items: [
        'If ES closes or trades above the IB midpoint, the odds favor an eventual IB High breakout.',
        'Above-mid ES probability of IB High break: 83.5%.',
        'If ES closes or trades below the midpoint, the odds strongly favor an IB Low break.',
        'Below-mid ES probability of IB Low break: 94.9%.',
        'NQ above-mid probability of IB High break: 83.3%.',
        'NQ below-mid probability of IB Low break: 78.2%.'
      ]
    },
    {
      title: 'Timing Curve',
      color: '#7cff6b',
      items: [
        'Most IB-related breakout activity happens quickly after 10:30 AM ET.',
        '84.1% of session breakouts appear within the first 30 minutes after the IB closes.',
        'Average time to first breakout: 18 minutes.',
        'Median time to first breakout: 2 minutes.',
        'If neither boundary has broken by 11:00 AM ET, the setup usually shifts toward range behavior and premium decay.'
      ]
    },
    {
      title: 'Boundary Sequence',
      color: '#ff5ec4',
      items: [
        'When the IB low forms first on NQ, the remainder of the session skews upward.',
        'Probability of breaking IB High after low-first: 78.79%.',
        'Probability of later breaking back through IB Low: 19.7%.'
      ]
    },
    {
      title: 'Tuesday Behavior',
      color: '#00e676',
      items: [
        'Tuesday sessions show a distinct path bias on NQ.',
        'If the IB High forms first on Tuesday, the first break skews to IB Low first: 58.33%.',
        'If the IB Low forms first on Tuesday, the first break skews to IB High first: 64.29%.'
      ]
    },
    {
      title: 'Volatility Compression',
      color: '#ffb300',
      items: [
        'On compressed NQ days where IB size is 0% to 1%, a 5-minute close below IB Low is a strong continuation trigger.',
        'Probability of continued downside after a -0.1 close: 98.01%.',
        'Probability of continued downside after closes of -0.2, -0.3, -0.4, -0.5, and -0.8: 87.56%, 81.59%, 74.63%, 67.66%, and 50.75%.',
        'A reversal to a 5-minute close above +0.1 is extremely rare at 0.5%.'
      ]
    },
    {
      title: 'Modern Regimes',
      color: '#00e5ff',
      items: [
        'Recent 6-month data shows cleaner trend holding than the older 10-year baseline.',
        'NQ single-break trend day rate: 80.95%.',
        'NQ double breach risk: 14.29%.',
        'ES single-break trend day rate: 75.59%.',
        'ES double breach risk: 22.05%.',
        'The current regime favors respecting first breaks instead of automatically fading them.'
      ]
    },
    {
      title: 'Liquidity Sweep Confluence',
      color: '#ff5ec4',
      items: [
        'If price tags the prior day high early, then locks into an IB High first path, and the opening hour closes large and red, treat it as a trap setup.',
        'Bias shifts bearish, with the preferred trade being a short on pullbacks into the opening-hour distribution.',
        'Target the IB Low and protect above the opening price.'
      ]
    }
  ];

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  async function initInsightsInitialBalance() {
    const el = document.getElementById('ib-content');
    if (!el) return;

    el.innerHTML = `
      <div id="ib-main" style="display:flex;flex-direction:column;gap:14px">
        <style>
          @media (max-width: 1200px) {
            #ib-logic-list { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          }
          @media (max-width: 760px) {
            #ib-logic-list { grid-template-columns: 1fr !important; }
          }
        </style>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px">
          <div>
            <div style="font-size:11px;color:var(--text3);letter-spacing:.16em;text-transform:uppercase;font-weight:800;margin-bottom:8px">Static IB Logic Reference</div>
            <div style="font-size:22px;color:var(--text0);font-weight:800">Initial Balance Logic, Listed Out</div>
            <div style="font-size:12px;color:var(--text3);margin-top:6px">This view is intentionally static so it can be used even when live data is not working.</div>
          </div>
          <div style="display:flex;gap:2px;background:#070c14;border-radius:2px;padding:2px;flex-shrink:0">
            <button id="ib-copy-shot-btn" onclick="copyIBScreenshot()" title="Copy screenshot" style="font-size:9px;padding:2px 8px;border:none;border-radius:2px;background:transparent;color:#00e5ff;cursor:pointer;font-family:Arial;font-weight:700">COPY SHOT</button>
            <button id="ib-share-x-btn" onclick="shareIB('x')" title="Copy and open X" style="font-size:9px;padding:2px 8px;border:none;border-radius:2px;background:transparent;color:#00e5ff;cursor:pointer;font-family:Arial;font-weight:700">X</button>
            <button id="ib-share-discord-btn" onclick="shareIB('discord')" title="Post to Discord" style="font-size:9px;padding:2px 8px;border:none;border-radius:2px;background:transparent;color:#7289da;cursor:pointer;font-family:Arial;font-weight:700">DISCORD</button>
          </div>
        </div>
        <div style="border:1px solid rgba(0,229,255,.18);background:rgba(0,229,255,.04);border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--cyan);letter-spacing:.14em;text-transform:uppercase;font-weight:800;margin-bottom:8px">Reference Summary</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.55">
            IB logic is a probability map, not a prediction engine. The core read is:
            first hour sets the range, midpoint tells directional pressure, the first break matters most, and compressed days can expand fast.
          </div>
        </div>
        <div id="ib-logic-list" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px"></div>
      </div>
    `;

    const list = document.getElementById('ib-logic-list');
    if (list) {
      list.innerHTML = logicRows.map(row => `
        <div style="border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;background:rgba(255,255,255,.02)">
          <div style="font-size:13px;color:${row.color};font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">${row.title}</div>
          <ul style="margin:0;padding-left:18px;color:var(--text2);font-size:13px;line-height:1.55">
            ${row.items.map(item => `<li style="margin-bottom:6px">${item}</li>`).join('')}
          </ul>
        </div>
      `).join('');
    }

    setText('ib-price', '--');
    setText('ib-high', '--');
    setText('ib-low', '--');
    setText('ib-mid', '--');
    setText('ib-width', '--');
    setText('ib-time', '--:--:--');
  }

  window.init_insights_initial_balance = initInsightsInitialBalance;
  window.copyIBScreenshot = async function copyIBScreenshot() {
    const btn = document.getElementById('ib-copy-shot-btn');
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = 'COPY';
    setTimeout(() => {
      btn.textContent = orig || 'COPY SHOT';
    }, 900);
  };

  window.shareIB = async function shareIB(platform) {
    const btn = platform === 'x' ? document.getElementById('ib-share-x-btn') : document.getElementById('ib-share-discord-btn');
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = platform === 'x' ? 'X' : 'OK';
    setTimeout(() => {
      btn.textContent = orig || (platform === 'x' ? 'X' : 'DISCORD');
    }, 900);
  };

  if (window.PageRuntime?.register) {
    window.PageRuntime.register('initial-balance', () => {});
  }
})();
