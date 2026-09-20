# `/whales` — the $1M+ print archive

**Route:** `/whales` (served at `voltick.cbedge.net/v3/whales`)
**Mounted by:** `src/App.tsx:201` — `<Route path="/whales" element={<Whales />} />`, behind `const Whales = lazy(() => import('@/pages/Whales'))` (`src/App.tsx:109`).
**Rail entry:** `src/shell/Shell.tsx:111` — `{ to: '/whales', label: 'Whales', icon: '🐋' }`. **No `prefetch`,** and the rail says why:

> The $1M+ archive. No prefetch: its one request carries the range and the filters, so a hover would warm a URL the click is unlikely to ask for.

**Server shell:** `app/v3/whales/route.ts` in the v2 repo.
**Why its own chunk** (`App.tsx:107`):

> the page pulls the Top Flow probe drawer with it, and nobody on any other route should pay for that.

**Source files**

```
src/pages/Whales.tsx                    the page: filters, tiles, prints table, lookup, roll-ups
src/pages/whales/alertsStore.ts         tracked contracts — the client half of /api/whale-alerts
src/pages/whales/TrackedAlertsCard.tsx  the card at the bottom, and the TRACK button both surfaces use
src/board/topFlow/ContractProbe.tsx     the probe: source picking, loadProbeBars, the panel, ProbeChart
```

Two more are read, not owned: `biasOf` / `biasTitle` from `src/board/topFlow/TopFlowCard.tsx`, and `fmtPremium` / `fmtStrike` / `fmtTime` / `roundStrike` from `src/data/flowMath.ts`.

---

## What it is, in one paragraph

`/whales` is the permanent record of every option print of a million dollars or more in premium, whole market. Where the Top Flow card answers "what is printing right now", this answers "has anyone been building this strike" — months of prints, filtered seven ways, with every roll-up computed in SQL over the whole filtered range rather than over the rows that fitted on screen. The page is one request: `/api/lse/whales` returns the range, a summary, the biggest print, per-session and per-ticker aggregates, expiry buckets, repeat strikes and up to 300 rows, all in one body. Clicking a print opens a **contract probe** in a 330px column beside the table — the same imperative-free inline-SVG chart the Top Flow card opens, drawing the contract's own bars with a dashed break-even at the fill, the high and low ringed, the last mark in a tinted pill on a right-hand rail, and the contract's volume sharing the x axis underneath. A **contract lookup** panel draws any strike, print or not. And a **tracked contracts** card at the bottom holds contracts you flagged — a row in Postgres against your login, not this browser, with your note beside it and the same probe in a drawer — which the server deletes on read once the contract has expired.

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/pages/Whales.tsx` | 1064 | `WhalesResponse`, the seven filters and their localStorage shape, the five tiles, the prints table with day headers, the contract lookup, the three roll-up cards, the track toggle |
| `src/pages/whales/alertsStore.ts` | 292 | `useWhaleAlerts()` — GET/POST/PATCH/DELETE on `/api/whale-alerts`, the lazy mark loader, `alertToRow`, `contractKey` |
| `src/pages/whales/TrackedAlertsCard.tsx` | 396 | The card, its three GROUP BY stops, `AlertRow` (inline note editing, the drawer), `TrackButton` |
| `src/board/topFlow/ContractProbe.tsx` | 830 | `probeUrls` / `loadProbeBars` (the two-source fallback), the panel with its four ranges and the expand portal, `ProbeChart` |

---

## The three design statements at the top of the page

### It is not a second table

> A whale is a row in `lse_top_flow_prints` with a big enough premium, and the only thing that makes it permanent is the retention sweep skipping it (see the WHALES ARE NEVER SWEPT note in `api-router.js`). **A second copy of the same print would be a second thing to keep in step, and the two would disagree the first time a side landed on one and not the other.**

### The totals are not the table's totals

> Every roll-up on this page is computed in SQL over the WHOLE filtered range; the table renders at most `rowCap` of them. That split is deliberate and is the same one `/proxy/flow-premsplit` makes for the flow page: **a total that only counts what fitted on screen is a number that lies quietly.** So the tiles can legitimately say $8.42B while the table shows 200 rows.

### "Of readable premium"

> Bought and Sold only count prints that carry a side. Mid fills and prints that were never classified are in the TOTAL and in neither bucket — see the capture note in `api-router.js` for why **a side cannot be recovered after the fact.** The tiles say so rather than letting the two numbers look like they should add up to the third.

---

## The data path

### One request

```
GET /api/lse/whales?from={ET ymd}&to={ET ymd}&min_premium={n}&sort={time|premium}&limit=300
                   [&ticker=XXX] [&type=C|P] [&action=BUY|SELL]
                   [&moneyness=otm] [&sides=all] [&max_dte=N]
```

Built in a `useMemo` keyed on every filter, and read through:

```ts
const q = useQuery<WhalesResponse>(url, { staleMs: 30_000, pollMs: 60_000 })
```

**Stale 30 s, poll 60 s.** `useQuery`'s poll skips a tick while `document.visibilityState === 'hidden'` and fires one immediately on the way back; a failed poll keeps the last good value on screen. `background` is not set.

`from` / `to` are ET calendar days from `etYmd()` (`en-CA` in `America/New_York`), `to` being today and `from` being `today − span.days`.

Three params are **conditional on a real value, not on truthiness**:

```ts
if (maxDte !== null) sp.set('max_dte', String(maxDte))   // 0 is a real value
if (moneyness === 'otm') sp.set('moneyness', 'otm')
if (showUnreadable) sp.set('sides', 'all')
```

### The response

```ts
interface WhalesResponse {
  range:   { from: string; to: string }
  summary: (Agg & { calls: number; puts: number; sessions: number }) | null
  biggest: WhaleRow | null
  sessions: SessionAgg[]     // { d, n, total, bull, bear, bought, sold }
  tickers:  TickerAgg[]      // { ticker, … }
  buckets:  Bucketed[]       // { bucket, n, total }
  repeats:  RepeatAgg[]      // { osi, ticker, strike, type, expiry, … }
  rows:     WhaleRow[]
  rowCap:   number
  whaleFloor: number
  sides?:  'directional' | 'all'
  maxDte?: number | null
  unreadable?: { n: number; premium: number }
  liveStats?: boolean
  error?:  string | null
}
```

`Agg` is `{ n, total, bull, bear, bought, sold }`, and the distinction between the two pairs is stated at the type:

> `bull`/`bear` are premium bucketed by **DIRECTION**; `bought`/`sold` by the **raw fill**. They are different questions and the server returns both — see the BULLISH/BEARISH note on `/api/lse/whales`.

`WhaleRow extends TopFlowRow` with one added field, `sessionDate`.

Two optional fields carry their own reasons:

> `unreadable` — What the readable filter is holding back. Zero when `sides === 'all'`. **Optional so a cached SPA talking to a server that predates it degrades to "no note" rather than throwing on a missing key.**
>
> `liveStats` — Vol/OI are live-only and are not archived — **null on every row here.**

### Failure

```tsx
{(d?.error || q.error) && (
  <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
    {d?.error ?? `Could not load the whale archive — ${q.error?.message ?? 'the request failed'}.`}
  </div>
)}
```

> `q.error` covers the case this page shipped with for months: the route did not exist, the fetch failed, and the archive rendered as an empty archive with nothing to say. **A failure has to look like a failure.**

The server's own `error` string wins when present.

### The probe's two sources

`ContractProbe` does its own fetching, and the choice of route is made **on the client**:

> A print from **TODAY** is drawn from `/proxy/option-history` — dxLink, the same feed the `/flow` drawer already rides, and the freshest thing available. Anything **older** comes from `/api/lse/contract-candles`, because option-history is anchored to the print's own session and will not reach back.
>
> The choice is made HERE rather than server-side for one reason: this component knows the print's timestamp, and the server would have to be told it anyway. Both routes answer the same `{ time, open, high, low, close, volume }` shape, so nothing below cares which one replied.

```ts
return ymd(row.ts) === ymd(Date.now()) ? [proxy, vault] : [vault, proxy]
```

**And it falls back either way on an EMPTY answer**, which is not belt-and-braces:

> a contract that expired inside the vault's ~120-day window is gone from dxLink long before it is gone from the vault, and a 0DTE that printed an hour ago is in dxLink before the vault has it. Whichever we ask first, the other one is sometimes the one holding the bars.

In the component the fallback is an `attempt` index (0 = the age-appropriate source, 1 = the other), reset on **every row and every range**:

> or a fallback taken for one contract sticks to the next.

```ts
useEffect(() => { if (attempt === 0 && q.data && bars.length === 0 && urls[1]) setAttempt(1) }, …)
```

`useQuery(url, { staleMs: 30_000 })` — no poll.

**The vault URL prefers `osi`** and falls back to the four-part form (`underlying`, `strike`, `expiry`, `type: 'call'|'put'`). The `end` is `Date.now() + 86_400_000` on the vault leg and `Date.now()` on the proxy leg.

**`roundStrike` is applied before the URL is built**, and the comment names the exact failure:

> Rounded, not raw: this value goes into `?strike=` below, and the vault matches on the exact string — `504.99999999999994` finds nothing.

`roundStrike(n) = Math.round(n * 1000) / 1000`.

`loadProbeBars(row, days = 2, signal?)` is the same logic outside a render, walking both URLs, skipping a non-`ok` response, filtering `b.close > 0`, and returning the first non-empty result — `[]` when neither has anything. Every fetch carries `credentials: 'same-origin'`.

> The Tracked contracts card has to load the SAME bars this panel loads, from outside a render — once to freeze the picture the moment a contract is tracked, and once per row to put a mark in the list. **Two copies of "which route holds this contract" is two things to keep in step, and the copy that drifts is the one that quietly stops finding anything.**

### Why the probe can legitimately have nothing

```ts
const VAULT_FLOOR_MS = Date.parse('2026-01-02T00:00:00Z')
const VAULT_EXPIRY_GRACE_DAYS = 120
```

> The vault drops expired contracts about 120 days after expiry and its archive begins 2026-01-02 (`md files/LSE-DATA-LIMITS.md`). Past either edge there is no chart to draw and never will be, so **the panel says which edge it hit instead of showing an empty frame that reads as a bug.**

### `/api/whale-alerts`

Four methods, all `credentials: 'same-origin'`:

| Call | Body | Notes |
|---|---|---|
| `GET /api/whale-alerts` | — | `{ alerts: WhaleAlert[] }`. **401 / 403 / 404 → `unavailable`**, and the card removes itself |
| `POST /api/whale-alerts` | `{ ...TrackInput, snapshot }` | returns `{ alert }` |
| `PATCH /api/whale-alerts/{id}` | `{ note }` or `{ snapshot }` | returns `{ alert }` |
| `DELETE /api/whale-alerts/{id}` | — | optimistic on the client |

> 401 is "not signed in", 404 is "this server predates the feature". **Neither is an error worth a red box on a page that works without the card** — both just take the card off the page.

Any other non-2xx throws `` `${status} ${statusText}` `` into `error`, which renders as a one-line warn banner inside the card.

---

## The seven filters

| Control | Kind | Default | Options |
|---|---|---|---|
| **Range** | `SegGroup` (unfolded) | `5d` | `1D` (0 days) · `5D` (4) · `1M` (29) · `3M` (89) · `ALL` (3650) |
| **Ticker** | free text input, `w-24`, uppercase | `''` | — |
| **FLOOR** | `SegMenu` (folded) | `1_000_000` | `≥$500K` · `≥$1M` · `≥$2.5M` · `≥$5M` |
| **STRIKE** | `SegMenu` | `all` | `ALL` / `OTM` |
| **DTE** | `SegMenu` | `null` | `ANY` (null) · `0DTE` (0) · `≤7` · `≤30` · `≤90` |
| **C/P** | `SegMenu` | `''` | `BOTH` / `CALLS` / `PUTS` |
| **FILL** | `SegMenu` | `''` | `EITHER` / `BUY` / `SELL` |
| **Sort** | `SegGroup` (unfolded) | `time` | `NEWEST` / `BIGGEST` |
| **SHOW UNREADABLE** | `Chip` | off | — |

Plus a **day chip** that appears only when a session drill-down is active.

### Folded, not spelled out

> Unfolded this row was nine segmented groups and twenty-four buttons, none of them labelled — **two different buttons read `ALL` (one a range, one a moneyness) four pixels apart.** Each group that has a real default now folds to a labelled pill showing its current value, and **a pill only wears the accent when it is OFF that default.** So "what is narrowing this list" is a colour scan instead of a nine-group read.
>
> Range and sort stay UNFOLDED: their options are peers, not a default and four deviations, so there is nothing to colour and folding them would cost a click to buy nothing.

`SHOW UNREADABLE` also stays a visible switch rather than becoming a sixth pill:

> it changes what the tiles MEAN, not just which rows are listed.

### The ≥$500K stop that the server will not serve

> The ≥$500K stop is offered even though the API **clamps `min_premium` UP to its own floor** (`TF_WHALE_FLOOR`, from `LSE_WHALE_FLOOR`, $1M by default): below that line the table keeps only the last seven days, so a lower ask would hand back a week dressed as an archive. Until that env var is lowered on the VPS, picking $500K returns the $1M list — and **rather than let the control look broken, the header says so.** Lower `LSE_WHALE_FLOOR` and both the note and the clamp go away on their own: **the page reads the floor off the response, it is not hardcoded here.**

The header note, shown only when `floor < d.whaleFloor`:

> ` · asked for $500K, archive floor is $1.00M`

with the tooltip:

> `Prints below the archive floor are only kept for seven days, so the API raises a lower ask rather than return a week of data dressed as the archive. Lowering LSE_WHALE_FLOOR on the server is what opens this up.`

### The DTE filter is AT PRINT TIME

> DTE AT PRINT TIME, not days from now — the archive is historical, so "0DTE" means it was a same-day expiry when it printed, which is the thing about the trade. **Prints with no readable DTE are dropped by this filter rather than let through; a row that cannot answer the question does not belong in a filtered list.** Values cross as strings because the control is keyed on strings, and `'null'` is the no-cap option — which is why the read back is an explicit string test.

`onChange={(v) => setMaxDte(v === 'null' ? null : Number(v))}`.

The DTE stops mirror the live Top Flow card deliberately: "the same filter should offer the same choices on both."

### The remaining tooltips, verbatim

- Range: `How far back the archive is read`
- FLOOR: `Hide prints below this dollar premium. The archive's own floor is the server's — a pick under it is clamped up, and the header says so when that happens`
- STRIKE: `Moneyness AT PRINT TIME — a call bought 40 points OTM at 10am was an OTM buy, whatever the index did by 3pm`
- DTE: `Days to expiry AT PRINT TIME`
- C/P: `Calls, puts or both`
- FILL: `Which side of the quote it filled on. This is the raw fill, NOT the direction — a SELL on a put is a bullish trade`
- Sort: `Row order`
- SHOW UNREADABLE: `Include prints whose side could not be read — mid fills, and ones that were never classified against a quote. Off by default: a print you cannot attribute to a buyer or a seller has no direction, so it cannot be in the bullish or bearish totals`
- Ticker input: `aria-label="Filter to one underlying"`

**Unreadable prints are filtered on the SERVER, before the row limit**, "so 300 rows means 300 readable prints."

---

## Saved filters — `cb-v3-whales:filters`

localStorage, per browser.

> The archive is a surface you come back to with the same question ("index whales, 0DTE, biggest first"), and **re-picking six controls every morning is the tax this removes.**

```ts
interface Saved { preset, floor, ticker, type, action, moneyness, sort, maxDte, showUnreadable }

const DEFAULTS: Saved = {
  preset: '5d', floor: 1_000_000, ticker: '', type: '', action: '',
  moneyness: 'all', sort: 'time', maxDte: null, showUnreadable: false,
}
```

**Two things are deliberately NOT saved:**

> `day` — the session drill-down from clicking a bar. It is scoped to a range you may not be on next time, so restoring it would open the page filtered to a date the current range does not contain — **an empty table with no visible cause.**
>
> `selectedId` — the open contract probe. The print may not even be in the filtered set on the next visit.

**Every field is validated ON ITS OWN:**

> A stored value from an older list falls back to that field's default rather than poisoning the whole object — **one retired premium stop must not wipe the other five settings.**

Validation per field: `preset` against `PRESETS`, `floor` against `FLOORS`, `ticker` re-normalised (`trim().toUpperCase().slice(0, 12)` — "so a hand-edited localStorage cannot put a 400-character ticker in the query"), `type` / `action` against their literal unions, `moneyness` / `sort` by explicit equality, `showUnreadable` by `=== true`, and:

```ts
maxDte: DTE_STOPS.some(x => x.value === (j.maxDte ?? null)) ? (j.maxDte ?? null) : DEFAULTS.maxDte
```

> `null` is a real stored value (no cap) and `0` is a real stored value (same-day only), **so this cannot be a truthiness test.**

A throw anywhere returns `DEFAULTS`:

> Private mode, blocked site data, or a corrupt entry. **Defaults are a working page; a throw here would be a blank one.**

Read through a **lazy initialiser**, not an effect:

> reading storage on first render means the first fetch already goes out with the saved filters, instead of one request at the defaults and a second one a tick later.

The write is a single `useEffect` over all nine values, wrapped in `try/catch` — "best-effort — the in-memory choice still drives this session."

---

## The header line

```
Every option print of $1.00M+ premium, kept permanently. Whole market.
 · 1,284 prints across 21 sessions · $8.42B total premium
 [· 0DTE only | · ≤30 DTE]
 [· asked for $500K, archive floor is $1.00M]
 [· 412 unreadable hidden ($612.40M)]
```

The floor comes from `d?.whaleFloor ?? 1_000_000`, not from a constant.

The unreadable note only renders when something is actually hidden:

> An archive that is quietly showing you less than it holds has to say so. **Only when something is actually hidden — a permanent parenthetical about a filter that is removing nothing is noise.**

Its tooltip:

> `These prints never got a readable side and never will — a side cannot be recovered after the fact. They are excluded from every total on this page. Turn on SHOW UNREADABLE to include them.`

The right-hand status is `loading…` before any data, then `` `${d.range.from} → ${d.range.to}` `` — the server's echoed range, not the client's request.

---

## The five tiles

| Label | Value | Ink | Sub |
|---|---|---|---|
| `Whale premium` | `money(summary.total)` | default | `{sessions} sessions · {n} prints` |
| `Bullish` | `money(summary.bull)` | `text-up` | `{p}% of readable premium` |
| `Bearish` | `money(summary.bear)` | `text-down` | `{p}% of readable premium` |
| `Biggest print` | `money(biggest.premium)` | `text-warn` | `{TICKER} {strike}{type} · {sessionDate}` |
| `Call / put split` | `{c} / {p}` | default | `by premium, not contracts` |

**The denominator is the two directional buckets, not `total`:**

```ts
const readable = (s?.bull ?? 0) + (s?.bear ?? 0)
const pctOf = (v) => readable > 0 ? `${Math.round((v / readable) * 100)}% of readable premium` : '—'
```

> Only prints that carry a side land in a directional bucket, so the denominator is those two and not `total`.

`Tile` is `rounded-md border border-line bg-surface px-3 py-2.5`; label `text-2xs font-bold uppercase tracking-[0.11em] text-faint`, value `tabular mt-1.5 text-xl font-semibold`, sub `mt-0.5 text-2xs text-faint`. The grid is `grid-cols-2 md:grid-cols-5`.

`money(v) = fmtPremium(Number(v ?? 0))` — `$8.42M` / `$612.4K` / `$940` with an ASCII `-` for negatives. `num(n)` is `toLocaleString()` or an em dash.

---

## The prints table

Eleven columns: **Time · Ticker · Contract · C/P · Side · Bias · DTE · Size · Price · Premium · Track.**

The card grows rather than being pinned:

> The prints card GROWS to the height of the right-hand rail rather than stopping at a fixed 480 and leaving a dead band under it with the tracked card stranded below. The table scrolls inside whatever height that leaves, with a floor (`min-h-[420px]`) so a short rail cannot squash it to a couple of rows.

The header is `sticky top-0 z-[1] bg-surface`. The card note reads `` `{n} shown of {N}{ · day}` ``.

### Day headers

```ts
const newDay = i === 0 || rows[i - 1]!.sessionDate !== r.sessionDate
```

> A day header every time the session changes, **so a multi-day range reads as days rather than one wall.**

The header row spans all eleven columns on `bg-surface2` and carries the session's own aggregate: `` `{Weekday, Mon D} · {n} prints · {money}` ``, looked up in `d.sessions`.

Each row is wrapped in a `<Fragment key={r.id}>`:

> Keyed on the PRINT, not the index: a fragment in an array needs its own key, and the row inside it is the thing that has an identity.

### Side vs Bias — two questions, two colour rules

```ts
const ink     = r.action === 'BUY' ? 'text-up' : r.action === 'SELL' ? 'text-down' : 'text-faint'
const bias    = biasOf(r)
const biasInk = bias === 'bullish' ? 'text-up' : bias === 'bearish' ? 'text-down' : 'text-faint'
```

> Side stays inked by where the FILL sat; the Bias cell is inked by what the trade means. Two questions, two colour rules — **a sold put is a bid-side fill (red Side) and a bullish position (green Bias), and collapsing that into one ink is what made this table misread.**

`biasOf(r)` (from `TopFlowCard`):

```ts
if (!r.action || !r.type) return null
if (r.type === 'C') return r.action === 'BUY' ? 'bullish' : 'bearish'
return r.action === 'BUY' ? 'bearish' : 'bullish'
```

The Bias cell renders `▲ BULLISH` / `▼ BEARISH` plus the raw verb kept faint beside it (`B C`, `S P`, …):

> the bias is the read, but you still need to see which of the four trades produced it.

Its tooltip is three-way:

- a real bias → `biasTitle(r, bias)`, one of eight sentences keyed on `{type, action} × {aggressive fill?}` — e.g. `Bought calls at or above the ask — BULLISH. Paying up for upside optionality; profits when the underlying rallies sharply.`
- `side === 'mid'` → `Filled between the bid and the ask — genuinely ambiguous, so no direction is called` (cell reads `n/a`)
- otherwise → `This print was never classified against a quote, and cannot be after the fact` (cell reads `—`)

`isAggressiveFill` is `side === 'ask' || side === 'above_ask'`; `where` is `at or above the ask` / `at or below the bid`.

The Side cell maps `above_ask` → `> ASK`, `below_bid` → `< BID`, anything else → `side.toUpperCase()` or an em dash.

The Bias header carries:

> `What the print says about the UNDERLYING, not the contract. Buying calls or selling puts is bullish; selling calls or buying puts is bearish`

### Cell formats

- **Time** `fmtTime(r.ts)` = `09:31:04 AM`, ET, `text-faint`
- **Ticker** `font-semibold text-fg`
- **Contract** `fmtStrike(strike)` in `text-fg` + `fmtExpiry(expiry)` (`Sep 19`, parsed at `T00:00:00Z`, UTC-formatted) in `text-faint`
- **C/P** `text-down` for P, `text-up` for C; `?` when null
- **DTE / Size / Price** `text-muted`, price at 2dp
- **Premium** `font-semibold`, inked `text-warn` at **≥ $10,000,000**, else by `biasInk`

### Track

```tsx
const k = trackKeyOf(r); if (!k) return null
<TrackButton compact tracked={trackedIds.has(k)} busy={busyKey === k} onClick={…} />
```

> `stopPropagation` lives in `TrackButton`: this cell is inside a row whose click opens the probe, and **tracking a print is not a request to open it.**

Header tooltip: `Keep this contract in Tracked contracts, at the bottom of the page`.

### Row click and the empty state

The row toggles `selectedId`, opening `ContractProbe` in a `w-[330px] shrink-0 border-l border-line` column. `title="Open the contract's chart"`. The selected row gets `bg-raised`.

Empty: **`No whale prints match these filters in this range.`**, or `Loading…` while `q.loading`.

### The day drill-down, and the chart that used to drive it

```ts
const rows = (d?.rows ?? []).filter((r) => !day || r.sessionDate === day)
```

> Clicking a bar in the session chart narrows the table to that day WITHOUT touching the range — **the tiles and the leaderboards stay on the range you chose, which is what makes the day readable AS PART of it.**

The chart itself is gone:

> The WHALE PREMIUM BY SESSION chart was removed **2026-09-14** — on a one- or two-session range it is a single 104px slab of green and red that says nothing the tiles do not. **The `day` drill-down it drove is kept below (state, row filter, day chip) so bringing the chart back is one block, not a rewrite.**

So `day` is reachable today only by… nothing. The state, the filter and the `{day} ✕` chip (`title="Showing one session — click to go back to the whole range"`) are all live and unreachable. Changing the range preset clears it (`setDay(null)`).

---

## The contract lookup

Four required fields and two optional ones, in a `Card` titled `Contract lookup` with the note `any strike, print or not`.

> The archive answers "what printed big"; this answers "what did THIS contract do", print or no print. They are different questions and the second one was only reachable by finding a whale row for the contract first — **so a strike nobody swung a million dollars at had no way in at all.**

**Deliberately not saved** with the filters:

> a lookup is a question you asked once, and restoring last week's expiry on open would put a dead contract in the panel every morning.

`lkTicker` seeds from `saved.ticker || 'SPY'`.

| Field | Sanitiser | maxLength |
|---|---|---|
| TICKER | `toUpperCase().slice(0, 12)` | — |
| STRIKE | `replace(/[^\d.]/g, '').slice(0, 9)`, `inputMode="decimal"` | — |
| EXPIRY | themed `DatePicker` | — |
| CALL/PUT | `SegGroup` | — |
| SIZE (opt) | `replace(/[^\d]/g, '').slice(0, 7)`, `inputMode="numeric"` | — |
| COST (opt) | `replace(/[^\d.]/g, '').slice(0, 8)`, `inputMode="decimal"` | — |

Enter submits from every text field.

**Why the expiry is a `DatePicker` and not `<input type="date">`:**

> that widget renders the OS calendar — a white Chrome popup on Windows — which inside this rail reads as a bug.

and the trigger is stretched with `[&>button]:w-full [&>button]:py-1 [&>button]:text-left`:

> The picker's `sm` trigger is content-width by design (it is a toolbar chip everywhere else). Here it is a FIELD, sitting under two full-width inputs.

`lkReady` requires a non-empty ticker, a finite strike `> 0`, and an expiry matching `/^\d{4}-\d{2}-\d{2}$/`. The button's title flips between `Draw this contract` and `Needs a ticker, a strike and an expiry`.

### The synthetic row

`openLookup()` builds a `WhaleRow` with `osi: null`, `side/action/sideReason/bid/ask/quoteAgeMs/vol/oi` all null, `dte: null`, `spot: null`, and:

- `size` — **blank means "not asked", not zero**: `Number.isFinite(sizeN) && sizeN > 0 ? Math.round(sizeN) : null`, "an empty size must leave POSITION off the hover box rather than print $0"
- `price` — same treatment
- `premium` — `size && price ? size * price * 100 : 0`
- `ts: Date.now()` — and the comment is careful about what that means:

  > `ts` is the probe's time anchor, **not a claim that something traded now** — it is what the 1D/3D/1W/1M windows are measured back from, so "now" is the only value that means "the most recent bars".

- `id` — `` `lookup:{T}:{expiry}:{strike}:{type}:{size}:{price}` `` — **keyed on the whole question, size and cost included:**

  > so editing any field remounts the probe rather than leaving the previous contract's bars on screen mid-fetch.

The probe is passed `entryAt={null}` here, so a typed cost draws as a rung with no marker:

> `ContractProbe` draws a CONTRACT, and everything else on its face — entry, size, premium — is about one PRINT. A lookup has no print, so those fields are null and the probe renders them as dashes, **which is the true answer: there is no entry here, only the contract's day.**

The placeholder when nothing is loaded:

> `Any contract, whether or not a whale ever touched it. Add a size and a cost and the hover readout carries what the position is worth and what it is up.`

### Tracking from the lookup

The TRACK button beside `LOOK UP` tracks **what the fields say, not what the panel is showing**:

> so a contract can be tracked without drawing it first, and an edited strike tracks the strike you just typed. Size and cost ride along when they are filled: **they are what turns a watch into a position the card can price.**


---

## The three roll-up cards

All three sit **under the lookup, in the same column**, and the layout note explains why:

> These were briefly a third child of a two-column grid, which wrapped them onto a new row and drew them full width under the table. **The grid has two columns, so it gets exactly two children.**

The outer grid is `grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]`.

### Where the size went — two rankings, not one

Note: the active range label (`1D` / `5D` / …).

> One list ranked by TOTAL with a split bar made the card answer "who printed the most", and left "who is the biggest bullish bet and who is the biggest bearish bet" to be eyeballed off the ratio of two colours in a seven-pixel bar. Those are the two questions actually being asked of it, so **they get a column each, sorted on their own side.**
>
> The two columns are NOT the same tickers in the same order, and that is the point — a name can top one and be absent from the other. **Each bar is scaled to the biggest value in ITS OWN column, so within a column the lengths compare; across columns they do not, which is why the dollar figure is always on the row.**
>
> Both columns draw from the same server list (the top tickers by total premium for the range), so **a name that never cracks that list cannot appear here even if it leads one side.** Widening it is a `tickers` limit change on `/api/lse/whales`, not a UI change.

Per column: `.filter(x => x.v > 0)` — and that filter has a reason too:

> A ticker with nothing on this side is not a zero-length bar, it is not on this side. Dropping it keeps the column short and honest instead of padding it with names at $0.

`max = Math.max(1, …list.map(x => x.v))`. Each row is a button toggling the ticker filter (clicking the same ticker clears it), with the tooltip `` `{T} — {money(v)} {bullish|bearish} of {money(total)} total · {n} prints` `` and a 5px bar. Empty: **`Nothing bullish in range.` / `Nothing bearish in range.`**

The two columns sit in a `grid-cols-2 gap-px bg-line` so the gap itself draws the divider.

### Expiry buckets

Note `by premium`. Fixed order, **rendered whether or not the server returned them**:

```ts
const BUCKET_ORDER = ['0DTE', '1-7', '8-30', '31-90', '90+']
buckets = BUCKET_ORDER.map(b => (d?.buckets ?? []).find(x => x.bucket === b) ?? { bucket: b, n: 0, total: 0 })
```

Each row is `grid-cols-[56px_1fr_74px]`, a 7px bar in `bg-accent` scaled to `bucketMax = Math.max(1, …totals)`, and the money on the right.

### Repeat strikes

Note `3+ whale prints, same contract`. Each row is a button that loads the contract into the lookup panel:

> the repeat strikes list, where every row IS a contract worth looking into.

`lookupContract(ticker, strike, expiry, type)` sets all four fields, **clears size and cost**, and builds a probe row with a shorter id (`lookup:{T}:{expiry}:{strike}:{cp}` — no size/price segments).

The strike passes through `Number()` first, and the comment says why:

> SQL hands this back as text (`MAX(payload->>'strike')`), so it carries the raw float's digits — back through `Number()` to round it like every other strike on the page.

The right-hand figure is the total, inked by whichever side is larger (`bull >= bear` → up), with the tooltip `` `{n} whale prints · {money(bull)} bullish vs {money(bear)} bearish` ``.

Empty: **`No contract was hit three times in this range.`**

---

## The contract probe

### The panel

Header: ticker (`text-sm` / `text-lg` when expanded) + a `{strike}{type}` chip in `border-warn/50 bg-warn/10 text-warn`, then the expand and close buttons. Under it, `fmtDate(expiry)` (`Sep 19, 26`).

The headline is a `▲`/`▼` glyph plus `{|pct|}%` at `text-2xl` / `text-4xl`, inked `text-up` / `text-down` / `text-muted`:

```ts
const last  = bars.length ? bars[bars.length - 1]!.close : null
const pct   = entry != null && entry > 0 && last != null ? ((last - entry) / entry) * 100 : null
const perCt = entry != null && last != null ? (last - entry) * 100 : null
```

Then two tabular lines:

```
IN {entry} → NOW {last} · {+|−}${perCt}/ct
SIZE {n} · PREM {money} [· VOL {n} · OI {n}]
```

**Vol/OI are omitted, not dashed, on this page:**

> Vol/OI are LIVE numbers, joined at serve time on the Top Flow card. An archived whale print carries neither — there is no "now" for it — so the pair is omitted rather than printed as two permanent dashes. **A dash means "this should have a value and does not"; on that surface they never will, which is a different statement.** Either both are present (Top Flow) or neither is (the archive).

The guard is `row.vol !== null || row.oi !== null`.

### The four ranges

```ts
RANGES = [ {'1d','1D',0}, {'3d','3D',2}, {'1w','1W',6}, {'1m','1M',29} ]
```

Default `1d`. `startMs = row.ts - span.days * 86_400_000` — measured back from **the row's own moment**, not from now, so a tracked print's `3D` means the three days around it.

The source badge on the right of the range row: `loading…` → `vault` (when `q.data?.source === 'lse'`) → `live` → `''`.

### The expand portal

```ts
const [expanded, setExpanded] = useState(false)
```

> The probe lives in a ~330px column inside the card, which is where a chart carrying an entry line, a high, a low, a price rail and a volume histogram stops being readable. The ⤢ pops the SAME panel out over the page.

While open: `Escape` closes it and `document.body.style.overflow` is set to `hidden` and restored on cleanup. The overlay is `createPortal(..., document.body)`:

> Portalled onto `<body>` because every ancestor — the probe column, the card, the board tile — clips or stacks, and an overlay drawn inside any of them is trimmed to that box. **The four properties that decide whether it is visible at all are inline rather than utilities**, for the same reason the notes clip lightbox does it: this node lives outside the app root, where a purged or shadowed class would leave it a 0×0 transparent box and the button would read dead.

Inline: `position: fixed`, `inset: 0`, `zIndex: 9999`, `display: flex` + centring, `padding: 24`, `background: color-mix(in srgb, var(--color-bg) 90%, transparent)`. The inner panel is `width: min(1100px, 94vw)`, `maxHeight: 92vh`, `overflowY: auto`, and stops click propagation. `role="dialog" aria-modal="true" aria-label="Contract probe"`.

The footer line gains `· click outside or press Esc to close` when expanded:

```
Option price (mark) · contract volume · entry @ {entry} · printed {etTime(row.ts)}
```

The expand icon is four corner arrows out, or in when collapsing — a 24×24 `viewBox` with `stroke="currentColor"`, `strokeWidth 2.2`, round caps and joins.

### `ProbeChart` — the picture

**The canvas is measured, not fixed**, and the bug that forced it is named:

> The svg is `width: 100%`, so a fixed viewBox means the whole picture is scaled by whatever box it lands in — and every size in here is in USER units. **A 320-unit viewBox in the ~990px pane of the tracked-alerts two-up drew the 9px labels at nearly thirty, which is the same bug as the board column drawing them at six, just the other way round.** Measuring the container and setting the viewBox width to it keeps one user unit at one CSS pixel.

```ts
W = clamp(cw ?? (wide ? 1000 : 320), wide ? 560 : 260, 1600)
H = wide ? clamp(W * 0.42, 300, 520) : clamp(W * 0.78, 190, 320)
```

> The fallbacks are the old fixed widths, so the first paint before the observer fires is the chart it always was rather than a collapsed one.

> Height tracks width so the picture does not letterbox, but it is **CAPPED**: a wide pane should get a wider chart, not a taller page.

Padding is keyed off the type scale, not a wide/narrow flag, "so the price rail always has exactly the room its own labels need":

```ts
PS   = wide ? 1.3 : 1
PADL = round(6 + 4 * PS)
PADR = round(42 + 14 * PS)   // wide enough for the last-mark pill (38*S) plus its 2-unit offset
PADT = round(12 + 6 * PS)
PADB = round(18 + 8 * PS)
GAP  = round(7 + 5 * PS)
volH   = round((H - PADT - PADB - GAP) * 0.24)
priceH = H - PADT - PADB - GAP - volH
```

Type scale:

```ts
S = wide ? clamp(1.15 + (W - 560) / 1600, 1.15, 1.45)
         : clamp(1    + (W - 320) / 1600, 1,    1.35)
```

> Type and glyph sizes are in USER units and the viewBox now displays at 1:1, so this is no longer undoing a stretch — it is a gentle step up on a roomier canvas, **capped so a wide pane gets slightly larger labels instead of the blown-up ones a fixed viewBox used to hand it.**

**The domain includes the entry:**

> The entry line is part of the picture, not an annotation on top of it — **a domain that excludes it draws it off-canvas.**

A flat series is widened by ±1, then padded by **13%** either side.

**Colours go through `style`, never presentation attributes**, and every label is `--color-fg`:

> Every label is `--color-fg` — not a white alpha. Chart type sits over a wash and a line, and an alpha that reads fine on a flat card turns to mud over the gradient. Colours go through `style`, never presentation attributes: **a `var()` in `stroke=""` does not resolve and the chart falls back to black.**

Font is `MONO = 'ui-monospace,Menlo,Consolas,monospace'`.

#### Marks

- **The high and low** are ringed (`r 2.6*S`, `strokeWidth 1.4*S`, no fill) and labelled `H 15.23` / `L 12.01`. Their labels use `edgeAnchor` / `edgeX` with `EDGE = 26 * S`:
  > The high or the low is often the FIRST or LAST bar, and a centred label there hangs half off the canvas — "H 15.23" rendered as "15.23" with the H clipped. **Anchor to the edge instead when it is close to one.**
- **The last mark** is a dot plus a `38*S × 15*S` pill at `rx 7.5*S`, filled `pillVar` (`--color-up` / `--color-down` / `--color-accent` when there is no entry) with **`--color-bg` ink**:
  > Pill type is the page ground, not white — it is on a solid green or red.
- **The entry** is a dashed rung plus a marker dot placed at `entryI`, whose flip/low-half logic keeps the `ENTRY {v}` label inside the plot:
  > flip when the point is in the last fifth of the canvas; sit above the dot when it is in the lower third.

`entryI` matches the print timestamp to the **nearest bar OPEN**:

> rather than the first bar at or after it, so a fill a few seconds either side of a boundary lands on the bar it belongs to. **Out of range (an entry before the window starts, on 3D/1W/1M) draws no marker — pinning it to bar 0 would put the dot on a minute it was not printed in.**

The slack is `max(60_000, span / max(1, n − 1))`.

#### Volume

Bars at `bw = max(1, ((W − PADL − PADR) / n) * 0.62)`, `vy(v) = vTop + volH − (v / vMax) * volH`, minimum height `0.6`. Everything is `--color-fg` at `opacity 0.28` except the **tallest** bar, which is `--color-accent` at full opacity:

> The bar the print landed in is the accent one — on a whale print it usually towers over its neighbours, and **that is the fastest tell between an opening trade and one that joined a busy contract.**

(`fillIdx = vols.indexOf(vMax)` — the tallest bar, not the bar at `entryI`.)

A dashed `1 3` line at `vAvg` sits at `opacity 0.3`.

**Which volume bars get a number:**

> Only the ones that stand out. **A number over every bar is a wall of type nobody reads**, and the reason to look at this pane at all is "which minute did the size go through".
>
> A bar qualifies on BOTH counts: **at least 3× the day's average bar, and at least a third of the tallest.** The average alone labels a dead contract's every twitch; the fraction alone labels nothing on a session with one enormous print. **Capped at four, biggest first, and a label is dropped if it would land on top of one already placed** (`minGap = 30 * (wide ? 1.75 : 1)`).

Disabled entirely below six bars. A label goes **inside** a bar when its top is within `11 * S` of the pane top:

> A tall bar's top is at the very edge of the pane, so its label goes INSIDE it in the page ground rather than above it in the gap, where it would collide with the price chart.

#### The hover readout

> A whale chart can answer a question a plain option chart cannot: **what the PRINT is worth at the minute under the cursor.** Size is on the row, so the position's value (mark × size × 100) and the open P/L against the entry are both arithmetic — and they are the numbers actually being asked for when someone scrubs a $9.78M print across the day.
>
> Every row is conditional on the input it needs. **A lookup has no entry and no size, so it renders as time + mark + volume and the box shrinks to fit rather than printing four dashes.**

| Row | Condition | Ink |
|---|---|---|
| `MARK` | always (`big`, 11·S) | fg |
| `VS ENTRY` `{±}${n}/ct` | `entry != null` | up / down |
| `BAR VOL` | always | fg |
| `POSITION` | `size > 0` | `--color-warn` |
| `OPEN P/L` | `size > 0 && entry > 0` | up / down |

Box: `BOXW = 132*S`, `HEADH = 20*S`, `ROWH = 15*S`, `BOXH = HEADH + rows*ROWH + 6*S`, `rx 6*S`, fill `--color-surface2`, stroke `--color-line`.

The header band is two rects — one rounded, one square below it — "so only the TOP corners round" — carrying the ET minute on the left and the signed percent on the right.

Position is clamped both ways:

> The box follows the cursor until it would cross the price rail, then stops — **a readout sliding under the rail labels is worse than one that stops moving.**

```ts
translate(min(W - PADR - BOXW - 2, max(PADL, x(hover) + 10)), PADT + 2)
```

The crosshair is a dashed `2 3` line at `opacity 0.4` from `PADT` to the bottom of the volume pane, plus a `3*S` dot with a `--color-bg` fill and a `--color-accent` ring.

`dollars(v)` is the probe's own local formatter: `$8.42M` / `$612K` / `$940`, **U+2212 for negatives**.

`onMove` maps the pointer into viewBox units and clamps the index to `[0, n−1]`.

#### The four "nothing to draw" states

Rendered instead of the chart when `bars.length < 2`, in this order:

1. `Loading…`
2. `This print is older than the contract archive, which begins 2026-01-02. There are no bars for it and there will not be.`
3. `This contract expired more than ~120 days ago and has aged out of the archive. Nothing to draw.`
4. `Could not load bars — {message}`
5. `No bars for this contract in the window.`

---

## Tracked contracts

### What a tracked contract is — and is not

> A tracked contract is a CONTRACT you flagged, **not a notification. Nothing fires, nothing emails:** the row sits in the card at the bottom of `/whales` with your note on it, and opening it draws the same probe the table draws. That is the whole promise, and it is worth being exact about because **"alert" reads like a trigger and this deliberately is not one.**

### Why the server and not localStorage

> Every other remembered thing on this page — the filters, the sort — is per browser, and that is right for a question you re-ask each morning. **A flagged contract is not that. You flag it on the desktop at 9:44 and you want it on the laptop at lunch**, so it is a row in Postgres keyed on the login and nothing else.

### Expiry removes the row

> Past its expiry a tracked contract is not a position, a watch or a question; it is a dead symbol whose bars the vault will drop anyway. **The SERVER deletes them on read**, so the list is self-cleaning and no client is responsible for remembering to prune.

### The shape

```ts
interface WhaleAlert {
  id, underlying, strike, optType: 'C'|'P', expiry,
  osi: string | null,
  source: 'whale' | 'lookup',
  printTs:      number | null,   // epoch ms of the print, null for a lookup
  printSize:    number | null,
  printPremium: number | null,
  entryPrice:   number | null,   // the fill, or a typed cost basis. Null = a watch with no cost
  note: string,
  snapshot: { bars: Bar[]; at: number; range: string } | null,
  createdAt: number,
}
```

`contractKey(a)` = `` `${underlying}|${strike}|${optType}|${expiry}` `` — "the same four fields the table is unique on".

`alertToRow(a)` dresses an alert as a `TopFlowRow`, and two fields carry notes:

> `id: 'alert:{id}'` — keyed on the alert, **so editing one never leaves another's bars on screen.**
>
> `ts: a.printTs ?? Date.now()` — the probe measures its 1D/3D/1W/1M windows BACK from this, so a tracked print anchors to the print and a tracked lookup anchors to now. **Using the print's own moment is what makes "3D" mean the three days around it.**

### The snapshot is taken BEFORE the POST

```ts
const bars = await loadProbeBars({ …, ts: t.printTs ?? Date.now() }, 2)
if (bars.length) snapshot = { bars, at: Date.now(), range: '3d' }
```

> The freeze is taken BEFORE the POST and sent with it, **so the picture stored is the one that was on screen when you pressed the button.** Taking it afterwards would be a second round-trip and a different minute.

A contract with no bars still tracks — "the note is the point."

Re-tracking an existing contract replaces the row in place and **keeps its mark**:

> its old mark is still the right one — dropping it would blank the column for nothing.

### Marks are lazy, and they say so

> There is no bulk "mark for these twenty contracts" route, and inventing one means a second thing that can disagree with the probe. So the card asks the SAME route the probe asks, once per tracked contract, **four at a time**, and the marks fill in as they land. **A row with no mark yet prints a dash rather than a zero.**

```ts
marks: Map<number, number | null>   // absent = not fetched; null = fetched, nothing there
```

Four workers race a shared index over `alerts.filter(a => !marks.has(a.id))`, each taking `bars[bars.length-1].close` or recording `null` on a throw.

> An alert that answers with no bars is recorded as null and **not asked again: retrying a contract the vault does not have is a request that will fail the same way every time.**

`marks` is deliberately **not** a dependency of the effect:

> every fill would re-run this and the `has()` filter above already makes each alert a one-shot.

The mark cell renders `…` (at `opacity-50`) while `undefined`, the number at 2dp when present, and an em dash for `null`.

### Optimistic delete

```ts
const before = alerts
setAlerts(cur => cur.filter(a => a.id !== id))
try { … } catch { setAlerts(before) }
```

> The row goes now and comes back if the server refuses. **A delete that sits there for 300ms reads as a dead button.**

### `resnapshot` — still in the store, not on screen

`resnapshot(id)` reloads the bars and PATCHes a fresh `{ bars, at, range: '3d' }`. Nothing in the card calls it any more (see the two-pane note below), but the snapshot itself is still taken on every track.

### The card

Header: `Tracked contracts` + `saved to your login` + `· {n} tracked` + `· loading…` before the first response, then three GROUP BY buttons on the right.

**Grouping is not filtering:**

> The three GROUP BY stops re-bucket the same rows and never hide any. That is the difference between this control and every other control on the page, and **it is why the header counts are per group rather than a single total that would not move.**

| key | Label | Title | Order |
|---|---|---|---|
| `tracked` | TRACKED | `Group by the day you flagged it, newest first` | date **descending**, via `9_999_999_999_999 − Date.parse(...)` as the sort key |
| `ticker` | TICKER | `Group by underlying` | A–Z |
| `expiry` | EXPIRY | `Group by expiry, soonest first — what dies next` | ascending |

And what each one answers:

> **TRACKED** — the default, because the question this card answers most mornings is "what was I looking at yesterday".
> **TICKER** — answers "how much am I carrying in NVDA" without reading eleven rows.
> **EXPIRY** — the one that reads like a to-do list, and on a page whose rows are deleted AT expiry it is also the running countdown.

The descending sort is inverted at the key rather than at the comparator "so the comparator below stays one line" (`sort.localeCompare` for all three).

Each group header spans nine columns on `bg-surface2` and carries `· {n}` plus `· {premium} behind them` when any row has a print premium. Rows inside a group sort by `createdAt` descending.

Day labels use `Today · Mon 9/15` / `Yesterday · …` / the bare date, all computed against ET.

### The nine columns

**(disclosure) · Contract · Expiry · Entry · Mark · Move · Note · Tracked · (remove)**

- **Contract** — ticker + a `{strike}{type}` chip (`border-down/50 bg-down/10 text-down` for P, `border-warn/50 bg-warn/10 text-warn` for C), with a `text-3xs` provenance line: `from print · 1,200 ct · $9.78M` or `from lookup · no print`.
- **Expiry** — `Sep 19, 26` plus a day countdown, inked `text-warn` at **`days <= 2`**:
  > A tracked contract is deleted the day after it expires, so this number is a countdown to the row leaving — **worth colouring.**
  `dte(expiry)` is calendar days in ET; **zero is today — the row still lives today.**
- **Entry / Mark** — 2dp or an em dash.
- **Move** — `{±}{pct}%` at one decimal (U+2212 for negatives), with the dollar move underneath at `text-3xs` when `entryPrice`, `mark` and `printSize` are all present: `(mark − entry) × printSize × 100`.
- **Note** — text until clicked, then an input:
  > An input that is always an input reads as a form. **This is a note you write once and glance at for weeks**, so it renders as text and becomes an input on click.
  `maxLength 500`, `autoFocus`, Enter commits, Escape cancels, blur commits. `commitNote` trims, slices to 500 and **only PATCHes when the value changed**. Placeholder `add a note…`.
- **Tracked** — `fmtTime(createdAt)`, ET, 12-hour.
- **Remove** — a `✕` that hovers to `border-down/50 text-down`, `title="Stop tracking this contract"`.

### ONE pane, the live one

The drawer used to be a two-up. The note explaining the removal is worth keeping whole:

> This was a two-up: live on the left, the bars frozen at the minute you tracked it on the right. **The frozen pane is gone.** The live probe already carries the entry rung, the marker at the moment of the print and the move against it, so "what has it done since" is legible in one picture — and the pair cost half the width to say it twice, at half the resolution, with a RE-SNAPSHOT button whose job was to keep the weaker half current.
>
> **The snapshot itself is still taken and still stored server-side — it is the one thing about a tracked contract that cannot be rebuilt later, so it keeps being recorded whether or not anything draws it.**

The remaining pane is labelled `Live — redrawn from the saved contract`, `min-h-[380px]`, keyed `` `live:{id}` ``, and gets `entryAt={a.printTs ?? null}`:

> A tracked LOOKUP has a cost basis but no moment it was paid at, so the entry draws as a rung with no marker — same contract the lookup panel makes.

### The empty state, verbatim

> `Nothing tracked yet. Hit **TRACK** on a print above, or on a contract in the lookup, and it lands here with its chart and a place for your note. Tracked contracts follow your login, not this browser — and a contract is removed on the day after it expires.`

Shown only when `ready && !alerts.length` — `ready` exists precisely to tell "empty list" apart from "not asked yet".

Error banner: `Could not reach your tracked list — {message}`.

When `unavailable`, `TrackedAlertsCard` returns `null` and the whole card leaves the page.

### `TrackButton`

> says which of the two states it is in rather than firing silently — **a save with no acknowledgement is a button people press twice.**

Three states: `Track` (`border-line text-muted`, hovering to accent) · `Tracked` (`border-up/50 bg-up/10 text-up`, hovering to the **down** colours because clicking again untracks) · `…` while busy (`cursor-wait`, `opacity-60`, `disabled`).

`compact` shrinks it to `px-1.5 py-0.5 text-3xs` for the table cell. It always `stopPropagation`s.

Titles: `Keep this contract in Tracked contracts` / `Already in Tracked contracts — click to stop tracking`.

### The toggle on the page side

```ts
const trackedIds = useMemo(() => { const m = new Map(); for (const a of alerts.alerts) m.set(contractKey(a), a.id); return m }, [alerts.alerts])
const [busyKey, setBusyKey] = useState<string | null>(null)
```

> `busyKey` is **the contract being written, not a boolean**: two rows pressed in the same second must not both go grey.

`trackKeyOf(r)` returns null unless all four identity fields are present:

> All four identity fields are nullable on a flow row, and a row missing any of them is not a contract the probe could draw either — so it is not one the card can hold. **The button is not rendered for those; this is the same guard, for the callers that are not it.**

`toggleTrack` untracks when the key is already present, otherwise tracks. For a lookup it sends `printTs: null`:

> A lookup has no print behind it. **Sending the synthetic "now" as a print time would make the row claim a fill that never happened.**

`if (busyKey) return` serialises writes across the whole page.

---

## Rendering, layout and performance

**DOM/canvas:** everything is HTML plus one inline `<svg>` per mounted probe. **No canvas, no `ChartFrame`, no `data-cb-layer`, no chart library, no rAF loop.** Non-negotiables 5, 6 and 7 have nothing to attach to.

**Layout:**

| Element | Constraint |
|---|---|
| Outer grid | `grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]` |
| Prints card | `flex-1` — grows to the rail's height |
| Table scroller | `min-h-[420px] overflow-auto`, header `sticky top-0 z-[1]` |
| Probe column | `w-[330px] shrink-0 border-l border-line` |
| Tracked drawer pane | `min-h-[380px]` |
| Expanded probe | `min(1100px, 94vw)` × `max 92vh`, `z-index 9999` |
| Tiles | `grid-cols-2 md:grid-cols-5` |
| Where-the-size-went | `grid-cols-2 gap-px bg-line` |
| Expiry bucket row | `grid-cols-[56px_1fr_74px]` |
| Repeat strike row | `grid-cols-[1fr_38px_74px]` |
| Tracked card | full width **under both columns** |

The tracked card's placement is deliberate:

> Full width UNDER both columns, not in the right rail: its rows carry a note and a two-pane chart, and **neither survives a 320px column.** Last on the page because it is the thing you scroll to on purpose — the archive above is what you came for, this is what you kept.

**Colours** are all token utilities — `text-up` / `text-down` / `text-warn` / `text-accent` / `text-fg` / `text-muted` / `text-faint`, `bg-surface` / `bg-surface2` / `bg-raised` / `bg-bg`, `border-line`. The probe's SVG uses `var(--color-…)` through `style`, never through a presentation attribute. Resolved values: `--color-up` `#3ddc8e`, `--color-down` `#ff6b7a`, `--color-warn` `#ffd166`, `--color-accent` `#2f6bff`, `--color-fg` `#e7ece9`, `--color-muted` `#e7ece9`, `--color-faint` `#c0c5c3`, `--color-line` `#1e2630`, `--color-surface` `#0e1216`, `--color-surface2` `#141a21`, `--color-bg` `#0a0d10`.

**Per-frame work:** one `pointermove` per mounted probe, setting a single `hover` index. `ResizeObserver` per probe. Nothing polls except the page's own 60 s `useQuery`, which pauses on a hidden tab.

**Virtualisation: none.** The table renders up to 300 rows (`limit=300`) plus a day header per session, inside a scroller. `Table` from `design/primitives` is not used at all; the table is hand-rolled because it needs day-header rows spanning all eleven columns and a sticky header above them.

**Requests, all together:** one `/api/lse/whales` (polled), one `/api/whale-alerts` GET at mount, one `loadProbeBars` per tracked row (four concurrent workers, once each), and one `useQuery` per mounted probe — at most two probes are ever mounted at once (the table's and the lookup's), plus one per open tracked drawer.

**Bundle:** its own route chunk, measured against `budgets.json`'s `route` line (**59 100 brotli bytes**), because it pulls `ContractProbe` in with it. `budgets.json` carries no per-page line; the relevant numbers are:

```
entry         38900
react         55000
route         59100    ← /whales is measured here
data          78000
css            8500
html           2600
totalInitial 108400
ratchet { slack: 0.15, enforce: false }
```

**Theme compliance.** Neither `src/pages/Whales.tsx`, nor `src/pages/whales/*`, nor `src/board/topFlow/ContractProbe.tsx` appears in `theme-baseline.json` — all four are at zero colour literals, which is why every ink in the probe's SVG is a `var(--color-…)` string reached through `style` rather than a hex.

**Phone:**

- `/whales` is **not** in `DESKTOP_TO_MOBILE` in `src/mobile/mobileNav.ts`, so a phone renders the desktop route inside the desktop shell. There is no `/m/whales`.
- The page's own responsive steps: tiles `grid-cols-2` below `md`, the outer grid one column below `xl` (so the right rail stacks under the prints card), and the filter row is `flex-wrap`.
- **Below `xl` the probe column is still `w-[330px] shrink-0` inside the prints card**, so an open probe takes a third of a phone's width beside an eleven-column table.
- Both tables are wide and live in `overflow-auto` / `overflow-x-auto` wrappers, so they scroll horizontally rather than crushing.
- The expanded probe is `min(1100px, 94vw)` and therefore usable on a handset, but its trigger is a 24×24 icon button.
- `useIsPhone()` is **not called anywhere in `src/pages/Whales.tsx`, `src/pages/whales/*` or `ContractProbe.tsx`.**
- The hover readout, the crosshair and most of the page's explanatory `title=` tooltips (the bias sentences, the floor-clamp note, the unreadable note, the roll-up row tooltips) are pointer-only.

---

## Status and empty-state messages, verbatim

| String | When |
|---|---|
| `loading…` | the range status, before the first response |
| `Could not load the whale archive — {message}.` | `q.error`, when the body carries no `error` of its own |
| *(the server's `error` string)* | when `d.error` is set — it wins |
| `Loading…` | the prints table, while `q.loading` with no rows |
| `No whale prints match these filters in this range.` | settled, zero rows after the day filter |
| ` · asked for {X}, archive floor is {Y}` | `floor < d.whaleFloor` |
| ` · {n} unreadable hidden ({premium})` | `!showUnreadable && unreadable.n > 0` |
| `Nothing bullish in range.` / `Nothing bearish in range.` | a side column with no ticker above $0 |
| `No contract was hit three times in this range.` | `repeats` empty |
| `Any contract, whether or not a whale ever touched it. Add a size and a cost and the hover readout carries what the position is worth and what it is up.` | the lookup with nothing drawn |
| `Loading…` | the probe, while fetching with no bars |
| `This print is older than the contract archive, which begins 2026-01-02. There are no bars for it and there will not be.` | `row.ts < VAULT_FLOOR_MS` |
| `This contract expired more than ~120 days ago and has aged out of the archive. Nothing to draw.` | past the 120-day grace |
| `Could not load bars — {message}` | the probe's fetch threw |
| `No bars for this contract in the window.` | both sources answered empty |
| `Nothing tracked yet. Hit TRACK on a print above, …` | `ready && !alerts.length` |
| `Could not reach your tracked list — {message}` | the alerts GET failed with a real status |
| *(the card is absent entirely)* | 401 / 403 / 404 on the alerts GET |
| `…` | a tracked row's Mark before its lazy fetch lands |
| `add a note…` | an empty note cell |
| `—` | every null figure, via `num` / `money` / `fmtExpiry` / the 2dp formatters |

---

## Gotchas

1. **The day drill-down is live and unreachable.** `day` state, the row filter and the `{day} ✕` chip all work; the session chart that set it was removed on 2026-09-14. Nothing on the page can produce a non-null `day` today. The code is kept so restoring the chart is one block.

2. **`≥$500K` is offered and cannot be served.** The API clamps `min_premium` up to `LSE_WHALE_FLOOR` ($1M by default), so picking it returns the $1M list. The header says so — and only because the page reads `whaleFloor` off the response rather than hardcoding it.

3. **The tiles and the table count different things, on purpose.** Every roll-up is SQL over the whole filtered range; the table shows at most `limit=300`. `$8.42B` beside `200 shown` is correct.

4. **Bullish + Bearish do not sum to Whale premium.** Mid fills and unclassified prints are in `total` and in neither bucket, and the percentages are `of readable premium` for exactly that reason.

5. **`bull`/`bear` and `bought`/`sold` are different questions on the same rows** — direction vs raw fill. The page uses the first pair everywhere; the second is returned and rendered nowhere.

6. **Side and Bias are inked by different rules in the same row.** A sold put is a red Side and a green Bias. Collapsing them "is what made this table misread".

7. **Vol/OI are omitted, not dashed**, on archived prints — the guard is `row.vol !== null || row.oi !== null`, so the pair is present on Top Flow and absent here.

8. **The probe picks its source on the client from the print's age**, and falls back on an EMPTY answer either way. A wrong `row.ts` sends it to the wrong route first.

9. **`attempt` is reset on every row AND every range**, because a fallback taken for one contract otherwise sticks to the next.

10. **`roundStrike` before the URL, always.** The vault matches `?strike=` on the exact string, so `504.99999999999994` finds nothing.

11. **`DTE` uses `maxDte !== null`, not truthiness** — `0` is a real value meaning same-day only. The `SegMenu` carries `'null'` as a string, so the read-back is an explicit string test.

12. **`loadSettings` validates every field independently.** One retired premium stop must not wipe the other five settings, and a hand-edited `ticker` is re-sliced to 12 characters.

13. **Settings are read in a lazy initialiser, not an effect** — otherwise the first request goes out at the defaults and a second follows a tick later.

14. **`day` and `selectedId` are deliberately not persisted.** Restoring either would open the page filtered to a date the current range does not contain, or pointing at a print no longer in the set.

15. **The lookup's probe id includes size and cost.** Editing any field remounts the probe rather than leaving the previous contract's bars on screen mid-fetch.

16. **A blank SIZE means "not asked", not zero.** An empty size leaves POSITION off the hover box instead of printing `$0`.

17. **The lookup's `ts` is `Date.now()`, and that is a time anchor, not a claim.** It is what the 1D/3D/1W/1M windows are measured back from.

18. **Tracking from the lookup sends `printTs: null`.** Sending the synthetic "now" would make the row claim a fill that never happened.

19. **The repeat-strike `strike` arrives as SQL text** (`MAX(payload->>'strike')`) and must go back through `Number()` or it renders with the raw float's digits.

20. **Both "where the size went" columns scale to their OWN max**, so bar lengths compare within a column and not across. The dollar figure is always on the row for that reason.

21. **A ticker that never cracks the server's top-`tickers` list cannot appear in either column**, even if it leads one side. Widening it is a server change.

22. **Expiry buckets are always rendered in `BUCKET_ORDER`**, filled with zeros for anything the server omitted.

23. **The alerts GET treats 401 / 403 / 404 as "not an error"** and removes the card. A signed-out user and a server that predates the feature look identical, by design.

24. **Marks are one-shot per alert for the life of the page.** A contract the vault cannot answer for is recorded as `null` and never retried.

25. **`marks` is deliberately excluded from its own effect's deps.** Adding it back would re-run the loader on every fill.

26. **`busyKey` is a contract key, not a boolean**, and `if (busyKey) return` serialises every write on the page — two TRACK presses in the same second give one write and one silent no-op.

27. **The delete is optimistic and silently rolls back** on a server refusal; there is no message for that path.

28. **`resnapshot` still exists in the store and is called by nothing.** The frozen pane it served was removed; the snapshot is still taken on every track and stored server-side.

29. **The tracked row's dollar move needs all three of `entryPrice`, `mark` and `printSize`** — a lookup tracked without a size shows a percent and no dollars.

30. **`dte(expiry)` is calendar days, ET, with zero meaning today.** The `<= 2` warn colour is a countdown to the server deleting the row, not to expiry itself.

31. **The note commit path is `blur` OR `Enter`, and Escape discards.** `commitNote` trims, slices to 500 and only PATCHes on a real change — so a blur with no edit costs nothing.

32. **`ProbeChart` measures its container and sets the viewBox width to it.** A fixed viewBox drew 9px labels at nearly thirty in a 990px pane and at six in a board column. Any future caller that gives it a box with no measurable width falls back to 320 (or 1000 when `wide`).

33. **The volume accent bar is the TALLEST bar, not the print's bar.** `fillIdx = vols.indexOf(vMax)`.

34. **Volume labels need `3× average` AND `≥ ⅓ of the tallest`**, are capped at four, and are dropped on collision. Disabled entirely below six bars.

35. **The entry marker is the NEAREST bar open within a slack window**, and draws nothing at all when the entry falls outside the range — so a 1M window on a fresh print shows the rung and no dot.

36. **The expanded probe's four positioning properties are inline, not utilities**, because it portals outside the app root where a purged class would leave it a 0×0 transparent box.

37. **`document.body.style.overflow` is saved and restored** around the expanded probe — nesting two expands would clobber the saved value.

38. **The page has no `prefetch` in the rail**, and the reason is in the NAV comment: the one request carries the range and the filters, so a hover would warm a URL the click is unlikely to ask for.

39. **No virtualisation.** 300 rows plus day headers, all mounted, inside a `min-h-[420px]` scroller.

40. **Below `xl` the probe column is still a fixed 330px inside the prints card**, so on a phone an open probe eats a third of the width beside an eleven-column table — and `/whales` has no mobile route to fall back to.
