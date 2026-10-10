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
