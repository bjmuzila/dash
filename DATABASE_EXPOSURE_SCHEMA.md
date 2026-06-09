# Database Schema — Buy/Sell Scores with Greeks Exposure

## Overview
Buy/sell trading signals are now stored with full greek exposures (GEX, DEX, CHEX, VEX) at the time of the signal for complete context and analysis.

## Data Files

### 1. buy-sell-scores.json (Trade Signals with Greeks)
**Location:** `data/buy-sell-scores.json`  
**Purpose:** Historical record of all buy/sell signals with associated greek exposures

**Record Structure:**
```json
{
  "timestamp": 1718000000000,           // Unix timestamp (ms)
  "date": "2024-06-10",                 // YYYY-MM-DD (NY timezone)
  "time": "09:30:45",                   // HH:MM:SS (NY timezone)
  "slotKey": "2024-06-10_09:30:45_Buy", // Unique identifier
  "spxPrice": 5250.75,                  // SPX spot price at signal
  "side": "Buy",                        // Buy or Sell
  "score": 78,                          // Signal strength (0-100)
  "buyPct": 0.65,                       // % buy pressure (65%)
  "sellPct": 0.35,                      // % sell pressure (35%)
  
  // Greeks Exposures at time of signal
  "gex": 2.5,                           // Gamma Exposure (billions)
  "dex": 1.2,                           // Delta Exposure (billions)
  "chex": -45.0,                        // Theta Exposure (millions, time decay)
  "vex": 120.0                          // Vega Exposure (millions, volatility)
}
```

### 2. intraday-greeks.json (30-Second Snapshots)
**Location:** `data/intraday-greeks.json`  
**Purpose:** High-frequency Greeks exposure tracking (cleared daily at midnight)  
**Frequency:** Every 30 seconds (max 800 points = ~6.5 hours)  
**Retention:** 24 hours, resets at midnight NY time

**Record Structure:**
```json
{
  "date": "2024-06-10",
  "records": [
    {
      "time": "09:30:00",      // ET HH:MM:SS
      "ts": 1718000000000,     // Unix timestamp (ms)
      "gex": 2.5,              // Gamma Exposure (billions)
      "dex": 1.2,              // Delta Exposure (billions)
      "chex": -45.0,           // Theta Exposure (millions)
      "vex": 120.0,            // Vega Exposure (millions)
      "buyPct": 0.65,          // Buy % from latest signal
      "spot": 5250.75          // SPX spot price
    }
  ]
}
```

## Data Flow

```
dxlink WebSocket (Greeks feed)
  ↓
dxGreeksCache + dxSummaryCache
  ↓
computeIntradaySnapshot() [every 30s]
  ├── Calculate GEX, DEX, CHEX, VEX from live greeks
  ├── Fetch latest buyPct from buy-sell-scores backup
  ├── Create intraday record
  ├── Push to intradayGreeksHistory
  ├── Broadcast to browsers (GREEKS_INTRADAY event)
  └── Save to disk every 5 snapshots (~2.5 min)
  ↓
insights/exposure/exposure.js
  └── Display real-time exposures
  
Buy/Sell Signal Generated
  ├── Create signal with current greeks (gex, dex, chex, vex)
  ├── POST to /proxy/api/backup/buy-sell-scores
  └── Saved to buy-sell-scores.json with full context
```

## API Endpoints

### GET /proxy/api/backup/buy-sell-scores
Retrieve historical signals (optionally filtered by date)

**Query Params:**
- `date` (optional): Filter by YYYY-MM-DD

**Response:**
```json
{
  "ok": true,
  "records": [
    { /* record as shown above */ }
  ]
}
```

### POST /proxy/api/backup/buy-sell-scores
Save a new buy/sell signal with greeks

**Request Body:**
```json
{
  "timestamp": 1718000000000,
  "date": "2024-06-10",
  "time": "09:30:45",
  "slotKey": "2024-06-10_09:30:45_Buy",
  "spxPrice": 5250.75,
  "side": "Buy",
  "score": 78,
  "buyPct": 0.65,
  "sellPct": 0.35,
  "gex": 2.5,      // Added
  "dex": 1.2,      // Added
  "chex": -45.0,   // Added
  "vex": 120.0     // Added
}
```

## Calculations

### GEX (Gamma Exposure)
```
GEX = Σ(|callGamma| × callOI - |putGamma| × putOI) × 100 × SPX²
Result: Billions of dollars
```

### DEX (Delta Exposure)
```
DEX = Σ(callDelta - putDelta) × (callOI + putOI) × SPX × 100
Result: Billions of dollars
```

### CHEX (Theta Exposure)
```
CHEX = Σ(|callTheta| - |putTheta|) × (callOI + putOI) × SPX × 100
Result: Millions of dollars
(Positive = dealers benefit from time decay)
```

### VEX (Vega Exposure)
```
VEX = Σ(|callVega| - |putVega|) × (callOI + putOI) × SPX × 100
Result: Millions of dollars
(Positive = dealers benefit from vol increase)
```

## Historical Query Example

**Get all signals for June 10, 2024:**
```bash
curl "http://localhost:3001/proxy/api/backup/buy-sell-scores?date=2024-06-10"
```

**Response:**
```json
{
  "ok": true,
  "records": [
    {
      "timestamp": 1718000000000,
      "date": "2024-06-10",
      "time": "09:30:45",
      "slotKey": "2024-06-10_09:30:45_Buy",
      "spxPrice": 5250.75,
      "side": "Buy",
      "score": 78,
      "buyPct": 0.65,
      "sellPct": 0.35,
      "gex": 2.5,
      "dex": 1.2,
      "chex": -45.0,
      "vex": 120.0
    },
    {
      "timestamp": 1718002500000,
      "date": "2024-06-10",
      "time": "10:01:40",
      "slotKey": "2024-06-10_10:01:40_Sell",
      "spxPrice": 5252.30,
      "side": "Sell",
      "score": 62,
      "buyPct": 0.38,
      "sellPct": 0.62,
      "gex": 1.8,
      "dex": 0.9,
      "chex": -38.0,
      "vex": 95.0
    }
  ]
}
```

## File Locations
- **Buy/Sell Scores:** `data/buy-sell-scores.json`
- **Intraday Greeks:** `data/intraday-greeks.json` (cleared daily)
- **Backup Directory:** Configured in proxy-tastytrade.js

## Storage Notes
- Atomic writes prevent corruption
- Old intraday data auto-cleared at midnight NY time
- Buy/sell scores persist indefinitely (historica record)
- Sorted by timestamp for chronological queries
