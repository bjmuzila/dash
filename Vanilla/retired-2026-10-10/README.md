# RETIRED 2026-10-10 — do not use, import, or re-wire

Moved here (not deleted) when these recorders/pages were switched off. Nothing in
the live app requires these files. Their Postgres tables were left in place.

| Retired | Was | Why |
|---|---|---|
| server-v2/greek-scanner-recorder.js | SPX per-strike greeks every 5 min → greek_snapshots, /proxy/greek-scanner | only the v2 Scanner read it |
| owner-vite/src/pages/Greeks.tsx (+ components/RegimeMatrix.tsx, SkewCalculator.tsx) | owner.cbedge.net/greeks | page removed; /greeks redirects to /owner |
| server-v2/atm-prem-*.js | SPY/QQQ ATM premium daily + every minute → atm_prem_diff, atm_prem_intraday | only the v2 Test Lab Prem Diff tab read it |
| server-v2/eod-dte-gamma-recorder.js, app/api/eod-dealer-gamma, tests/eod-dte-gamma-enrichment.test.mjs | 3 extra full-chain sweeps at the close → eod_dte_gamma | only the v2 Dealer Gamma tab read it |
| server-v2/strategy-generator.js, cbedge-v3 StrategyBuilder.tsx | hourly AI daily strategy (7 Anthropic calls/day) → daily_strategy | the v3 card was never mounted |
| server-v2/day-post-writer.js | 3 AI X posts a day → day_posts | nothing read day_posts (on-demand /api/social-media/day-post still works) |

Paths below this folder mirror where each file used to live.

## Second pass, same day — recorders that were already switched off

None of these were running. They were still wired in (requires, routes, gated
start lines), so they were unwired and parked here. `LEGACY_RECORDERS` no longer
exists.

| Retired | Was | Routes removed |
|---|---|---|
| server-v2/forward-scanner-recorder.js | next-expiry walls → scanner_forward | /proxy/walls-forward, -run |
| server-v2/state/ticker-wall-recorder.js | NDX/SPY/QQQ walls every 60s → ticker_wall_snapshots | /proxy/wall-history |
| server-v2/momentum-bias-tracker.js, state/momentum-bias-writer.js | ES TP/reversal signals → momentum_bias_signals (incl. the inline block in proxy-tastytrade.js) | /api/momentum-bias |
| server-v2/preview-snapshot-recorder.js, home-snapshot-recorder.js, mult-greek-snapshot-recorder.js | delayed snapshots for unpaid /preview, /home, /mult-greek | /proxy/preview-snapshot, /proxy/home-snapshot, /proxy/mult-greek-snapshot |
| server-v2/ict-setup-tracker.js, es-gap-tracker.js | already commented out since 2026-09 | — (/api/ict-setups, /api/es-gap still serve old rows) |
| server-v2/vol-pin-recorder.js, play-recorder.js, multi-flow.js, state/etf-candle-recorder.js | never wired / empty stub / replaced / duplicate of server-v2/etf-candle-recorder.js | — |

Also unwired (module kept, still used by daily-grades): the walls-reach routes
/proxy/walls-reach(-run), /proxy/walls-watch(-run), /proxy/walls-alerts, and the
attachRank() decoration on /proxy/walls (two dead queries per call).

## Third pass — Discord alerts and the v2 dashboard

**Discord alerts dropped.** `econ-alert-recorder.js` (polled /api/calendar every
20s into public/signals.txt), `discord-relay.js` (signals.txt → Discord),
`greeks-cross-alerts.js` (fed [Greeks] lines from greeks-ts-writer) and
`signals-file.js` (their shared writer).

**v2 cut to Test Lab + Levels** (Brandon: "only keep v2 stuff that's /app/test";
Levels kept because Test Lab links to it). Everything under `v2/` here was
unreachable once the v2 SPA routed only `/test` and `/levels`: Level Log, Strike
History, Confidence Score, the /m/chain phone page, the Dealer Gamma and Prem
Diff Test Lab tabs, the dead `app/app/*` shell routes, and every component /
hook / lib file only they used (found by import-graph walk from the live entry
points — Next special files, app-vite main.tsx, server-v2, scripts, tests).
Old /app links redirect through PORTED in lib/v3Routes.ts.

API routes removed with them (server copy and Next fallback): /api/flow,
/api/flow/calls, /api/ict-prefs, /api/insights/{vix,gex,gex/stream,em,
greeks-intraday,market-quality}, /api/obook, /api/semi-strength,
/api/strike-gex-series, /api/tpo-forecast, /api/trump-calendar,
/api/positioning-tickers, /api/market-scanner, /api/strike-summary,
/api/econ-calendar, /api/spx-heatmap, /api/momentum-bias,
/proxy/strike-dod-{dates,history,strikes}; bundles _lib-tpo-forecast.cjs and
_lib-obook.cjs.

Also unreferenced server files: condor-marks.js, voltick-levels.js,
es-spx-basis-1.js (stale copy), tpo-profiles-recorder.js and its two backfill
scripts (recorder removed 2026-10-06).
