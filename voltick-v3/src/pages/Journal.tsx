// DELETED 2026-08-30 — the Journal page was retired from v3.
//
// Nothing imports this file: the lazy() import and the <Route path="/trading">
// are gone from src/App.tsx, the rail slot is gone from src/shell/Shell.tsx,
// and /trading is out of ALL_PAGES / LIVE_ROUTES in pages/TradersDashboard.tsx.
// The shell handler at app/v3/trading/route.ts now answers 404.
//
// The file is still on disk only because the tooling that made this change
// cannot delete files. It is safe — and intended — to:
//
//     git rm cbedge-v3/src/pages/Journal.tsx
//
// The backend is untouched: /api/journal and /api/journal/trades still exist,
// and v2's page (components/pages/Trading.tsx at /app/trading) still uses them.

export {}
