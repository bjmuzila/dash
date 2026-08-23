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

## The three OTHER apps on this box (separate SPAs, separate backends)

These are not part of the trading dashboard and do not share its process. Each is
its own Vite SPA behind its own nginx, talking to its own Node backend, on its own
subdomain. They share a Postgres server and nothing else.

| Subdomain | SPA | Backend | Container / port | Auth |
|---|---|---|---|---|
| budget.cbedge.net | `budget-vite/` | `server-v2/household-server.js` | household-api:3010 | `hh_session`, `hh_*` tables |
| recipe.cbedge.net | `recipe-vite/` | same household backend | household-api:3010 | same login as budget |
| daily.cbedge.net  | `daily-vite/`  | `server-v2/daily-server.js`    | daily-api:3011     | `dy_session`, `daily_*` tables |

**budget and daily are the same product and NOT the same code.** budget is the
private, owner-gated life-OS for two people. daily is the public, paid version of
it with a landing page, Stripe checkout and members. It was COPIED across once and
the two now evolve independently — deliberately, because a shared component
library between them guarantees that a change meant for the private app
eventually surprises a paying customer.

So: **editing `budget-vite/` does nothing to daily.cbedge.net, and editing
`daily-vite/` does nothing to budget.cbedge.net.** Work out which one the request
is about before you touch a file. Same for the backends — `_lib-household*.cjs`
and `household-routes.cjs` serve budget and recipe; `_lib-daily*.cjs` and
`daily-routes.cjs` serve daily. There is no shared module and no code path from a
session on one into the other's data.

### Editing daily.cbedge.net

- Pages: `daily-vite/src/pages/*.tsx`, routed in `daily-vite/src/App.tsx`.
- Colours and type come from `daily-vite/src/theme.ts`. Never hardcode a hex.
- The HTTP contract is `daily-vite/src/api.ts`. Change a route in
  `server-v2/daily-routes.cjs` and change the client in the same commit.
- **Tenancy is not optional.** Every `daily_*` content row carries
  `household_id NOT NULL` and every query filters on it via `scoped(user)` from
  `_lib-daily.cjs`. There is no visibility column. A query on a `daily_*` table
  without `household_id` beside it is a bug that shows one customer another
  customer's data — see the long header comment in `_lib-daily.cjs`.
- Route auth levels are `public` / `user` / `member`. `member` means signed in
  AND paying; every app-data route is `member`. `user` is for billing, settings
  and account routes, so someone whose card failed can still fix it.
- Setup that has to exist outside the repo — Stripe prices and webhook, the
  Google redirect URI, `DAILY_TOKEN_KEY`, the tunnel entry — is in
  `md files/DAILY-SETUP.md`.

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
  `home3-vite/` — legacy / experiments, also not the live app.
- Rule of thumb: **if it's a `.html` file or a top-level `.js` UI file, it is
  almost certainly dead.** The live UI is React `.tsx` under `app/`.

## `owner-vite/` IS LIVE — it is the internal console (corrected 2026-08-13)

This line used to say `owner-vite*` was legacy. It is not. `docker-compose.yml`
builds it as the `owners` service behind a Cloudflare Tunnel at
**owner.cbedge.net**, and `components/shared/UserMenu.tsx` makes that URL the
owner's only entry point. `app/owner/reta/page.tsx` says so itself: the Next
copy is "the Next fallback copy; the live owner-vite page is
`owner-vite/src/pages/Reta.tsx`."

Two owner surfaces exist, and they are not equals:

- **`owner-vite/` → owner.cbedge.net — the real one.** 20+ pages. Its own
  `AuthGate` (fail-closed on `/api/auth/me` → `isOwner`), its own theme port
  (`owner-vite/src/lib/theme.ts`), its own `PageShell`/`Card`
  (`owner-vite/src/components/PageCard.tsx`). `/api/*` and `/proxy/*` are
  proxied through to server-v2, so pages fetch them as relative paths.
- **`app/owner/*` (Next) — three pages left**: `budget`, `reta`, `tpo-extract`.
  Gated by `app/owner/layout.tsx` → `OwnerGuard` (404s, not redirects).

**Adding an owner page = 3 files, no route wiring:**

1. `owner-vite/src/pages/<Name>.tsx`
2. one link in `owner-vite/src/lib/nav.ts` — the rail AND the route both derive
   from `OWNER_SIDEBAR_GROUPS`
3. one `lazy()` line in `owner-vite/src/pages/registry.ts`, keyed by the `key`
   you used in step 2

Do NOT add owner pages to `app-vite/src/App.tsx` — that SPA has zero owner
routes and `check-routes.mjs` only inspects the customer `NAV_ITEMS`.

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

## The phone build (`/m/*`)

Six phone-only pages live under **`components/mobile/`** and are routed at
**`/app/m/<id>`**: GEX chart, GEX heatmap, ES candles, option chain, Estimated
Moves, Economic Calendar. They are purpose-built for a 390px iPhone, not
restyled desktop pages — the desktop layouts are inline-styled with no class
names, so a stylesheet cannot reach them.

- **Registry: `components/mobile/mobileNav.ts`** — the tab list, the
  desktop↔mobile route map, and the phone test. Adding a tab is three edits and
  they are listed in that file's header. Miss the third (an
  `app/app/m/<id>/route.ts` calling `serveSpaShell`) and the tab works in-app
  but the URL 404s on a hard refresh.
- **Shell: `MobileShell`** — universal `GlobalToolbar` stays on top (mounted by
  LayoutShell), bottom tab bar below, page content between. `fill` = no scroll
  (charts own their gestures); default = scrolling list.
- **Redirect:** `MobileRedirect`, mounted once in `app-vite/src/App.tsx`. Phones
  on a route in `DESKTOP_TO_MOBILE` get replaced to the phone build. Desktop
  browsers are never redirected away from `/m/*`, so the phone pages can be
  tested on a laptop. Long-press the tab bar to opt out for the session.
- **Data is shared, not copied.** `useMobileGex` rides the same `lib/gexSocket`
  the desktop uses; `useMobileChain` calls the same `/api/chains` through the
  same `parseExpiration`; `useEmLookup` and `useEconCalendar`/`lib/econCalendar`
  were extracted from the desktop components so both surfaces read one source.
  Do not add a mobile-only fetch for a number the desktop already computes.
- **`gridCols()` (in `mobileTheme`) is mandatory for every grid.** `globals.css`
  has a "GLOBAL GRID COLLAPSE" block that flattens inline
  `grid-template-columns: repeat(N…)` on narrow screens to rescue the desktop
  pages. It would flatten the phone grids too, so they route the value through a
  CSS custom property to stay out of its way. The helper's comment explains it.
- **Preview without a backend:** `node scripts/mock-mobile-preview.mjs 4310`
  serves `app-vite/dist` with synthetic SPX data at `/app/m/*`.

`app/mobile/page.tsx` is the OLD one-off phone page. It is not routed by the SPA
and its live-data path never worked (it reads a `wsRef` that is never assigned).
It is superseded by `/m/*`.

## The live feed: one socket, scoped by topic

Every consumer shares ONE `/ws/gex` connection (`lib/gexSocket.ts`) — refcounted,
parsed once, last frame of each type replayed to late subscribers.

Since 2026-08 that connection is **topic-scoped**. `subscribeGex({ topics: [...] })`
declares the frame types a consumer reads; the socket connects with `?topics=`
set to the union across everything mounted, and the server
(`server-v2/websocket-server.js`) drops the rest — INCLUDING the small scalar
frames (`spot`, `aux`, `status`), so those must be listed explicitly.

Three rules:

1. **`topics` is opt-in, and omitting it is safe.** One subscriber without it
   forces the whole socket back to the unscoped firehose. That is the correct
   default for anything unaudited — never guess a topic list to "clean up" a
   consumer you have not read.
2. **List every type your handler branches on, and err wide.** A missing topic
   does not throw; the frames just stop and the panel silently goes stale.
   Extra topics cost a few hundred bytes.
3. **Declare topics at module scope**, not as an inline array — the value keys
   the subscription effect.

`regime-fit-updated` / `pairs-regime-updated` go out via `broadcastEvent()`,
which ignores topics entirely. Do not request them.

The scope is applied by reconnecting, so `gexSocket` debounces: 250ms to open or
widen (a route's consumers mount in a cascade and must land on ONE connection),
1200ms to narrow. Any scope change clears the replay cache, because those frames
were captured under the old — possibly narrower — scope.

`scripts/ws-scope-check.mjs` drives a real browser against a mock server that
mirrors the real filtering and asserts all of the above. Run it after touching
`gexSocket` or any consumer's topic list.

Note: `app/home/HomeClient.tsx`, `WhaleOrdersPanel`, `hooks/useNqCandles` and the
separate `owner-vite` / `home3-vite` apps still open their OWN sockets and none
of this applies to them.

## Theme

UI must source colors/spacing from `components/shared/homeTheme.ts` (+
`PageShell`/`Card` from `components/shared/PageCard.tsx`). Never hardcode hex.

## Deploy

`push.ps1` on the laptop commits → GitHub → VPS pulls + `docker compose build`.
Code reaches the VPS only through GitHub. The Dockerfile rebuilds the Vite SPA
(`app-vite`) every deploy and copies it to `public/app` — do not remove that step
or new dashboard pages stop appearing.
