// DELETED 2026-09-03 — the TPO Structures tab was dropped from v3.
//
// This was the tab's vocabulary: the eight structure kinds, their four age
// buckets, the label/ink records and the base-rate copy. Its only consumers were
// tpoStructures.ts, tpoProfile.ts, amt.ts and TpoTab.tsx, all deleted the same
// day.
//
// Nothing imports this file: no lazy import, no route, no tab-registry entry.
// 'tpo' is out of SCANNER_TABS, SCANNER_GROUPS and the ScannerTabId union in
// pages/scanner/scannerNav.ts.
//
// The file is still on disk only because the tooling that made this change
// cannot delete files. It is safe — and intended — to:
//
//     git rm cbedge-v3/src/pages/scanner/tpoTaxonomy.ts
//
// The v2 tab it was ported from — components/pages/Scanner.tsx lines 2223–3043,
// components/scanner/Tpo*.tsx, lib/tpo.ts and lib/amt.ts — is a separate app and
// is UNTOUCHED.

export {}
