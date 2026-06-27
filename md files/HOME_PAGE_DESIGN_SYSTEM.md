# Home Page Design System & UI Setup Guide

---

## ⭐ CANONICAL RULE — Every New Page Must Use `PageShell` + `Card`

**Do not hand-build the shell or card styling on a new page.** Theming is centralized so it can never drift. To create a new page that matches the dashboard automatically:

1. Copy `app/_template/page.tsx.txt` → `app/<your-route>/page.tsx` and rename it.
2. Wrap everything in `<PageShell>` and put each panel in a `<Card>`.

```tsx
"use client";
import { HOME_THEME, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

export default function MyPage() {
  return (
    <PageShell maxWidth={620} align="center">   {/* omit both for a full-width dashboard */}
      <Card accent="cyan" title="My Page" subtitle="What this page does.">
        {/* your content; use HOME_THEME colors + homeInputStyle/homeButtonStyle */}
      </Card>
      {/* add more <Card>s — they stack with the shell's gap automatically */}
    </PageShell>
  );
}
```

**What you get for free:** dark themed shell, background glow, the top accent strip, the top-down radial glow, and the dashboard-wide hover lift — identical to the home/confidence cards.

**Accents:** `cyan` | `purple` | `orange` | `green` | `red` (or pass a hex).

**Single source of truth:** the look lives in `components/shared/PageCard.tsx` (which builds on `homeShellStyle` / `homeContentStyle` / `homeGlossPanelStyle` in `components/shared/homeTheme.ts`). Change it there once and every page follows. Never re-create shell/card styling inline.

**Reference example:** `app/feedback/page.tsx` is built entirely on `PageShell` + `Card`.

The sections below document the underlying tokens (colors, gradients, etc.) that these components are built from — read them when you need to style *inside* a card, not to rebuild the card itself.

---

## Core Design Principles

The home page (/app/home/page.tsx) uses a **dark theme with frosted-glass panels, cyan/purple accents, and live data visualizations**. This document details every aspect needed to replicate this design for new pages.

---

## Color Palette

All colors are defined in a single `C` object for consistency:

```typescript
const C = {
  bg: "#05060A",        // Primary background (darkest)
  panel: "#0D1119",     // Panel background
  cyan: "#00F0FF",      // Primary accent (bright cyan)
  purple: "#8B5CF6",    // Secondary accent
  orange: "#F97316",    // Warning/emphasis
  green: "#10B981",     // Positive/call metrics
  red: "#EF4444",       // Negative/put metrics
  muted: "#8B94A7",     // Secondary text
};
```

**Usage:**
- `C.bg` — shell/container backgrounds
- `C.panel` — transparent panel overlays
- `C.cyan` — active states, primary CTAs, accent icons
- `C.purple` — secondary overlays, gradient fills
- `C.orange` — peak GEX, rank #1 labels
- `C.green` — positive changes, call OI
- `C.red` — negative changes, put metrics
- `C.muted` — labels, secondary text, timestamps

---

## Gradients & Backgrounds

### Shell Background (Full Page)

```typescript
<div style={{
  background: C.bg,  // "#05060A"
  backgroundImage: "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)",
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  color: "#fff",
}}>
```

**Effect:** Subtle radial gradients (cyan at 15% left, purple at 85% right) that fade out. Very low opacity (0.02–0.03) for ambient effect only.

### Panel Backgrounds

All floating panels use the same frosted-glass recipe:

```typescript
background: "rgba(13,17,25,0.45)",
backdropFilter: "blur(16px)",
borderRadius: 16,
```

**Properties:**
- **Color**: `rgba(13,17,25,0.45)` — semi-transparent dark panel
- **Blur**: `blur(16px)` — frosted-glass effect
- **Radius**: `16px` — rounded corners
- **Padding**: Typically `24px` inside panels

### Divider Gradients

Two CSS classes handle subtle dividers:

```css
.grad-divider-b {
  position: relative;
}
.grad-divider-b::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(to right, 
    transparent 0%, 
    rgba(255,255,255,0.10) 30%, 
    rgba(255,255,255,0.13) 50%, 
    rgba(255,255,255,0.10) 70%, 
    transparent 100%);
  pointer-events: none;
}

.grad-divider-t {
  position: relative;
}
.grad-divider-t::before {
  /* Same gradient as above, but on ::before */
}
```

**Bottom divider example:**
```typescript
<div style={{ paddingBottom: 12, marginBottom: 12 }} className="grad-divider-b">
  {/* content */}
</div>
```

### Sidebar Dividers (Narrower)

For narrower dividers (used in sidebar):

```css
.grad-divider-sidebar-b::after {
  bottom: 0; left: 12px; right: 12px;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(255,255,255,0.10) 50%, transparent);
}

.grad-divider-sidebar-t::before {
  top: 0; left: 12px; right: 12px;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(255,255,255,0.10) 50%, transparent);
}
```

---

## Typography

### Font Family
```typescript
fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif"
```

### Font Sizes & Weights

| Usage | Size | Weight | Letter Spacing |
|-------|------|--------|-----------------|
| **Page Title** | 13px | 700 | 0.1em |
| **Section Title** | 13px | 700 | 0.1em |
| **Label** | 10px | 700 | 0.08em / 0.1em |
| **Value** | 14px | 700/800 | 0 |
| **Monospace (prices)** | 11–14px | 700 | 0 (uses `fontFamily: "monospace"`) |
| **Secondary text** | 9px | 700 | 0.08em |
| **Icon labels** | 13px | 700 | 0.1em |

### Color Hierarchy

```typescript
// Primary text
color: "#fff"

// Secondary text (labels, units)
color: "#8da8c2" or C.muted

// Accent text (active, cyan)
color: C.cyan

// Status text
color: C.green  // positive
color: C.red    // negative
color: C.orange // neutral/rank
```

---

## Layout Grid & Spacing

### Main Layout Structure

```typescript
<div style={{
  display: "flex",
  flexDirection: "row",  // Horizontal split
  padding: "clamp(14px, 2vw, 24px)",
  gap: "clamp(16px, 2vw, 32px)",
  minHeight: 0,
  overflow: "hidden",
  height: "100%",
}}>
  {/* LEFT: 55% */}
  <div style={{ width: "55%", ... }}>
  
  {/* RIGHT: 45% */}
  <div style={{ width: "45%", ... }}>
</div>
```

**Responsive clamps:**
- Padding: `clamp(14px, 2vw, 24px)` — scales between 14–24px with viewport
- Gap: `clamp(16px, 2vw, 32px)` — scales between 16–32px

### Scaling for Small Viewports

The entire page scales down via `transform: scale()` when viewport is smaller than 1680×980:

```typescript
const viewportScale = useRef(1);

<div
  style={{
    width: `${100 / viewportScale}%`,
    height: `${100 / viewportScale}%`,
    minWidth: viewportScale < 1 ? 1680 : "100%",
    minHeight: viewportScale < 1 ? 980 : "100%",
    transform: `scale(${viewportScale})`,
    transformOrigin: "top left",
    transition: "transform 0.18s ease-out",
  }}
>
```

Base dimensions: **1680×980px**, min scale: **0.78**

---

## Common Components

### Button Styles

#### Primary Button (CTA, active)
```typescript
style={{
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid rgba(0,229,255,.25)",
  background: "linear-gradient(180deg,rgba(0,229,255,.12),rgba(0,229,255,.04))",
  color: C.cyan,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
}}
```

#### Secondary Button (inactive)
```typescript
style={{
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.04)",
  color: "#fff",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
}}
```

#### Toggle Button (Tab-like)
```typescript
<button style={{
  display: "flex", alignItems: "center", gap: 8,
  padding: "12px 16px",
  fontSize: 13,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  background: "none",
  border: "none",
  cursor: "pointer",
  color: activeTab === tab.id ? C.cyan : "#fff",
  borderBottom: activeTab === tab.id ? `2px solid ${C.cyan}` : "2px solid transparent",
  transition: "color 0.15s",
}}>
```

### Input Styles

#### Range Slider (Intensity, Zoom)
```typescript
<input
  type="range"
  min={0.05}
  max={1}
  step={0.05}
  value={intensity}
  onChange={e => setIntensity(Number(e.target.value))}
  style={{
    flex: 1,
    accentColor: C.cyan,
    cursor: "pointer",
    height: 4,
  }}
/>
```

#### Text Input
```typescript
<input
  type="text"
  value={value}
  onChange={e => setValue(e.target.value)}
  style={{
    fontSize: 13,
    padding: "2px 8px",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 4,
    background: "rgba(0,0,0,0.4)",
    color: "#fff",
    fontFamily: "monospace",
    outline: "none",
  }}
/>
```

---

## SVG Gradients & Chart Styling

### Bar Chart Gradients

**Positive (Cyan) bars:**
```tsx
<linearGradient id="cyanBarGrad" x1="0" y1="1" x2="0" y2="0">
  <stop offset="0%" stopColor="#0284C7"/>
  <stop offset="100%" stopColor="#00F0FF"/>
</linearGradient>
```

**Negative (Gold/Amber) bars:**
```tsx
<linearGradient id="goldBarGrad" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stopColor="#CA8A04"/>
  <stop offset="100%" stopColor="#EAB308"/>
</linearGradient>

<linearGradient id="goldBarBright" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stopColor="#D97706"/>
  <stop offset="100%" stopColor="#FCD34D"/>
</linearGradient>
```

### Chart Grid & Lines

**Grid lines (horizontal):**
```tsx
<line x1="0" y1={y} x2={CHART_W} y2={y} stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
```

**Zero line:**
```tsx
<line x1="0" y1={ZERO_Y} x2={CHART_W} y2={ZERO_Y} stroke="rgba(255,255,255,0.3)" strokeWidth="2"/>
```

**Spot price line (dashed):**
```tsx
<line x1={spotBar.x} y1={0} x2={spotBar.x} y2={CHART_H} 
  stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="6 4"/>
```

### Glow Effects

**Positive bar glow:**
```tsx
style={{ filter: "drop-shadow(0 0 6px rgba(0,240,255,0.5))" }}
```

**Negative bar glow:**
```tsx
style={{ filter: "drop-shadow(0 0 6px rgba(234,179,8,0.5))" }}
```

**Line glow (DEX curve):**
```tsx
style={{ filter: "drop-shadow(0 0 4px rgba(139,92,246,0.6))" }}
```

---

## Data Display Patterns

### Metric Display (Label + Value)

```typescript
<div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
  <span style={{ fontSize: 10, color: "#8da8c2", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
    VIX
  </span>
  <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#fff" }}>
    {vix > 0 ? vix.toFixed(2) : "—"}
  </span>
</div>
```

**Structure:**
1. Label (small, muted color, uppercase)
2. Value (larger, monospace, full white)
3. Optional change (small, colored)

### Heatmap Cell

```typescript
<div style={{
  padding: "3px 4px",
  fontSize: 10,
  fontFamily: "monospace",
  textAlign: "right",
  background: cellBg(val, max, intensity),  // Dynamic gradient
  color: "#fff",
}}>
  {formattedValue}
</div>
```

**Cell background function:**
```typescript
function cellBg(val: number, colMax: number, intensity: number): string {
  if (val === 0) return "transparent";
  const abs = Math.abs(val);
  const ratio = Math.min(abs / colMax, 1);
  const rank = topValues.indexOf(abs) + 1;
  
  let opacity;
  if (rank === 1)      opacity = Math.max(0.82, intensity * 0.92);
  else if (rank === 2) opacity = Math.max(0.60, intensity * 0.78);
  else if (rank === 3) opacity = Math.max(0.40, intensity * 0.62);
  else                 opacity = Math.pow(ratio, 0.65) * intensity * 0.55;
  
  return val > 0
    ? `rgba(32,178,220,${Math.min(opacity, 0.95).toFixed(3)})`
    : `rgba(220,50,60,${Math.min(opacity, 0.95).toFixed(3)})`;
}
```

---

## States & Animations

### Active State
```typescript
// Button
background: "rgba(0,240,255,0.25)"
color: C.cyan
borderBottom: `2px solid ${C.cyan}`

// Card
outline: "1px solid rgba(41,182,246,0.7)"
outlineOffset: "-1px"
```

### Hover State
```typescript
cursor: "pointer"
filter: "brightness(1.1)"  // or opacity change
```

### Card Hover Lift & Highlight (standard for all cards)

Every panel-like card gets a subtle lift + soft shadow + faint cyan border on
hover. This is the dashboard-wide standard — apply it to any card you create.

**The class** (defined once in `app/globals.css`):
```css
.card-hover {
  transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}
.card-hover:hover {
  transform: translateY(-2px);                 /* lift ~2px */
  box-shadow: 0 6px 18px rgba(0, 0, 0, .35);   /* soft drop shadow */
  border-color: rgba(0, 240, 255, .35);        /* faint cyan highlight */
}
```

**Two ways it applies:**

1. **Automatic** — any card inside `<main>` with `borderRadius: 16` (the
   standard panel radius) gets the lift via a global rule in `globals.css`.
   So a card built from the standard panel recipe needs nothing extra.

2. **Opt-in** — for cards with a non-16px radius (e.g. 8px/10px/12px), add the
   class explicitly:
   ```tsx
   <div className="card-hover" style={{ /* ...panel styles... */ }}>
   ```

**Self-contained version** (if a page injects its own `<style>` instead of
relying on `globals.css`):
```tsx
<style>{`
  .card-hover { transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
  .card-hover:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.35); border-color: rgba(0,240,255,.35); }
`}</style>
```

**Rule of thumb:** put `className="card-hover"` on the OUTER container of each
card — not on inner badges, table rows, inputs, or nav chrome.

### Loading State
```typescript
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

// Apply:
style={{ animation: "pulse 1.5s infinite" }}
```

### Disabled State
```typescript
cursor: "not-allowed"
opacity: 0.5
pointerEvents: "none"
```

---

## Scrollbar Customization

All scrollable containers use:

```css
scrollbarWidth: "thin"
scrollbarColor: "rgba(255,255,255,0.04) transparent"
```

In `<style>` tag (for webkit browsers):
```css
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.04);
  border-radius: 3px;
}
```

---

## Typography Hierarchy Examples

### Section Header
```typescript
<div style={{
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
}}>
  <span style={{ color: C.cyan }}><IconComponent /></span>
  Section Title
</div>
```

### Data Label + Value
```typescript
<div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
  <span style={{ fontSize: 8, color: C.muted, textTransform: "uppercase", fontWeight: 700 }}>
    Label
  </span>
  <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: C.green }}>
    +$1.23M
  </span>
</div>
```

---

## Icon Styles

All icons are inline SVG with these properties:

```typescript
<svg width="16" height="16" 
  viewBox="0 0 24 24" 
  fill="none" 
  stroke="currentColor" 
  strokeWidth="2" 
  strokeLinecap="round" 
  strokeLinejoin="round"
/>
```

**Colors:**
- Inherit from parent (use `currentColor`)
- Override with explicit `stroke={C.cyan}` for accents

---

## Responsive Behavior

### Flex Utilities

```typescript
// Shrink on overflow
flexShrink: 0

// Min-width prevents overflow
minWidth: 0

// Hide overflow smoothly
overflow: "hidden"

// Prevent flex wrapping
whiteSpace: "nowrap"
```

### Column Widths

```typescript
// Left column
width: "55%"

// Right column
width: "45%"

// Both require:
minWidth: 0  // Required for flex children to shrink below content size
```

---

## Complete Page Template

```typescript
export default function NewPage() {
  return (
    <div style={{
      height: "100%",
      width: "100%",
      overflow: "auto",
      background: C.bg,
      backgroundImage: "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)",
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      color: "#fff",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 16,
        background: "rgba(13,17,25,0.45)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}>
        <span style={{ color: C.cyan, fontSize: 13, fontWeight: 700 }}>PAGE TITLE</span>
      </div>

      {/* Main Content */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "clamp(14px, 2vw, 24px)",
        gap: "clamp(16px, 2vw, 32px)",
        minHeight: 0,
        overflow: "hidden",
      }}>
        {/* Card Panel — `card-hover` adds the standard lift + cyan highlight */}
        <div className="card-hover" style={{
          background: "rgba(13,17,25,0.45)",
          backdropFilter: "blur(16px)",
          borderRadius: 16,
          padding: 24,
          flex: 1,
          overflow: "auto",
        }}>
          {/* Content */}
        </div>
      </div>

      <style>{`
        .grad-divider-b {
          position: relative;
        }
        .grad-divider-b::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.13) 50%, rgba(255,255,255,0.10) 70%, transparent 100%);
          pointer-events: none;
        }

        /* Standard card hover lift + highlight (see States & Animations). */
        .card-hover {
          transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
        }
        .card-hover:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 18px rgba(0,0,0,.35);
          border-color: rgba(0,240,255,.35);
        }
      `}</style>
    </div>
  );
}
```

---

## Summary Checklist for New Pages

- [ ] Color palette (C object)
- [ ] Shell background (radial gradients)
- [ ] Panel backgrounds (rgba + blur)
- [ ] Font: Inter, 700 weight for labels
- [ ] Layout: 55/45 split or adjust as needed
- [ ] Divider classes (grad-divider-b, grad-divider-t)
- [ ] Button styles (primary, secondary, toggle)
- [ ] SVG gradients (cyan, gold)
- [ ] Hover/active states
- [ ] Card hover lift (`.card-hover` on every card — auto for 16px-radius panels)
- [ ] Scrollbar styling
- [ ] Responsive clamps for padding/gaps
- [ ] Icon colors (currentColor or C.cyan)
- [ ] Monospace for values (fontFamily: "monospace")
- [ ] Glow effects for data highlights
