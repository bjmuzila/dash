# options-vite

Placeholder shell for the Options dashboard. Vite + React + TypeScript, palette
ported from `home3-vite/src/dashboard/theme.ts`.

```bash
npm install
npm run dev      # http://localhost:5183
```

## Layout

```
┌───────────────── TOP UNIVERSAL TOOLBAR ─────────────────┐
│ ticker selector          │                              │
│ daily / yearly heatmap   │  S&P 500 sunburst            │
│                          ├──────────────────────────────┤
│ candlestick (ES-based)   │  orderflow graph             │
│                          ├──────────────────────────────┤
│                          │  live orderflow feed         │
└──────────────────────────┴──────────────────────────────┘
```

## How it's wired

- `src/TickerContext.tsx` — one global selected ticker. Every card calls
  `useTicker()`, so changing the dropdown re-labels the whole page.
- `src/components/TickerSelect.tsx` — main dropdown with a second, smaller
  dropdown at its top-left that switches between **Favorites** and
  **Watchlist** (lists live in `src/data/tickers.ts`).
- `src/pages/PageView.tsx` — owns the grid. The toolbar, ticker selector,
  heatmap and sunburst render on **every** page; only the three remaining slots
  (main / side / feed) change per route.
- `src/pages/registry.tsx` — add a route here and it shows up in the toolbar nav
  automatically.

## Not wired yet

Every panel body is `src/components/Placeholder.tsx` — a skeleton plus the
selected symbol. No fetches, no sockets, no chart libraries. Swap a panel's
`<Placeholder />` for the real component when data goes in.
