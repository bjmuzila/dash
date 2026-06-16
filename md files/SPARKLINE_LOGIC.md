# Sparkline Logic Documentation

## Overview
The sparkline implementation in `exposure.js` renders real-time time-series data as interactive canvas-based line charts. It's designed for Greeks exposure metrics (GEX, DEX, CHEX, VEX) but is **fully generic** and reusable for any stat with a time-series history.

---

## Core Concepts

### Data Structure
All time-series data is stored in a uniform format:
```javascript
{
  ts: number,        // Unix timestamp (milliseconds)
  value: number      // The metric value (any numeric scale)
}
```

### History Storage
Global object `window.__insightsGreekHistory` holds arrays per metric:
```javascript
window.__insightsGreekHistory = {
  gex: [{ ts: 1000, value: 5e9 }, { ts: 2000, value: 5.1e9 }, ...],
  dex: [{ ts: 1000, value: -7.5e9 }, { ts: 2000, value: -7.4e9 }, ...],
  chex: [...],
  vex: [...],
  gexvex: [...],
  // NEW: Add custom metrics here
  myMetric: [{ ts, value }, ...]
}
```

**Retention:** Automatically caps at 800 points (~6.5 hours at 30-sec intervals).

---

## Main Functions

### 1. `renderGreekSparklineCanvas(canvasId, data, color)`
**Purpose:** Core rendering engine for a single sparkline.

**Parameters:**
- `canvasId` (string): HTML canvas element ID to draw into
- `data` (array): Array of `{ts, value}` objects
- `color` (string): RGB/RGBA stroke color (e.g., `'rgb(0,200,136)'`)

**What it does:**
1. **Canvas Setup**
   - Gets canvas element and 2D context
   - Scales to device pixel ratio for crisp rendering
   - Clears previous frame

2. **Data Validation & Normalization**
   - Filters timestamps to valid 9:00am–4:00pm ET session window
   - Removes invalid/outlier points using IQR method
   - Sorts by timestamp ascending

3. **Outlier Removal (IQR)**
   ```javascript
   Q1 = 25th percentile value
   Q3 = 75th percentile value
   IQR = Q3 - Q1
   lowerBound = Q1 - 1.5 × IQR
   upperBound = Q3 + 1.5 × IQR
   // Keep only: lowerBound ≤ value ≤ upperBound
   ```
   Prevents single spikes from crushing the chart.

4. **Scale Calculation**
   - Determines min/max of filtered values
   - Calculates range: `max - min` (or 1% of max if flat)
   - Handles all-positive and all-negative datasets

5. **Coordinate Mapping**
   - **X-axis:** Pinned to real wall-clock session time (9am–4pm ET)
   - **Y-axis:** Normalized to chart height (min=bottom, max=top)

6. **Rendering**
   - **Line:** Smooth 2px stroke with shadow blur
   - **Fill:** Gradient fill from line to baseline (22% opacity)
   - **Endpoint Dot:** 3px circle at latest point with glow effect
   - **Time Labels:** Tick marks at 9am, 10:30, 12pm, 1:30, 3pm, 4pm

**Example Usage:**
```javascript
renderGreekSparklineCanvas(
  'my-sparkline-canvas',
  window.__insightsGreekHistory.gex || [],
  'rgb(0,200,136)'
);
```

---

### 2. `renderGreekSparklines()`
**Purpose:** Batch renderer—updates all Greek sparklines in one call.

```javascript
function renderGreekSparklines() {
  const histories = window.__insightsGreekHistory;
  if (!histories) return;
  
  renderGreekSparklineCanvas('greeks-gex-sparkline', histories.gex || [], 'rgb(0,200,136)');
  renderGreekSparklineCanvas('greeks-dex-sparkline', histories.dex || [], 'rgb(34,152,207)');
  renderGreekSparklineCanvas('greeks-chex-sparkline', histories.chex || [], 'rgb(218,92,190)');
  renderGreekSparklineCanvas('greeks-vex-sparkline', histories.vex || [], 'rgb(114,120,202)');
  renderGreekSparklineCanvas('greeks-gexvex-sparkline', histories.gexvex || [], 'rgb(255,140,0)');
}
```

**To add your custom metric:**
```javascript
renderGreekSparklineCanvas('my-custom-sparkline', histories.myMetric || [], 'rgb(255,100,50)');
```

---

### 3. `ensureExposureHistorySeries()`
**Purpose:** Initializes the history object if missing.

```javascript
function ensureExposureHistorySeries() {
  if (!window.__insightsGreekHistory) {
    window.__insightsGreekHistory = { gex: [], dex: [], chex: [], vex: [], gexvex: [] };
  }
  return window.__insightsGreekHistory;
}
```

**To add custom metrics:**
```javascript
function ensureExposureHistorySeries() {
  if (!window.__insightsGreekHistory) {
    window.__insightsGreekHistory = {
      gex: [], dex: [], chex: [], vex: [], gexvex: [],
      myMetric1: [],
      myMetric2: [],
      myMetric3: []
    };
  }
  return window.__insightsGreekHistory;
}
```

---

## Data Flow: Adding New Points

### Live Updates
When new data arrives (every 30 seconds):

1. **Dedupe Check**
   ```javascript
   const stampKey = Math.floor(Date.now() / 30000); // 30-sec buckets
   if (hist._lastStamp !== stampKey) {
     hist._lastStamp = stampKey;
     hist.myMetric.push({ ts: Date.now(), value: latestValue });
   }
   ```

2. **Capacity Management**
   ```javascript
   if (hist.myMetric.length > 800) {
     hist.myMetric.shift(); // Remove oldest point
   }
   ```

3. **Render**
   ```javascript
   renderGreekSparklineCanvas('my-sparkline', hist.myMetric, 'rgb(100,200,255)');
   ```

### Example Integration
```javascript
// Every 30 seconds, in your refresh loop:
async function refreshMyMetrics() {
  const newValue = await fetchMyMetricFromAPI();
  
  // Ensure history exists
  ensureExposureHistorySeries();
  const hist = window.__insightsGreekHistory;
  
  // Add new point (deduplicated by 30-sec buckets)
  const stampKey = Math.floor(Date.now() / 30000);
  if (hist._lastStamp_myMetric !== stampKey) {
    hist._lastStamp_myMetric = stampKey;
    hist.myMetric.push({ ts: Date.now(), value: newValue });
    if (hist.myMetric.length > 800) hist.myMetric.shift();
  }
  
  // Re-render
  renderGreekSparklineCanvas('my-sparkline', hist.myMetric, 'rgb(100,200,255)');
}
```

---

## Session & Time Handling

### ET Wall-Clock Pinning
The sparkline x-axis is **always pinned to 9am–4pm ET**, regardless of when data points arrive.

```javascript
const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
const sessionOpenEt = new Date(nowEt);
sessionOpenEt.setHours(9, 0, 0, 0);
const sessionCloseEt = new Date(nowEt);
sessionCloseEt.setHours(16, 0, 0, 0);

const etOffsetMs = nowEt.getTime() - new Date().getTime();
const sessionOpenMs = sessionOpenEt.getTime() - etOffsetMs;
const sessionCloseMs = sessionCloseEt.getTime() - etOffsetMs;
```

**Effect:** All sparklines show the same time window regardless of metric, making them directly comparable side-by-side.

### Session Filtering
```javascript
// Only plot points within session ± buffer
const sessionPts = ordered.filter(d =>
  d.ts >= sessionOpenMs - 15 * 60 * 1000 &&  // Start 15 min early (mock seed buffer)
  d.ts <= sessionCloseMs + 5 * 60 * 1000      // End 5 min late
);
```

---

## Outlier Detection & Filtering

### IQR Method
Removes data spikes that would crush the chart scale:

```javascript
const values = pts_src.map(d => d.value);
const sortedVals = [...values].sort((a, b) => a - b);

const q1 = sortedVals[Math.floor(sortedVals.length * 0.25)];
const q3 = sortedVals[Math.floor(sortedVals.length * 0.75)];
const iqr = q3 - q1;

const lowerBound = q1 - 1.5 * iqr;  // Below this = outlier
const upperBound = q3 + 1.5 * iqr;  // Above this = outlier

const filteredPts = pts_src.filter(p => p.value >= lowerBound && p.value <= upperBound);
```

**Fallback:** If all points are outliers, plot unfiltered.

---

## Visual Rendering Details

### Canvas Layout
```
┌─────────────────────────────────┐
│  Padding (12px L, 10px R, 8px T)│
│  ┌──────────────────────────────┤
│  │  Chart Area                  │  14px bottom for time labels
│  │  (Line + Fill)               │
│  │                              │
│  ├──────────────────────────────┤
│  │ 9AM  10:30  12PM  1:30  3PM  │ 4PM
│  └──────────────────────────────┘
```

### Colors & Styling
| Element | Style |
|---------|-------|
| **Line** | 2px stroke, `lineJoin='round'`, `lineCap='round'` |
| **Shadow** | `shadowBlur=6px`, color matches stroke |
| **Fill** | Vertical gradient, 22% top → 0% bottom opacity |
| **Endpoint Dot** | 3px circle, color = stroke, 6px glow blur |
| **Labels** | 7.5px Arial, gray (#94a3b8) |

### Fill Baseline
- **All Positive:** Fill to bottom
- **All Negative:** Fill to top
- **Mixed:** Fill to bottom (default)

---

## Device Pixel Ratio
Scales all rendering to screen pixel density for crisp lines on HiDPI displays:

```javascript
const dpr = window.devicePixelRatio || 1;
const width = Math.floor(rect.width * dpr);
const height = Math.floor(rect.height * dpr);
canvas.width = width;   // Set physical resolution
canvas.height = height;

// Apply dpr to all measurements
ctx.lineWidth = 2 * dpr;
ctx.shadowBlur = 6 * dpr;
```

---

## Responsive Resizing
Canvas auto-scales when window resizes:

```javascript
window.addEventListener('resize', () => {
  scheduleExposureSparklineRefresh(); // Batch update all sparklines
});
```

Checks current `getBoundingClientRect()` and redraws if size changed.

---

## Usage Template for New Metrics

### 1. Add Canvas HTML
```html
<canvas id="my-metric-sparkline" style="width:100%; height:120px;"></canvas>
```

### 2. Initialize History
```javascript
function ensureMyMetricHistory() {
  if (!window.__insightsGreekHistory.myMetric) {
    window.__insightsGreekHistory.myMetric = [];
  }
}
```

### 3. Add Data Point (in refresh loop)
```javascript
const stampKey = Math.floor(Date.now() / 30000);
if (hist._lastStamp_myMetric !== stampKey) {
  hist._lastStamp_myMetric = stampKey;
  hist.myMetric.push({ ts: Date.now(), value: newValue });
  if (hist.myMetric.length > 800) hist.myMetric.shift();
}
```

### 4. Render
```javascript
renderGreekSparklineCanvas('my-metric-sparkline', hist.myMetric, 'rgb(100, 200, 255)');
```

### 5. Schedule Refresh
```javascript
// On page init:
setInterval(() => {
  renderGreekSparklineCanvas('my-metric-sparkline', hist.myMetric, 'rgb(100, 200, 255)');
}, 1000); // Or tie to your data refresh interval
```

---

## Performance Notes

- **Canvas rendering:** ~2ms per sparkline on modern hardware
- **History cap:** 800 points limits memory to ~16KB per metric
- **Batch updates:** Call `renderGreekSparklines()` instead of individual renders
- **Resize throttling:** Use `scheduleExposureSparklineRefresh()` (already batched)
- **DPR scaling:** Only computed once per resize

---

## Customization Points

| What | Where |
|------|-------|
| History size limit | `if (hist[k].length > 800) hist[k].shift();` → change 800 |
| Dedup interval | `Math.floor(Date.now() / 30000)` → change 30000 (ms) |
| Session hours | `9 * 60` (9am), `16 * 60` (4pm) → change times |
| Chart padding | `pad = { left: 12, right: 10, top: 8, bottom: 14 }` |
| Line width | `ctx.lineWidth = 2 * dpr;` → change 2 |
| Dot size | `ctx.arc(..., 3 * dpr, ...)` → change 3 |
| Shadow blur | `ctx.shadowBlur = 6 * dpr;` → change 6 |
| Time tick labels | `tickTimes` array in `renderGreekSparklineCanvas()` |
| Outlier threshold | `1.5 * iqr` in IQR calculation |

---

## Edge Cases Handled

✅ **Empty data** → Returns early, no render  
✅ **Single point** → Shows as horizontal line + dot  
✅ **All flat values** → Uses 1% of value as range  
✅ **All outliers (IQR)** → Falls back to unfiltered data  
✅ **No ET offset data** → Uses live ES/RVOL fallback  
✅ **Detached DOM nodes** → Avoids writing to removed canvases  
✅ **Viewport not ready** → Schedules retry with 100–200ms delay  

---

## Example: Adding a Volume Metric

```javascript
// 1. Initialize
ensureExposureHistorySeries();
window.__insightsGreekHistory.volume = [];

// 2. In your 30-sec refresh:
async function updateVolume() {
  const vol = await getLatestVolume();
  const hist = window.__insightsGreekHistory;
  const stampKey = Math.floor(Date.now() / 30000);
  
  if (hist._lastStamp_volume !== stampKey) {
    hist._lastStamp_volume = stampKey;
    hist.volume.push({ ts: Date.now(), value: vol });
    if (hist.volume.length > 800) hist.volume.shift();
  }
  
  renderGreekSparklineCanvas('volume-sparkline', hist.volume, 'rgb(255, 140, 0)');
}

// 3. Tie to page init
if (document.getElementById('volume-sparkline')) {
  updateVolume();
  setInterval(updateVolume, 30000);
}
```

---

## API Summary

| Function | Purpose |
|----------|---------|
| `renderGreekSparklineCanvas(id, data, color)` | Render single sparkline |
| `renderGreekSparklines()` | Render all Greeks sparklines |
| `ensureExposureHistorySeries()` | Init history object |
| `scheduleExposureSparklineRefresh()` | Batch render with stagger delays |
| `utcMsToEtMinutes(ms)` | Convert UTC timestamp to ET minutes-since-midnight |

---

## References
- **Main file:** `exposure.js` lines 1114–1250 (rendering logic)
- **Data flow:** Lines 1024–1077 (DB hydration), Lines 1347–1407 (live updates)
- **Session timing:** Lines 382–398 (ET helpers)
