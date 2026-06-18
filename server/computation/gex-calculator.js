const { getLatestBuySellPct } = require('./flow-processor');
const {
  firstFiniteNumber,
  maxWholeNumber,
  todayYmd,
  optionExpirationCompact,
  isSpxwSymbol
} = require('./utils');
const { accumulateExposureTotals } = require('./vex-chex');

function computeIntradaySnapshot({ dxGreeksCache, dxSummaryCache, readBuySellBackup, spot }) {
  const totals = {
    totalGEX: 0,
    totalDeltaCall: 0,
    totalDeltaPut: 0,
    totalCharmCall: 0,
    totalCharmPut: 0,
    totalVegaCall: 0,
    totalVegaPut: 0
  };

  const todayCompact = todayYmd().compact;
  for (const [symbol, greeks] of Object.entries(dxGreeksCache)) {
    if (!isSpxwSymbol(symbol)) continue;
    if (optionExpirationCompact(symbol) !== todayCompact) continue;

    const summary = dxSummaryCache[symbol] || {};
    const oi = maxWholeNumber(summary.openInterest) || 0;
    const vol = maxWholeNumber(summary.dayVolume) || 0;
    const contracts = oi + vol;
    if (!contracts) continue;

    accumulateExposureTotals({
      totals,
      isCall: /C\d{4,8}$/.test(symbol),
      gamma: firstFiniteNumber(greeks.gamma, 0),
      delta: firstFiniteNumber(greeks.delta, 0),
      theta: firstFiniteNumber(greeks.theta, 0),
      vega: firstFiniteNumber(greeks.vega, 0),
      contracts,
      spot
    });
  }

  const now = new Date();
  return {
    time: now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'America/New_York'
    }),
    ts: now.getTime(),
    gex: totals.totalGEX / 1e9,
    dex: (totals.totalDeltaCall + totals.totalDeltaPut) / 1e9,
    chex: (totals.totalCharmCall + totals.totalCharmPut) / 1e6,
    vex: (totals.totalVegaCall + totals.totalVegaPut) / 1e6,
    buyPct: getLatestBuySellPct(readBuySellBackup()),
    spot
  };
}

function spxLevelToEs(spxLevel, basis) {
  return Math.round((spxLevel + basis) * 4) / 4;
}

function buildGexLevels({ dxGreeksCache, dxSummaryCache, underlyingPrice, fallbackSpot = 0, esBasis = 0 }) {
  const strikes = [];
  for (const [symbol, greeks] of Object.entries(dxGreeksCache)) {
    if (!isSpxwSymbol(symbol)) continue;

    const summary = dxSummaryCache[symbol] || {};
    const gamma = Math.abs(firstFiniteNumber(greeks.gamma, 0));
    const oi = maxWholeNumber(summary.openInterest);
    const isCall = /C\d{4,8}$/.test(symbol);
    const match = String(symbol).match(/[CP](\d{4,6})$/);
    if (!match) continue;

    const strike = parseInt(match[1], 10);
    if (!strike) continue;

    let row = strikes.find((item) => item.strike === strike);
    if (!row) {
      row = { strike, callGamma: 0, callOI: 0, putGamma: 0, putOI: 0 };
      strikes.push(row);
    }

    if (isCall) {
      row.callGamma = gamma;
      row.callOI = oi;
    } else {
      row.putGamma = gamma;
      row.putOI = oi;
    }
  }

  if (strikes.length < 5) return null;

  const spot = firstFiniteNumber(underlyingPrice, fallbackSpot, 0);
  if (!(spot > 0)) return null;

  strikes.forEach((row) => {
    row.callGEX = row.callGamma * row.callOI * spot * spot;
    row.putGEX = row.putGamma * row.putOI * spot * spot;
    row.netGEX = row.callGEX - row.putGEX;
  });

  const callWall = strikes.reduce((max, row) => (row.callGEX > max.callGEX ? row : max), strikes[0]).strike;
  const putWall = strikes.reduce((max, row) => (Math.abs(row.putGEX) > Math.abs(max.putGEX) ? row : max), strikes[0]).strike;

  const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
  let zeroGamma = 0;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (left.netGEX === undefined || right.netGEX === undefined) continue;
    if (Math.sign(left.netGEX) === Math.sign(right.netGEX)) continue;
    const slope = (right.netGEX - left.netGEX) / (right.strike - left.strike);
    zeroGamma = Math.round((left.strike - left.netGEX / slope) * 100) / 100;
    break;
  }

  return {
    callWall,
    putWall,
    zeroGamma,
    spot,
    esSpot: spot + esBasis,
    basis: esBasis,
    ts: Date.now()
  };
}

module.exports = {
  computeIntradaySnapshot,
  buildGexLevels,
  spxLevelToEs
};
