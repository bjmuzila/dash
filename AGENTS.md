# AGENTS.md — read this before editing anything

This repo has **three** UIs layered on top of each other. Two are dead. Editing
the wrong one is the #1 recurring mistake here: the change "works" in the file
but nothing shows on the live site. Read the map below first.

## DEFAULT TARGET: v3 (`cbedge-v3/`)

**Assume every dashboard request means v3 unless it says otherwise.** The v3 SPA
in `cbedge-v3/` is where the work is happening — the board (`src/board/`), its
cards, the pages under `src/pages/` and the phone build under `src/mobile/`.

**v2 — the `app/` + `app-vite/` dashboard described in the next section — is
ASK-FIRST.** Do not edit anything under `app/`, `app-vite/` or
`components/dashboard/` for a dashboard change without asking Brandon first. Both
versions still run, and many surfaces exist in both under nearly the same name,
so a request that matches a v2 filename is not evidence it meant v2:

| Looks like | v2 (ask first) | v3 (default) |
|---|---|---|
| Gauge rail | `components/dashboard/HomeGaugeRail.tsx` | `cbedge-v3/src/board/gaugeRail/GaugeRailCard.tsx` |
| Candles chart | `components/dashboard/es-candles/EsChartCard.tsx` | `cbedge-v3/src/board/gexCandles/GexCandlesCard.tsx` |
| Options chain | `app/options-chain/page.tsx` | `cbedge-v3/src/pages/OptionsChain.tsx` |
| Scanner | `app/scanner/page.tsx` | `cbedge-v3/src/pages/Scanner.tsx` |
| Flow | `app/flow/page.tsx` | `cbedge-v3/src/pages/Flow.tsx` |
| Phone build | `components/mobile/` (`/app/m/*`) | `cbedge-v3/src/mobile/` (`/v3/m/*`) |

If a screenshot or description could be either, the v3 file is the one to open.

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

## `/ws/gex` — the bandwidth rules (read before touching the socket)

This socket is uncacheable and counts 100% as Cloudflare "bandwidth served". It
has run up a bill three times now (2026-08-21, 2026-08-31, 2026-09-01). Every
rule below exists because of a specific one of those.

### Next.js steals the `'upgrade'` event — do NOT remove the guard

`server-v2/server-with-proxy.js` wraps `server.on` immediately after
`createGexWsServer(...)`. It looks like defensive noise. It is not. Removing it
re-breaks every WebSocket on the site and costs ~53GB/day.

Next 15 (`node_modules/next/dist/server/next.js:298 setupWebSocketHandler`)
attaches its OWN `'upgrade'` listener to our HTTP server the first time a request
passes through `getRequestHandler()`. It needs no `httpServer` option — it takes
the server straight off `req.socket.server`. A production build owns no `/ws/*`
route, so its handler destroys the socket. Ours registered first, so a client
gets: 101 accepted, full ~220KB connect snapshot delivered, then a bare RST
(1006) ~2ms later. NOTHING is logged, because the destroy happens on the raw
socket and never reaches the `ws` instance that owns it.

Symptoms if it returns: pages sit on "waiting for the feed",
`/proxy/self-metrics` shows `clients: 0` with megabytes/min of `snapshot`, and
`srv.listenerCount('upgrade')` is 2 instead of 1.

The guard WRAPS rather than blocks — a blanket refusal would kill HMR under
`dev: true`. Install it AFTER `createGexWsServer` so our own listener is never
wrapped.

### Never broadcast a whole growing array

The `flow` frame carried `FlowProcessor.bucket().tape` — the entire per-order
session FIFO (FLOW_TAPE_CAP, 8000) — to every client twice a second, all session.
On 2026-09-01 that was 646MB/min, **99% of all socket egress**, ~940GB/day.

Live frames now trim to `FLOW_BROADCAST_TAPE_MAX` (300) via `trimBroadcastFlow()`,
the same slice the connect snapshot has always used at `SNAPSHOT_TAPE_MAX` (150).
Trimming is applied ONLY on the wire — the processor tape stays at 8000 so
`writeFlowTape()` persistence and `flowGexAccumulator.ingestTape()` still see
every order.

Three things to carry forward:

1. **Dedupe on what you actually SEND, not on source state.** Coalescing mutates
   orders that have already scrolled out of the window, which defeats a dedupe
   keyed on the full tape and resends byte-identical frames.
2. **Off-hours testing proves nothing about a tape.** A pre-market probe measured
   `flow 5646b` and read as harmless; the same frame was 1.7MB by 10:29 ET. Any
   frame whose size depends on session accumulation must be measured DURING RTH.
3. `FLOW_TAPE_FLOOR` is $500 in prod vs a $5000 default — ~10x more orders clear
   the noise floor and ride in every frame. Lowering it multiplies frame size.

### The bandwidth alarm

`websocket-server.js` checks its own egress every 60s, logs `[WS-ALERT]` and posts
to `WS_ALERT_WEBHOOK || DISCORD_WEBHOOK_URL` with a projected GB/day and the split
by frame type. 15-minute cooldown so the alarm cannot become the second outage.
It found the flow bleed on its first trading day, from the log line alone.

- `WS_ALERT_CONNECTS_PER_MIN` (30) — connects/min this high while `clients <= 1`.
  The sharpest trip, and the only one that would have caught BOTH the 08-21 and
  08-31 outages on day one: a reconnect storm holds no sockets, so `clients` reads
  ~0 no matter how bad it is. Bytes alone cannot tell "a few clients on a fat
  feed" apart from "sixty clients that each took a snapshot and died".
- `WS_ALERT_SNAPSHOT_MB_PER_MIN` (5) — sustained MB of connect snapshots = churn.
- `WS_ALERT_MB_PER_MIN` (30) — total backstop. A heavy session can still trip this
  legitimately; drop `FLOW_BROADCAST_TAPE_MAX` to 150 or set
  `FLOW_BROADCAST_MS_RTH=1000` before raising the threshold.

Healthy `/proxy/self-metrics` looks like: `clients` > 0, `connectsLastMin` near 0,
`snapshot` a small slice of `total`. The inverse of that is a storm.

### Client-side backoff (`lib/gexSocket.ts`)

Backoff credit is earned by SURVIVING, not by opening — `attempts = 0` fires on a
`HEALTHY_CONNECTION_MS` (10s) timer, not in `onopen`. Do not move it back. When
the handshake succeeds and the socket dies immediately (exactly what Next was
doing), resetting on open makes the "exponential" backoff a flat 2s loop forever
at full snapshot cost. Three consecutive open-then-die connections floor the retry
at `BROKEN_TRANSPORT_FLOOR_MS` (60s); the wake handlers stay the fast path back.

### Env flags — NOT in git, easy to lose

These live ONLY in `.env.local` on the VPS, which is untracked. A fresh box, a
restored backup or a hand-rebuilt env silently reverts every one to a worse
default.

| flag | live value | if missing | what you lose |
|------|-----------|------------|---------------|
| `WS_DEFLATE` | `default` | `off` | 80-90% of socket egress |
| `WS_AUTH_REQUIRED` | `1` | off | the paid feed is open to anyone with the URL |
| `FLOW_BROADCAST_TAPE_MAX` | unset (300) | 300 | nothing; the default is the intended one |
| `AUTH_POOL_MAX` | unset (16) | 16 | raise to 32 if `[WS] upgrade rejected (verify-error)` appears in bulk |

`WS_DEFLATE=default` is ws's own settings. `WS_DEFLATE=on` is a TUNED config
blamed for the 2026-08-21 browser outage — that diagnosis was WRONG (the real
cause was the Next upgrade bug above), but `on` has still never been verified.
Use `default`.

`WS_AUTH_REQUIRED=1` fails CLOSED: if the Postgres session lookup errors, every
connection is rejected and every dashboard goes dark. Before enabling it on a new
box, verify the gate against the DB for a real subscriber, a comped user and the
owner — the script is in the 2026-08-31 CHANGELOG entry. `is_paid` here MUST stay
in sync with `lib/db.ts`'s `getSessionWithUser()`; when it drifted, comped users
passed middleware and then 401'd on everything.

## Theme

UI must source colors/spacing from `components/shared/homeTheme.ts` (+
`PageShell`/`Card` from `components/shared/PageCard.tsx`). Never hardcode hex.

## Deploy

`push.ps1` on the laptop commits → GitHub → VPS pulls + `docker compose build`.
Code reaches the VPS only through GitHub. The Dockerfile rebuilds the Vite SPA
(`app-vite`) every deploy and copies it to `public/app` — do not remove that step
or new dashboard pages stop appearing.
