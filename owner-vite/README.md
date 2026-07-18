# owner-vite

Standalone Vite recreation of the CB Edge **/owner** backend section — the
sibling of `home3-vite` (which recreates `/home`). Same proxy pattern: the app
talks to the Next backend over the real relative URLs (`/ws/*`, `/proxy/*`,
`/api/*`), proxied in dev so there's no CORS and WebSockets upgrade cleanly.

## Run

```
cd owner-vite
npm install
cp .env.example .env      # set VITE_BACKEND (default http://localhost:3001)
npm run dev               # http://localhost:5174/owner3/
```

For prod data (auth-gated owner routes): set `VITE_BACKEND=https://cbedge.net`
and paste an authenticated `document.cookie` into `BACKEND_COOKIE` in `.env`.

Served under `/owner3/` in prod (matches `vite.config.js` `base` and the
router `basename`).

## Layout

```
src/
  main.jsx            entry
  App.jsx             BrowserRouter (basename /owner3) → OwnerShell + routes
  OwnerShell.tsx      persistent left rail (3 groups) + <Outlet/>  [port of OwnerSidebar]
  index.css
  lib/
    theme.ts          OWNER_THEME + card styles (self-contained port of ownerTheme/homeTheme)
    nav.ts            OWNER_SIDEBAR_GROUPS — single source of truth (labels/glyphs/hrefs)
  pages/
    registry.ts       page key → component
    Hub.tsx           /owner landing (List view live; Brain graph stubbed)
    ControlPanel.tsx  /owner/dev/owner — ?tab= sections (overview/infra)
    Placeholder.tsx   shared "migration pending" body
    NotFound.tsx
    <Route>.tsx       one module per sidebar route, ready to fill in
```

## Migration status

Foundation done: config, proxy, theme, nav rail, routing, Hub (list). Each
page under `pages/` is a themed placeholder until its Next route is ported
over — **page for page, tab for tab, card for card**. To port a page, replace
its module body with the real cards; the shell, nav, and routing already work.

Route map (nav.ts) mirrors the backend exactly:

| Group    | Route                       | Page module      |
|----------|-----------------------------|------------------|
| Owner    | /owner                      | Hub ✅            |
| Owner    | /owner/dev/admin            | Admin            |
| Owner    | /owner/dev/sales            | Sales            |
| Owner    | /owner/dev/owner?tab=…      | ControlPanel     |
| Owner    | /owner/probe                | Probe            |
| Owner    | /owner/dev/results          | Results          |
| Owner    | /owner/backtests            | Backtests        |
| Owner    | /owner/dev/tree             | Tree             |
| Owner    | /greeks                     | Greeks           |
| Backend  | /owner/dev                  | Dev              |
| Backend  | /database                   | Database         |
| Backend  | /estimated-move             | EstimatedMove    |
| Backend  | /changelog                  | Changelog        |
| Backend  | /social-media               | SocialMedia      |
| Backend  | /owner/admin/emails         | Emails           |
| Backend  | /owner/post-studio          | PostStudio       |
| Personal | /owner/budget               | Budget           |
| Personal | /owner/personal/todo        | Todo             |
```
