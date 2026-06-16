# How To Use GEX, DEX, CHEX, And VEX

This guide explains how to read the options-exposure stack as an execution tool. The core idea is to treat each exposure as a different dealer-hedging force, then combine them into a practical market map.

The `vol-gex-notes.txt` logic is especially important: volume GEX should come from signed trade-by-trade flow whenever possible, not from the option chain's aggregated volume snapshot. That keeps the signal focused on what traded today.

## What Each Signal Means

Use the four exposures as separate lenses:

- GEX: gamma exposure. Shows where dealer hedging may dampen or amplify price movement.
- DEX: delta exposure. Shows where dealer directional inventory is concentrated.
- CHEX: charm exposure. Shows where dealer delta may change as time passes, especially into 0DTE decay.
- VEX: vanna exposure. Shows where dealer delta may change as implied volatility rises or falls.

Each signal answers a different question:

- GEX: Is price likely to pin, reject, or accelerate through this area?
- DEX: Where is dealer directional inventory stretched or likely to flip?
- CHEX: Will time decay create buy or sell pressure as the session passes?
- VEX: Will volatility movement force dealers to buy or sell underlying?

## Build The Exposure Map

Start by calculating exposure by strike. Keep call and put values separate first, then combine them into net values.

Recommended fields per strike:

```text
strike
callGEX
putGEX
netGEX
callDEX
putDEX
netDEX
callCHEX
putCHEX
netCHEX
callVEX
putVEX
netVEX
volumeGEX
```

Then calculate cumulative versions where useful:

```text
cumulativeDEX
cumulativeCHEX
cumulativeVEX
```

Cumulative lines help show where exposure is accelerating, flattening, or reversing across the strike ladder.

## Calculate Trade-Level Volume GEX

For live flow, use signed trade-level volume GEX:

```text
Tick GEX = TradeDirection x OptionType x Gamma x TradeSize x 50 x SpotPrice^2 x 0.01
```

Where:

- `TradeDirection` is `+1` for bought at ask and `-1` for sold at bid.
- `OptionType` is `+1` for calls and `-1` for puts.
- `Gamma` is the raw option gamma at the time of the trade.
- `TradeSize` is the number of contracts in that trade.
- `50` is the ES multiplier.
- `SpotPrice` is the ES price at the time of the trade.

Then sum the signed ticks:

```text
Net Vol GEX = Sum of all Tick GEX values for the current session
```

This can be shown by strike or as an overall session total. The key is that today's volume GEX should reflect signed live flow, not stale chain volume.

## Read GEX First

GEX gives the structural map.

Positive GEX zones often behave like magnets or resistance/support walls. Dealers are more likely to hedge against price movement, which can dampen realized volatility.

Negative GEX zones are more unstable. Dealers are more likely to hedge with price movement, which can amplify momentum.

Key GEX levels:

- Call wall: major overhead positive GEX area.
- Put wall: major downside positive or protective put concentration.
- GEX flip: strike where net GEX changes sign.
- Negative GEX pocket: area where price can move faster and cleaner.
- Positive GEX wall: area where price can stall, pin, or reject.

## Add DEX For Inventory Traps

DEX shows where dealer delta inventory is stretched.

The most useful DEX view is often the cumulative DEX line over the GEX profile. This lets you see where delta inventory is accelerating, troughing, or flattening.

Use three patterns:

| Pattern | GEX Context | Cumulative DEX Read | Action Bias |
| --- | --- | --- | --- |
| Delta cliff | Heavy negative GEX | DEX slopes sharply lower into a trough | Look for a long if downside stalls |
| Flip squeeze | Price crosses GEX flip | DEX crosses or steepens through the flip | Trade breakout or retest continuation |
| Delta shelf | Price hits positive GEX wall | DEX flattens | Avoid chasing; look for mean reversion |

The DEX trough is important because it can mark the point where dealer short-delta hedging pressure is exhausted. If price reaches that area and selling pressure stalls, a mechanical bounce becomes more likely.

## Add CHEX For Time-Decay Pressure

CHEX is the time-decay layer. It estimates how dealer delta changes as time passes.

This matters most for 0DTE and near-expiration options because charm accelerates into expiration.

Use CHEX to answer:

- Does time passing create a buy program or sell program?
- Does the pressure increase into the afternoon?
- Is price sitting near a strike where decay can force dealer re-hedging?

Basic read:

- Positive net CHEX near spot can support upward drift if dealers need to buy underlying as time passes.
- Negative net CHEX near spot can create downward pressure if dealers need to sell underlying as time passes.
- A large CHEX cluster near a wall can make that wall more active later in the day.
- A CHEX flip near spot can mark a time-decay inflection zone.

CHEX is not usually the first signal. Use it after GEX and DEX to judge whether time is helping or fighting the current move.

## Add VEX For Volatility-Sensitive Pressure

VEX is the volatility layer. It estimates how dealer delta changes when implied volatility moves.

This matters most when IV is expanding or contracting quickly:

- After a fast selloff.
- During event risk.
- Near the open.
- Around major economic releases.
- During volatility crush after a catalyst passes.

Use VEX to answer:

- If IV rises, does dealer hedging add to the move or fade it?
- If IV falls, does dealer hedging create a squeeze or a reversal?
- Are vanna flows aligned with price direction?

Basic read:

- If price is rising and IV is falling, VEX can create supportive buy pressure when dealers must re-hedge.
- If price is falling and IV is rising, VEX can add downside pressure when dealers must sell more underlying.
- If VEX is large but IV is flat, the signal is potential energy, not active pressure.

Always pair VEX with an IV condition. VEX needs volatility movement to matter.

## Combine The Four Signals

Use this order:

1. GEX defines the map.
2. DEX defines inventory pressure.
3. CHEX defines time-decay pressure.
4. VEX defines volatility-pressure risk.
5. Live signed Vol GEX confirms whether today's actual flow agrees.

Example decision logic:

```js
function describeExposureStack(data) {
  const gexText = data.netGEX < 0
    ? 'negative gamma conditions can amplify price movement'
    : 'positive gamma conditions can dampen price movement';

  const dexText = data.cumulativeDexSlope > 0.7
    ? 'DEX is steepening upward, supporting upside momentum'
    : data.cumulativeDexSlope < -0.7
      ? 'DEX is steepening downward, showing downside hedge pressure'
      : 'DEX is flat, showing limited directional inventory pressure';

  const chexText = data.netCHEX > 0
    ? 'CHEX is supportive as time decay passes'
    : data.netCHEX < 0
      ? 'CHEX is a headwind as time decay passes'
      : 'CHEX is neutral';

  const vexText = data.ivTrend === 'rising' && data.netVEX < 0
    ? 'VEX may add downside pressure if IV continues rising'
    : data.ivTrend === 'falling' && data.netVEX > 0
      ? 'VEX may support upside if IV continues falling'
      : 'VEX is not the active driver yet';

  return `${gexText}. ${dexText}. ${chexText}. ${vexText}.`;
}
```

## Execution Playbooks

### 1. Reversal From A Delta Cliff

Setup:

- Price approaches a negative GEX zone.
- Cumulative DEX reaches a deep trough.
- Selling momentum stalls.
- Live signed Vol GEX stops getting more negative.

Execution:

- Look for a long near the DEX trough.
- Use the GEX flip or nearest positive GEX zone as the first target.
- Avoid the trade if DEX is still accelerating lower and Vol GEX remains aggressively negative.

### 2. GEX Flip Momentum Squeeze

Setup:

- Price crosses the GEX flip.
- Cumulative DEX has a steep slope through the flip zone.
- Live signed Vol GEX confirms the breakout direction.
- CHEX or VEX is aligned with the move.

Execution:

- Trade the breakout or wait for a retest of the flip.
- Target the next large positive GEX wall.
- If DEX flattens immediately after the break, reduce expectations.

### 3. Positive GEX Wall Fade

Setup:

- Price rallies into a major positive GEX wall.
- Cumulative DEX flattens into a shelf.
- Live signed Vol GEX stops confirming upside.
- VEX is inactive or turns into a headwind.

Execution:

- Avoid chasing the breakout.
- Look for failed continuation and mean reversion.
- Target the middle of the GEX distribution or the prior flip zone.

### 4. CHEX Time-Decay Drift

Setup:

- 0DTE exposure is large near spot.
- Net CHEX is strongly positive or negative.
- Price is not already extended into a major wall.
- Time of day increases the importance of decay.

Execution:

- If CHEX supports the trend, hold continuation trades longer.
- If CHEX fights the trend, tighten targets near walls.
- Watch for afternoon acceleration when charm pressure becomes more visible.

### 5. VEX Volatility Re-Hedge

Setup:

- IV is moving quickly.
- Net VEX is large near spot.
- Price is near a GEX flip or negative gamma pocket.

Execution:

- If IV expansion aligns with the price move, expect acceleration.
- If IV crush fights the price move, expect squeeze or reversal risk.
- Do not trade VEX alone when IV is flat.

## Summary Checklist

| Question | Signal | Bullish Read | Bearish Read | Caution Read |
| --- | --- | --- | --- | --- |
| Is the market stable or unstable? | GEX | Positive below price, controlled pullbacks | Negative below price, fast downside | Large wall directly overhead |
| Is dealer inventory stretched? | DEX | DEX trough holds, slope turns up | DEX accelerates lower | DEX shelf after a move |
| Is time decay helping? | CHEX | Positive CHEX near spot | Negative CHEX near spot | CHEX flip directly at price |
| Is volatility forcing hedges? | VEX | IV crush creates buy pressure | IV expansion creates sell pressure | Large VEX with flat IV |
| Does today's flow confirm it? | Vol GEX | Signed flow supports direction | Signed flow opposes direction | Chain volume disagrees with trades |

## Practical Rule

Do not treat any single exposure as a signal by itself.

Use GEX for location, DEX for inventory, CHEX for time, VEX for volatility, and signed Vol GEX for live confirmation. The best trades appear when at least three of those layers point to the same conclusion.

