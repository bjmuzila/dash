# app-vite — customer dashboard SPA

A Vite + React + TypeScript SPA that compiles the **existing** Next client
pages (`app/**/page.tsx`) directly — no rewrite. It aliases `@` to the repo
root and shims the three `next/*` modules those pages use.

Currently mounted: `/traders-dashboard`, `/analytics`.

## How it works
- `vite.config.ts` — `@` → repo root; `next/link`, `next/navigation`,
  `next/dynamic` → `src/shims/*`; dev proxy for `/api` `/proxy` `/ws` → `VITE_BACKEND`.
- `src/App.tsx` — React Router (basename `/app`), wrapped in the real
  `AuthProvider`, mounting each page's default export.
- `src/shims/*` — thin `next/*` → react-router adapters.

## Dev
```
cd app-vite
cp .env.example .env        # set VITE_BACKEND (use https://cbedge.net for live GEX)
npm install
npm run dev                 # http://localhost:5174/app/traders-dashboard
```

## Build
```
npm run build               # → app-vite/dist (base /app/)
```

## Serve in prod (mirror the /home3 pattern)
1. Copy `app-vite/dist/*` into `public/app/` (base is `/app/`, so assets land at `/app/assets/*`).
2. Add an optional-catch-all route so `/app` and `/app/*` return the SPA shell
   (client routing owns the sub-paths):

   `app/app/[[...slug]]/route.ts`
   ```ts
   import { readFile } from "fs/promises";
   import path from "path";
   export const dynamic = "force-dynamic";
   export async function GET() {
     try {
       const html = await readFile(path.join(process.cwd(), "public", "app", "index.html"), "utf8");
       return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
     } catch {
       return new Response("app build not found", { status: 404 });
     }
   }
   ```
3. No middleware change needed: `/app/*` is a protected (paid) route, gated exactly
   like the other dashboards. Static `/app/assets/*.js|css` already bypass the auth
   matcher (extension exclusion), same as `/home3`.

## Porting more pages
For any customer `app/<route>/page.tsx` that is a client component: add
`import X from '@/app/<route>/page'` and a `<Route>` in `src/App.tsx`. If it
imports a new `next/*` API, extend `src/shims/`. Server-data pages (only `/home`,
`/home-fast`) need their SSR seed swapped for a client fetch first — see notes.

> Note: pages mount bare (no global nav/LayoutShell yet). Add the shared shell
> in `App.tsx` when you want the toolbar/sidebar around them.
