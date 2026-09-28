# Voltick — post-close investigation + fixes (from Mon 2026-09-28 open logs)

You're working on the Voltick server and its theta-proxy (the Render service in front of ThetaData). Below are issues found in today's production logs around the open (9:20–9:55 ET). Work through them after the close tonight, in priority order.

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
- **A burst of ~26 morning-report emails at 10:38 ET,** right in the middle of this. See #9. If building those reports is CPU work on the main thread, it's adding to the problem.

- **Caveat on the gap:** a second log export skips `14:32:19 → 14:39:52` entirely, while the first one *has* lines from 14:35–14:38. So at least part of the "silence" is the log viewer dropping lines, not the process. Confirm with Render's metrics (not the log view) whether the process actually stalled. The member-facing 502 on `GET voltick.io/chart` (the HTML page itself) is real.
- **Reconnect storm right after (10:39–10:41 ET):** viewers went 145 → 169 → **199** in two minutes. Many members reconnected several times within seconds: `mitotakekei` ×7, `jose_f_mejia` ×8, `devinglover` ×5, `poppyohio` (delayed) ×6, plus `inforecruiter`, `ngnotz`, `dimwobba`, `dominicchoi20`. The "watching" count sat at 192 while connections poured in, so fresh sockets were dying almost as fast as they opened. People reloading after the 502 plus client dead-socket timers (38–58s of silence while the loop was held) all landed at once. CPU went to 272–342% (workers) with the main thread at 100%. It recovered by ~10:42 (loop avg 307ms, stalest 6s, 95% covered), but this storm is exactly the stall-re-arming pattern CLAUDE.md warns about.
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
- **Email retries likely cause the duplicates:** `email queued 996 · sent 994 · retried 57 · failed 2`. A retry after a timeout whose original send actually landed = a duplicate (#9). Use a Resend idempotency key per user-per-report-per-day.
- **Thin ladders:** `81 of 1023` boards have 0 strike rungs inside the expected move (NIO, OPEN, RR, HIVE, GRAB, PLUG, DSX…). WBD uses step 1 where 0.5 is listed (`stepVsListed 2`), so half the strikes are dropped. Check whether the weekend update changed strike-step selection.
- Healthy: all 1025 symbols `ok`, `chainFails 0`, compute pool `timeouts 0 · misses 0`, chainBank writes with 0 failures, prevCloses fresh.

**Find:**
1. What ran in the gap. Check Render metrics (CPU/memory/event-loop) and any `🧱 block` line emitted right after 14:35:10 for a single multi-second block.
2. **Whether `/api/flow` got heavier in the weekend update.** It was fine in last week's logs if it never appeared. Profile it with a typical member query. Cache or precompute its response per filter, or move it to the worker pool (`WORKERS` is on).
3. Move `node-alert check`, `calibration warm` and `lens-record` off the main thread, or chunk them so they yield.
4. Add a load-shed guard: when loop lag stays above ~500ms, pause the non-essential sweeps (calibration warm, darkpool sweep, morning reports) until it recovers.

**Rule reminder (CLAUDE.md):** broken during market hours means roll back to the last stable release first (Render → Deploys → Rollback). Diagnose after close.

---

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

### 9. Possible duplicate morning-report emails, and they went out late
```
13:53:42 📧 morning report → k…@gamateks.com (x2 in the same ms)
13:53:45 📧 morning report → k…@gamateks.com (again)
13:53:42 📧 morning report → c…@gmail.com (x2)
```
- The masking might hide different addresses at the same domain. Check the send records by full address for real duplicates, and add a per-user per-day send guard if needed.
- These went out at 9:53 ET, after the open. Check whether that's the scheduled time or a catch-up or re-run after a restart. Server uptime was 26587s, so it started around 2:30 ET.
- **Duplicates look confirmed:** at 10:41:50 ET `k…@gamateks.com` got **three** sends within 5ms (three different resend ids). There's also `email send (morning report) errored or timed out: fetch failed` at 10:40. Check whether a failed or timed-out send is retried while the original actually went through, and whether one user has several report subscriptions.
- Morning reports were **still going out at 10:22 and 10:23 ET** (`a…@gmail.com`, `b…@gmail.com`). So it's a trickle, not a batch at one scheduled time. Find out what sets the send time. Maybe it's per-user, or triggered on login/connect? A "morning report" should land before the open.

### 10. Scan values `shape` and `premPace` are 0 across all boards
```
scan extras: 1025 boards in 16935ms · tight 1023 · shape 0 · levelFlow 21 · flowToday 26 · premPace 0
status: chains 1025/1025 · boards 1023/1025
```
- If shape and premPace should be non-zero at 9:54 ET, something from the weekend broke them. Also identify the 2 boards that aren't building.

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

## P2 addendum

### 8b. Socket reconnect storm from one client
```
14:22:22 browser connected — dominicchoi20@… → LIVE (156 watching)
14:22:22 browser connected — dominicchoi20@… → LIVE (157 watching)
14:22:24 browser connected — dominicchoi20@… → LIVE (154 watching)
14:22:24 browser connected — dominicchoi20@… → LIVE (155 watching)
```
- The same user connected 4 times in 2 seconds, and the viewer count jumps around (157→156→157→154→155). This also happened at 9:53. It looks like a client reconnect loop, not tabs.
- Check the v3 client's socket reconnect logic for missing backoff, or several socket instances per page. Check whether the server kicks duplicate sessions for the same user and the client then reconnects, which would make a kick/reconnect ping-pong.
- Add exponential backoff with jitter on the client. On the server, log the disconnect reason and code.

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

### 8c. Watch RSS growth
- RSS went from 4.5GB at 9:53 ET to 5.0–5.1GB at 10:22 ET (+0.5GB in ~29 min). Viewers also rose from 140 to 152, so this may be normal load.
- After close, check whether RSS drops back when viewers leave. If it only climbs across the day, look for per-connection or per-board caches that never evict. The reconnect storm in #8b is a likely source, since each reconnect may leave its old state behind.

---

## What's healthy (don't touch)
- Chains: 1025/1025 loaded.
- Viewers: ~140.
- Broadcast: the single-board delta (79KB vs 14.4MB, 182x smaller) is working.
- Resend emails are going out and being delivered.
- Loop average is 57ms.
- RSS is flat at ~4.5GB.
- Flow alerts, agent alerts and regime alerts are firing.

## When done
Give me a short list of what changed per item number. Also list which log lines to watch at tomorrow's open to confirm each fix, especially items 1, 3, 4 and 5 between 9:20 and 10:05 ET.
