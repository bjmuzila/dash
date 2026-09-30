# Voltick Health Monitoring

How to use the server's health/status JSON to confirm streams and tickers are still flowing, and alert when they aren't.

> This is **not** the log feed. It's a live state snapshot. Poll it on a timer and alert on the fields below. Logs (Render API / CLI / log streams) are for figuring out *why* something stopped. This endpoint is for noticing *that* it stopped.

---

## 1. Endpoint

```
GET <HEALTH_URL>
```

Replace `<HEALTH_URL>` with the route that returns the JSON (the one with `ok`, `build`, `flowTape`, `streamPrices`, …).

- Poll every **30–60s** during market hours, every **5 min** off-hours.
- One request covers every stream and ticker, so there's no per-symbol polling.
- A failed request (timeout, non-200, invalid JSON) is itself an alert.

---

## 2. Alert rules

### Critical: data has stopped

| Field | Healthy example | Alert when | Meaning |
|---|---|---|---|
| request | 200 + JSON | fails / times out | Server down or wedged |
| `ok` | `true` | not `true` | Server says it's unhealthy |
| `flowTape.lastPrintAgeSec` | `1` | `> 30` (market hours) | Options flow tape stalled |
| `flowTape.newestRowAgeSec` | `1` | `> 30` (market hours) | No new flow rows written |
| `flowTape.coverage.verdict` | `"ok"` | not `"ok"` | Flow coverage check failed |
| `flowTape.coverage.silent` | `[]` | non-empty | Specific sentinel names went quiet |
| `flowTape.coverage.alarmed` | `false` | `true` | Server's own flow alarm tripped |
| `streamPrices.freshestAgeMs` | `94` | `> 10000` | Price stream stalled |
| `streamPrices.behind` | `false` | `true` | Price stream falling behind |
| `streamPrices.lastError` | `null` | not null | Price stream error |
| `priceLane.stream.on` | `true` | `false` | Price stream switched off |
| `tradierQuotes.lastOkAgoSec` | `10` | `> 120` | Tradier quote batches stopped |
| `symbols.*` | all `"ok"` | any not `"ok"` | Per-ticker failure (list which) |
| `chainFails.total` | `0` | `> 0` | Option chain loads failing |
| `compute.timeouts` | `0` | increasing | Worker jobs timing out |

### Warning: degraded, not dead

| Field | Healthy example | Warn when | Meaning |
|---|---|---|---|
| `uptimeSec` | `17351` | lower than last poll | Process restarted (crash / deploy) |
| `build.commit` | `0d3d915` | changed | New deploy went out (info only) |
| `fallback.chainsParked` | `false` | `true` | Chains parked on fallback |
| `loop.maxMs` | `934` | `> 2000` sustained | Event loop blocking |
| `priceLane.hot.missed` | `0` | `> 0` | Hot-lane price deadlines missed |
| `priceLane.stalestViewed.ageMs` | `10494` | `> 60000` | A ticker someone is viewing is stale |
| `flowTape.streamRestarts` | `0` | increasing | Flow stream reconnecting |
| `flowTape.feedErrors` | `243` | jumps > ~50 between polls | Feed errors spiking (alert on rate, not total) |
| `rssMb` | `5946` | `> 85%` of box RAM | Memory pressure / OOM risk |
| `email.failed` / `gaveUp` | `3` / `0` | `gaveUp > 0` | Emails being dropped |
| `samplerFails` | `0` | `> 0` | Internal sampler failing |

### Daily checks (run once, ~9:00 ET)

| Field | Expect | Meaning if not |
|---|---|---|
| `prevCloses.fresh` | `true`, `day` = today | Previous closes not loaded |
| `dayRange.seeded` | = `dayRange.boards` | Day ranges not seeded |
| `chainBank.writeFails` | `0` | Chain bank not persisting |
| `shelf.saveFail` | `null` | Board shelf not saving |
| `backup.newest.ageHours` | `< 26` | Nightly backup missed |
| `backup.offBox.last` | not null | Off-box backup never uploaded |

---

## 3. Items flagged in the 2026-09-30 snapshot

- **`tradierQuotes.lagMs: 840000`, `treatedAsLive: false`.** Tradier quotes are ~14 min behind, which looks like delayed data. Fine if intentional. If not, check the data entitlement.
- **`backup.last: null`, `backup.offBox.last: null`.** Newest local backup is 12.8h old, but no backup or off-box upload is recorded since boot. Confirm off-box uploads to `voltick-backups` are actually landing.
- **`rssMb: 5946` (peak `6149`).** ~6 GB resident. Check headroom against the host's RAM.
- **`flowTape.feedErrors: 243`.** Stream is healthy (`lastPrintAgeSec: 1`), but errors are accumulating. Track the rate.
- **`thinLadders.thin: 130 of 130`** and **`shortChains`** (CROX, WING, SYF, …). These are informational: vendor doesn't list weeklies for those roots. Not a stream problem, so don't alert on them.

---

## 4. Market-hours gating

Staleness rules only apply while data *should* be flowing:

- **Options / equities:** Mon–Fri, 9:30–16:00 ET (add a 2–3 min grace after open).
- **Off-hours:** only alert on request failures, `ok !== true`, restarts, memory, and the daily checks.
- Skip market holidays (keep a small list, or skip when `prevCloses.day` isn't today).

---

## 5. Watchdog script (Node)

Drop-in starting point. It needs Node 18+ (built-in `fetch`) and a Discord webhook, or you can swap in email or push.

```js
// health-watchdog.js
const HEALTH_URL = process.env.HEALTH_URL;
const WEBHOOK    = process.env.DISCORD_WEBHOOK;
const EVERY_MS   = 30_000;

let lastUptime = null;
let lastFeedErrors = null;
const active = new Set(); // alerts currently firing (avoid spam)

function marketOpen(d = new Date()) {
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 33 && mins <= 16 * 60;
}

function check(h) {
  const out = [];
  const live = marketOpen();
  if (h.ok !== true) out.push('ok is not true');

  if (live) {
    if (h.flowTape?.lastPrintAgeSec > 30) out.push(`flow tape stale ${h.flowTape.lastPrintAgeSec}s`);
    if (h.flowTape?.coverage?.verdict !== 'ok') out.push(`flow coverage ${h.flowTape?.coverage?.verdict}`);
    if (h.flowTape?.coverage?.silent?.length) out.push(`flow silent: ${h.flowTape.coverage.silent.join(',')}`);
    if (h.streamPrices?.freshestAgeMs > 10_000) out.push(`price stream stale ${h.streamPrices.freshestAgeMs}ms`);
    if (h.streamPrices?.behind) out.push('price stream behind');
    if (h.tradierQuotes?.lastOkAgoSec > 120) out.push(`tradier stale ${h.tradierQuotes.lastOkAgoSec}s`);
  }
  if (h.streamPrices?.lastError) out.push(`price stream error: ${h.streamPrices.lastError}`);
  if (h.chainFails?.total > 0) out.push(`chain fails: ${h.chainFails.total}`);

  const bad = Object.entries(h.symbols || {}).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}=${v}`);
  if (bad.length) out.push(`symbols not ok: ${bad.slice(0, 20).join(', ')}${bad.length > 20 ? ' …' : ''}`);

  if (lastUptime != null && h.uptimeSec < lastUptime) out.push(`RESTARTED (uptime ${h.uptimeSec}s, commit ${h.build?.commit})`);
  if (lastFeedErrors != null && h.flowTape?.feedErrors - lastFeedErrors > 50) out.push(`feedErrors spiking (+${h.flowTape.feedErrors - lastFeedErrors})`);
  lastUptime = h.uptimeSec;
  lastFeedErrors = h.flowTape?.feedErrors ?? lastFeedErrors;

  return out;
}

async function notify(msg) {
  console.log(new Date().toISOString(), msg);
  if (WEBHOOK) await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: msg }) }).catch(() => {});
}

async function tick() {
  let problems;
  try {
    const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    problems = check(await r.json());
  } catch (e) {
    problems = [`health request failed: ${e.message}`];
  }

  const now = new Set(problems);
  for (const p of now) if (!active.has(p)) await notify(`🔴 ${p}`);
  for (const p of active) if (!now.has(p)) await notify(`🟢 recovered: ${p}`);
  active.clear(); now.forEach(p => active.add(p));
}

tick();
setInterval(tick, EVERY_MS);
```

Run it:

```bash
HEALTH_URL="<HEALTH_URL>" DISCORD_WEBHOOK="<webhook>" node health-watchdog.js
```

**Where to run it:** somewhere *other* than the server it watches (a second small box, a cron job, or an uptime service), so a dead server can't silence its own alarm.

> Note: the "recovered" matching is by exact message text, so alerts with changing numbers (e.g. `stale 45s` → `stale 60s`) re-fire. If that's noisy, key alerts by a fixed id (`flow-stale`, `price-stale`, …) and keep the number only in the message.

---

## 6. Quick manual check

```bash
curl -s <HEALTH_URL> | jq '{ok, uptimeSec,
  flowAge: .flowTape.lastPrintAgeSec, flow: .flowTape.coverage.verdict,
  priceAgeMs: .streamPrices.freshestAgeMs, behind: .streamPrices.behind,
  tradierAgo: .tradierQuotes.lastOkAgoSec, chainFails: .chainFails.total,
  badSymbols: [.symbols | to_entries[] | select(.value != "ok") | .key],
  rssMb, backupAgeH: .backup.newest.ageHours}'
```
