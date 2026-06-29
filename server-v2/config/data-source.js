'use strict';
/**
 * server-v2/config/data-source.js
 *
 * Single source of truth for the ThetaData migration rollback flag (doc §9/§10).
 *
 * DATA_SOURCE selects the OPTIONS data provider only. Futures (ES/NQ candles,
 * settle, watchlist) ALWAYS stay on TastyTrade/dxLink regardless of this flag —
 * ThetaData does not sell futures data, so there is nothing to switch there.
 *
 *   DATA_SOURCE=tt     (default) → options chain/OI/greeks/flow from TT + dxLink
 *   DATA_SOURCE=theta            → options chain/OI/greeks/flow from ThetaData
 *
 * Build the flag FIRST so a bad Theta day can be reverted with one env change
 * and a `docker compose up -d --force-recreate` — no code rollback.
 */

const RAW = String(process.env.DATA_SOURCE || 'tt').trim().toLowerCase();
const DATA_SOURCE = RAW === 'theta' ? 'theta' : 'tt';

const useTheta = () => DATA_SOURCE === 'theta';
const useTastytradeForOptions = () => DATA_SOURCE === 'tt';

// INDEX_SOURCE is a SEPARATE flag for SPX/VIX spot (indices), independent of the
// options DATA_SOURCE. Default dxlink (real-time, free with the brokerage). Set
// to theta only after confirming Theta Index is real-time during RTH (PRO Index
// tier). ES futures ALWAYS stay on dxLink regardless — Theta has no futures.
const RAW_IDX = String(process.env.INDEX_SOURCE || 'dxlink').trim().toLowerCase();
const INDEX_SOURCE = RAW_IDX === 'theta' ? 'theta' : 'dxlink';
const useThetaIndex = () => INDEX_SOURCE === 'theta';

// ThetaData Terminal connection. Locally the Terminal binds 127.0.0.1:25503
// (v3 REST, paths under /v3/...) and ws://127.0.0.1:25520/v1/events. On the VPS
// the Terminal is a sibling container, so point these at the compose service
// name (e.g. http://theta-terminal:25503) via env — never hardcode 127.0.0.1
// once it's a separate container (doc §7).
const THETA_BASE_URL = (process.env.THETA_BASE_URL || 'http://127.0.0.1:25503').replace(/\/+$/, '');
const THETA_WS_URL = process.env.THETA_WS_URL || 'ws://127.0.0.1:25520/v1/events';
const THETA_DATA_API_KEY = process.env.THETA_DATA_API_KEY || '';

if (useTheta()) {
  // eslint-disable-next-line no-console
  console.log(`[DATA_SOURCE] options provider = THETA (base ${THETA_BASE_URL}); futures stay on TT/dxLink`);
} else {
  // eslint-disable-next-line no-console
  console.log('[DATA_SOURCE] options provider = TASTYTRADE/dxLink (default)');
}

if (useThetaIndex()) {
  // eslint-disable-next-line no-console
  console.log('[INDEX_SOURCE] SPX/VIX spot = THETA index price stream');
} else {
  // eslint-disable-next-line no-console
  console.log('[INDEX_SOURCE] SPX/VIX spot = dxLink (default)');
}

module.exports = {
  DATA_SOURCE,
  useTheta,
  useTastytradeForOptions,
  INDEX_SOURCE,
  useThetaIndex,
  THETA_BASE_URL,
  THETA_WS_URL,
  THETA_DATA_API_KEY,
};
