'use strict';
/**
 * server-v2/greeks-cross-alerts.js
 *
 * Zero-line cross detector for net GEX and net DEX ($SPX, OI+Vol basis) — the
 * server-side version of the flips the /greeks page draws. The page's own
 * gamma-logic engine is client-only (it can only fire while a tab is open), so
 * detection lives here instead: fed from greeks-ts-writer.js, which already
 * polls the totals every 30s.
 *
 * Emits [Greeks] lines into public/signals.txt → home SignalsFeed → Discord
 * (via discord-relay.js). Alerts only.
 *
 * ── Why the hysteresis (READ BEFORE TUNING) ─────────────────────────────────
 * A naive `sign(prev) !== sign(now)` detector is what got signals-engine's
 * flip_cross alert disabled: GEX oscillating around zero re-fired the alert
 * every poll (~30s) and buried the feed ([[signals-flip-cross-disabled]]).
 * Three guards, all of which must pass:
 *
 *   1. DEADBAND — a value within ±BAND of zero is "neutral" and does NOT
 *      establish a side. Sides only flip band-to-band, so noise around zero is
 *      structurally incapable of producing a cross.
 *   2. CONFIRM  — the new side must hold for CONFIRM_N consecutive polls
 *      (~60s at the writer's 30s cadence) before the alert fires.
 *   3. COOLDOWN — at most one alert per metric per COOLDOWN_MS.
 *
 * The caller (greeks-ts-writer.writeRow) only reaches us AFTER its stale-spot
 * and populated-strikes guards pass, so a frozen index feed can't manufacture a
 * cross — that was the root cause of the original false crosses
 * ([[greeks-frozen-spot-crosses]]).
 *
 * Env:
 *   GREEKS_CROSS_DISABLED=1     hard off
 *   GREEKS_CROSS_GEX_BAND       $B deadband for GEX (default 0.50)
 *   GREEKS_CROSS_DEX_BAND       $B deadband for DEX (default 0.25)
 *   GREEKS_CROSS_CONFIRM        consecutive polls to confirm (default 2)
 *   GREEKS_CROSS_COOLDOWN_MS    per-metric cooldown (default 30m)
 */

const { appendAutoLines } = require('./signals-file');

const DISABLED = process.env.GREEKS_CROSS_DISABLED === '1';
const CONFIRM_N = Number(process.env.GREEKS_CROSS_CONFIRM || 2);
const COOLDOWN_MS = Number(process.env.GREEKS_CROSS_COOLDOWN_MS || 30 * 60 * 1000);
const MAX_LINES = 20;

// Per-metric config. Bands are asymmetric because the two live on different
// scales — SPX net GEX routinely runs tens of $B, net DEX is much tighter.
const METRICS = {
  gex: {
    label: 'GEX',
    band: Number(process.env.GREEKS_CROSS_GEX_BAND || 0.5),
    // What the flip MEANS, which is the whole point of the alert.
    up: 'dealers long gamma — expect mean-reversion / pinning',
    down: 'dealers short gamma — expect trend + amplified moves',
  },
  dex: {
    label: 'DEX',
    band: Number(process.env.GREEKS_CROSS_DEX_BAND || 0.25),
    up: 'dealer delta flipped positive',
    down: 'dealer delta flipped negative',
  },
};

// state[metric] = { side, pending, pendingCount, lastFiredAt }
//   side: 'pos' | 'neg' | null   — last CONFIRMED side (null until first read
//                                  outside the deadband; we never alert on the
//                                  first observation, only on a real transition)
const state = Object.create(null);
for (const k of Object.keys(METRICS)) {
  state[k] = { side: null, pending: null, pendingCount: 0, lastFiredAt: 0 };
}

function etDisplayTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d).replace(/\s?([AP]M)$/i, (m, ap) => ' ' + ap.toUpperCase());
}

/** Which side of the deadband is this value on? null = inside the band. */
function sideOf(value, band) {
  if (value >= band) return 'pos';
  if (value <= -band) return 'neg';
  return null;
}

/**
 * Feed one observation. Called once per greeks-ts write (~30s).
 * @param {{gexB:number, dexB:number, spot:number}} obs — $B, already basis-correct
 */
function noteGreeks(obs) {
  if (DISABLED) return;

  const now = Date.now();
  const lines = [];

  for (const [key, cfg] of Object.entries(METRICS)) {
    const value = key === 'gex' ? obs.gexB : obs.dexB;
    if (!Number.isFinite(value)) continue;

    const st = state[key];
    const side = sideOf(value, cfg.band);

    // Inside the deadband: not a side. Cancel any in-progress confirmation —
    // a value that wobbles back into the band never had conviction.
    if (side === null) { st.pending = null; st.pendingCount = 0; continue; }

    // Same side as confirmed: nothing to do, clear any pending.
    if (side === st.side) { st.pending = null; st.pendingCount = 0; continue; }

    // Different side — start or advance confirmation.
    if (st.pending === side) st.pendingCount += 1;
    else { st.pending = side; st.pendingCount = 1; }

    if (st.pendingCount < CONFIRM_N) continue;

    const prevSide = st.side;
    // Commit the new side regardless of whether we alert, so a cooldown-
    // suppressed flip doesn't leave us stuck on the stale side forever.
    st.side = side;
    st.pending = null;
    st.pendingCount = 0;

    // First confirmed reading of the session — establishes a baseline, it's not
    // a cross. Nothing crossed; we just now know where we are.
    if (prevSide === null) continue;

    // Every line that reaches here IS a confirmed sign flip (same-side readings
    // were already `continue`d above) — so the old blanket cooldown could ONLY
    // ever suppress a real regime change. That's how the feed ended up showing
    // two consecutive "crossed 0 ↑ positive" alerts with the intervening ↓ cross
    // missing: a long-gamma tape that never existed.
    //
    // Keep the cooldown as a spam damper for WEAK flips that are still hugging
    // the deadband (|value| < 2× band = the value is oscillating, not committing),
    // but a decisive flip always fires. Regime changes are never suppressed.
    const decisive = Math.abs(value) >= cfg.band * 2;
    if (!decisive && now - st.lastFiredAt < COOLDOWN_MS) continue;
    st.lastFiredAt = now;

    const dir = side === 'pos' ? 'positive' : 'negative';
    const arrow = side === 'pos' ? '↑' : '↓';
    const meaning = side === 'pos' ? cfg.up : cfg.down;
    const val = `${value >= 0 ? '+' : ''}${value.toFixed(2)}B`;

    lines.push(
      `${etDisplayTime()}  [Greeks] ${cfg.label} crossed 0 ${arrow} ${dir} (${val}) — ${meaning} {/greeks}`
    );
  }

  if (lines.length) {
    void appendAutoLines('GREEKS', lines, MAX_LINES);
    lines.forEach((l) => console.log(`[greeks-cross] ${l}`));
  }
}

/** Reset confirmed sides — call on a session boundary if desired. */
function resetGreeksCross() {
  for (const k of Object.keys(METRICS)) {
    state[k] = { side: null, pending: null, pendingCount: 0, lastFiredAt: 0 };
  }
}

module.exports = { noteGreeks, resetGreeksCross };
