# testui — Bklit UI component gallery

A standalone Vite + React + TS + Tailwind v4 test bench that renders every
component from [bklit.com/docs/components](https://bklit.com/docs/components)
against seeded sample data. One route per component, sidebar navigation,
light/dark toggle.

Nothing here is wired to CB Edge — it's a sandbox for eyeballing the charts
before pulling any of them into the dashboard.

## Setup (one time)

```powershell
cd testui
.\setup.ps1
```

or manually:

```bash
npm install
npm run charts:add     # pulls all @bklit registry items via the shadcn CLI
```

`charts:add` needs network access to `bklit.com`. It installs each registry
item one at a time so a single failure doesn't abort the run, then regenerates
the barrel at `src/components/charts/index.ts`.

Re-run a single item:

```bash
node scripts/add-charts.mjs sankey-chart
```

## Run

```bash
npm run dev        # http://localhost:5199
```

## Layout

```
src/
  App.tsx                  gallery shell — sidebar, hash router, theme toggle
  catalog.ts               the component list (slug -> title, group, registry items)
  demos/<slug>.tsx         one demo file per component, lazily loaded
  components/charts/       <- shadcn drops the Bklit source here
  components/frame.tsx     card wrapper used by the demos
  components/error-boundary.tsx
  lib/demo-data.ts         seeded sample data (stable across reloads)
scripts/
  registry-items.mjs       the list of @bklit items to install
  add-charts.mjs           installs them + regenerates the barrel
  gen-charts-index.mjs     rebuilds src/components/charts/index.ts
```

## Notes

- Demos are loaded with `import.meta.glob` + `React.lazy`, so a component you
  haven't installed only breaks its own route — the rest of the gallery still
  works, and the route shows the exact `shadcn add` command to fix it.
- The sidebar dot is green when the matching file exists in
  `src/components/charts`.
- `npm run build` requires all components installed (Rollup treats missing
  named exports as hard errors). `npm run dev` does not.
- Chart CSS tokens (`--chart-line-primary`, `--chart-grid`, `--chart-scale-01..05`,
  etc.) are defined in `src/index.css`. The shadcn CLI may add more when
  installing components — that's expected, keep them.
- Demo prop usage was transcribed from the Bklit docs. A few pages (composed,
  candlestick) publish no prop tables, so those demos stick close to the
  documented example. If a prop name changed upstream, the fix is in
  `src/demos/<slug>.tsx`.
- To add a component: add an entry to `src/catalog.ts`, drop a
  `src/demos/<slug>.tsx`, and add the registry item to
  `scripts/registry-items.mjs`.
