// DELETED 2026-09-03 — the TPO Structures tab was dropped from v3.
//
// This was the auction read (AMT) — its five ladders and the signal set the TPO
// tab rendered as tiles. It read StructureKind from tpoTaxonomy.ts and
// TpoResult / TpoSession from tpoStructures.ts, so it was never usable without
// the profile engine. Its only consumer was TpoTab.tsx, deleted the same day.
//
// Nothing imports this file: no lazy import, no route, no tab-registry entry.
// 'tpo' is out of SCANNER_TABS, SCANNER_GROUPS and the ScannerTabId union in
// pages/scanner/scannerNav.ts.
//
// The file is still on disk only because the tooling that made this change
// cannot delete files. It is safe — and intended — to:
//
//     git rm cbedge-v3/src/pages/scanner/amt.ts
//
// The v2 tab it was ported from — components/pages/Scanner.tsx lines 2223–3043,
// components/scanner/Tpo*.tsx, lib/tpo.ts and lib/amt.ts — is a separate app and
// is UNTOUCHED. In particular v2's lib/amt.ts, which this was transcribed from,
// is still there and still reached by v2's own tab.

export {}
