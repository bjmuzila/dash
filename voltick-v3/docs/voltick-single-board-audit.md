# Voltick Single Board — exact audit

Source of truth: `C:\Users\Brandon\Desktop\Voltick\web\src`, read 2026-09-19.
Target: `voltick-v3` (voltick.cbedge.net/v3).

---

## 1. What the single board actually is, in code

The screenshot is **not one component**. It is six bands stacked inside
`Voltick.jsx` (9,795 lines), each reading one shared derived bundle.

| Band (top → bottom) | File · lines |
|---|---|
| Brand + symbol + price + gamma pill + feed dot + jump pills | `Voltick.jsx` 5375–5549 |
| Toolbar — GEX/VEX, OI/VOLUME, ⚡0DTE, dates picker, ✦ AI Analyst, ✚ Intel, ⋯ | `Voltick.jsx` 5550–6067 |
| View tabs — Single/Multi/Chart/Terminal/Scanner/Grid/Replay + ticker chips | `Voltick.jsx` 4140–4142 (`VIEWS`), rendered 5788+ |
| Context bar — ▶ Show me around · ▾ Session Read · ☾ Overnight · ⚡ Headlines · ⌁ Pressure · ▲ Building · wall chips · IB strip | `Voltick.jsx` 4357–4470 (`readChips`), 6219–6442 |
| **The grid (the Voltmap)** | `Voltmap.jsx` (56 KB, 100% presentational) |
| Stat tiles + legend | `Voltick.jsx` 7459–7664 |

**Every number on the page comes from one hook**: `useBoardDerived()` in
`board-derive.jsx` (1,046 lines). Its header states the rule explicitly —
`agg`, `marks`, `roleOf`, `confluence` and `cellStyle` have exactly one
definition, and the Single board, the Terminal panes and the share card all
call the same hook. `Voltmap.jsx` computes nothing; it takes the bundle as `bd`.

That is the single most important architectural fact for the port: **rebuild
`board-derive` first and the grid becomes a rendering job.**

---

## 2. The grid, element by element

`Voltmap.jsx` renders one table:

- **Strike column** (left, sticky) + the `30 / 50 / 100 / 150` window control.
  State: `strikeCount`, `localStorage["gg-strikes"]`, default **50**
  (`Voltick.jsx:868`). Window is centred on spot.
- **One column per expiration.** Header carries the date, the `★` strike for
  that date, and the `⚡︎` flip strike for that date (or `⚡︎ none`).
- **Cells**: heat-coloured by `cellStyle()` → `heatscale.js` (`heatT`,
  `HEAT_FLOOR`). Green = positive gamma, red = negative, **brighter = bigger**.
- **Marks on the strike**: `★` Volt · `↯` Surge (+ `‖` Surge Wall) · `↘`
  Reversal · `◆` Coil · `⚡︎` Flip · `≋` Air · `⤴` Squeeze. Colour language is
  locked: amber = Volt, violet = flip, magenta = Reversal, blue = Coil/Surge.
- **Spot row**: `#spot-row`, the `◄ Spot` marker.
- **Net profile down the right**: horizontal bars, header `Net GEX · <source> ·
  <scope>`, width `netWidth` (default 280), bar length from
  `meterscale.js` (`meterPct`, `METER_H`).
- **Row click** → `onRow(strike, payload, e)` → `NodePopover.jsx` (96 KB).

Props the caller owns (and why): `ids` (duplicate DOM ids break
`jumpToVolt`/`jumpToSpot`), `onStrikeCount` (absent = hide the control),
`fill`, `netWidth`, `source`.

---

## 3. The stat tiles (exact, in render order)

From `Voltick.jsx:7489–7645`. Tiles are conditional — a tile with no number
does not render at all.

| Tile | Condition | Value | Colour |
|---|---|---|---|
| `Net {GEX\|VEX} · {scope}` | always | `agg.netTotal` | green/red by sign |
| `Call Wall · {scope}` | `callWall != null && king !== callWall` | strike | green |
| `Put Wall · {scope}` | `putWall != null && king !== putWall` | strike | red |
| `Volt ★ · {scope}` (or `Week Volt ★`) | `king != null` | strike | amber |
| `0DTE Volt` / `Front Volt · {tag}` | `king0d != null && !== king` | strike | amber |
| `Gamma Flip · {scope}` | `flipCardShown != null` | strike | violet |
| `Gamma Flip · {scope}` = **`none`** | flip known and one-sided | "none" | violet |
| `▲ Grower` / `▼ Fader` · **all dates** | `grower && !shareMode` | `$strike ±pct` | green/red |
| `± Move` | `emVal != null && !shareMode` | `±emWidth` | paper |
| `ATM IV · {frontTag}` | `board.atmIv != null && !shareMode` | `%` | muted |

Three documented traps worth carrying over verbatim:

1. **Grower is always all-dates**, never scoped — it reads `m.byStrike` /
   `m.chgOpen`, so it carries a fixed `· all dates` tag rather than `scopeTag`.
2. **± Move uses `emWidth`, not `emVal`** — the tile must be the same
   half-width the band on the map draws, or they disagree on screen.
3. **The stat cards are ALWAYS open interest**, even when the map above is
   weighted by volume. The VOLUME switch stays lit; the tiles keep OI.

Legend row below the tiles: `Legend` / `LegendGraduated` (`Voltick.jsx:9552`),
hidden in capture modes.

---

## 4. Derived values — the port's real work

`board-derive.jsx` + these helpers:

| File | Lines | Job |
|---|---|---|
| `board-derive.jsx` | 1,046 | `agg`, `marks`, `roleOf`, `cellStyle`, `confluence`, scope |
| `exposure.js` | 220 | `aggregateFromCells` — walls, king, reversal, coil |
| `heatscale.js` | 65 | `heatT`, `HEAT_FLOOR` — cell colour ramp |
| `meterscale.js` | 39 | `meterPct`, `METER_H` — the right-hand bars |
| `flipcurve.js` (repo root) | — | `flipFromCurve` — the gamma flip, band-clamped |
| `boardfacts.js` (repo root) | — | `flipStrikeOf`, `openBaselineLabel`, `dayBandOf` |
| `openrange.js` | 297 | opening range / IB maths |
| `forwardcone.js` | 131 | forward window |
| `volsrc.js` | 97 | `isVolSource` — "vol" and "volume" both mean volume |
| `dayscope.js` | 47 | which expirations a scope covers |

Two deliberate non-bugs to preserve: `inScope`/`eiVisible` are **plain
closures, never memoized** (memoizing freezes the columns on a stale scope);
and on `Σ ALL`, `agg` is the **same object** as `m`, because the grid tests
`agg !== m` to decide whose numbers a node card is quoting.

---

## 5. Blocker found: the wire has no strike × expiry matrix

This is the finding that decides the build.

Voltick's server computes the whole board and broadcasts it — one symbol's
full grid arrives as a unit (`server/engine.js`, 87 KB → WS).

`voltick-v3` has **no equivalent frame**. `src/contract/frames.ts` defines:

```ts
interface GexData {
  gexRows: GexRow[]      // one row per STRIKE
  callWall, putWall, gexFlip, totalNetGex
  expiry?: string        // ← ONE expiry
}
```

One expiry, one column. The Voltmap needs ~14. So the board cannot be built
against the existing socket frame as-is. The two ways forward:

**A · Client-side matrix (no backend change).**
`/api/expirations?ticker=` then `/api/chains?ticker=&expiration=` per column,
computing GEX/VEX per strike in the browser (dealer convention: long calls +,
short puts −). Nothing on the server moves. Costs ~14 chain fetches per
symbol per refresh, and the maths lives in the client where it is harder to
keep honest against the recorders.

**B · One new server-v2 endpoint** that returns the full matrix in one
response, mirroring Voltick's engine output. One fetch, maths stays server-side
next to the existing levels engine — but it is a backend change to
`server-v2/api-router.js` and touches the proxy path.

Everything else in this audit is the same either way.

---

## 6. Out of scope for a first build (Phase 2)

Real, but not the board: Session Read ribbon, ☾ Overnight, ⚡ Headlines
(`NewsFeed.jsx`), ⌁ Pressure (`PressurePanel.jsx`), the IB strip
(`IBStrip.jsx`, self-fetches `/api/ib` every 30 s), `NodePopover.jsx`
(96 KB row card), `Tour.jsx` / `▶ Show me around`, the share/shot capture
paths, and the paywall.
