# GEX Snapshot Feed Update

## What Changed
Updated the snapshot recording system to track the **top 3 strikes by cumulative net GEX** throughout the entire trading day, rather than just recording single peaks.

## Updated Files
- **shared/app.js** - Modified the peak GEX recorder (gexTakeSnapshot function)

## Key Features

### 1. **Daily Cumulative Tracking**
- New `dailyGexTracking` object tracks each strike's cumulative GEX all day
- Accumulates absolute values of net GEX (calls + puts combined)
- Survives page refreshes (saved to localStorage)

### 2. **Top 3 Snapshot**
Each snapshot now captures:
- Rank #1, #2, #3 strikes
- Cumulative GEX for the entire day (shown in millions)
- Individual call and put GEX values
- Timestamp of snapshot

### 3. **Daily Reset**
Automatically resets tracking at 9:30 AM ET (market open):
- Clears historical data
- Starts fresh cumulative tracking each day
- Prevents day-to-day carryover

### 4. **Enhanced Display**
Improved rendering in the peak list showing:
- Ranking (#1, #2, #3)
- Strike price
- Cumulative GEX with color coding (green for positive, red for negative)
- Snapshot timestamp in ET

## How It Works

1. **Snapshot Recording**: Call `gexTakeSnapshot()` during data refresh
2. **Tracking**: Every strike's GEX values are accumulated throughout the day
3. **Sorting**: Top 3 determined by highest cumulative GEX
4. **Storage**: Saved to localStorage for persistence across refreshes
5. **Reset**: Automatic cleanup at market open each day

## Updated Function Signatures

```javascript
gexTakeSnapshot()          // Records snapshot with top 3 strikes
renderGexPeaks()          // Displays top 3 in feed
checkDailyReset()         // Auto-resets at 9:30 AM ET
```

## localStorage Keys
- `gexPeaks` - Array of snapshots with top 3 strikes
- `dailyGexTracking` - Object tracking cumulative GEX per strike
