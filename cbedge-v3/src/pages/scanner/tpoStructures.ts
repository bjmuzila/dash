// DELETED 2026-09-03 — the TPO Structures tab was dropped from v3.
//
// This was the tab's profile engine: buildTpoSession, the forward-fill, the
// value-area walk, the eight-structure scan and binSizeFor. Its only consumers
// were TpoTab.tsx, tpoProfile.ts and amt.ts, all deleted the same day.
//
// Nothing imports this file: no lazy import, no route, no tab-registry entry.
// 'tpo' is out of SCANNER_TABS, SCANNER_GROUPS and the ScannerTabId union in
// pages/scanner/scannerNav.ts.
//
// The file is still on disk only because the tooling that made this change
// cannot delete files. It is safe — and intended — to:
//
//     git rm cbedge-v3/src/pages/scanner/tpoStructures.ts
//
// The v2 tab it was ported from — components/pages/Scanner.tsx lines 2223–3043,
// components/scanner/Tpo*.tsx, lib/tpo.ts and lib/amt.ts — is a separate app and
// is UNTOUCHED.
//
// It imported `EsCandle` / `TpoInstrument` from tpoData.ts. That module is a
// tombstone too, but its candle half survives as pages/scanner/candles.ts
// (TpoInstrument is CandleInstrument there) — see the tpoData.ts tombstone.

export {}
