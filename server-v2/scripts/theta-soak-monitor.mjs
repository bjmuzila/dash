/**
 * server-v2/scripts/theta-soak-monitor.mjs
 *
 * Soak watcher for the DATA_SOURCE=theta cutover. Polls /proxy/gex + /proxy/flow
 * on a cadence, logs a compact line per sample to console AND an append-only file,
 * and flags anomalies so you can leave it running a full session and skim the log
 * afterward instead of eyeballing live.
 *
 * Run (server-v2 must be up with DATA_SOURCE=theta):
 *   node scripts/theta-soak-monitor.mjs [intervalSec=60] [port=3002]
 *
 * Anomalies flagged:
 *   - wall jump      : callWall/putWall moves > WALL_JUMP_PCT of spot between samples
 *   - flow stalled   : /proxy/flow prints count hasn't increased for STALL_SAMPLES
 *   - gex sign flip  : totalNetGex crosses zero (regime change — note, not error)
 *   - empty/refused  : route returned no walls or errored
 */

import { appendFileSync } from 'fs';

const INTERVAL = Number(process.argv[2] || 60) * 1000;
const PORT = Number(process.argv[3] || 3002);
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = `theta-soak-${new Date().toISOString().slice(0, 10)}.log`;

const WALL_JUMP_PCT = 0.015; // 1.5% of spot = a "jump" worth noting
const STALL_SAMPLES = 3;     // flow prints flat this many polls = stalled

let prev = null;
let stalls = 0;

function line(s) {
  console.log(s);
  try { appendFileSync(LOG, s + '\n'); } catch { /* noop */ }
}

async function getJson(path) {
  try {
    const r = await fetch(`${BASE}${path}`, { cache: 'no-store' });
    if (!r.ok) return { _err: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) { return { _err: String(e.message || e).slice(0, 80) }; }
}

async function sample() {
  const ts = new Date().toISOString().slice(11, 19);
  const gex = await getJson('/proxy/gex');
  const flow = await getJson('/proxy/flow');

  if (gex._err) { line(`${ts}  GEX ERROR ${gex._err}`); return; }

  const spot = Number(gex.spot ?? 0);
  const cw = gex.callWall, pw = gex.putWall, flip = gex.gexFlip;
  const tng = Number(gex.totalNetGex ?? 0);
  const prints = flow._err ? NaN : Number(flow.prints ?? 0);
  const buyPct = flow._err ? NaN : Number(flow.buyPct ?? 0);

  const flags = [];
  if (cw == null || pw == null) flags.push('NO-WALLS');
  if (prev && spot > 0) {
    const jump = Math.abs(spot) * WALL_JUMP_PCT;
    if (prev.cw != null && cw != null && Math.abs(cw - prev.cw) > jump) flags.push(`CALLWALL-JUMP ${prev.cw}->${cw}`);
    if (prev.pw != null && pw != null && Math.abs(pw - prev.pw) > jump) flags.push(`PUTWALL-JUMP ${prev.pw}->${pw}`);
    if (prev.tng != null && Math.sign(prev.tng) !== Math.sign(tng) && tng !== 0) flags.push(`GEX-SIGN-FLIP ${(prev.tng/1e9).toFixed(1)}B->${(tng/1e9).toFixed(1)}B`);
  }
  if (Number.isFinite(prints)) {
    if (prev && prints <= prev.prints) { stalls++; if (stalls >= STALL_SAMPLES) flags.push(`FLOW-STALLED ${stalls}x`); }
    else stalls = 0;
  }
  if (flow._err) flags.push(`FLOW-ERR ${flow._err}`);

  line(
    `${ts}  spot=${spot.toFixed(1)}  cw=${cw ?? '-'} pw=${pw ?? '-'} flip=${flip ? Number(flip).toFixed(1) : '-'}` +
    `  gex=${(tng / 1e9).toFixed(2)}B  prints=${Number.isFinite(prints) ? prints : '-'} buy%=${Number.isFinite(buyPct) ? buyPct.toFixed(0) : '-'}` +
    (flags.length ? `  ⚠ ${flags.join(' | ')}` : '  ok')
  );

  prev = { cw, pw, tng, prints: Number.isFinite(prints) ? prints : (prev?.prints ?? 0) };
}

line(`[soak] watching ${BASE} every ${INTERVAL / 1000}s → ${LOG}  (Ctrl+C to stop)`);
await sample();
setInterval(sample, INTERVAL);
