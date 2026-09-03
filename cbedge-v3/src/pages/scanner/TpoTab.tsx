// DELETED 2026-09-03 — the TPO Structures tab was dropped from v3.
//
// Nothing imports this file: the lazy() import and the TAB_COMPONENT entry are
// gone from src/pages/Scanner.tsx, and 'tpo' is out of SCANNER_TABS,
// SCANNER_GROUPS and the ScannerTabId union in pages/scanner/scannerNav.ts. No
// lazy import, no route, no tab-registry entry reaches it.
//
// The file is still on disk only because the tooling that made this change
// cannot delete files. It is safe — and intended — to:
//
//     git rm cbedge-v3/src/pages/scanner/TpoTab.tsx
//
// The v2 tab it was ported from — components/pages/Scanner.tsx lines 2223–3043,
// components/scanner/Tpo*.tsx, lib/tpo.ts and lib/amt.ts — is a separate app and
// is UNTOUCHED.

export {}
