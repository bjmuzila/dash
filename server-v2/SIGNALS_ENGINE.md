# Signals Engine — actionable ES signals from the GEX/CB levels

`server-v2/signals-engine.js`. Turns the same levels the **ES Candles** heatmap
draws into concrete long/short **ES futures** signals. **Alerts only — it never
places, sizes, or manages an order.** It's the brain the trading bot reads later.

## Inputs
- `marketState.getState()` → `esFut`, `spot` (SPX), `basis`, `callWall`, `putWall`,
  `gexFlip`, `gexRows`, `esCandles` (walls/flip are SPX; converted to ES via `+basis`).
- CB / MVC scored level → `GET /api/snapshots/mvc?limit=1` (`strikeOIVol` = SPX level,
  `mvcValueOIVol` = size in $B, normalized).
- Session H/L + volume profile (POC/VAH/VAL) computed server-side from `esCandles`.

Everything is evaluated in **ES-price space**. Price = `esFut`. `levelEs = levelSpx + basis`.

## The four setups
| Setup | Fires when | Direction |
|---|---|---|
| **Flip cross** | price crosses the GEX flip by ≥ `CROSS_BUFFER` | up = **long**, down = **short** |
| **Wall reject** | touch (≤`WALL_TOUCH`) then push back ≥`WALL_REJECT` | Call Wall → **short**, Put Wall → **long** |
| **Wall break** | threshold-cross beyond the wall by ≥`WALL_BREAK` | above Call → **long**, below Put → **short** |
| **CB reaction** | touch→reject or break of the CB level | reject-from-below → **short**, reject-from-above → **long**, break = continuation |
| **Confluence** | reaction at a ≥2-level stack (GEX + session/profile) | from-below → **short**, from-above → **long** |

Every signal carries a **score 1–5** = base + one point per other level within
`CONFLUENCE_DIST`. CB reactions are **size-gated**: a small CB (≤ `CB_MIN_SIZE` $B)
rarely gets reached, so its signals score low (per the CB-size/reach backtest).

Gates: futures session + real basis + `chartReady`. Dedup: per
`(kind,direction,rounded-level)` cooldown = `COOLDOWN_MS`.

## Data & routes
- Table `trade_signals` (self-creating, no-ops without `DATABASE_URL`).
- `GET  /proxy/signals?limit=50&since=<ms>&kind=<kind>` — newest first (panel + bot).
- `POST /proxy/signals-run` — force one detection pass now (bypasses the gate; testing).
- UI: **ES Candles → dock → "Signals"** toggles the bottom strip (polls every 15s).

## Env (all optional; defaults are sane)
```
SIGNALS_ENGINE_DISABLED=1        # kill switch
SIGNALS_DISCORD_WEBHOOK=<url>    # push alerts to Discord (else in-app only)
SIGNALS_EVAL_MS=3000
SIGNALS_CROSS_BUFFER=1.0         SIGNALS_COOLDOWN_MS=600000
SIGNALS_WALL_TOUCH=1.5  SIGNALS_WALL_REJECT=1.5  SIGNALS_WALL_BREAK=2.0
SIGNALS_CB_TOUCH=1.5    SIGNALS_CB_REJECT=1.5    SIGNALS_CB_BREAK=2.0
SIGNALS_CB_MIN_SIZE=2.0          SIGNALS_CONFLUENCE_DIST=2.0
```

## Verify
```
node server-v2/signals-engine.selftest.js         # pure-logic test, all 4 setups
curl -X POST http://localhost:3002/proxy/signals-run   # force a pass (dev)
curl http://localhost:3002/proxy/signals?limit=10      # read recent
```
Then open ES Candles → toggle **Signals** and watch the strip during RTH.
> Not build-verified in this session (sandbox unavailable). Run the self-test +
> `next build`, then rebuild the `dashboard` container on the VPS (in-process engine).

## From signals → trading bot (next step)
This engine is the **decision layer**. The autonomous bot (the cron/Claude-Code
design) sits on top and only ever **reads `/proxy/signals`**:
1. **Alerts (now)** — Discord/panel, human trades. Grade fills by hand.
2. **Paper** — a `paper-broker` job reads new signals, simulates ES fills, tracks P&L.
3. **Live** — only after paper proves edge: a broker adapter (Tradovate/IBKR/TradeStation)
   places the order **with you confirming**. Claude/the engine never auto-executes.

Add a `signal_outcomes` grader (like the ICT/EM trackers) to auto-score each signal
by follow-through — that P&L history is what tells the bot which setups to trust.
