# Voltick — post-close investigation + fixes (from Mon 2026-09-28 open logs)

You're working on the Voltick server and its theta-proxy (the Render service in front of ThetaData). Below are issues found in today's production logs (Mon 9/28, ~8:55 ET to 12:05 ET) and two `/health` snapshots, build `12370c2`. Work through them after the close tonight, in priority order.

**Top 6, if you only get to some:**
1. **`/api/flow` cache + coalescing + load-shed** (ARCHITECTURE Stage 1). It caused both main-thread stalls (10:32 and 11:39 ET) and the 502s, and its per-request cost grows with the day's tape.
2. **Client reconnect floor, one dial per ~15s per tab** (#8d), plus the STUCK-ON-LOADING hole for boards the server never sends (#8b). This stops the reconnect feedback loop.
3. **Why the process restarted at 11:48 ET (same build, likely OOM)** and the RSS climb (#8c). Also make the flow record bank save periodically, because the restart wiped today's record.
4. **theta-proxy saturation:** fix the bulk-quote batch-drop (#4), chunk the 900-symbol call (#5), add a priority lane for index quotes (#5b), and stop the 1s SPX/SPY/QQQ/IWM poll (#6).
5. **The price brake at the open** (#1–#3). It ran ~65s stale through the bell and never lifted at 10:00.
6. **Log close code + lifetime on every socket close**, so tomorrow's logs name what's killing sockets.

**For every item:** find the code responsible, confirm the cause against the log evidence before changing anything, make the smallest fix that works, and tell me what you changed and how to verify it tomorrow. If the evidence doesn't match what the code does, say so rather than forcing a fix.

---

## P0 — 502s at ~10:32 ET: the main thread saturated

**What the logs show:**
- **A 2m51s hole with no log lines at all:** `14:32:19` → `14:35:10` (10:32–10:35 ET). Uptime keeps counting (28868s → 29108s), so the process didn't restart. It was frozen or starved, and Render/Cloudflare returned 502 because Node wasn't answering.
- **After it came back, the thread stayed pegged:**
  ```
  10:31 ET  loop avg 61ms  max 1106ms · cpu 80%  · thread 51%  · QUOTES 36% covered
  10:35 ET  loop avg 324ms max 3088ms · cpu 101% · thread 83%  · 13% covered · stalest NDX 169s · ticks skipped 2
  10:36 ET  loop avg 644ms max 2566ms · cpu 143% · thread 100% · ticks skipped 3 · wall chains 192092ms
  10:37 ET  loop avg 870ms max 3264ms · cpu 145% · thread 100% · 12 of 21 price pulls MISSED
  ```
- **`/api/flow` is the repeat offender:** about 20 "held the loop" lines of 1.0–2.7s in 3 minutes. The others are `node-alert check` 3.0s, `/api/lens-record` 2.9s, `calibration warm` 2.7s, `/api/pressure` 2.5s, `/api/node-trails` 2.3s, `tick:select` 2.1s and `flow-alert check` ~1.1s each time.
- **Viewers fell and came back together:** 151 → 143, then several members reconnected in the same second (14:38:42). The darkpool sweep is `OUT OF TIME … behind=44min`.
- **A burst of ~26 "morning report" emails at 10:38 ET,** right in the middle of this. These are really *alert* emails (see #9, a label bug), fanned out from the SPX/IWM Volt alerts. Building the alert emails is main-thread work during a stall, so batch or defer them under load.

- **Caveat on the gap:** a second log export skips `14:32:19 → 14:39:52` entirely, while the first one *has* lines from 14:35–14:38. So at least part of the "silence" is the log viewer dropping lines, not the process. Confirm with Render's metrics (not the log view) whether the process actually stalled. The member-facing 502 on `GET voltick.io/chart` (the HTML page itself) is real.
- **Reconnect storm right after (10:39–10:41 ET):** viewers went 145 → 169 → **199** in two minutes. Many members reconnected several times within seconds: `mitotakekei` ×7, `jose_f_mejia` ×8, `devinglover` ×5, `poppyohio` (delayed) ×6, plus `inforecruiter`, `ngnotz`, `dimwobba`, `dominicchoi20`. The "watching" count sat at 192 while connections poured in, so fresh sockets were dying almost as fast as they opened. People reloading after the 502 plus client dead-socket timers (38–58s of silence while the loop was held) all landed at once. CPU went to 272–342% (workers) with the main thread at 100%. It recovered by ~10:42 (loop avg 307ms, stalest 6s, 95% covered), but this storm is exactly the stall-re-arming pattern CLAUDE.md warns about.
- **The reconnect churn is now site-wide and ongoing (10:47–10:49 ET):** in ~90 seconds, `korkuta@gamateks` ×9, `fdelaneyiv` ×7, `aa7771146` (delayed) ×6, `chetman0331` ×6, `hhollyberry35` ×5, `ahmademaali` ×5, `poppyohio` ×5, `guruprasad3684` ×4, `everett.winer.nahs` ×3, and others. "Watching" stays flat at ~196, so sockets are opening and dying within seconds, all over the site.
  - Every reconnect costs `/api/me`, a payload build and a ~358KB gz summaries frame, which feeds the 100%-thread load that's causing it. **This is a feedback loop.**
  - Likely killers to check, in order:
    1. the client's STUCK-ON-LOADING watchdog (board not `ready` within 15s because the server is too slow to push it);
    2. the stale-socket timer (`DEAD_MS`, 38–58s of silence while the loop is held);
    3. `DIAL_MS` (8–12s handshake timeout while the server is slow to accept).
  - All three close a socket the server is merely slow on. **Server: log close code and lifetime. Client: send `?why=` on reconnect.** Also have the client back off harder when its previous sockets died young.
- **Heatmap bot is broken and heavy:** `[heatmap-bot] capture error (window.__voltickSet is not a function)`, then repeated `capture slow (over 9000ms) · page still warming`. `__voltickSet` looks renamed or removed in the weekend web build. Check whether the capture runs a headless browser on the same box, since that competes for CPU during exactly these moments.
- **Log bug:** the status line printed `140% covered`. Coverage can't exceed 100%, so the numerator and denominator are counting different sets.

**Health endpoint snapshot at 10:45 ET (build `12370c2`, web `index-D3leqSKM.js`, booted 2:30 ET):**
- Still unhealthy: `threadPct 100`, `loop avg 455ms max 2474ms`, 195 viewers.
- **`/api/flow` is by far the biggest consumer of main-thread time:** `n=86,009 · totalMs 1,725,471 (~29 min) · avg 20ms · max 2735ms`. That's 5.5x the next job (`tick:select` 313s). The next ones are `/api/tail` (228k calls, 307s), `payload` (267s) and `/api/node-trails` (265s, max 2.4s).
  - This is clients polling. Cache the `/api/flow` response per distinct filter for 1–2s, so N members on the same view cost one build.
  - Check whether the weekend update changed the Flow page's poll rate or the query cost.
- **Two different kinds of stall:**
  - **CPU contention (the 10:35–10:38 ET blocks):** `cpuPct 147–186%`, `idleMs 0`, and **443–792 involuntary context switches** per block. The main thread was being preempted while workers burned CPU, which is what a container CPU quota being hit looks like (the box reports 32 host cores, but the Render plan's quota is what counts). Check Render CPU throttling for that window. Consider capping worker concurrency during RTH, or moving up a plan.
  - **Synchronous I/O (low CPU, long wall time):** `route /api/history` 5.8s at `cpuPct 8%` (max 6.3s in the job table), `chains → /api/history` 3.2s at 15%. Those are sync disk/SQLite reads on the main thread.
- **`record:flow` held the loop for 12.8 seconds** (`n=1`, at boot+524s, ~2:39 ET). `recordBank.flow.saves: 1`, `savedAgoSec 29152`, so the flow record bank has saved exactly once since boot. If anything ever runs that save during market hours, it's a guaranteed 13s freeze, and if the box dies, today's flow record is lost. Chunk it or move it to a worker, and save it more often.
- **The price stream is mostly being thrown away:** `streamPrices got 631,510 · applied 117,834 · rejected 497,927 (79%)`, `laggedPolls 41,243 of 71,280 (58%)`, `shed 15,749`. Only 99 symbols are painted from the stream versus 919 from theta polling, and `coldLapSec 83`, so a cold symbol's price refreshes about every 83s. Find out why 79% of stream ticks are rejected (stale timestamps? the brake?).
- **Email:** `queued 996 · sent 994 · retried 57 · failed 2`. The retries are 429 rate-limit waits, not duplicates (see #9: the "morning report" label covers every alert email).
- **Thin ladders:** `81 of 1023` boards have 0 strike rungs inside the expected move (NIO, OPEN, RR, HIVE, GRAB, PLUG, DSX…). WBD uses step 1 where 0.5 is listed (`stepVsListed 2`), so half the strikes are dropped. Check whether the weekend update changed strike-step selection.
- Healthy: all 1025 symbols `ok`, `chainFails 0`, compute pool `timeouts 0 · misses 0`, chainBank writes with 0 failures, prevCloses fresh.

**Recovered by 10:54 ET (no rollback):** `loop avg 47ms max 1192ms · cpu 62% · thread 43% · 203 viewers · QUOTES 58/58 ok`. Reconnects calmed to a normal trickle, and `/api/flow` stopped showing up in "held the loop" lines. So the stall lasted roughly 10:32–10:50. What's still off: coverage is only 47%, stalest GOOGL 42s, and SPX/SPY/QQQ/IWM still time out now and then (#5b/#6). Compare what changed around 10:50 (viewers dropping, the Flow page's polling slowing, the heatmap bot finishing?) against the 10:32 start. That's the fastest way to name the trigger.

**It came back: a second stall at ~11:39 ET, so this recurs rather than being a one-off:**
```
11:40 ET  loop avg 565ms max 2670ms · cpu 188% · thread 100% · ticks skipped 2 · 8 of 27 price pulls MISSED · 167 viewers
          scan extras: 1025 boards in 57325ms (was 17–20s)
          /api/flow held the loop 1.9s, 2.3s, 2.5s, 2.2s, 1.3s inside ~20s · /api/node-trails 2.7s, 1.2s
```
- Same signature as 10:32: `/api/flow` dominates, and the reconnect churn starts again (`nathanallenwade`, `malikjsnowden`, `thresholdresearchgroup` ×3 each, `dpmaverick13`, `ruddy131990` ×2) within 30s.
- **It isn't viewer count:** 167 viewers here versus 203 at 10:54 when it was healthy. Look at *what* people are on (the Flow page and its filters) rather than how many.
- The status line dropped its `QUOTES … % covered` piece in this print. Check why that section went missing.

**RSS is climbing while viewers fall (see #8c):** 5.1GB at 10:54 (203 viewers) → **5.5–5.6GB at 11:40 (167 viewers)**, which is +0.4–0.5GB in 45 min with fewer people. That points to something growing (caches, flow tape, per-socket state from the reconnect churn), not load. Take a heap snapshot or check the size of the major maps/caches after the close. Watch whether it's still climbing into the 3:30 ET close, and compare against `peakRssMb` and the plan's memory limit.

**The process RESTARTED at ~11:48 ET (mid-session):** the 12:03 ET status shows `up 903s · rss 2.9GB`, where it was `up 32960s · rss 5.5–5.6GB` at 11:40.
- **Find out why first.** Check Render events for a deploy, a manual restart, or an **OOM kill**. RSS had been climbing (5.1 → 5.6GB) while viewers fell, so a memory-limit kill is a real candidate (#8c). `restartlog.js` / `/api/admin/restarts` and the "killed in place" owner email should say which.
- **After the restart the engine is healthy but the proxy is the bottleneck:** `loop avg 13ms · thread 36%`, yet `QUOTES 4% covered · stalest STX 133s`. The bulk quotes keep getting `503 busy`, and chain fetches time out and fall back to **Tradier (15-min delayed) for GS, CLSK and even IWM**. A core index ETF on delayed data during the session is a member-visible correctness problem.
- The warm-up after a restart (a full chain re-warm plus the ~900-symbol bulk quote pull) saturates the theta-proxy. The proxy needs its own concurrency priority (index/stream-fallback quotes first, #5b), and the post-boot warm should be paced against the proxy's `503`s (back off instead of retrying straight into it).
- `heatmap-bot@voltick.io` connects as a LIVE viewer and logs `capture slow (over 10500ms)`. If it's a headless browser on the same box, it's competing for CPU right when the box is warming.

**Health snapshot after the restart (12:04 ET):**
- **Same build `12370c2`, booted 11:48:24 ET, so this was NOT a deploy.** It was killed in place, restarted manually, or OOM-killed, and the memory climb makes OOM the lead suspect. `peakRssMb` before the kill was ~5.6GB. Compare against the Render plan's memory cap.
- **`/api/flow` gets more expensive as the day goes on:** `avg 6ms · 6,863 calls` 16 minutes after boot, versus `avg 20ms · 86,009 calls` at 10:45 after 8h up. The per-request cost grows with the size of the day's tape, which means each request scans the whole tape. That's why stalls get worse into late morning, and it's the strongest argument for Stage 1–2 in ARCHITECTURE (cache and index on insert).
- **The restart lost today's flow record:** `recordBank.flow.restored ageMin 549 · saves 0`. The last save was at the ~2:39 ET boot, so everything recorded between then and 11:48 is gone. The record bank has to save periodically (every few minutes, off the main thread), not once per boot.
- Other slow routes after boot: `/api/pressure` max 4.4s, `/api/forward-record` 2.9s, `/api/scan-intel` 2.9s, `/api/node-trails` 3.0s.
- Stream prices are still mostly rejected (`got 224k · applied 31k · rejected 193k`, 86%). `thinLadders` is up to 89.

**Find:**
1. What ran in the gap. Check Render metrics (CPU/memory/event-loop) and any `🧱 block` line emitted right after 14:35:10 for a single multi-second block.
2. **Whether `/api/flow` got heavier in the weekend update.** It was fine in last week's logs if it never appeared. Profile it with a typical member query. Cache or precompute its response per filter, or move it to the worker pool (`WORKERS` is on).
3. Move `node-alert check`, `calibration warm` and `lens-record` off the main thread, or chunk them so they yield.
4. Add a load-shed guard: when loop lag stays above ~500ms, pause the non-essential sweeps (calibration warm, darkpool sweep, heatmap bot, alert-email fan-out) until it recovers.

---

## ARCHITECTURE — the Flow page must never be able to take down the boards

The core problem: one Node main thread serves the boards, the broadcast, the price lanes, alerts, *and* every `/api/flow` poll. Today `/api/flow` ran 86,000 times and used ~29 minutes of that single thread, and each time it spiked, everything else stalled. A bigger Render plan won't fix this, because more cores don't make one thread faster. The fix is **isolation**, in stages:

**Stage 1 · this week (cheap, big win)**
1. **Cache plus coalescing on `/api/flow`:** key on the normalised filter set, with a 1–2s TTL. Concurrent identical requests share one in-flight build. N members on the default Flow view then cost 1 build per second, not N.
2. **Cap what a request can cost:** hard row limit (paginate), no full-day scans per request, and a per-user rate limit (e.g. 1 req/s).
3. **Shed load under pressure:** when loop lag is over ~300ms, `/api/flow` serves the last cached result with a `stale: true` flag (or a 503 with `Retry-After`) instead of computing. Boards, broadcast and prices always win.
4. **Client polls politely:** stop polling when the tab is hidden or the Flow page isn't mounted, and back off when the server says `stale`/`busy`.

**Stage 2 · next few weeks (structural)**
5. **Push the tape, stop polling it:** send new flow prints over the existing WebSocket as deltas ("rows since id X"), batched once a second, only to sockets that have the Flow page open. The browser filters and sorts locally. Server cost then scales with *new prints*, not *requests × tape size*. This removes most of the 86k calls.
6. **Index the tape on insert:** keep per-symbol/expiry/side buckets and running aggregates (premium totals, repeats, lean) up to date as prints arrive, so any remaining query is a lookup, not a scan.
7. **Move whatever heavy flow work remains into the compute pool.** `WORKERS` is already on with 4 workers and 0 timeouts today, so it has room. The main thread only routes.

**Stage 3 · long run (failure isolation)**
8. **Run Flow as its own service, like `theta-proxy`:** a separate Render service that owns the flow stream, the tape, `/api/flow*`, `/api/darkpool` and the flow alerts. The engine subscribes to it for anything it needs (alerts, grades). If Flow gets slammed or crashes, the boards keep running. This doesn't break the "one instance" rule, which exists to avoid forking in-memory state: each service is still a single instance owning its own state.
9. **The same pattern suits other heavy side features** that showed up in today's stalls (`/api/node-trails`, `/api/history` sync reads, calibration warm, the heatmap bot). Anything that isn't "build and broadcast the boards" should be able to fail or slow down without touching them.

**Guard rails to add regardless**
- A per-route CPU budget in the health endpoint (already partly there in `jobs`), plus an alert when any single route exceeds ~20% of main-thread time over 5 minutes.
- A load test before a deploy: replay a busy morning's `/api/flow` request mix against staging and check that loop lag stays under 200ms.

## P1 — Price data at the open

### 1. The price brake's in-place cut doesn't work; the open ran on ~65s-stale prices
Evidence (UTC → ET is -4h):
```
13:25:02 [stream] 🔻 price brake · open · 175 → 75 price streams · lag 5s · stock prints 8/s
13:26:02 [stream] price brake · 60s after 175 → 75: stock prints 13/s (was 8/s) · lag 65s (was 5s) · stock inflow did not fall (if it never does, the drop frames are not reaching upstream · the cut still applies in full at the next respawn)
13:30:57 [stream] streaming spot · subscribed 75 tickers
```
- The unsubscribe/drop frames aren't reaching upstream. Inflow didn't drop and lag grew 13x. The cut only took effect when the stream respawned at 9:30:57, so prices were about 65s behind from ~9:26 through the bell.
- Fix options: (a) make the brake respawn the stream immediately at the new count instead of the in-place cut, or (b) move the brake earlier (~9:20 ET) so any respawn finishes before 9:30. Also find out why the drop frames aren't sent or acknowledged.

### 2. Unexplained stream respawn exactly 20 min later
```
13:30:57 subscribed 75 tickers
13:50:58 subscribed 75 tickers
```
- The respawns are 20m01s apart, which looks like a timer or watchdog, not a crash. Find out what triggers it. If it isn't intentional, remove it. If it is, log the reason on the respawn line.

### 3. Confirm the brake lifts at 10:00 ET
- The brake says "75 streams until 10:00 ET, then back up once the tape is current." Check that the release code exists and fires, then logs a line when it goes back up to ~175. If it depends on "tape is current" and lag never gets there, it could stay braked all day.
- **Evidence it didn't lift:** at 10:22 ET, coverage was *worse* than at 9:53, and there's no "back up" or re-subscribe line anywhere after 10:00:
  ```
  09:53 ET status: QUOTES 51/53 ok · 73% covered · stalest NDX 27.7s · p95 2227ms · 2 of 50 MISSED
  10:22 ET status: QUOTES 40/43 ok · 36% covered · stalest NDX 49.7s · p95 3457ms · 5 of 39 MISSED
  ```
  If the brake stayed at 75, all the other symbols keep depending on the struggling bulk quote path, which matches the drop in coverage.

### 4. The theta-proxy bulk quote drops whole batches when a few symbols have no data
```
[theta-proxy] bulk stock_snapshot_quote failed (batch 0): No data found for: stock_snapshot_quote(['CRNX', 'EQR', 'AVB'],nqb,None)
```
- Response sizes suggest the bulk calls come back only partly filled while still returning 200:
  - 4 symbols → 95 bytes (~24 B/sym)
  - ~900 symbols → 10,950 bytes (~12 B/sym)
  - ~190 symbols → 2,069 bytes (~11 B/sym)
- The server status line agrees: `QUOTES 51/53 ok · 73% covered`.
- Fix: when a batch hits "No data found," retry without the bad symbols (or skip them one at a time) and return everything else. Log the skipped symbols once, not on every cycle. Consider pulling CRNX, EQR and AVB from the universe if they never return data.
- Then check that coverage in the status line goes up.

### 4b. Verify NDX weeklies: the "WEEKLIES NOT IN VENDOR LIST" check may be a false positive
```
⚠️ NDX chain came back short · 46 expirations · soonest expiration is 18d out · WEEKLIES ARE NOT IN THE VENDOR LIST for this root
```
- **Caveat:** the same note fired for **SPX** at 12:02 ET (`soonest expiration is 18d out`), yet SPX clearly has today's expiration (node alerts: "SPX's Volt for today's expiration moved to 7675"). So the check probably reads the base root only and ignores the merged weekly root, which makes it a false positive. **Confirm on the live NDX board whether today's/this week's expirations are present.** If they are, fix the check. If they aren't: NDX's weekly/daily PM-settled options trade under the root **`NDXP`**, not `NDX`, much like SPX's are `SPXW`. Check how the chain builder handles SPX/SPXW, and do the same for NDX + NDXP, so the NDX board includes its nearest expirations. Without them, NDX 0DTE/weekly positioning is missing entirely.
- The same "weeklies not in vendor list" note fires for VRSK, IQV, AJG, MCO, MSI and others. Those may just not have weeklies, but check them against the exchange's weekly list before assuming.

### 5. The ~900-symbol bulk quote call times out on the scan cycle
```
13:53:45 ⚠️ quotes: theta-proxy /quotes?syms=QQQ unreachable (timeout)
13:53:59 ⚠️ quotes: theta-proxy /quotes?syms=SPX,NDX,…(~900 syms) unreachable (timeout)
status: price pull avg 853ms p95 2227ms max 8085ms · 2 of 50 MISSED the deadline · batch 4 · deadline 2600ms · stalest NDX 27.7s
```
- One GET with ~900 symbols in the query string runs about every 16–17s, which matches the ~17s scan wall tick. Sometimes it runs past the deadline.
- Split it into smaller parallel chunks (100–200 symbols), or switch to a POST body. The status line says `batch 4`, but something still sends the whole universe in one request, so find that path (retry or fallback?).
- Add response time (ms) to the theta-proxy access log so slow calls show up.

### 5b. The theta-proxy is saturating: 503s, core-index timeouts, and chain fallbacks (10:22 ET)
```
14:22:28 ⚠️ ThetaData unavailable, using Tradier fallback: theta-proxy /chain?sym=DOCS unreachable (timeout)
14:22:46 ⚠️ quotes: … /quotes?syms=SPX,NDX,…(~900 syms) → 503 busy
14:23:12 ⚠️ quotes: … /quotes?syms=SPX,NDX,…(~900 syms) unreachable (timeout)
14:23:22 ⚠️ quotes: … /quotes?syms=SPX,SPY,QQQ,IWM unreachable (timeout)
```
- The proxy is now returning **503 busy**, so it's hitting its own concurrency limit. Even the tiny 4-symbol SPX/SPY/QQQ/IWM call timed out.
- Chain refreshes, bulk quotes, per-symbol quotes, darkpool and ohlc all share the same proxy. The ~1s SPX/SPY/QQQ/IWM poll (#6) and duplicate darkpool calls (#8) add to that load.
- Fixes to look at:
  - Give index and stream-fallback quotes a priority lane, or a separate concurrency pool, so the big bulk call can't starve them.
  - Cap how many bulk requests can be in flight at once (never let a new one start while the last is still running).
  - Check the proxy's worker and concurrency settings on Render, and the Render instance size.
  - Back off on 503 instead of retrying immediately.
- The Tradier fallback for chains worked (DOCS refreshed via Tradier 4s later), so keep it. Also log how often it fires per hour.

### 6. SPX, SPY, QQQ and IWM are polled about every 0.5–1.5s even though they're streamed
- The access log shows `GET /quotes?syms=SPX,SPY,QQQ,IWM` about 20 times in 20 seconds. All four are on the stream.
- Find the loop doing this. If it's a staleness fallback, it's either firing wrongly or the stream isn't updating them. Either way, don't poll symbols the stream is delivering fresh.

---

## P2 — Server responsiveness

### 7. `oi verdict:snapshot` blocks the event loop for ~2.2s
```
⏱ oi verdict:snapshot held the loop 2.2s
🧱 worst 2.1s spanned … oi verdicts→oi verdict:days→oi verdicts→oi verdict:snapshot …
```
- Every API route waits behind it. The box has 32 cores and runs 4 workers, so move this job to a worker thread (or break it into chunks that yield between pieces).

### 8. Identical upstream requests aren't combined
- `darkpool?sym=SPY` fired twice 32ms apart, and 3 times in 8 seconds. `darkpool?sym=META` repeated within 16 seconds.
- Add in-flight coalescing: concurrent requests for the same key share one upstream promise. Also add a short TTL cache (about 5–15s) for darkpool.

---

## P3 — Correctness checks

### 9. RESOLVED: the "morning report" lines are mostly ALERT emails (a log label bug)
- Checked in code: `email.js` `sendReportEmail()` hard-codes the label `"morning report"`, and it's the shared send path for **every alert email**:
  - `nodealerts.js:1874`
  - `flowalerts.js:1543`
  - `agentalerts.js:308`
  - `scanwatch.js:469` and `:568` (Holy Grail)
  - `newsalerts.js:158`
  - the owner's kill alert (`server.js:17457`)
  - Idea Lab (`server.js:24449`)
- Real morning briefs come from `brief.js` (cursor-guarded, once per member per day).
- So the "duplicates" and "sending at 10:47" are alert fan-outs. The bursts line up with them, e.g. `SPX/volt → 17 members` + `IWM/volt → 11` at 14:38:22, followed by ~21 "morning report" lines at 14:38:24–29. `k…@gamateks.com` is a member with many email alerts on.
- Retries only happen on a 429 (not sent), so they can't cause duplicates.
- **Fix:** give each caller its own label (`sendReportEmail(email, subj, html, label)`, e.g. "node alert", "flow alert", "scan alert", "news alert", "morning brief"). Also log the alert kind, so an owner can tell what went out.
- **Still worth a look:** one member getting 3 alert emails in the same second (10:41:50) is three separate alerts firing at once. Consider batching per member per minute into one email, which would also ease the ~1,000 sends/day through the Resend queue.

### 10. RESOLVED: scan values `shape` / `premPace` were 0 only early in the session
- At 10:54 ET: `scan extras: 1025 boards · tight 1023 · shape 34 · levelFlow 27 · flowToday 30 · premPace 20`. Both are populating now, so the 9:54 zeros were just too little session data. Only the 2 boards that aren't building (`boards 1023/1025`) are still worth identifying.

### 11. The opened-or-closed summary contradicts itself
```
◉ opened-or-closed 2026-09-25: 4000 of 4000 resolved · 564 opened, 90 closed, 464 mixed, 529 unclear, 2353 unresolved
```
- It says "4000 of 4000 resolved" but also 2353 unresolved. Fix the label or the count.

---

## P4 — Log hygiene (quick wins)

12. The quotes-timeout warning and the theta-proxy access log print the full ~900-symbol list. Cap it at about 10 symbols plus `+N more`.
13. The `🫀 rss` heartbeat logs every 5s even when nothing changes. Log only when RSS moves ≥0.2GB, or once a minute.
14. `browser connected` lines show full customer emails, while morning-report lines mask them. Mask them in both.
15. **Moved up to P2, see #8b.**

## P2 — Reconnects and memory

### 8b. Socket reconnect loops from individual clients
```
14:22:22 browser connected — dominicchoi20@… → LIVE (156 watching)
14:22:22 browser connected — dominicchoi20@… → LIVE (157 watching)
14:22:24 browser connected — dominicchoi20@… → LIVE (154 watching)
14:22:24 browser connected — dominicchoi20@… → LIVE (155 watching)
```
- The same user connected 4 times in 2 seconds, and the viewer count jumps around (157→156→157→154→155). This also happened at 9:53. It looks like a client reconnect loop, not tabs.
- Checked in code: the server does **not** kick duplicate sessions for a user (it only sends `close(4001)` on an access change or admin sign-out). So this is client-side; see the cause below and the reconnect floor in #8d.

**A second, different pattern: `dimwobba@…` reconnects exactly every 60 seconds, all session.**
```
12:55:51 browser connected — dimwobba@… → LIVE (59 watching)
12:56:51 browser connected — dimwobba@…
12:57:51 …
… every minute at :51, without a gap, through …
14:26:51 browser connected — dimwobba@… → LIVE (153 watching)
```
- That's ~90 connects in 90 minutes, all landing at second :51 of each minute. There are also extra off-cycle ones (13:03:47, 13:03:57, 13:04:12, 13:10:58, 13:11:17, 13:11:47, 13:11:58, 13:12:12, 13:20:18, 13:57:05, 14:11:34). This user was also in the 9:53 and 10:22 ET logs.
- **Cause (found in the code): the client's STUCK-ON-LOADING self-heal in `web/src/Voltick.jsx` (~line 1650).**
  ```js
  const b = profilesRef.current?.symbols?.[boardSymRef.current];
  if (b && b.error) ...; if (b && b.summary) ...;
  const ready = b && Array.isArray(b.strikes) && b.strikes.length >= 2 && b.modes;
  if (ready) ...;
  if (Date.now() - emptySince > 15000 && Date.now() - lastKick > 60000) { ...; ws.close(); }
  ```
  It runs every 4s, has no market-hours gate, and is capped at one kick per 60s. The comment above it already records this exact failure ("kicks at t=20.01s, 80.04s, 140.06s · a 60.0s cadence, indefinitely"). That comment fixed the *summarised-board* case, but one hole is still open:
  - **If `b` is `undefined`**, it isn't an error and isn't a summary, so `ready` is false. The socket gets closed every 60s forever. `b` is undefined when the member's `boardSym` is a ticker the server never sends. The server drops it in `focusSyms(m, s => SYMBOLS.includes(s))` (server.js ~27050), so it never lands in `profiles.symbols`.
  - It also happens if a board arrives without `modes` or with fewer than 2 strikes and without `summary` (partial or cold build).
- **How the evidence fits:**
  - The cycle is 60.0s because of the `lastKick > 60000` gate. The 4s interval lines up exactly when timers drift slightly positive.
  - The connect lands 0.5–1s after the close because of the backoff after a "stable" socket, which is why every line shows :51.1–:51.7.
  - It ran before the open (from 8:55 ET) because this watchdog has no RTH check.
  - The tab must be visible (the `document.hidden` skip), e.g. left open on a second monitor.
  - The off-cycle connects (13:03:47, 13:10:58, 13:11:17…) are probably a second tab or device, or the other watchdogs.
- **Weekend link:** if the symbol universe changed this weekend, any member whose remembered board was removed will loop exactly like this. Check which `boardSym` dimwobba has saved, and diff `SYMBOLS` against last week's.
- **Fix:**
  1. Don't kick when `b` is undefined *and* the symbol isn't in the server's universe. Show "not covered" and fall back to SPY, or let them pick another board. Reconnecting can never fix a symbol the server won't send.
  2. Give the watchdog exponential backoff: 60s → 2m → 4m → 8m, cap it, and give up after ~3 kicks that didn't change the outcome. Reset only when the board actually becomes `ready`.
  3. Server side: on connect/close, log the socket's focus set (or the first focus message) and the close code, so a loop like this names its board in the log.
- **`dominicchoi20@…` is the same ~60s family, with two extra twists:**
  ```
  14:23:25.696 / 14:23:25.807   ← pair
  14:23:27.412 / 14:23:27.423   ← pair, ~1.6s later
  14:23:28.834 / 14:23:28.849   ← pair, ~1.4s later
  14:24:29.707 / 14:24:29.815   ← next burst, ~61s after the first
  … bursts at :25, :29, :33, :38, :44, :48, :52, :59 · period 61–65s, drifting +1–4s per cycle
  ```
  - **Cycle of 61–65s:** that fits the stuck-on-loading watchdog above. Its 4s interval plus the `> 60000` gate gives 60 or 64s. Check his saved board the same way.
  - **Pairs 1–170ms apart:** two sockets reconnecting in lockstep. That's most likely two tabs or windows opened at the same moment, so their 4s intervals are in phase and both kick on the same tick. Ruling out a double mount of the socket effect is also worth a minute. `connect()` lives in a `[]` effect in `Voltick.jsx` ~1369, and `App.jsx:510` is the one `<Voltick>` render.
  - **Three reconnects per burst, ~1.5s apart:** that means a fresh socket is dying within ~1.5s, twice, before one sticks. The code doesn't explain this. The server has no per-user duplicate kick (only `close(4001)` on access change or admin sign-out), and backlog `drop` can't fire on a 1-second-old socket. **Log the close code/reason and socket lifetime on the server's `close` handler** (server.js ~27145), and have the client include `?why=<last close reason>` on reconnect. That will name the killer.
  - Each burst is 6 full reconnects per minute from one member, about 360 an hour.
- **Side effect on owner stats:** `recordBoardOpen` counts each board once per *socket*, so every reconnect re-counts it. Looping members inflate the "least-used boards" numbers, and the `(N watching)` count jitters by 1–2.
- **Cost:** each kick is a full reconnect. That means `/api/me`, a full payload re-send, a summaries frame (~2MB before gzip) and an upstream price pull, once a minute per affected tab, on top of the proxy saturation in #5b.

### 8d. Rate-limit client reconnects: at most one dial per ~15s per tab (Brandon's call)
**Why they reconnect so fast today** (`web/src/Voltick.jsx` ~1338 and ~1469):
- `STABLE_MS = 5000`. Any socket that lived 5s counts as "good" and resets `attempts = 0`.
- After a reset, the next dial waits only **0.5–1s** (`cap = 1000 * 2**attempts`, jittered 50–100%).
- Three watchdogs close sockets the server is merely *slow* on: STUCK-ON-LOADING (15s), `DEAD_MS` (38–58s) and `DIAL_MS` (8–12s). So under load a socket opens, lives 5–15s, a watchdog kills it, the backoff resets, and it redials in under a second. Repeat.

**Change (client, `onclose` + `connect`):**
```js
const STABLE_MS = 60000;          // was 5000 · only a socket that lived a minute resets the backoff
const MIN_DIAL_GAP_MS = 15000;    // never dial more than once per ~15s per tab
let lastDialAt = 0;

const connect = () => {
  lastDialAt = Date.now();
  ws = new WebSocket(wsUrl());
  // ...unchanged
};

ws.onclose = () => {
  // ...unchanged up to the delay
  const lived = openedAt ? Date.now() - openedAt : 0;
  if (lived >= STABLE_MS) attempts = 0;
  openedAt = 0;
  const cap = 1000 * 2 ** Math.min(attempts, 5);
  let delay = Math.round(cap * (0.5 + Math.random() * 0.5));
  // one fast retry is allowed ONLY after a long, healthy connection (a real blip);
  // everything else waits out a jittered 15–20s floor since the last dial
  const quickOk = attempts === 0 && lived >= STABLE_MS;
  if (!quickOk) {
    const floor = MIN_DIAL_GAP_MS + Math.random() * 5000;   // jitter so tabs don't herd
    delay = Math.max(delay, floor - (Date.now() - lastDialAt));
  }
  attempts++;
  retryTimer = setTimeout(connect, delay);
};
```
- The watchdogs all go through `ws.close()` → `onclose`, so they inherit the floor automatically.
- Show "Reconnecting in Ns" on the pill during the wait, so a member isn't staring at an unexplained red RECONNECTING.
- Optional, server side: `ws.close(1013, "try again later")` a user already over N connects per minute, and have the client treat 1013 as "wait at least 30s".

**Trade-off:** a genuine drop after a short-lived socket now waits 15–20s instead of ~1s. A healthy member (socket up more than a minute) still reconnects in about a second. **Effect:** today's worst tabs dialled every 2–10s. Capped, each tab is at most ~4/min, so roughly a 3–5x cut in reconnect load during a stall.

### 8c. RSS growth, and a likely OOM restart at 11:48 ET
- RSS: 4.5GB (9:53) → 5.1GB (10:22) → 5.1GB (10:54, 203 viewers) → **5.5–5.6GB (11:40, 167 viewers)** → process restarted at 11:48 ET on the same build (`rss 2.9GB` after boot). It kept climbing while viewers fell, so something is growing, not load.
- Confirm the restart cause (Render events, `/api/admin/restarts`, the "killed in place" owner email) against the plan's memory limit.
- After close, take a heap snapshot or log the sizes of the major maps/caches: flow tape, per-socket state, payload cache, `_lastPromote`, `ws.opened` sets and similar. The reconnect churn (#8b/#8d) is a likely contributor if closed sockets leave state behind.

---

## What's healthy (don't touch)
- Chains: 1025/1025 loaded all day, `chainFails 0`, all symbols `ok`.
- Broadcast: the single-board delta (~80KB vs 14.4MB, ~180x smaller) is working, and every socket takes gzip.
- Compute pool: 4 workers, `timeouts 0 · misses 0`.
- The Tradier fallback for chains kicks in within seconds when the proxy times out.
- Resend emails are delivered (0 dropped, 0 gave up).
- Flow, node, agent and regime alerts are firing.
- Outside the stalls the engine is healthy: loop avg 13–60ms with 136–203 viewers.

## When done
Give me a short list of what changed per item number. Also list which log lines to watch at tomorrow's open to confirm each fix, especially items 1, 3, 4 and 5 between 9:20 and 10:05 ET.
