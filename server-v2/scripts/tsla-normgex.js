// One-off: closest-expiration TSLA normalized GEX.
// Run inside the dashboard container: node server-v2/scripts/tsla-normgex.js
const { computeGexRows, normalizeGex } = require('../computation/gex-calculator');

const BASE = `http://127.0.0.1:${process.env.PORT || 3001}`;

async function main() {
  const expJson = await fetch(`${BASE}/api/expirations?ticker=TSLA`).then(r => r.json());
  const expItems = expJson?.data?.items ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const dates = [...new Set(expItems.map(i => String(i['expiration-date'] ?? '')).filter(Boolean))]
    .filter(d => d >= today)
    .sort();
  const expiry = dates[0];
  if (!expiry) throw new Error('no upcoming TSLA expiration found');

  const chainJson = await fetch(
    `${BASE}/api/chains?ticker=TSLA&expiration=${encodeURIComponent(expiry)}&range=all`
  ).then(r => r.json());
  const data = chainJson?.data ?? {};
  const spot = Number(data.underlyingPrice ?? 0);
  const groups = (data.items ?? []).filter(
    g => String(g['expiration-date'] ?? '').slice(0, 10) === expiry.slice(0, 10)
  );

  // Flatten nested {strikes:[{call,put}]} groups into flat computeGexRows input.
  const flat = [];
  for (const g of groups) {
    for (const item of (g.strikes || [])) {
      const strike = parseFloat(String(item['strike-price'] || 0));
      if (!strike) continue;
      for (const side of ['call', 'put']) {
        const o = item[side];
        if (!o) continue;
        flat.push({
          strike,
          side,
          oi: parseInt(String(o['open-interest'] ?? o.openInterest ?? 0), 10) || 0,
          volume: parseInt(String(o.volume ?? 0), 10) || 0,
          gamma: parseFloat(String(o.gamma ?? 0)) || 0,
          delta: parseFloat(String(o.delta ?? 0)) || 0,
          theta: parseFloat(String(o.theta ?? 0)) || 0,
          vega: parseFloat(String(o.vega ?? 0)) || 0,
          iv: parseFloat(String(o['implied-volatility'] ?? o.iv ?? 0)) || 0,
        });
      }
    }
  }

  if (!flat.length) throw new Error(`no strikes parsed for TSLA ${expiry} — check item shape`);

  const gexRows = computeGexRows(flat, spot);
  const normalized = normalizeGex(gexRows)
    .sort((a, b) => b.normalizedGexPct - a.normalizedGexPct)
    .slice(0, 15);

  console.log(`TSLA closest expiry: ${expiry}  spot: ${spot}`);
  console.log(
    normalized.map(r => ({
      strike: r.strike,
      netGEX: Math.round((r.netGEX ?? 0) + (r.netVolGEX ?? 0)),
      pct: r.normalizedGexPct.toFixed(2),
    }))
  );
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
