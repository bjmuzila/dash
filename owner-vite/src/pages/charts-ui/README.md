# Charts UI — Bklit UI bench inside owner-vite

Route: **`/owner/charts-ui`** (sidebar → Backend → Charts UI), behind the usual
`AuthGate`. Every component from [bklit.com/docs/components](https://bklit.com/docs/components)
rendered against seeded sample data, in CB Edge colours.

Look-at-it page only — no backend calls, no app state.

## Install the components

The Bklit source is vendored into `src/components/charts` by the shadcn CLI.
From `owner-vite/`:

```powershell
npm install          # picks up tailwind + visx + world-atlas, drops @bklitui/ui
npm run charts:add   # pulls all 34 @bklit registry items, then rebuilds the barrel
npm run dev          # http://localhost:5174/owner/charts-ui
```

`charts:add` needs network access to `bklit.com` and installs one item at a time,
so a single failure doesn't abort the run. Re-run just one:

```bash
node scripts/add-charts.mjs sankey-chart
```

Until they're installed each tab shows a "not installed" card with the exact
command — the page itself still works.

## How it's wired

| File | Role |
|---|---|
| `src/pages/ChartsUI.tsx` | the page — picker, install status, lazy demo host |
| `src/pages/charts-ui/charts-ui.css` | Tailwind (utilities only) + all design tokens, scoped to `.charts-ui-root` |
| `src/pages/charts-ui/catalog.ts` | component list → title, group, registry items, docs link |
| `src/pages/charts-ui/demos/*.tsx` | one demo per component, 1–3 variants each |
| `src/pages/charts-ui/demo-data.ts` | seeded sample data (stable across reloads) |
| `src/lib/nav.ts` | sidebar entry (Backend → Charts UI) |
| `src/pages/registry.ts` | `ChartsUI` → lazy import |
| `scripts/add-charts.mjs` | installs the registry items + regenerates the barrel |

## Tailwind

owner-vite is inline-styled and has no Tailwind. The Bklit components are
shadcn-flavoured and carry Tailwind class names internally, so `charts-ui.css`
imports **only** `tailwindcss/theme.css` and `tailwindcss/utilities.css` —
**preflight is deliberately skipped**, so no global reset reaches the existing
pages. Verified: the compiled stylesheet contains the utilities and none of
preflight's resets.

That stylesheet is imported from `ChartsUI.tsx`, which is lazy-loaded, so it
stays out of the initial bundle.

## Colours

Chart tokens are mapped onto `OWNER_THEME` in `charts-ui.css`, all declared on
`.charts-ui-root` rather than `:root`:

```
--chart-1  #219EBC  cyan        --chart-line-primary    #7dd3fc
--chart-2  #8ECAE6  light blue  --chart-line-secondary  #FB8501
--chart-3  #FFB703  gold        --chart-grid            rgba(255,255,255,0.10)
--chart-4  #FB8501  orange      --chart-scale-01..05    cyan ramp
--chart-5  #EF4444  red
```

When the shadcn CLI adds a component it may append more variables — keep them
inside the `.charts-ui-root` block, not `:root`.

## Note on `package.json`

`"@bklitui/ui": "latest"` was removed. That package isn't published on npm
(registry returns 404), so `npm install` in owner-vite was failing. Bklit ships
as a shadcn registry that copies source into the repo — that's what
`charts:add` does.

## Adding a component

1. Entry in `src/pages/charts-ui/catalog.ts`
2. Demo at `src/pages/charts-ui/demos/<slug>.tsx`
3. Registry item in `scripts/registry-items.mjs`
