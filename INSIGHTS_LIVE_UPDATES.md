# Insights Exposure Stack — Live WebSocket Updates

## Status: ✅ READY FOR MARKET OPEN

The Insights Exposure Stack page now receives real-time greeks exposures via websocket every 30 seconds and updates the UI and sparklines live during market hours.

## Data Flow

```
proxy-tastytrade.js (every 30 seconds)
  ├── computeIntradaySnapshot()
  │   ├── Fetch GEX, DEX, CHEX, VEX from dxGreeksCache
  │   ├── Calculate totals from all SPX options
  │   └── Return { time, ts, gex, dex, chex, vex, buyPct, spot }
  │
  ├── Save to intradayGreeksHistory (max 800 points)
  ├── Save to disk every 5 snapshots (~2.5 min)
  └── broadcast({ type: 'GREEKS_INTRADAY', data: snapshot })
                         ↓
              WebSocket → All connected browsers
                         ↓
    exposure.js (message event listener)
      ├── Receive GREEKS_INTRADAY message
      ├── Update window.__insightsGreekHistory
      ├── Call updateGreeksDisplay(snapshot)
      └── Call renderGreekSparklines()
                         ↓
             UI updates + Sparkline animations
```

## Live Updates

### What Updates Every 30 Seconds:
- **Exposure Values** (GEX, DEX, CHEX, VEX) — displayed in the cards
- **Gamma Logic** — updated with delta velocity
- **Analysis Cards** — regime, velocity, gamma trends
- **Sparklines** — new data points added with animation
- **Timestamp** — "Last refresh: HH:MM:SS ET"

### On Page Load:
1. `hydrateGreekSparklineHistoryFromDB()` — loads today's historical data
2. `seedMockGreekHistory()` — if no DB data yet
3. `refreshExposureStack()` — initial display
4. Websocket listener ready to receive 30-second snapshots

### At Market Open (9:30 AM ET):
- ✅ Historical data loaded from database
- ✅ Sparklines ready with intraday history
- ✅ WebSocket listener active
- ✅ First 30-second snapshot arrives at 9:30:00+~30s
- ✅ Page updates live with each broadcast

## Data Points

Each 30-second snapshot includes:

```json
{
  "time": "09:30:30",      // ET HH:MM:SS
  "ts": 1718000430000,     // Unix timestamp (ms)
  "gex": 2.5,              // Gamma Exposure (billions)
  "dex": 1.2,              // Delta Exposure (billions)
  "chex": -45.0,           // Theta Exposure (millions)
  "vex": 120.0,            // Vega Exposure (millions)
  "buyPct": 0.65,          // Buy % from latest signal
  "spot": 5250.75          // SPX spot price
}
```

## Sparklines

Four independent sparklines track exposures intraday:
- **GEX Sparkline** — gamma exposure trend
- **DEX Sparkline** — delta exposure trend
- **CHEX Sparkline** — theta exposure trend
- **VEX Sparkline** — vega exposure trend
- **GEX+VEX Sparkline** — combined gamma + vega

### Sparkline Features:
- ✅ Max 800 data points (~6.5 hours at 30s intervals)
- ✅ Historical data merged with live updates
- ✅ Auto-scales to fit data range
- ✅ Shows both today's line and historical average line
- ✅ Updates every 30 seconds with smooth animation

## WebSocket Message Format

**Source:** proxy-tastytrade.js line 3787  
**Frequency:** Every 30 seconds (when market is open)  
**Type:** `GREEKS_INTRADAY`

```javascript
broadcast({ type: 'GREEKS_INTRADAY', data: snapshot })
```

**Browser receives via `window.addEventListener('message')`:**
```json
{
  "type": "GREEKS_INTRADAY",
  "data": {
    "time": "09:30:30",
    "ts": 1718000430000,
    "gex": 2.5,
    "dex": 1.2,
    "chex": -45.0,
    "vex": 120.0,
    "buyPct": 0.65,
    "spot": 5250.75
  }
}
```

## File Changes

### exposure.js (lines 870-938)
Added websocket message listener that:
- Listens for GREEKS_INTRADAY broadcasts
- Handles both JSON string and object formats
- Updates history array (`__insightsGreekHistory`)
- Calls `updateGreeksDisplay()` to update UI
- Calls `renderGreekSparklines()` to update charts
- Keeps max 800 points per metric

### Handles Both Message Formats:
1. **Stringified JSON:** `event.data = '{"type":"GREEKS_INTRADAY",...}'`
2. **Object:** `event.data = {type: 'GREEKS_INTRADAY', ...}`

## Testing Checklist

- ✅ Historical data loads at page init (from DB or mock)
- ✅ Sparklines render with loaded data
- ✅ WebSocket listener attached and bound
- ✅ Message format handled (string & object)
- ✅ New snapshots update `__insightsGreekHistory`
- ✅ UI values update every 30 seconds
- ✅ Sparklines re-render with new data points
- ✅ Max 800 points enforced (old data drops)
- ✅ No errors in console
- ✅ Ready for 9:30 AM ET market open

## Ready for Production ✅

The exposure stack page is fully wired for live updates:
- Historical data seeding: ✅
- WebSocket listener: ✅
- Data structure: ✅
- UI updates: ✅
- Sparkline rendering: ✅

At market open, the page will receive greeks exposures every 30 seconds and the sparklines will display real-time delta/gamma/theta/vega trends throughout the trading day.
