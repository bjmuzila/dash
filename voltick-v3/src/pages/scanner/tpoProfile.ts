// DELETED 2026-09-03 — the TPO Structures tab was dropped from v3.
//
// This was the letter profile's GEOMETRY — pure layout maths handing back draw
// instructions, with no canvas of its own. Its only consumer was TpoTab.tsx,
// deleted the same day.
//
// Nothing imports this file: no lazy import, no route, no tab-registry entry.
// 'tpo' is out of SCANNER_TABS, SCANNER_GROUPS and the ScannerTabId union in
// pages/scanner/scannerNav.ts.
//
// The file is still on disk only because the tooling that made this change
// cannot delete files. It is safe — and intended — to:
//
//     git rm cbedge-v3/src/pages/scanner/tpoProfile.ts
//
// The v2 tab it was ported from — components/pages/Scanner.tsx lines 2223–3043,
// components/scanner/Tpo*.tsx, lib/tpo.ts and lib/amt.ts — is a separate app and
// is UNTOUCHED.

export {}
