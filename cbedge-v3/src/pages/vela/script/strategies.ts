// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the ready-made strategies. Four strategy() scripts anyone can put
// on a chart from the Strategy Tester's picker or the Indicators dialog's
// Strategies category, and edit a copy of in Scripts. Plain Pine v5 (the
// language every TradingView strategy is written in), so they double as
// examples of what the tester runs.
//
//   EMA Cross               long on a fast-over-slow EMA cross, short on the
//                           cross down — always in the market
//   Opening Range Breakout  the first 5 / 15 / 30 / 60 minutes' high and low;
//                           one trade a day on the first close outside it,
//                           stop at the other side, target a multiple of the
//                           range, flat by 15:55 ET
//   VWAP Reclaim / Reject   long when price closes back above VWAP, short when
//                           it closes back below; ATR stop and target, regular
//                           hours only, flat by 15:55
//   CB Edge Walls Bounce    fades CB Edge's put and call walls: a bar that tags
//                           the put wall and closes back above it goes long, the
//                           call wall short; stop beyond the wall, target the
//                           other wall (or halfway / 2× the stop). Reads the walls
//                           recorder bar by bar (`cbedge.put_wall` /
//                           `cbedge.call_wall`), so the backtest trades the wall
//                           that was really there at each bar. ES / NQ trade
//                           SPX's / NDX's walls shifted by the day's basis.
//
// They are NOT saved to the library on their own: a chart keeps its copy (the
// Scripts persistence), and "Edit" saves a copy you then own.
// ─────────────────────────────────────────────────────────────────────────────

import type { Script } from './library'

export interface ReadyStrategy extends Script {
  /** One line for the picker. */
  desc: string
}

const HEAD = (title: string) =>
  `//@version=5\nstrategy("${title}", overlay=true, initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.cash_per_contract, commission_value=0)\n`

export const READY_STRATEGIES: ReadyStrategy[] = [
  {
    id: 'st-ema',
    name: 'EMA Cross',
    desc: 'Long on a fast/slow EMA cross up, short on the cross down',
    source:
      HEAD('EMA Cross') +
      `fastLen = input.int(9, "Fast EMA", minval=1)
slowLen = input.int(21, "Slow EMA", minval=2)
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
plot(fast, "Fast EMA", color=color.orange)
plot(slow, "Slow EMA", color=color.blue)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)
`,
  },
  {
    id: 'st-orb',
    name: 'Opening Range Breakout',
    desc: 'One trade a day on a close outside the opening range; stop at the other side',
    source:
      HEAD('Opening Range Breakout') +
      `orMins = input.int(15, "Opening range (minutes)", options=[5, 15, 30, 60])
rr = input.float(2.0, "Target (x the range)", minval=0.5, step=0.5)
mins = hour * 60 + minute
openMin = 9 * 60 + 30
flatMin = 15 * 60 + 55
inRange = mins >= openMin and mins < openMin + orMins
var float orHi = na
var float orLo = na
var bool done = false
if ta.change(dayofmonth) != 0
    orHi := na
    orLo := na
    done := false
if inRange
    orHi := na(orHi) ? high : math.max(orHi, high)
    orLo := na(orLo) ? low : math.min(orLo, low)
ready = mins >= openMin + orMins and mins + timeframe.multiplier < flatMin and not na(orHi)
if ready and not done and strategy.position_size == 0
    if close > orHi
        strategy.entry("Long", strategy.long)
        done := true
    else if close < orLo
        strategy.entry("Short", strategy.short)
        done := true
rng = orHi - orLo
strategy.exit("Long exit", "Long", stop=orLo, limit=orHi + rng * rr)
strategy.exit("Short exit", "Short", stop=orHi, limit=orLo - rng * rr)
// the order fills on the next bar's open: send it on the bar before 15:55
if mins + timeframe.multiplier >= flatMin
    strategy.close_all(comment="End of day")
plot(inRange or ready ? orHi : na, "Range high", color=color.green, style=plot.style_linebr)
plot(inRange or ready ? orLo : na, "Range low", color=color.red, style=plot.style_linebr)
`,
  },
  {
    id: 'st-vwap',
    name: 'VWAP Reclaim / Reject',
    desc: 'Long on a close back above VWAP, short on a close back below; ATR stop and target',
    source:
      HEAD('VWAP Reclaim / Reject') +
      `side = input.string("Both", "Trade", options=["Both", "Long only", "Short only"])
atrLen = input.int(14, "ATR length", minval=1)
stopAtr = input.float(1.0, "Stop (x ATR)", minval=0.25, step=0.25)
targetAtr = input.float(2.0, "Target (x ATR)", minval=0.25, step=0.25)
v = ta.vwap(hlc3)
a = ta.atr(atrLen)
mins = hour * 60 + minute
rth = mins >= 9 * 60 + 35 and mins < 15 * 60 + 45
reclaim = ta.crossover(close, v)
reject = ta.crossunder(close, v)
if rth and reclaim
    if side != "Short only"
        strategy.entry("Long", strategy.long)
    else
        strategy.close("Short", comment="VWAP reclaimed")
if rth and reject
    if side != "Long only"
        strategy.entry("Short", strategy.short)
    else
        strategy.close("Long", comment="VWAP lost")
avg = strategy.position_avg_price
strategy.exit("Long exit", "Long", stop=avg - a * stopAtr, limit=avg + a * targetAtr)
strategy.exit("Short exit", "Short", stop=avg + a * stopAtr, limit=avg - a * targetAtr)
// the order fills on the next bar's open: send it on the bar before 15:55
if mins + timeframe.multiplier >= 15 * 60 + 55
    strategy.close_all(comment="End of day")
plot(v, "VWAP", color=color.purple, linewidth=2)
`,
  },
  {
    id: 'st-walls',
    name: 'CB Edge Walls Bounce',
    desc: 'Fades the put / call walls: tag and close back inside; stop beyond the wall',
    source:
      HEAD('CB Edge Walls Bounce') +
      `touchPts = input.float(2.0, "Touch distance (points)", minval=0, step=0.5)
stopPts = input.float(5.0, "Stop beyond the wall (points)", minval=0.25, step=0.25)
target = input.string("Other wall", "Target", options=["Other wall", "Halfway", "2x the stop"])
cw = cbedge.call_wall
pw = cbedge.put_wall
mins = hour * 60 + minute
rth = mins >= 9 * 60 + 45 and mins < 15 * 60 + 45
// a bar that tags the put wall and closes back above it; the call wall the other way
longSig = rth and not na(pw) and low <= pw + touchPts and close > pw
shortSig = rth and not na(cw) and high >= cw - touchPts and close < cw
var float lStop = na
var float lTarget = na
var float sStop = na
var float sTarget = na
if longSig and strategy.position_size <= 0
    lStop := pw - stopPts
    lTarget := target == "Other wall" and not na(cw) and cw > close ? cw : target == "Halfway" and not na(cw) and cw > close ? (pw + cw) / 2 : close + 2 * (close - lStop)
    strategy.entry("Long", strategy.long)
if shortSig and strategy.position_size >= 0
    sStop := cw + stopPts
    sTarget := target == "Other wall" and not na(pw) and pw < close ? pw : target == "Halfway" and not na(pw) and pw < close ? (pw + cw) / 2 : close - 2 * (sStop - close)
    strategy.entry("Short", strategy.short)
strategy.exit("Long exit", "Long", stop=lStop, limit=lTarget)
strategy.exit("Short exit", "Short", stop=sStop, limit=sTarget)
// the order fills on the next bar's open: send it on the bar before 15:55
if mins + timeframe.multiplier >= 15 * 60 + 55
    strategy.close_all(comment="End of day")
plot(cw, "Call wall", color=color.green, style=plot.style_stepline)
plot(pw, "Put wall", color=color.red, style=plot.style_stepline)
`,
  },
]

/** A script that declares strategy(…) (an indicator(…) has no trades to test). */
export const IS_STRATEGY = /(^|\n)\s*strategy\s*\(/
/** A script that reads CB Edge's levels (the engine then loads the walls for it). */
export const USES_CBEDGE = /\bcbedge\.(call_wall|put_wall|core)\b/

export const readyStrategy = (id: string): ReadyStrategy | undefined => READY_STRATEGIES.find((s) => s.id === id)
