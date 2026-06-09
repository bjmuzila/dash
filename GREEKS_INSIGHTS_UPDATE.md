# Greeks Exposure Stack Update — Insights

## What Was Added

The Insights Exposure Stack page was trying to display:
- ✅ GEX (Gamma Exposure)
- ❌ DEX (Delta Exposure) - **MISSING**
- ❌ CHEX (Charm/Theta Exposure) - **MISSING**
- ❌ VEX (Vega Exposure) - **MISSING**

These have now been added to the `window._levelMathContext` object.

## Implementation

### Locations Updated
- **Line 4826-4829:** (finishGEXCompute function) - Added total calculations
- **Line 4838:** Updated `_levelMathContext` to include totalDEX, totalCHEX, totalVEX
- **Line 6920-6923:** (updateOVLevelBar function) - Added total calculations  
- **Line 6954:** Updated `_levelMathContext` to include totalDEX, totalCHEX, totalVEX

### Greeks Calculations

**DEX (Delta Exposure):**
```javascript
totalDEX = rawChain.reduce((s,r) => s + (r.netDEX||0), 0)
```
- Uses pre-calculated `netDEX` from each strike
- netDEX = (callDelta - putDelta) × (OI + Volume) × spotPrice × 100

**CHEX (Theta Exposure):**
```javascript
totalCHEX = rawChain.reduce((s,r) => s + 
  (|callTheta| - |putTheta|) × (callOI + putOI + callVolume + putVolume) × spotPrice × 100
)
```
- Combines OI and volume like GEX
- Uses absolute value to handle the sign properly

**VEX (Vega Exposure):**
```javascript
totalVEX = rawChain.reduce((s,r) => s + 
  (|callVega| - |putVega|) × (callOI + putOI + callVolume + putVolume) × spotPrice × 100
)
```
- Combines OI and volume like GEX
- Uses absolute value to handle the sign properly

## Data Source
All greeks (delta, theta, vega, gamma) come from dxlink WebSocket:
- **Greeks** feed type: `['Quote','Greeks','Summary','Trade']` subscribed for all 0DTE options
- Updated in real-time as market data flows in
- No REST API calls needed after initial chain build

## Insights Exposure Stack Display

The exposure.js file now gets all four exposures from `window._levelMathContext`:
```javascript
const values = {
  gex: window._levelMathContext?.totalGEX ?? fallback,
  dex: window._levelMathContext?.totalDEX ?? fallback,
  chex: window._levelMathContext?.totalCHEX ?? fallback,
  vex: window._levelMathContext?.totalVEX ?? fallback
};
```

These are then displayed and analyzed in the exposure stack UI with proper formatting and trend analysis.

## Testing Checklist
- ✅ Greeks are calculated from rawChain (which gets dxlink updates)
- ✅ Calculated on every chart render (finishGEXCompute + updateOVLevelBar)
- ✅ Exposure totals passed to insights via _levelMathContext
- ✅ Both OI and Volume included (like GEX)
- ✅ Uses spotPrice for proper dollar calculations
- ✅ No REST API polling for greeks

## Files Modified
- `/pages/overview/overview.js` - Added totalDEX, totalCHEX, totalVEX calculations
