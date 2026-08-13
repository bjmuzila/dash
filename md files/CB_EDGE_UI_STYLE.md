# CB Edge — Dashboard UI Style Guide

A self-contained spec for reproducing the CB Edge dashboard look. Everything
needed is in this file — no repo access required. Written for another AI/agent
building HTML, React, or SVG that must match the app.

**One-line brief:** near-black frosted-glass trading terminal. Dark navy-black
canvas, translucent blurred cards with hairline edges, cyan/light-blue as the
single accent, uppercase micro-labels with wide tracking, tabular numerics, and
semantic color used *only* to mean something (up/down, positive/negative gamma).

---

## 1. Tokens

Drop-in CSS custom properties. These are the exact app values.

```css
:root{
  /* Surfaces */
  --bg:            #05060A;   /* page canvas */
  --panel:         #0D1119;   /* OPAQUE panel — sticky headers only */
  --panelBg:       rgba(13,17,25,0.45);  /* frosted card base (needs blur) */
  --panelBgStrong: rgba(13,17,25,0.72);  /* heavier frosted fill */
  --border:        rgba(255,255,255,0.10);

  /* Brand accents */
  --cyan:      #219EBC;  /* primary UI accent: buttons, toolbar, focus */
  --purple:    #126783;  /* deep cyan-teal, used in gradients */
  --orange:    #FB8501;  /* projection / forecast lines */
  --skyMuted:  #8ECAE6;  /* card subtitles, "income"/positive text */

  /* The one card accent */
  --lightBlue: #7dd3fc;  /* card highlight, chips, selection ring */
  --softRed:   #f4948e;  /* negatives, deficits, destructive — NOT #EF4444 */

  /* Status */
  --green:     #1FD98A;  /* success / up / gamma increasing */
  --red:       #EF4444;  /* hard alert only — rare */

  /* Candles (OHLC surfaces only) */
  --up:        #30d158;
  --down:      #ff5b5b;

  /* GEX level colors */
  --cb:        #ffd600;  /* Core Bullseye — highest |GEX| strike */
  --cw:        #29b6f6;  /* Call Wall     — highest +GEX strike */
  --pw:        #ff4757;  /* Put Wall      — most −GEX strike */
  --onSolid:   #04121a;  /* ink on a solid fill of a level color */
}
```

Level tints (faint cell wash behind a row at that level):

```css
--tint-cb: rgba(255,214,0,0.05);
--tint-cw: rgba(41,182,246,0.05);
--tint-pw: rgba(255,71,87,0.05);
```

### Color rules (important)

1. **One accent.** Light blue `#7dd3fc` for card highlights; cyan `#219EBC` for
   interactive chrome. No rotating per-card colors, no colored top bars on cards.
2. **Reds:** `--softRed` (`#f4948e`) for every negative number, deficit tint, and
   delete control. `#EF4444` reads harsh on the dark surface — reserve it for
   genuine error states.
3. **Candles are their own pair.** `#30d158` / `#ff5b5b` are for OHLC marks only.
   Never use the UI status colors for candles, and never use candle colors for UI.
4. **Never hardcode a hex outside this token list.** If a new color seems needed,
   it almost certainly maps to an existing token.

---

## 2. Page shell

```css
body{
  background: #05060A;
  background-image:
    radial-gradient(circle at 15% 50%, rgba(33,158,188,0.04) 0%, transparent 50%),
    radial-gradient(circle at 85% 30%, rgba(18,103,131,0.05) 0%, transparent 50%);
  color: #FFFFFF;
  font-family: 'Inter','Helvetica Neue',Arial,sans-serif;
  -webkit-font-smoothing: antialiased;
}
main{
  padding: clamp(14px, 2vw, 24px);
  display: flex; flex-direction: column;
  gap: clamp(16px, 2vw, 32px);
  overflow: auto; min-height: 0;
}
```

Two faint off-axis radial glows are the entire background treatment. No noise,
no images, no gradients on the body itself.

Scrollbars are thin and nearly invisible:

```css
::-webkit-scrollbar { width:6px; height:6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius:3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
```

---

## 3. Cards — three surfaces

Pick by content type. Never invent a fourth.

### 3a. Classic card — dense tables, lists, anything needing a contained edge

```css
.card{
  background: rgba(13,17,25,0.45);
  backdrop-filter: blur(16px);
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow: 0 18px 40px rgba(0,0,0,0.22);
  padding: 22px;
}
```

### 3b. Dissolve card — chart / overview panels that should float

No border. The fill ramps its alpha to nothing toward the perimeter and a radial
mask feathers the corners, so the panel melts into the background.

```css
.card-dissolve{
  background: radial-gradient(120% 130% at 50% 0%,
                rgba(13,17,25,0.34) 0%,
                rgba(13,17,25,0.22) 45%,
                rgba(13,17,25,0.06) 80%,
                transparent 100%);
  backdrop-filter: blur(44px) saturate(1.15);
  border-radius: 28px;
  border: none;
  box-shadow: 0 40px 100px -40px rgba(0,0,0,0.45);
  mask-image: radial-gradient(130% 140% at 50% 40%, #000 60%, transparent 100%);
}
```

Dissolve cards do **not** get the hover lift (no edge to lift).

### 3c. Stat / metric tile — KPI numbers

```css
.tile{
  background: rgba(13,17,25,0.45);
  backdrop-filter: blur(20px);
  border: none;
  border-radius: 16px;
  padding: 13px 14px;
}
```

Tile anatomy: micro-label on top, big number below. The **number** carries the
semantic color; the tile body stays neutral.

### Hover lift (classic + tile only)

```css
.card-hover{ transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
.card-hover:hover{
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0,0,0,.35);
  border-color: rgba(0,240,255,.35);
}
```

### Card header

```html
<div class="card-title">SECTION NAME</div>
<div class="card-sub">short qualifier</div>
```
```css
.card-title{ font-size:14px; font-weight:800; letter-spacing:.12em;
             text-transform:uppercase; color:#fff; }
.card-sub  { font-size:12px; color:#8ECAE6; margin-top:2px; }
```

---

## 4. Typography

| Role | Spec |
|---|---|
| Family | Inter → 'Helvetica Neue' → Arial, sans-serif |
| Page/section heading | 11–14px, **800–900**, `letter-spacing:.12em–.22em`, UPPERCASE |
| Card title | 14px / 800 / .12em / UPPERCASE |
| Card subtitle | 12px, `#8ECAE6` |
| Micro-label (`labelCap`) | **10px / 800 / .14em / UPPERCASE**, `rgba(255,255,255,.45)` |
| Body copy | 12–13px, `line-height:1.6`, `rgba(255,255,255,.68)` |
| Emphasis in body | `color:#fff; font-weight:700` |
| Big metric | 20–26px, 800, `letter-spacing:-.02em` |
| Numbers (all) | `font-variant-numeric: tabular-nums` |
| Prices / strikes / times | monospace stack: `ui-monospace,'SF Mono',Menlo,monospace` |

The uppercase micro-label with wide tracking is the single strongest signature of
this UI. Use it for every field label, axis label, and tile caption.

---

## 5. Chrome — toolbar

Full-bleed frosted bar with a 2px cyan accent hairline across the top that fades
to transparent at both edges:

```css
.toolbar{
  position:relative; display:flex; align-items:center; justify-content:space-between;
  gap:12px; padding:14px 18px;
  background: rgba(13,17,25,0.45);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255,255,255,0.10);
}
.toolbar::before{
  content:""; position:absolute; top:0; left:0; right:0; height:2px; pointer-events:none;
  background: linear-gradient(90deg, transparent 0%,
    rgba(33,158,188,.12) 15%, rgba(33,158,188,.9) 50%,
    rgba(33,158,188,.12) 85%, transparent 100%);
  box-shadow: 0 0 8px rgba(33,158,188,.35);
}
```

Brand mark: `CB` in white + `EDGE` in cyan, 13px / 800 / `.18em` / uppercase.

Live indicator: 6px green dot with `box-shadow:0 0 10px rgba(31,217,138,.7)` and
a 10px / 800 / `.08em` uppercase label in `#1FD98A`.

---

## 6. Controls

```css
/* Primary — cyan gradient */
.btn{
  padding:5px 10px; border-radius:6px;
  border:1px solid rgba(33,158,188,.25);
  background: linear-gradient(180deg, rgba(33,158,188,.12), rgba(33,158,188,.04));
  color:#219EBC; font-size:10px; font-weight:700;
  letter-spacing:.08em; text-transform:uppercase; cursor:pointer;
}
/* Ghost / secondary */
.btn-ghost{
  padding:5px 10px; border-radius:6px;
  border:1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.04); color:#fff;
  font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
}
/* Input */
.field{
  font-size:14px; padding:8px 12px; border-radius:6px;
  border:1px solid rgba(255,255,255,0.10);
  background: rgba(0,0,0,0.40); color:#fff; outline:none;
  color-scheme: dark; accent-color:#219EBC;
}
/* Chip / pill — filled, not outlined */
.chip{
  padding:3px 8px; border-radius:999px;
  background: rgba(125,211,252,0.12); color:#7dd3fc;
  font-size:9px; font-weight:800; letter-spacing:.08em; text-transform:uppercase;
}
/* Status tag — tinted fill + matching hairline */
.tag-green{ color:#1FD98A; border:1px solid rgba(31,217,138,.30); background:rgba(31,217,138,.08); }
.tag-red  { color:#f4948e; border:1px solid rgba(244,148,142,.32); background:rgba(244,148,142,.08); }
.tag-blue { color:#7dd3fc; border:1px solid rgba(125,211,252,.28); background:rgba(125,211,252,.08); }
```

**Tag/chip formula:** text color `C`, border `C @ 0.30`, background `C @ 0.08`.
This one recipe generates every status pill in the app.

### Dropdowns / menus ("dock" language)

```css
.dock{
  background: radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%),
              rgba(10,13,20,0.98);
  border-top: 2px solid rgba(33,158,188,0.5);
  box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset,
              0 20px 44px -14px rgba(0,0,0,0.75),
              0 6px 16px rgba(0,0,0,0.45);
}
.dock-item.active{
  background: linear-gradient(180deg, rgba(33,158,188,0.16), rgba(33,158,188,0.04));
  border: 1px solid rgba(33,158,188,0.3);
  box-shadow: 0 0 14px rgba(33,158,188,0.22);
}
.dock-item:hover{ background: rgba(33,158,188,0.10); }
```

---

## 7. Data visualization

**Read this before writing any chart code.**

### Chart canvas
- No chart background fill — the card is the background.
- Grid: `rgba(255,255,255,.045)`, 1–1.5px, `stroke-dasharray:7 9`. Barely there.
- Plot frame (optional): `rgba(255,255,255,.07)` hairline.
- Axis text: micro-label spec (10px / 800 / .14em / uppercase / 45% white).

### Candlesticks
Body `rx:2`, opacity ~.88; wick 2.6px at ~.8 opacity, same color as the body.
Up `#30d158`, down `#ff5b5b`.

### Bars / histograms (GEX etc.)
Horizontal gradient fading away from the axis:

```css
/* positive */ linear-gradient(90deg, rgba(41,182,246,.95), rgba(41,182,246,.38))
/* negative */ linear-gradient(90deg, rgba(255,71,87,.85),  rgba(255,71,87,.25))
```
Radius 3px. Sign is encoded by color, not by direction alone.

### Level lines (walls, flip, VWAP)
2–4px stroke in the level color, plus a soft glow:

```html
<filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
  <feGaussianBlur stdDeviation="7" result="b"/>
  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
```
Solid = active level, `stroke-dasharray:6 4` = projected/secondary. End the line
with a 22–24px circle badge: fill `C @ .18`, stroke `C`, 900-weight letter inside.

### Regime washes
Tint a price band to mark a regime — a vertical gradient from `C @ .10` to
transparent. Never a flat fill.

### Meters / progress
```css
.meter{ height:7px; border-radius:999px; background:rgba(255,255,255,.06); overflow:hidden; }
.meter i{ height:100%; border-radius:999px;
          background: linear-gradient(90deg, var(--c), color-mix(in srgb, var(--c) 30%, transparent)); }
```

### Sparklines
Flex row of 3px-gap bars, `border-radius:2px 2px 0 0`, opacity ramping .4 → .9
along the series so direction reads without a legend.

### Chart color assignment
Categorical series: `#7dd3fc → #FB8501 → #8ECAE6 → #1FD98A → #f4948e → #ffd600`.
Never assign a semantic color (up/down/CW/PW) to a non-semantic series.

---

## 8. Layout patterns

- **Section rule:** uppercase 11px / .22em heading at 50% white, followed by a
  `1px` line `linear-gradient(90deg, var(--border), transparent)` filling the row.
- **Grids:** `repeat(3, minmax(0,1fr))` with `gap: 16px`; collapse to one column
  under ~900px. Chart+sidebar splits use `minmax(0,1.55fr) minmax(0,1fr)`.
- **Key/value rows:** `display:flex; justify-content:space-between; padding:9px 0;`
  with `border-top:1px solid rgba(255,255,255,.06)`. Label muted left, tabular
  value right.
- **Ladder rows** (strike tables): `grid-template-columns: 64px 1fr 78px` —
  strike / bar / value. Hover `rgba(33,158,188,.06)`. Spot row gets a dashed
  `--cb` border and a left-to-right gold wash.
- **Sticky headers use the OPAQUE `#0D1119`**, never a translucent fill, or
  scrolled rows bleed through.

---

## 9. Motion

Restrained. Only three motions exist:

1. Card hover lift — `translateY(-2px)`, `.15s ease`.
2. Value/state transitions — `all .15s`.
3. Live-dot glow — static `box-shadow`, no pulse animation.

No page transitions, no entrance animations, no parallax.

---

## 10. Voice

Terminal-terse. Labels are 1–3 words, uppercase. Values carry units inline
(`+6.4B`, `−1.24B`, `6420`, `±8`). Descriptions run 1–2 sentences at ~13px with
the load-bearing nouns bolded white against 68% body text.

---

## 11. Checklist before shipping a surface

- [ ] Every color traces to a token in §1 — zero ad-hoc hex.
- [ ] Negative numbers use `#f4948e`, not `#EF4444`.
- [ ] Candle colors used only on OHLC marks.
- [ ] Every label is 10px / 800 / .14em / uppercase / 45% white.
- [ ] All numerics are `tabular-nums`; prices/strikes are monospace.
- [ ] Cards: classic (bordered, 18px) for tables, dissolve (borderless, 28px,
      blur 44) for charts, tile (16px, no border) for KPIs.
- [ ] Sticky surfaces are opaque `#0D1119`.
- [ ] Grid lines are `rgba(255,255,255,.045)` dashed — invisible until you look.
- [ ] Hover lift present on bordered cards, absent on dissolve cards.
- [ ] Layout collapses to a single column under 900px.

---

## 12. Minimal working example

```html
<div class="card card-hover">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px">
    <div>
      <div class="card-title">Call Wall Structure</div>
      <div class="card-sub">5m · dealer positioning</div>
    </div>
    <span class="tag-blue" style="padding:4px 9px;border-radius:999px;font-size:9px;
      font-weight:800;letter-spacing:.14em;text-transform:uppercase">CW 6420</span>
  </div>

  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
    <div class="tile">
      <div style="font-size:10px;font-weight:800;letter-spacing:.14em;
                  text-transform:uppercase;color:rgba(255,255,255,.45)">Net GEX</div>
      <div style="font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;
                  letter-spacing:-.02em;margin-top:5px;color:#29b6f6">+6.4B</div>
    </div>
    <div class="tile">
      <div style="font-size:10px;font-weight:800;letter-spacing:.14em;
                  text-transform:uppercase;color:rgba(255,255,255,.45)">Flip Level</div>
      <div style="font-size:20px;font-weight:800;font-family:ui-monospace,Menlo,monospace;
                  letter-spacing:-.02em;margin-top:5px">6371</div>
    </div>
  </div>
</div>
```

---

## 13. What NOT to do

- No rotating per-card accent colors, and no colored strip across the top of a
  card. That look was removed deliberately.
- No pure black (`#000`) or pure gray (`#333`) surfaces — always the navy-tinted
  `#05060A` / `#0D1119` family.
- No solid opaque cards. Frosted translucency + blur *is* the design.
- No borders on tiles or dissolve panels.
- No emoji, no drop shadows on text, no rounded-pill buttons for primary actions.
- No bright saturated fills — color appears as ~8–20% alpha tints with a
  full-strength hairline and full-strength text.
- No decorative color: if a thing is colored, that color means something.
