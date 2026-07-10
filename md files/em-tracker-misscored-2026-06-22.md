# EM Tracker — mis-scored rows, week 6/22 (ending Fri 6/26/2026)

**Root cause:** the weekly evaluator ran while each ticker's weekly candle was
still forming (a partial Friday bar timestamped `…T20:00:01Z` instead of the
finalized Monday-boundary weekly bar). `fetchWeeklyClose()` did `bars.find(week === target)`
and grabbed whichever bar appeared first — at evaluation time that was the
non-final bar, so results were scored against a partial close.

**Scope:** of 383 scored rows, 284 were re-checkable against the now-finalized
weekly candle; **53 are wrong** (flip hit↔miss). 98 errored in the re-check
(symbol-mapping / history gaps) and were NOT verified — the whole week should be
re-evaluated, not just these 53.

**Fix:** (A) `fetchWeeklyClose` now selects the canonical weekly bar (Monday-open
timestamp) and refuses to score a still-forming bar; (B) re-run the evaluator for
week 2026-06-22 so every row is re-scored from finalized candles.

## Confirmed flips (stored → should be)

| Ticker | Stored close | Stored | True close | Should be |
|--------|-------------:|--------|-----------:|-----------|
| A | 135.51 | hit | 136.01 | miss |
| ACAD | 23.72 | hit | 25.32 | miss |
| ADI | 417.93 | hit | 386.91 | miss |
| AFRM | 76.85 | hit | 79.49 | miss |
| AG | 16.50 | miss | 16.89 | hit |
| AMAT | 668.00 | miss | 626.84 | hit |
| AMC | 1.89 | miss | 2.16 | hit |
| ANET | 165.45 | hit | 157.60 | miss |
| MSFT | 352.83 | miss | 372.97 | hit |

Full machine-readable list of all 53 tickers:

A, ACAD, ADI, AFRM, AG, AMAT, AMC, ANET, ARKK, ASML, BDX, BE, BIIB, CAMT, CARR,
CAT, CLS, CRUS, CSCO, DDOG, DXCM, ENPH, EQT, ETN, FTNT, GE, GEV, GILD, GS, GSK,
GTLB, HALO, HPE, JPM, LCID, LH, LLY, MCHP, MDB, MMM, MRVL, MS, MSFT, NBIX, NIO,
NVMI, ON, PANW, PYPL, QCOM, REGN, RIVN, SMH

> Note: this audit was generated from a quick client-side re-check. The 98 rows
> that errored are unverified. Re-running the evaluator (Fix B) is the source of
> truth — do not hand-edit from this table.
