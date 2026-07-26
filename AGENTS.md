# AGENTS.md — read this before editing anything

This repo has **three** UIs layered on top of each other. Two are dead. Editing
the wrong one is the #1 recurring mistake here: the change "works" in the file
but nothing shows on the live site. Read the map below first.

## The live site (edit THIS)

- **Customer dashboard = React pages at `app/<name>/page.tsx`.** They are
  written as `"use client"` components and are served by the **Vite SPA in
  `app-vite/`** at **`/app/*`** (e.g. `cbedge.net/app/es-candles`). The SPA
  imports each page via the `@/app/...` alias and mounts it as a route in
  **`app-vite/src/App.tsx`**.
- **Marketing / auth / content pages** (landing, `/sign-in`, `/sign-up`,
  `/pricing`, `/whats-new`, `/docs`, legal) stay **Next.js server-rendered**.
- **Backend / data API = `server-v2/`** — a plain Node server
  (`server-v2/server-with-proxy.js`) that runs `/proxy/*`, the WebSocket, and an
  in-process API router (`server-v2/api-router.js`). Most `app/api/*` routes have
  been ported into that router; the `app/api/*/route.ts` files are kept only as a
  fallback and are being deleted at the end of the migration.
- One process serves all of it. `server.js` at the root is just a shim to
  `server-v2/server-with-proxy.js`.

## DEAD CODE — never edit (changes here do NOTHING on the live site)

There was an original **vanilla HTML/JS prototype**, and a couple of abandoned
experiments. Nothing serves them. If a search leads you to one of these, STOP —
find the React page instead.

- **`overview.html`, `overview.js`, `chain.js`, `estimated-moves.html`,
  `estimated-moves.js`**, and any other loose `*.html` / dashboard `*.js` at the
  repo root — dead vanilla prototype.
- **All the root-level `*.html` mockups** (`*-mockup*.html`, `cbedge-*.html`,
  `home-mockup-*.html`, `flow-redesign-preview.html`, `x-post-*.html`, etc.) —
  one-off design mockups, not the app.
- **`Vanilla/`** — the quarantine folder for dead code. **Anything inside it is
  dead by definition — never edit, import, or reference it.** The old vanilla
  prototype (`overview.html`, `overview.js`, `chain.js`, `estimated-moves.*`, the
  root `*.html` mockups, …) is being moved here.
- **`server/`** (the OLD backend — the live one is `server-v2/`), `testui/`,
  `home3-vite/`, `owner-vite*` — legacy / experiments, also not the live app.
- Rule of thumb: **if it's a `.html` file or a top-level `.js` UI file, it is
  almost certainly dead.** The live UI is React `.tsx` under `app/`.

## Editing a dashboard page

"Edit the ES Candles page" → edit **`app/es-candles/page.tsx`** (the React
component), NOT `overview.html`/`overview.js`. Map of the common ones:

| Page             | Live file (edit this)                    |
|------------------|-------------------------------------------|
| ES Candles       | `app/es-candles/page.tsx`                 |
| Overview         | `app/overview/page.tsx`                    |
| Traders Dashboard| `app/traders-dashboard/page.tsx`          |
| Multi Greek      | `app/mult-greek/MultGreekClient.tsx`      |
| Options Chain    | `app/options-chain/page.tsx`              |
| Estimated Moves  | `app/em/page.tsx`                          |
| Flow             | `app/flow/page.tsx`                        |
| Scanner          | `app/scanner/page.tsx`                     |
| ICT              | `app/ict/page.tsx`                         |

(If a page isn't listed, look for `app/<name>/page.tsx`.)

## Adding a NEW dashboard page (two steps, not one)

A new customer dashboard page needs BOTH:

1. `app/<name>/page.tsx` written as a **`"use client"`** component (Vite cannot
   run server components).
2. A `lazy()` route added to **`app-vite/src/App.tsx`** (and a nav entry).

If you only do step 1, the page renders on Next at `cbedge.net/<name>` but
silently falls through the SPA catch-all to `/traders-dashboard` at
`/app/<name>`. A guard enforces this: **`app-vite/scripts/check-routes.mjs`**
runs on every `npm run build` (local and the Docker deploy) and FAILS the build
if a toolbar nav item has no route, or if `App.tsx` imports a deleted page.

## Theme

UI must source colors/spacing from `components/shared/homeTheme.ts` (+
`PageShell`/`Card` from `components/shared/PageCard.tsx`). Never hardcode hex.

## Deploy

`push.ps1` on the laptop commits → GitHub → VPS pulls + `docker compose build`.
Code reaches the VPS only through GitHub. The Dockerfile rebuilds the Vite SPA
(`app-vite`) every deploy and copies it to `public/app` — do not remove that step
or new dashboard pages stop appearing.
