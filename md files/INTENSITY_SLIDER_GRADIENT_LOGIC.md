# Intensity Slider & Gradient Coloring Logic

## Overview
The Options Chain heatmap uses an intensity slider (0.2x–3x) to control the opacity of color-coded cells. Greek columns (Gex, Dex, Chex, Vex) are colored by value rank and magnitude, with blue for positive and red for negative.

---

## Intensity Slider Control

**Location:** Top toolbar, options-chain/page.tsx lines 549–562

```jsx
<span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 800 }}>
  Intensity
</span>
<input
  type="range"
  min={0.2}
  max={3}
  step={0.01}
  value={intensity}
  onChange={(event) => setIntensity(Number(event.target.value))}
  style={{ width: 100, accentColor: "#00e5ff", cursor: "pointer" }}
/>
<span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, textAlign: "right", fontFamily: "monospace" }}>
  {intensity.toFixed(2)}x
</span>
```

**Parameters:**
- **Min:** 0.2x
- **Max:** 3x
- **Step:** 0.01
- **Default:** 0.4x (set via `const [intensity, setIntensity] = useState(0.4)`)

---

## Color Application

**Location:** options-chain/page.tsx line 667

Applied to Greek cells (Gex, Dex, Chex, Vex) only:

```jsx
{numericCells.map((cell) => {
  const greekCell = cell.key === "gex" || cell.key === "dex" || cell.key === "chex" || cell.key === "vex";
  return (
    <div
      style={{
        background: greekCell 
          ? metricBg(cell.value, maxByColumn[cell.key], intensity, top3ByColumn[cell.key]) 
          : "transparent",
        // ... other styles
      }}
    >
      {cell.text}
    </div>
  );
})}
```

**Parameters passed to metricBg():**
1. `cell.value` — the Greek metric value (e.g., row.gex)
2. `maxByColumn[cell.key]` — maximum absolute value in visible rows for that column
3. `intensity` — slider value (0.2–3x)
4. `top3ByColumn[cell.key]` — array of top 3 non-zero values for ranking

---

## The metricBg() Function

**Location:** options-chain/page.tsx lines 89–104

```typescript
function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]) {
  // Return transparent if value is zero or falsy
  if (!value) return "transparent";
  
  // Normalize value to 0–1 range for power curve
  const abs = Math.abs(value);
  const ratio = Math.min(abs / Math.max(maxValue, 1), 1);
  
  // Find rank in top 3 values (1, 2, 3, or >3)
  const rank = topValues.indexOf(abs) + 1;

  // Calculate opacity based on rank
  let opacity: number;
  if (rank === 1) {
    // #1 value: minimum 0.82, or intensity × 0.92 (whichever is higher)
    opacity = Math.max(0.82, intensity * 0.92);
  } else if (rank === 2) {
    // #2 value: minimum 0.6, or intensity × 0.78
    opacity = Math.max(0.6, intensity * 0.78);
  } else if (rank === 3) {
    // #3 value: minimum 0.4, or intensity × 0.62
    opacity = Math.max(0.4, intensity * 0.62);
  } else {
    // Rest: power curve applied to normalized ratio, then intensity scaled
    opacity = Math.pow(ratio, 0.65) * intensity * 0.55;
  }

  // Cap opacity at 0.95 maximum
  const finalOpacity = Math.min(opacity, 0.95).toFixed(3);

  // Return RGBA string: cyan for positive, red for negative
  return value > 0
    ? `rgba(32,178,220,${finalOpacity})` // Cyan
    : `rgba(220,50,60,${finalOpacity})`; // Red
}
```

---

## Opacity Calculation Rules

### Top 3 Values (Rank 1, 2, 3)
Each rank has a **floor** (minimum opacity) and an **intensity-scaled** formula. The function returns whichever is higher:

| Rank | Floor | Intensity Formula | Result |
|------|-------|-------------------|--------|
| #1   | 0.82  | intensity × 0.92  | `Math.max(0.82, intensity × 0.92)` |
| #2   | 0.60  | intensity × 0.78  | `Math.max(0.60, intensity × 0.78)` |
| #3   | 0.40  | intensity × 0.62  | `Math.max(0.40, intensity × 0.62)` |

**Example at intensity = 0.4x:**
- Rank #1: max(0.82, 0.4 × 0.92) = max(0.82, 0.368) = **0.82**
- Rank #2: max(0.60, 0.4 × 0.78) = max(0.60, 0.312) = **0.60**
- Rank #3: max(0.40, 0.4 × 0.62) = max(0.40, 0.248) = **0.40**

**Example at intensity = 3x:**
- Rank #1: max(0.82, 3 × 0.92) = max(0.82, 2.76) = **0.95** (capped)
- Rank #2: max(0.60, 3 × 0.78) = max(0.60, 2.34) = **0.95** (capped)
- Rank #3: max(0.40, 3 × 0.62) = max(0.40, 1.86) = **0.95** (capped)

---

### Remaining Values (Rank > 3)
For all other values, opacity follows a **power curve**:

```
opacity = (value/maxValue)^0.65 × intensity × 0.55
```

The exponent 0.65 creates a gentle curve that emphasizes mid-range values. Multiplying by intensity scales the entire curve.

**Example at intensity = 1x, value = 50% of max:**
- opacity = (0.5)^0.65 × 1 × 0.55 = 0.609 × 0.55 ≈ **0.335**

**Example at intensity = 3x, value = 50% of max:**
- opacity = (0.5)^0.65 × 3 × 0.55 = 0.609 × 1.65 ≈ **1.005** → capped at **0.95**

---

## Color Mapping

**Sign → Color:**
- **Positive value** (`value > 0`): Cyan `rgba(32, 178, 220, opacity)`
- **Negative value** (`value < 0`): Red `rgba(220, 50, 60, opacity)`

**RGB Breakdown:**
- Cyan: R=32, G=178, B=220 (hex #20b2dc)
- Red: R=220, G=50, B=60 (hex #dc323c)

---

## Data Dependencies

### maxByColumn
Calculated in useMemo (line 382–405). Tracks the maximum absolute value in **visible rows** for each column.

```typescript
const base: Record<Lowercase<ChainColumn>, number> = {
  strike: 1,
  gex: 1,
  dex: 1,
  chex: 1,
  vex: 1,
  premium: 1,
  volume: 1,
  oi: 1,
};

visibleRows.forEach((row) => {
  base.gex = Math.max(base.gex, Math.abs(row.gex));
  base.dex = Math.max(base.dex, Math.abs(row.dex));
  // ... etc
});
```

### top3ByColumn
Calculated in useMemo (line 407–417). For each column, extracts the three largest non-zero values.

```typescript
const top3ByColumn = useMemo(() => {
  return {
    gex: visibleRows.map((row) => Math.abs(row.gex))
      .filter((value) => value > 0)
      .sort((a, b) => b - a)
      .slice(0, 3),
    // ... repeat for dex, chex, vex, premium, volume, oi
  };
}, [visibleRows]);
```

---

## Summary

| Aspect | Value |
|--------|-------|
| **Slider range** | 0.2x–3x |
| **Default** | 0.4x |
| **Granularity** | 0.01 |
| **Positive color** | Cyan `rgba(32, 178, 220, ?)` |
| **Negative color** | Red `rgba(220, 50, 60, ?)` |
| **Max opacity** | 0.95 |
| **Top 3 strategy** | Rank-based floors + intensity scaling |
| **Rest strategy** | Power curve: `(ratio)^0.65 × intensity × 0.55` |
| **Applies to** | Greek columns only (Gex, Dex, Chex, Vex) |
