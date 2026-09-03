// DELETED 2026-09-03 — the TPO Structures tab was dropped from v3.
//
// ── THE CANDLE HALF OF THIS FILE DID NOT DIE. IT MOVED. ──────────────────────
// This module owned two unrelated things: the TPO tab's forecast layer, and the
// four `/api/snapshots/candles` reads for ES and NQ. The candles are still live —
// IB Stats' live tape reads them — so they were extracted to:
//
//     cbedge-v3/src/pages/scanner/candles.ts
//
// with the TPO-flavoured names made neutral. If you came here looking for one of
// these, that is where it is now:
//
//     loadTpoCandles       → loadCandles          (candles.ts)
//     TpoInstrument        → CandleInstrument     (candles.ts, same 'ESU'|'NQU')
//     TpoCandleLoad        → CandleLoad           (candles.ts)
//
// and these moved KEEPING their names: EsCandleRecord, EsCandle, CandleInterval,
// etDateStr, esCandlesTodayUrl, esCandlesHistoryUrl, nqCandlesTodayUrl,
// nqCandlesHistoryUrl, CANDLES_TODAY_STALE_MS, CANDLES_HISTORY_STALE_MS,
// loadEsCandlesToday, loadEsCandlesHistorical, loadNqCandlesToday,
// loadNqCandlesHistorical, candleFrameType, CANDLE_COALESCE_MS, liveCandleRows,
// candleLoadFailureLine, unionCandles, barCountKey, spotFromCandles.
//
// Everything else here went with the tab and has NO replacement: the day
// selector (TPO_SESSION_CHOICES, TPO_DEFAULT_INSTRUMENT, TPO_DEFAULT_SESSIONS,
// historyDaysFor, TPO_MAX_SESSIONS, TPO_HISTORY_DAYS) and the whole
// `/api/tpo-forecast` section (TpoForecastOk, loadTpoForecast, TPO_FORECAST_*,
// TPO_FORECAST_ENGINE, forecastSubtitle, accumulatingLine, …). The route itself
// is server-side and untouched; v3 simply has no client for it.
//
// Nothing imports this file: candles.ts is a copy, not a re-export, and
// pages/scanner/ibStatsData.ts — the one surviving caller — imports
// `loadCandles` from '@/pages/scanner/candles'. No lazy import, no route, no
// tab-registry entry reaches it.
//
// The file is still on disk only because the tooling that made this change
// cannot delete files. It is safe — and intended — to:
//
//     git rm cbedge-v3/src/pages/scanner/tpoData.ts
//
// The v2 tab it was ported from — components/pages/Scanner.tsx lines 2223–3043,
// components/scanner/Tpo*.tsx, lib/tpo.ts and lib/amt.ts — is a separate app and
// is UNTOUCHED. So is v2's lib/snapdb.ts, which the candle queries were
// transcribed from.

export {}
