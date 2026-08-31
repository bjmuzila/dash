# LSE vault — what the data actually covers

Measured against the live vault on **2026-08-31**, not read off the docs. The
catalog's date spans and the SDK docstrings both overstate what you can pull,
in different ways. Re-run the probes at the bottom if the answers here start
looking wrong.

Backing code: `server-v2/_lib-lse.cjs`, routes at `/api/lse/*`
(`server-v2/api-router.js`), UI at `/owner/lse-data`.

---

## The one-line answers

| Endpoint | How far back |
|---|---|
| `/candles` (OHLCV) | per the catalog: stocks to 2003, FX to 2009, crypto to 2017 |
| `/options/chain` | now only — it is a live snapshot, not history |
| `/options/flow` | trailing **week** |
| `/options/candles` | **2026-01-02, hard floor**; expired contracts drop ~4 months after expiry |

Every call is capped at **5,000 rows**. "Download it all" is a walk, not a
request — `pageCandles()` / `pageOptionsFlow()` do that walk and stream CSV.

---

## Contract candles: the two limits that actually bite

### 1. The archive begins 2026-01-02

Four SPY LEAPs of wildly different ages all report their first bar within an
hour of each other on the first trading session of 2026:

```
2027-01-15   first = 2026-01-02T14:40:00Z
2027-06-17   first = 2026-01-02T14:36:00Z
2027-12-17   first = 2026-01-02T14:32:00Z
2028-01-21   first = 2026-01-02T15:40:00Z
```

A Jan-2028 contract was listed years ago. Its bars start in January 2026
anyway. **The vault started recording option minute bars on 2026-01-02 and
nothing exists before it.**

Do not be misled by the catalog. Its `options` rows show spans like
`2014-06-02 → 2026-08-28`, and the symbol picker displays them — but that is
the UNDERLYING's options history, a different dataset from the per-contract
bar archive. They are not the same number and the catalog will happily imply
twelve years of contract bars that are not there.

### 2. Expired contracts age out around four months

Probed SPY expiries, first hit across strikes 600–860 both rights:

| Expiry | Days since | Bars |
|---|---|---|
| 2026-09-18 (live) | — | 798 |
| 2026-08-28 | 3 | 15 |
| 2026-07-17 | 45 | 1013 |
| 2026-06-26 | 66 | 18 |
| 2026-05-15 | 108 | 583 |
| 2026-04-17 | 136 | **nothing** |
| 2026-03-20 | 164 | **nothing** |
| 2026-02-20 | 192 | **nothing** |

The cut is between 108 and 136 days past expiry — call it ~120 days and do not
build anything that assumes more. **Anything you want beyond that window has to
be recorded on our side as it happens**, the way the `server-v2` recorders
already do for GEX.

### Two probe results that look like data gaps and are not

`2026-06-19` and `2026-07-03` return nothing at any strike. Both are NYSE
holidays — Juneteenth on a Friday, and the observed holiday for a Saturday
July 4th. There is no expiry on either date, so there was never anything to
find. Check the calendar before filing a bug.

---

## Row shape

`/options/candles` rows are keyed on **`minute`**, not `timestamp`:

```json
{"ticker":"SPY260918P00655000","underlying":"SPY","strike":655,
 "expiry":"2026-09-18","contract_type":"put","minute":"2026-01-02T14:48:00Z",
 "dte":136,"open":23.56,"high":23.56,"low":23.56,"close":23.56,
 "volume":1,"premium":2356,"print_count":1,"iv_avg":0.2477,"delta_avg":-0.3206,
 "gamma_avg":0.0034,"theta_avg":-0.1139,"vega_avg":1.4947,"rho_avg":-0.9074,
 "underlying_price":686.15}
```

`/candles` uses `ts`, which `candles()` renames to `timestamp` (this API's
long-standing contract). The options endpoints were left un-renamed, which
broke the flow pager silently — its cursor read `timestamp` and got
`undefined`, so an `all=1` sweep stopped after one page and reported a complete
pull. `withTimestamp()` now mirrors whichever column the vault used onto
`timestamp` across chain, flow and contract candles. It mirrors rather than
renames, so the vault's own column still reaches the CSV.

## Bar counts are sparse, and that is real

The counts above are small because 600C is deep ITM on a name trading ~767 and
barely prints — a bar exists only where a trade did. An ATM contract will blow
past the 5,000-row cap in days. A thin count is not a broken pull.

---

## Re-running this

Off the VPS, against the live vault:

```bash
docker compose exec dashboard node -e '
const lse = require("/app/server-v2/_lib-lse.cjs");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const probe = async (exp, lo, hi, step) => {
  for (let k = lo; k <= hi; k += step) for (const t of ["call","put"]) {
    try { const r = await lse.optionCandles({ contract:"SPY", strike:k, expiry:exp, type:t, limit:5000, order:"asc" });
      if (r.length) return `${k}${t[0].toUpperCase()} bars=${r.length} first=${r[0].minute} last=${r[r.length-1].minute}`;
    } catch (e) {}
    await sleep(60);
  }
  return null;
};
(async () => {
  for (const e of ["2028-01-21","2026-09-18","2026-05-15","2026-04-17"]) {
    console.log(e.padEnd(12), await probe(e, 600, 860, 10) || "nothing");
  }
})()'
```

Bracket the strike range around where the underlying actually traded — the
first pass at this used strikes from remembered price history, missed every
contract by 15%, and read as "no data" when the data was there.
