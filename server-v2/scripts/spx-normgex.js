// One-off: full SPX chain normalized GEX.
// SPX runs through the live in-process feed (/api/gex -> /proxy/gex), so no
// manual chain fetch/flatten is needed the way TSLA required.
// Run inside the dashboard container: node server-v2/scripts/spx-normgex.js
const { normalizeGex } = require('../computation/gex-calculator');

const BASE = `http://127.0.0.1:${process.env.PORT || 3001}`;

async function main() {
  const json = await fetch(`${BASE}/api/gex`).then(r => r.json());
  const rows = Array.isArray(json.chain) ? json.chain : [];
  if (!rows.length) throw new Error('empty /api/gex chain — feed may be down/stale');

  const normalized = normalizeGex(rows).sort((a, b) => b.strike - a.strike);

  console.log(`SPX expiry: ${json.expiration}  spot: ${json.spotPrice}  totalNetGex: ${json.totalNetGex}`);
  console.log(
    normalized.map(r => ({
      strike: r.strike,
      netGEX: Math.round((r.netGEX ?? 0) + (r.netVolGEX ?? 0)),
      pct: r.normalizedGexPct.toFixed(2),
    }))
  );
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
