// DELETED 2026-08-30 — the Scanner page was retired from v3.
//
// Nothing imports this file: the lazy() import and the <Route path="/scanner">
// are gone from src/App.tsx, the rail slot is gone from src/shell/Shell.tsx,
// and /scanner is out of ALL_PAGES / LIVE_ROUTES in pages/TradersDashboard.tsx.
// The shell handler at app/v3/scanner/route.ts now answers 404.
//
// The file is still on disk only because the tooling that made this change
// cannot delete files. It is safe — and intended — to:
//
//     git rm cbedge-v3/src/pages/Scanner.tsx
//
// The v2 page it was ported from (components/pages/Scanner.tsx) and the
// scanner tabs under components/scanner/ are a separate app and are untouched.
// So is src/data/scannerTickers.ts, which is the shared ticker universe that
// Premarket and the board cards read — that is not part of this page.

export {}
