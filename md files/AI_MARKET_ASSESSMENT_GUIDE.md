# How To Build An AI-Style Market Assessment

This guide explains how to create a dynamic market assessment like the one on the Stats page. The key idea is simple: calculate market stats, score them, then generate readable commentary from those scores.

## What It Is

An AI-style market assessment is a written summary that changes based on live or recent market data.

It does not have to use a real AI model. A strong first version can be rule-based:

1. Pull market data.
2. Calculate useful stats.
3. Score each category.
4. Combine the scores into a total market score.
5. Generate a paragraph using conditional logic.

This gives you consistent, explainable commentary without needing an external AI API.

## Core Inputs

Choose the market signals you care about. A good dashboard-style assessment can use:

- Volatility: VIX level, VIX trend, VIX percentile, put/call ratio.
- Trend: SPY vs 20-day, 50-day, and 200-day moving averages.
- Breadth: number of sectors above their 50-day moving average.
- Momentum: 5-day sector returns, leader, laggard, rotation spread.
- Macro: bond trend, dollar trend, rates-sensitive assets.

Each input should answer one question:

- Is volatility supportive or dangerous?
- Is price trending up or down?
- Is participation broad or narrow?
- Are sectors moving together or rotating aggressively?
- Are macro conditions helping or hurting risk assets?

## Score The Categories

Give each category a score from `0` to `100`.

Example:

```js
function scoreVolatility(vix) {
  if (vix > 40) return 0;
  if (vix > 30) return 15;
  if (vix > 25) return 30;
  if (vix > 20) return 55;
  if (vix > 15) return 80;
  return 100;
}
```

Then combine the scores with weights:

```js
const totalScore =
  volatilityScore * 0.25 +
  trendScore * 0.20 +
  breadthScore * 0.20 +
  momentumScore * 0.25 +
  macroScore * 0.10;
```

The weights should reflect what matters most to your trading style.

## Turn Scores Into Market Language

Once the stats are calculated, generate the written assessment with conditional logic.

Example:

```js
function describeScore(totalScore) {
  if (totalScore >= 65) return 'above the threshold for active sizing';
  if (totalScore >= 45) return 'near the threshold and requires caution';
  return 'well below the threshold for active sizing';
}
```

Example VIX language:

```js
function describeVix(vix) {
  if (vix < 20) return 'constructive volatility conditions';
  if (vix < 25) return 'moderate volatility';
  return 'elevated volatility, caution warranted';
}
```

Example RSI language:

```js
function describeRsi(rsi) {
  return rsi > 60 ? 'momentum strength' : 'neutral or weakening momentum';
}
```

## Generate The Assessment

Build one final paragraph from the calculated values.

```js
function generateMarketAssessment(data) {
  const scoreText = describeScore(data.totalScore);
  const vixText = describeVix(data.vix);
  const rsiText = describeRsi(data.rsi);

  return `The current environment scores ${Math.round(data.totalScore)}/100, ${scoreText}. VIX is ${data.vix.toFixed(1)}, showing ${vixText}. Market regime is ${data.regime}. Breadth shows ${data.sectorsAbove} sectors above their 50-day moving average. RSI-14 signals ${rsiText}. Sector rotation has ${data.leader} leading and ${data.laggard} lagging. Bonds are ${data.bondTrend}, while the dollar is ${data.dollarTrend}.`;
}
```

## Add A Trading Action Layer

You can also convert the total score into a simple trading stance.

```js
function getTradingMode(totalScore) {
  if (totalScore >= 65) {
    return {
      action: 'YES',
      mode: 'ACTIVE',
      note: 'Conditions are favorable. Normal sizing allowed.'
    };
  }

  if (totalScore >= 45) {
    return {
      action: 'CAUTION',
      mode: 'REDUCED',
      note: 'Mixed signals. Reduce position size.'
    };
  }

  return {
    action: 'NO',
    mode: 'MINIMAL',
    note: 'Conditions are poor. Preserve capital.'
  };
}
```

## Recommended Structure

Keep the system split into clear parts:

```text
fetchMarketData()
calculateIndicators()
scoreVolatility()
scoreTrend()
scoreBreadth()
scoreMomentum()
scoreMacro()
calculateTotalScore()
generateMarketAssessment()
renderAssessment()
```

This makes the assessment easy to audit and improve.

## Why This Works

The assessment feels intelligent because it is context-aware. It reacts to changing market conditions, uses weighted evidence, and explains the dashboard in plain English.

The advantage of this approach is that every sentence can be traced back to a stat or rule. That makes it more reliable than a generic AI response when you need fast, repeatable trading context.

## Optional Upgrade: Real AI

Later, you can send the calculated stats into an AI model and ask it to write the commentary.

The safest approach is to keep the calculations local and only use AI for wording.

Example prompt:

```text
You are a market risk assistant. Use only the provided stats. Do not invent data.

Total score: 58
VIX: 22.4
Trend regime: Choppy
Sectors above 50-day: 5/11
RSI: 54
Leader: XLK +2.1%
Laggard: XLE -1.4%
Bond trend: Falling
Dollar trend: Strengthening

Write a concise market assessment for an intraday trader.
```

This gives you better writing while keeping the decision logic controlled by your dashboard.

