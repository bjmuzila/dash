# AGENTS.md — cbedge-v3

Read this before editing anything. It is short on purpose; if it grows past two
screens something has gone wrong with the architecture, not the doc.

## What this is

Version 3 of the CB Edge dashboard. A **frontend only**, and a clean-slate one:
it shares no code with v2 — no imports, no copied components, no `@/app/...`
aliases into the Next tree, its own `package.json` and `node_modules`.

It lives **inside** the `spx-gex-dashboard-tt-fixed` repo, as a sibling to
`app-vite/`, `owner-vite/`, `budget-vite/` and `recipe-vite/`. That is not a
compromise of the clean-slate goal — it is how code reaches the VPS. The deploy
pipeline pulls exactly one repo; a separate one would need its own clone, its own
compose service and its own tunnel rule to buy nothing. The isolation that
matters is the dependency graph, and that is intact.

**The backend is unchanged.** `server-v2/` in the v2 repo stays exactly where it
is and keeps doing everything it does: the recorders, the levels engine,
walls-reach, the TastyTrade and ThetaData proxies, the WebSocket. That code is
correct and expensive to reproduce. v3 talks to it over HTTP and one WebSocket
and nothing else.

v3 is served at **`/v3/*`**. v2 keeps `/app/*`. Both run at the same time until
v3 is complete. There is no cutover day.

## Non-negotiables

These are the rules the repo exists to enforce. Each one is enforced by a script,
not by memory.

1. **No colour literals outside `src/design/tokens.css`.** No hex, no rgb(), no
   named colours in components. This is what stopped v2 from having a coherent
   look, and it is the single easiest rule to break by accident.

2. **Pages never touch the socket.** They call `useFrame` / `useField` /
   `watchFrame` from `src/data/hooks.ts`. There is no topic list to maintain —
   scoping is derived from what is actually subscribed. `npm run check:ws`
   proves it.

3. **No request waterfalls.** A route fires everything it needs in parallel at
   entry. If a component fetches something that a parent's fetch had to resolve
   first, hoist it. Use `preload()` on nav intent.

4. **Charts are imperative.** Mount through `ChartFrame`, update through
   `watchFrame` + the chart library's own API. Never push a tick through React
   state on its way to a chart.

5. **A card nobody can see does not paint.** `ChartFrame` reports its own
   visibility three ways — `handle.visible()` for a per-frame loop,
   `onVisibility` for an on-demand renderer, `data-visible` on the element. Use
   one. The board is N cards on ONE main thread sharing ONE animation frame, and
   the cards below the fold are most of that budget if nothing stops them —
   nothing in the browser stops them for you. `npm run perf` catches a renderer
   that ignores all three.

6. **Every canvas v3 owns carries `data-cb-layer`.** One line where it is
   created. It is how the perf check tells our layers from the ones a chart
   library made for itself, and it is what makes a per-card redraw number
   possible at all.

7. **Budgets are hard limits, and they ratchet.** `npm run build` fails if a
   chunk is over. Raise a number in `budgets.json` deliberately, in a diff
   someone can see — never work around it. When a chunk gets SMALLER, pull the
   number back down with `npm run budgets:ratchet`: a budget carrying 40%
   headroom has stopped enforcing anything, and the check now says so on every
   run.

8. **Source maps do not ship.** `dist/` is copied to `public/v3` and served, so
   a shipped map publishes v3's entire source to anyone who opens devtools on a
   customer page. Off by default; build with `CB_SOURCEMAPS=1` when you need
   them locally.

9. **No silent catch-all route.** An unregistered route renders NotFound. v2 fell
   through to `/traders-dashboard`, which made missing pages look like they
   half-worked.

## Where things live

| Concern | File |
|---|---|
| Wire contract (WS frames) | `src/contract/frames.ts` |
| Socket, topic derivation, reconnect | `src/data/socket.ts` |
| Store, rAF coalescing, selectors | `src/data/store.ts`, `src/data/hooks.ts` |
| REST dedupe / cache / preload | `src/data/api.ts` |
| Last-known-state cache | `src/data/cache.ts` |
| Design tokens (the only colours) | `src/design/tokens.css` |
| Primitives | `src/design/primitives/*` |
| App frame + nav | `src/shell/Shell.tsx` |
| Routes | `src/App.tsx` |
| Early boot (socket opens here) | `index.html` |

## Living inside the v2 repo: two traps

Both cost real time on 2026-08-19. Both are already handled — this is here so
nobody "tidies up" the handling.

1. **`css.postcss` in `vite.config.ts` must stay pinned.** The repo root has a
   `postcss.config.js` loading Tailwind **v3**. Vite searches UPWARD for a
   PostCSS config, finds it, and runs v3 over this app's v4 stylesheet — dying
   with "`@layer base` is used but no matching `@tailwind base` directive". It
   only reproduces when a parent config exists, so it passes on a standalone
   checkout and fails only inside the Docker image.

2. **No `package-lock.json`.** Regenerating it on Windows records the win32
   builds of the native binaries rollup and `@tailwindcss/oxide` ship as
   optional platform packages; npm then skips the linux-x64 ones on a cold
   install and `vite build` dies with "Cannot find module
   @rollup/rollup-linux-x64-gnu". It is gitignored, and the Dockerfile deletes
   it defensively. `app-vite` avoids this the same way.

The shape of both: **a standalone checkout is not the environment this builds
in.** Before trusting a green local build, consider what the parent directory
adds.

## The early boot

`index.html` opens the WebSocket and starts the IndexedDB read **before the
bundle is fetched**, and buffers frames until `startSocket()` in
`src/data/socket.ts` takes over. This is worth 300–800ms on a cold load and it is
the reason `startSocket()` is called at module scope in `main.tsx` rather than in
an effect.

Two consequences worth knowing:

- The boot connection is deliberately **unscoped**. Scoping is applied ~1.2s
  later, once the first route has settled. Reconnecting at boot just to add a
  `?topics=` param would give back the head start to save a few hundred bytes.
- `--cb-bg` / `--cb-fg` are duplicated in `index.html` so the first paint is the
  right colour. `check-budgets.mjs` fails the build if they drift from
  `tokens.css`.

## Adding a page — FOUR steps, not three

1. `src/pages/<Name>.tsx`, default export, composed from primitives.
2. A `lazy()` route in `src/App.tsx`.
3. A `NAV` entry in `src/shell/Shell.tsx` (with `prefetch` URLs if it loads data).
4. **`app/v3/<name>/route.ts` in the v2 repo**, three lines calling
   `serveSpaShell("v3")`.

Miss step 4 and the page works when you click to it in-app but 404s on a hard
refresh or a shared link — exactly the failure `components/mobile/mobileNav.ts`
warns about for the phone build. Deliberately not solved with a catch-all route:
a catch-all would swallow `/v3/assets/*.js` and hand back HTML.

## Adding a frame type

1. Describe it in `src/contract/frames.ts` — transcribed from what
   `server-v2/websocket-server.js` actually emits, not inferred from a log.
2. Read it with `useField`. That is the whole process; nothing else needs to
   know, including the socket.

## Adding a card to the board

`src/board/catalog.tsx` — one entry in `CARD_CATALOG`, and the "+ Add card"
dropdown, `BoardPage` and `Board` all pick it up. Big cards go behind `lazy()`;
a card that is a few lines stays static, because a chunk boundary costs more
than it saves.

Then, before you push:

- Anything that paints must go through `ChartFrame` and honour ONE of its
  visibility signals (non-negotiable 5), and tag its canvas `data-cb-layer`
  (non-negotiable 6).
- Run **`npm run perf`**. It adds every card in the catalog to a board and
  measures your new one automatically — there is no list to update. It is the
  only thing standing between the fifteenth card and a board that runs at 15fps
  for a reason nobody can point at.

## Commands

```
npm run dev             # dev server on :5273, proxying to VITE_BACKEND_ORIGIN
npm run build           # typecheck + build + budget check (fails on over-budget)
npm run mock            # serve dist/ with synthetic data, no backend needed
npm run check           # typecheck + build + budgets + ws scope + perf
npm run check:ws        # proves topic derivation is correct
npm run perf            # per-card redraw guard: idle quiet, offscreen silent,
                        # interaction still paints
npm run budgets:ratchet # pull budgets.json down to what dist/ actually weighs
```

`check:ws` and `perf` are the two that catch silent failures — a wrong topic
scope and a runaway repaint both look completely fine on screen for a while.

## Deploy

Wired up, same shape as `app-vite`:

- `Dockerfile` builds this app every deploy → `public/v3`. Do not remove that
  step or new pages stop appearing — the exact failure v2's Dockerfile comment
  warns about for `public/app`.
- It runs `npm run build:fast`, **not** `npm run build`. Budgets are meant to
  fail a commit, not a deploy; an over-budget v3 bundle must never be able to
  block a v2 hotfix from reaching the VPS. Run `npm run check` on the laptop
  before pushing.
- Source maps are NOT emitted (see non-negotiable 8). The deploy would serve
  them publicly out of `public/v3`.
- `middleware.ts` gates `/v3*` to owner-only, the same treatment `/home3` gets.
  Remove that pattern when v3 ships.
- Live at `cbedge.net/v3/` after `push.ps1` → GitHub → VPS pull + rebuild.
