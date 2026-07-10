# SPX GEX Dashboard — server-v2 migration handoff

Context for a new chat. Pick up at **Step 4**.

## Working setup
- Folder: `C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed`
- Branch: `server-v2-wirein` (do NOT merge or push — Brandon merges to `main` himself after verifying)
- OS: Windows / PowerShell. Linux sandbox is usually down (`HYPERVISOR_VIRT_DISABLED`),
  so the assistant edits files directly; Brandon runs git/npm/node and pastes output.
- Read files fresh before editing — don't trust stale memory of contents.

### Run commands
- New stack (live): `npm run dev` or `npm start` → `node server-v2/server-with-proxy.js`
- Old stack: `dev:old` / `start:old`
- Server binds **port 3002** (set via `PORT` in `.env.local`), not the 3001 default.
- Active feed `SYMBOL` is set in `.env.local`. Currently **NVDA**. Override per-session
  with `$env:SYMBOL="SPX"; npm run dev`.
- Snapshot probes (second PowerShell window, server running):
  - GEX: `(iwr "http://localhost:3002/proxy/gex" -UseBasicParsing).Content | node -e "..."`
  - Flow: `(iwr "http://localhost:3002/proxy/flow" -UseBasicParsing).Content | node -e "..."`
  - Use `-UseBasicParsing` to avoid the IE-engine security prompt. `curl` is aliased to
    Invoke-WebRequest in PS and won't take `-s`.

## Done & verified this session
**Step 1 — raw-greeks runtime verify ✓**
- `/proxy/gex` snapshot on both NVDA and SPX: `all-zero-gamma: 0`, `negative putDelta
  rows: 0`. Greeks physically sane (deep-ITM call delta ~0.99, etc.). Heatmap steady.
- Note: put-delta sign is robust because `vex-chex.js` and `gex-calculator.js` both take
  `Math.abs(delta)` and apply call/put sign structurally — broker-vs-BS sign can't break it.
- Known cosmetic-only artifact: deep-ITM strikes (~600pts from spot) alternate between a
  broker greek and BS-underflow-to-~0 on adjacent strikes. Out of the visible heatmap
  window, no effect on GEX totals. Left as-is.

**Step 2 — production build ✓**
- `npm run build` clean (76/76 pages).
- Fixed a build blocker: `app/premarket/page.tsx` referenced undefined `wsLive`. The page's
  WS wiring was never finished (`setQuotes`/`setTs` are dead). Added
  `const wsLive = Object.keys(allQuotes).length > 0 || yahooTs !== "";` before the return.
  (Follow-up option, not done: finish or remove the dead premarket WS state.)

**Step 3 — restore SPX Flow tab ✓**
Tab previously showed only "Coming Soon". Now wired, build clean, tape verified:
`prints: 1340, tape len: 200` on SPX, all `.SPXW`, correct action/bucket/isOtm/premium.
- **Important architecture fact:** `hooks/useSpxFlow.ts` is NOT the live path. Despite its
  header comment, it's a pure state container (no socket). The live SPX flow path is:
  - `server-v2/computation/flow-processor.js`: `FlowProcessor` builds a capped (200)
    per-order `tape[]` in `FlowOrder` shape inside `addPrint`; `bucket()` emits it
    filtered SPX-only (`underlying === 'SPX' || 'SPXW'`), so a non-SPX feed yields an
    empty tape. `reset()` clears the tape.
  - `server-v2/proxy-tastytrade.js`: passes `spot: this.spot` into `addPrint`.
  - `server-v2/websocket-server.js`: unchanged — `flow` message (line ~107) already
    broadcasts `state.flow`.
  - `app/home/page.tsx`: imports `FlowTape` + `FlowOrder` type, adds `flowOrders` state,
    handles `case "flow"` (reads `data.tape`), renders
    `<FlowTape orders={flowOrders} connected={status==="LIVE"} />`.
- `FlowOrder` TYPE still lives in `useSpxFlow.ts`, imported by FlowTape and home page.
- bucket logic: bull = buy call / sell put; bear = buy put / sell call; mid/unknown side
  → action `FLOW`, bucket `neutral`. Side inference is bid/ask based, needs a fresh quote.

### Uncommitted changes on `server-v2-wirein` (NOT committed, NOT pushed)
1. `app/premarket/page.tsx` — `wsLive` definition (build fix)
2. `server-v2/computation/flow-processor.js` — tape buffer + emit
3. `server-v2/proxy-tastytrade.js` — pass spot to addPrint
4. `app/home/page.tsx` — FlowTape import, flowOrders state, `case "flow"`, render

## NEXT: Step 4 — rotate exposed secrets (REQUIRED before any push)
Repo is **public with secrets in git history**. Rotate before pushing:
TT token/secret, Discord bot token + webhook, Postgres password, Massive key, Schwab secret.
Secrets were already stripped from `lib/proxy/config.ts` in current files, but they remain
in git history. Plan needed: (a) audit current files + `git log -p`/`git grep` history for
each secret, list exactly where; (b) rotate each at its provider; (c) scrub history
(git-filter-repo or BFG) if Brandon wants the public history clean; (d) update `.env.local`.
Do the audit read-only first — don't rotate or rewrite history without Brandon confirming.

## Step 5 — merge `server-v2-wirein` → `main` (Brandon does this himself after verifying)

## Optional follow-ups noted, not required
- Premarket page dead WS state (`setQuotes`/`setTs`) — finish or remove; LIVE badge is
  currently driven off yahooTs as a proxy for "data flowing".
- Home page header chip showed "0 OPTION SYMBOLS" / "$TREAM" — looks like an unwired
  display binding (feed is live), worth a look.
