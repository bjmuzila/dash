# Mobile Scroll / Viewport Audit — 2026-07-11

Static code audit of every route + tab strip at a ~390px viewport.
Breakpoint: `@media (max-width: 899px)` in `app/globals.css`.

## Architecture (why things clip)

The app is a fixed-height desktop shell:

- `app/layout.tsx` → `<body class="h-screen overflow-hidden">`
- `LayoutShell` → every wrapper is `overflow: hidden`
- `homeShellStyle` / `homeContentStyle` → `overflow: hidden`, `height: 100%`

So **nothing scrolls by default**. Mobile scroll is granted entirely by the
`@media (max-width: 899px)` block in `globals.css`, which flips `main` and
`main > div` to `overflow-y: auto; height: auto`. Any clipping bug on mobile is
almost always one of:

1. A wrapper **deeper than `main > div`** that is still `overflow: hidden`.
2. A **hard pixel `minWidth`** on a layout column → horizontal overflow.
3. A **tab strip** that is `display: flex` with no `flexWrap` → tabs 4+ pushed
   off-screen and unreachable (parent is `overflow-x: hidden`).
4. A **multi-column grid** whose track string isn't matched by the collapse
   rules in globals.css.

## Fixes applied this pass

### `app/globals.css` (mobile block)

- `.tab-strip` / `.sm-tabs` — tab rows become one horizontally-swipeable strip
  (`nowrap` + `overflow-x: auto`, scrollbar hidden, children `flex: 0 0 auto`).
  Every tab stays reachable instead of being clipped off-screen.
- `.sm-head` — `/social-media` header row wraps.
- `.wide-scroll` — escape hatch for dense blocks that must keep their width.
- Released hard pixel min-widths on layout columns (300/320/380/400/420/480px)
  so wrapped flex columns can shrink to the screen.
- Collapsed `minmax(0, 1.5fr) minmax(...)` / `minmax(0, 1.55fr) minmax(...)`
  grids (Regime Matrix) that the existing collapse list missed.
- `html, body { overflow-x: hidden }` — last line of defence against a
  horizontal scrollbar on the viewport.

### Tab strips tagged `className="tab-strip"`

| File | Tabs |
|---|---|
| `components/shared/DockToolbar.tsx` → `SegGroup` | **shared** — covers /social-media (7), /fails, /es-candles, /greeks, /options-chain, /mult-greek, /owner/admin/emails, /feedback, GexToolbar, EstimatedMoves |
| `app/test/page.tsx` → `TestTabBar` | Overview · GEX Levels · Flow Inventory · Regime Engine · Flow GEX History |
| `app/home/HomeClient.tsx` | Calendar · Flow · Whale · Greeks · Scanner · ES Candles |
| `app/trading/page.tsx` | Journal · Comparison · Analysis |
| `app/owner/dev/results/page.tsx` | ICT Results · Fail Rate · Confidence |
| `app/owner/dev/owner/page.tsx` | Daily · Weekly · Monthly |

## Tab strips verified OK (already wrap)

- `/scanner` — 9 tabs, `flexWrap: "wrap"` ✔
- `/owner/budget` — 5 tabs, `flexWrap: "wrap"` ✔
- `/database` — `flex flex-wrap` ✔
- `/whats-new` — 2 tabs ✔
- `/flow` — filter chips use `flexWrap: "wrap"` ✔

## Pages with page-specific mobile CSS already in place

`/home` (home-split stack + reorder), `/es-candles` (`.es-candles-root`,
`.es-candles-toggles`), `/mult-greek` (`.mg-panels`), `/greeks`
(`.greeks-cards`), `/overview` (`.overview-root`), `/analytics`
(`.analytics-grid`), `/explore` + landing (`.explore-root`).

## Still needs eyes-on (static audit can't confirm)

These are the routes where a real 390px render is the only way to be sure —
they have deep nesting, canvases, or absolutely-positioned overlays that
CSS-level rules can't fully reason about:

- `/es-candles` — canvas chart + GEX heatmap overlay + lanes
- `/test` — GEX Levels tab (SqueezeMetrics dashboard), Regime Engine charts
- `/scanner` — Balance/Imbalance quadrant, Watch This cards
- `/flow` — tape + Dark Pool accumulation chart
- `/confidence-score` — MVC timeline (has `minWidth: 300` column, now released)
- `/ict` — candle pipeline canvases
- `/social-media` — screenshot capture panes (fixed capture widths are
  intentional; they should scroll, not shrink)

**Verification method:** open each in Chrome DevTools at 390×844, scroll to the
bottom of the page, then click through every tab and repeat. Look for: content
cut off at the fold, a horizontal scrollbar, tabs you can't reach.
