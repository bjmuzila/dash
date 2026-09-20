# Voltick v3 — the reference set

Every card on the v3 board and every page of the app has a written reference in this
folder, and the ↓MD button on that surface downloads it. They are markdown files served
straight out of `public/docs`, so they cost the bundle nothing and are readable in any
editor, any wiki, or as a paste into a chat.

**What is in one of these.** Not a feature list: what the surface draws, every feed behind
it with its cadence and its failure shape, every derived number with the actual formula,
every control with its default and where the setting is stored, the colours as design
tokens, the status strings verbatim, and a Gotchas section carrying the traps that have
already cost somebody an afternoon — including the dated notes about things that were
tried and reverted, which is the part that is nowhere else.

They are generated from the source and its header comments, so a claim here should always
be checkable against a file. Where a doc and the code disagree, the code is right and the
doc is a bug.

| | Slug | Reference | Size |
|---|---|---|---:|
| Card | [`card-econ-calendar`](card-econ-calendar.md) | Board card — `econ-calendar` | 48 KB |
| Card | [`card-flow-tape`](card-flow-tape.md) | Flow Tape — board card reference | 41 KB |
| Card | [`card-gauge-rail`](card-gauge-rail.md) | `gauge-rail` — Gauge Rail · 🎚️ · default 48 × 20 · `src/board/gaugeRail/` | 34 KB |
| Card | [`card-gex-candles`](card-gex-candles.md) | GEX Candles — board card reference | 136 KB |
| Card | [`card-gex-chart`](card-gex-chart.md) | `gex-chart` — GEX Chart · 📊 · default 24 × 48 · `src/board/gexChart/` | 52 KB |
| Card | [`card-key-levels`](card-key-levels.md) | `key-levels` — Key Levels · 📏 · default 48 × 24 · `src/board/keyLevels/` | 43 KB |
| Card | [`card-multi-greek`](card-multi-greek.md) | `multi-greek` — **Multi Greek** · 🧮 · default grid `w 48 × h 56` · `src/board/multiGreek/` | 52 KB |
| Card | [`card-net-premium`](card-net-premium.md) | Net Premium — board card reference | 49 KB |
| Card | [`card-oi-by-expiry`](card-oi-by-expiry.md) | `oi-by-expiry` — **OI by Expiration** · 📅 · default grid `w 24 × h 40` · `src/board/oiByExpiry/` | 43 KB |
| Card | [`card-quick-links`](card-quick-links.md) | Quick Links — board card reference | 18 KB |
| Card | [`card-top-flow`](card-top-flow.md) | Top Flow — board card reference | 48 KB |
| Card | [`card-vol-gex-flow`](card-vol-gex-flow.md) | `vol-gex-flow` — **Net Vol GEX Flow (Today)** · 🌀 · default grid `w 24 × h 56` · `src/board/volGexFlow/` | 45 KB |
| Page | [`page-analysis`](page-analysis.md) | `/analytics` — Analysis | 85 KB |
| Page | [`page-board`](page-board.md) | The grid board — `/board` | 78 KB |
| Page | [`page-chain`](page-chain.md) | `/chain` — the option BOOK | 55 KB |
| Page | [`page-economic-calendar`](page-economic-calendar.md) | Page — `/economic-calendar` | 54 KB |
| Page | [`page-em`](page-em.md) | `/em` — Estimated Moves | 48 KB |
| Page | [`page-feedback`](page-feedback.md) | `/feedback` — support tickets | 42 KB |
| Page | [`page-flow`](page-flow.md) | Options Flow — `/flow` | 74 KB |
| Page | [`page-home-cards`](page-home-cards.md) | The home board — `/` (and `/cards`, `/cards/:cardId`) | 45 KB |
| Page | [`page-legacy`](page-legacy.md) | `/legacy` — the v2 door | 29 KB |
| Page | [`page-level-log`](page-level-log.md) | Level Log — `/level-log` | 65 KB |
| Page | [`page-options-chain`](page-options-chain.md) | `/options-chain` — the GEX heat MATRIX | 72 KB |
| Page | [`page-phone`](page-phone.md) | The phone build — `/v3/m/*` | 54 KB |
| Page | [`page-premarket`](page-premarket.md) | `/premarket` — Premarket Prep | 99 KB |
| Page | [`page-replay`](page-replay.md) | Replay — `/replay` | 68 KB |
| Page | [`page-scanner`](page-scanner.md) | `/scanner` — the Scanner | 224 KB |
| Page | [`page-seasonality`](page-seasonality.md) | `/seasonality` — the Almanac | 72 KB |
| Page | [`page-single-voltmap`](page-single-voltmap.md) | The Voltmap — `/single` | 68 KB |
| Page | [`page-traders-dashboard`](page-traders-dashboard.md) | `/traders-dashboard` — Traders Dashboard | 55 KB |
| Page | [`page-whales`](page-whales.md) | `/whales` — the $1M+ print archive | 66 KB |

---

## Keeping this set honest

`src/docs/docsIndex.ts` is the only place that says which slug belongs to which card or
route — nothing else in the app hardcodes a filename. `npm run check:docs` walks it in
both directions: every slug it names must have a file here, every file here must be named
by it, and every card in `src/board/catalog.tsx` and every route in `src/App.tsx` must
have a line in it or be listed as deliberately exempt.

A surface with no entry draws **no button** rather than a broken one. So adding a card
never breaks this folder — and never lets you quietly forget it either, because the check
will say so.
