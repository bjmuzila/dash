# Prompt — owner-vite Backtests page: prune 3 panels, add GEX Change Summary

Repo: `spx-gex-dashboard-tt-fixed`. Two files change. Do not touch `app-vite/`,
`app/`, or nginx — `/api/*` already proxies upstream from the owner site.

---

## 1. `owner-vite/src/pages/Backtests.tsx` — remove three panels

Delete these three `<Panel />` blocks from the `Backtests()` component, including
the entire `help={...}` JSX block on the third one:

- `title="DEX pre-flip alert"` / `test="dex-preflip"`
- `title="Gamma wall — pin / reject"` / `test="gamma-wall"`
- `title="GEX / DEX flip cross → MFE/MAE"` / `test="gex-dex-cross"`

Keep: `cb-size`, `confidence`, `normalized-gex`.

Leave the backend handlers for those three tests in place in `api-router.js` —
this is a page-level removal only, the routes stay callable.

Do not delete the `help` prop from the `Panel` component signature. The new panel
in step 3 uses it, so `ReactNode` stays imported and used.

---

## 2. `server-v2/api-router.js` — add a `gex-change-summary` test

Inside the existing `/api/backtests` block (the one starting with the comment
`// /api/backtests?test=... — owner-only research panels`), alongside `cbSize`,
`confidence`, `dexPreflip`, `gammaWall`, `normalizedGex`, `gexDexCross`, add:

```js
// Consolidates gex_change_top (top-N very-strong strikes per 30m slot) from
// slot/strike rows into one row per ticker — the same rollup we run by hand
// against the VPS with psql.
const gexChangeSummary = async (dateArg) => {
  // Resolve the session: explicit YYYY-MM-DD, else the most recent day on record.
  let date = String(dateArg || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [r] = await libDb.queryAll(`SELECT max(date) AS d FROM gex_change_top`);
    date = r?.d || '';
  }
  if (!date) return { note: 'gex_change_top is empty.', by_ticker: [], detail: [] };

  const rows = await libDb.queryAll(
    `WITH src AS (SELECT * FROM gex_change_top WHERE date = ?),
     strikes AS (
       SELECT symbol, count(*) AS n_strikes,
              string_agg(lbl, ', ' ORDER BY strike) AS strike_list
       FROM (SELECT DISTINCT symbol, strike,
                    to_char(strike, 'FM999990.##') AS lbl FROM src) x
       GROUP BY symbol
     )
     SELECT s.symbol,
            count(*)                                  AS hits,
            count(DISTINCT s.slot)                    AS slots,
            min(s.slot)                               AS first_slot,
            max(s.slot)                               AS last_slot,
            min(s.rank)                               AS best_rank,
            max(s.score)                              AS best_score,
            sum(s.latest_chg)                         AS net_chg,
            sum(abs(s.latest_chg))                    AS abs_chg,
            count(*) FILTER (WHERE s.strike > s.spot) AS above_spot,
            count(*) FILTER (WHERE s.strike < s.spot) AS below_spot,
            count(DISTINCT s.expiry)                  AS n_expiries,
            min(s.expiry)                             AS near_expiry,
            k.n_strikes, k.strike_list,
            max(s.spot)                               AS spot
     FROM src s JOIN strikes k ON k.symbol = s.symbol
     GROUP BY s.symbol, k.n_strikes, k.strike_list
     ORDER BY abs_chg DESC`, [date]);

  const detailRows = await libDb.queryAll(
    `SELECT symbol, strike, expiry,
            count(*)               AS hits,
            count(DISTINCT slot)   AS slots,
            min(slot)              AS first_slot,
            max(slot)              AS last_slot,
            sum(latest_chg)        AS net_chg,
            sum(abs(latest_chg))   AS abs_chg,
            max(abs(latest_chg))   AS biggest_hit,
            min(rank)              AS best_rank
     FROM gex_change_top WHERE date = ?
     GROUP BY symbol, strike, expiry
     ORDER BY abs_chg DESC`, [date]);

  const M = (v) => round(num(v) / 1e6, 2);

  const by_ticker = rows.map((r) => {
    const abs = num(r.abs_chg), net = num(r.net_chg);
    const callShare = abs > 0 ? Math.round((100 * ((abs + net) / 2)) / abs) : 0;
    return {
      symbol: r.symbol,
      '$M abs': M(r.abs_chg),
      '$M net': M(r.net_chg),
      'call %': callShare,
      side: callShare >= 70 ? 'call/resist' : callShare <= 30 ? 'put/support' : 'two-sided',
      hits: num(r.hits),
      slots: num(r.slots),
      window: `${r.first_slot}–${r.last_slot}`,
      'best rank': num(r.best_rank),
      above: num(r.above_spot),
      below: num(r.below_spot),
      strikes: r.strike_list,
      expiries: num(r.n_expiries),
      'near exp': r.near_expiry,
      spot: round(num(r.spot), 2),
    };
  });

  const detail = detailRows.map((r) => {
    const abs = num(r.abs_chg);
    return {
      symbol: r.symbol,
      strike: num(r.strike),
      expiry: r.expiry,
      '$M abs': M(r.abs_chg),
      '$M net': M(r.net_chg),
      'biggest hit $M': M(r.biggest_hit),
      'concentration %': abs > 0 ? Math.round((100 * num(r.biggest_hit)) / abs) : 0,
      hits: num(r.hits),
      slots: num(r.slots),
      window: `${r.first_slot}–${r.last_slot}`,
      'best rank': num(r.best_rank),
    };
  });

  const totalAbs = by_ticker.reduce((s, r) => s + num(r['$M abs']), 0);
  const totalHits = by_ticker.reduce((s, r) => s + num(r.hits), 0);
  const slotCount = new Set(rows.flatMap(() => [])).size; // placeholder, see below
  const distinctSlots = await libDb.queryAll(
    `SELECT count(DISTINCT slot) AS n, max(cnt) AS cap FROM (
       SELECT slot, count(*) AS cnt FROM gex_change_top WHERE date = ? GROUP BY slot
     ) s`, [date]);
  const nSlots = num(distinctSlots[0]?.n), cap = num(distinctSlots[0]?.cap);
  const saturated = nSlots > 0 && totalHits >= nSlots * cap;

  return {
    by_ticker, detail,
    note: `${date} · ${by_ticker.length} tickers · ${totalHits} hits across ${nSlots} slots · `
      + `$${round(totalAbs, 1)}M flagged.`
      + (saturated
        ? ` ⚠ Board saturated — every slot hit the top-${cap} cap, so real activity exceeds what is shown. Raise GEX_CHANGE_TOP_N to widen coverage.`
        : '')
      + ` "call %" = share of |Δ| on the call/above-spot side. "$M net" is call-build minus put-build, not the ticker's net day GEX change.`,
  };
};
```

Remove the `slotCount` placeholder line — it is dead; I left it only to mark
where the saturation check goes. Use `nSlots` / `cap` from the query below it.

Then register the test in the handler's if-chain, after the `gex-dex-cross` branch:

```js
else if (test === 'gex-change-summary') body = await gexChangeSummary(q.get('date') || '');
```

Notes for whoever implements this:

- `gex_change_top.date` is **TEXT** (`YYYY-MM-DD`), not a `date` column — compare
  it to a string, never to `CURRENT_DATE`. (`strike_growth.date` *is* a real
  `date`; do not copy a predicate between the two tables.)
- `libDb.queryAll` uses `?` placeholders, matching the surrounding handlers.
- `num` and `round` already exist at the top of this block — reuse them, do not
  redeclare.
- Read-only. No writes, no schema changes.

---

## 3. `owner-vite/src/pages/Backtests.tsx` — add the panel

Add where the removed `gex-dex-cross` panel was, as the last `<Panel />`:

```tsx
<Panel
  title="GEX change — by ticker" test="gex-change-summary"
  subtitle="Consolidates the very-strong GEX-change board into one row per ticker for a session."
  fields={[{ key: "date", label: "date (blank = latest)", type: "text", def: "" }]}
  help={
    <>
      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>How to read this</div>
      <p style={{ margin: "0 0 8px" }}>
        The recorder keeps the top-N “very strong” strikes every 30 minutes. One ticker shows up many
        times across slots and strikes — this collapses that into one row each.
      </p>
      <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>$M abs</strong> — total |Δ GEX| flagged. Rank on this.</p>
      <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>call %</strong> — share of that on the call/above-spot side. ≥70 reads as resistance building, ≤30 as support/protection, in between is two-sided.</p>
      <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>slots</strong> — distinct 30m windows it appeared in. High slots + high $M abs = persistent build; 1 slot is a one-off, ignore it.</p>
      <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>expiries / near exp</strong> — all one short-dated expiry means event positioning, not a standing level.</p>
      <p style={{ margin: "0 0 6px" }}>
        Expand <strong>Per-day detail</strong> for the per-strike breakdown. <strong>concentration %</strong> there is the
        single largest hit as a share of that strike's total — above ~60% means one print is carrying it, not distributed stacking.
      </p>
      <p style={{ margin: "6px 0 0", color: HOME_THEME.text }}>
        If the note warns the board is saturated, the totals are a floor, not the full picture.
      </p>
    </>
  }
/>
```

Rendering is automatic: `Panel` turns every array-of-objects key in the response
into a titled table (so `by_ticker` renders as a section) and puts `detail` in the
collapsible. `DataTable` already colors negatives red — which lands correctly
here, since a negative `$M net` is put-side build.

---

## 4. Verify

- `cd owner-vite && npm run build` must pass clean — no unused imports left behind
  after the deletions (`ReactNode` is still used by the new panel's `help`).
- Load the owner site → Backtests. Three panels gone, six remain.
- Hit **Run** on the new panel with the date blank; it should return the latest
  session. Then enter a specific past `YYYY-MM-DD` and confirm it changes.
- Confirm the `note` line renders and that `by_ticker` totals reconcile against
  the same rollup run directly in psql.
