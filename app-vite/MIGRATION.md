# app-vite — customer-app Vite migration

**GOAL:** Migrate CB Edge customer pages from Next App Router into ONE Vite SPA
(`app-vite/`), served at `/app`. Do NOT rewrite pages — **COMPILE the existing
Next client pages as-is.**

## How it works (already set up)
- `app-vite/` is Vite + React + TS, `base: '/app/'`.
- `vite.config.ts` aliases `@` → repo root, so pages resolve their real
  `@/components`, `@/hooks`, `@/lib` with zero changes.
- Three shims in `app-vite/src/shims/` adapt the only Next APIs the pages use:
  `next/link`, `next/navigation`, `next/dynamic` → react-router.
- `src/App.tsx` = one `BrowserRouter` (basename `/app`) wrapped in the real
  `AuthProvider`; each page is mounted by importing its default export:
  `import Analytics from '@/app/analytics/page'`.

## Why one SPA
Single warm `/ws/gex` socket across all pages, instant client-side navigation,
shared vendor chunk cached once. Use `React.lazy` per route so heavy pages
(scanner, es-candles, gex-3d / three.js) code-split and load on demand.

## To add a page (page by page)
1. `app-vite/src/App.tsx`: add
   `const X = lazy(() => import('@/app/<route>/page'))` and a
   `<Route path="/<route>" element={<Suspense fallback={null}><X/></Suspense>} />`.
2. Add `app/app/<route>/route.ts` (copy an existing one — each just returns
   `serveSpaShell("app")`). This makes hard-loads / refreshes of the deep link work.
3. Only extend `src/shims/` if the page imports a NEW `next/*` API.

## Build + go live
```
cd app-vite && npm run build
# copy dist/* -> public/app/   (index.html + assets/*)
# then push.ps1
```

## Auth
`/app/*` is a normal PAID route (middleware gates owner/paid; signed-out → `/`).
Static `/app/assets/*.js` bypass auth via the matcher extension exclusion.
No middleware change needed.

## Constraints
- **Backend stays Next untouched:** API routes, `/proxy`, `/ws`, `server.js`,
  `middleware.ts`. Only the UI layer moves.
- **Owner pages** (`/owner/*`, `/social-media`) are a SEPARATE owner-subdomain
  Vite app handled elsewhere — do not touch them here.
- **Marketing/SEO pages** (`/`, `/pricing`, `/explore`) stay Next server-rendered.
- **Two pages need the SSR seed swapped** for a client fetch before moving:
  `/home` and `/home-fast` fetch `/proxy/gex` + a DB snapshot server-side.
  Replace that with a client fetch to `/api/home-snapshot` (already exists).
  Everything else is client + API-first = drop-in.
- **home3-vite/** is an older REWRITE prototype of `/home`; retire it by
  compiling the real `app/home/HomeClient.tsx` into `app-vite` instead of
  extending home3.

## Serving internals (reference)
- `lib/serveSpaShell.ts` — reads `public/<app>/index.html` and returns it.
- Per-PAGE route handlers (NOT a catch-all — a catch-all would swallow
  `/app/assets/*.js` and return HTML): `app/app/route.ts`,
  `app/app/traders-dashboard/route.ts`, `app/app/analytics/route.ts`.
- Built SPA output is committed to `public/app/` (like `public/home3/`).

## Status (2026-07-18)
Live-wired: `/app/traders-dashboard`, `/app/analytics`. Verified by real
`vite build` (both real pages, 46 modules, zero page edits). Pages mount bare
(no global nav/LayoutShell yet). Not yet prod-verified.
