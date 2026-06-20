# Intensity Slider & Gradient Coloring Logic

## Overview
All Greek heatmaps (Multi-Greek, GEX Heatmap / home page, Options Chain) share one canonical intensity slider and one `metricBg()` coloring formula. The **Multi-Greek panel is the reference standard** — every other heatmap matches it exactly so increments are identical across the app.

Greek cells (Gex, Dex, Chex, Vex) are colored by rank and magnitude: blue `rgba(41,182,246,…)` for positive, red `rgba(255,71,87,…)` for negative.

---

## Intensity Slider Control (canonical)

```jsx
<span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>Intensity</span>
<input
  type="range" min={0.5} max={3} step={0.01}
  value={intensity}
  onChange={(e) => setIntensity(Number(e.target.value))}
  style={{ width: 80, height: 3, accentColor: "#00e5ff" }}
/>
<span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, fontFamily: "monospace" }}>
  {intensity.toFixed(2)}x
</span>
```

**Parameters:**
- **Min:** 0.5x
- **Max:** 3x
- **Step:** 0.01
- **Default:** `useState(1.75)`

---

## The metricBg() Function (canonical)

```typescript
function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]): string {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  const pos = n >= 0;
  const rank = topValues.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * (intensity || 0.1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
}
```

> Note: in `GexHeatmap.tsx` this lives as `cellBg(key, val, topRank)` and reads `topRank` directly (1/2/3) instead of `topValues.indexOf`, but the alpha math is identical.

---

## Opacity Rules

### Top 3 magnitudes (fixed alpha)

| Rank | Alpha |
|------|-------|
| #1   | 0.90  |
| #2   | 0.45  |
| #3   | 0.25  |

Fixed — **not** scaled by intensity. This gives the bold, clearly-ranked top cells.

### Remaining values (intensity-scaled, capped)

```
ratio = min(|value| / maxValue, 1)
eased = (ratio × intensity)^1.4
alpha = min(0.18, 0.02 + eased × 0.16)
```

The exponent 1.4 keeps low/mid values subtle; alpha is **hard-capped at 0.18** so non-top cells never overpower the ranked top 3.

**Example at intensity = 1.75, value = 50% of max:**
- eased = (0.5 × 1.75)^1.4 = (0.875)^1.4 ≈ 0.829
- alpha = min(0.18, 0.02 + 0.829 × 0.16) = min(0.18, 0.153) = **0.15**

**Example at intensity = 3, value = 50% of max:**
- eased = (0.5 × 3)^1.4 = (1.5)^1.4 ≈ 1.78
- alpha = min(0.18, 0.02 + 1.78 × 0.16) = min(0.18, 0.305) = **0.18** (capped)

---

## Color Mapping

- **Positive** (`value ≥ 0`): blue `rgba(41, 182, 246, alpha)`
- **Negative** (`value < 0`): red `rgba(255, 71, 87, alpha)`

---

## Where this is used

| File | Notes |
|------|-------|
| `app/mult-greek/page.tsx` | **Reference standard** |
| `app/home/page.tsx` | GEX Heatmap (LIVE GEX HEATMAP panel) — inline `metricBg` |
| `app/options-chain/page.tsx` | Options Chain heatmap — `metricBg` |
| `components/dashboard/GexHeatmap.tsx` | `cellBg()` — same alpha math, used by `app/mobile` |

---

## Summary

| Aspect | Value |
|--------|-------|
| **Slider range** | 0.5x–3x |
| **Default** | 1.75x |
| **Granularity** | 0.01 |
| **Slider style** | width 80, height 3, accent `#00e5ff` |
| **Positive color** | Blue `rgba(41, 182, 246, ?)` |
| **Negative color** | Red `rgba(255, 71, 87, ?)` |
| **Rank 1/2/3 alpha** | 0.90 / 0.45 / 0.25 (fixed) |
| **Rest alpha** | `min(0.18, 0.02 + (ratio × intensity)^1.4 × 0.16)` |
| **Max alpha (non-top)** | 0.18 |
| **Applies to** | Greek columns (Gex, Dex, Chex, Vex) |
