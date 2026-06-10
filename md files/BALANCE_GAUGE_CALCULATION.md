# Balance Gauge Calculation

## Overview
The **Balanced Gauge** on the Overview page displays the call/put GEX balance as a percentage. Based on the screenshot showing "59% BC + SP", here's how it's calculated:

## Formula

```
Call Weight % = Total Call GEX / (Total Call GEX + Total Put GEX) × 100
```

Where:
- **Total Call GEX** = Sum of all call gamma × position (OI + Vol) × 100 across the chain
- **Total Put GEX** = Sum of all put gamma × position (OI + Vol) × 100 across the chain

## Display
- **Left side (red-orange gradient)**: Call-heavy bias (higher % = more call dominance)
- **Right side (green gradient)**: Put-heavy bias (higher % = more put dominance)
- **Center (neutral)**: 50% = balanced market

## Example
If the gauge shows **59% BC + SP**:
- 59% of total GEX is from Calls (Call Bias)
- 41% is from Puts (Put Spread)
- Indicates a slightly call-biased market

## Interpretation
- **65%+ Call bias** → Dealer hedging skewed toward calls, suggests call buying pressure
- **50% balanced** → Neutral market, no directional bias
- **35%- Call bias (65%+ Put bias)** → Dealer hedging skewed toward puts, suggests put buying pressure

## Related Calculations
The balance gauge is complementary to:
- **Net GEX** - Dollar impact per 1% move
- **Call Wall** - Strike with highest call GEX
- **Put Wall** - Strike with highest put GEX (magnitude)

## Real-time Updates
- Recalculates every data refresh
- Reflects entire options chain, all strikes
- Can shift rapidly during market moves with unusual flow
