# Path Ribbon · Crossfade styles (B1–B4)

This spec covers the four crossfade handoff styles for Voltick's Path Ribbon (`pathband`). It was prototyped on 2026-09-30 against real `option_strike_gex_history` data for SPX, SPY and QQQ 0DTE on Tue 9/29.

Reference renders are in `generated/`:

| File | Shows |
|---|---|
| `2026-09-30-gex-pathband-b1-crossfade-spx-spy-qqq.png` | B1 on all three symbols |
| `2026-09-30-gex-pathband-b2-quickswap-spx-spy-qqq.png` | B2 on all three symbols |
| `2026-09-30-gex-pathband-b3-dissolve-spx-spy-qqq.png` | B3 on all three symbols |
| `2026-09-30-gex-pathband-b4-spx-spy-qqq.png` | B4 on all three symbols |
| `2026-09-30-gex-pathband-netgex.png` | B1–B4 side by side (synthetic data) |

---

## 1. What stays exactly as Voltick draws it today

These are taken from `web/src/HeatChart.jsx` (`style === "pathband"`) and `web/src/trailruns.js`.

- **Rows:** there are three rows, Volt, Surge and Reversal. The Coil stays Path-only (`pathOnly`).
- **Locked colours:** each colour has one owner (from `theme.jsx`).

  | Row | Token | Hex |
  |---|---|---|
  | Volt ★ | `FLIP_AMBER` | `#ffd166` |
  | Surge ↯ | `SURGE` | `#4d8cff` |
  | Reversal ↘ | `MAGENTA` | `#ff5fa2` |
  | Panel | `PANEL_HEX` | `#0e1216` |

- **Ink:** each band is a see-through fill between two hairline banks, so every candle stays visible through it.
- **Runs:** `strikeRuns` splits a row into runs, and `absorbRuns(runs, DWELL=3)` folds any run under 3 bars into a neighbour.
- **Holes:** the band breaks wherever two readings are more than `holeSec` apart (at least 20 min, or 4× the row's median gap).
- **The Volt wins a shared strike:** any other row is cut where it sits on the Volt's strike (`goldSpans`, `cutAtGold`).
- **True start and end of a level:** these keep the `bandPath` sine taper: `TIP_H = 0.12` over `TAPER_BARS = 4`.
- **Live edge:** the flare and the dashed tail to the axis are unchanged.

## 2. The rule these styles add

> **No connector is ever drawn between two strikes.** When a level changes strike, the band it leaves fades out and the new band fades in. For a couple of bars they overlap at their two different prices. Nothing is drawn in the vertical gap between them.

This replaces the pinched lens at every strike change. Without the pinch, a hop no longer reads as a break in the record.

## 3. Width = |net GEX| at the strike the level holds

The old input was the role's own size (`f.sz.volt`, `f.sz.surge`, `f.sz.rev`), measured against that row's low-to-high range for the day. That made the band widest right at a hop: the width travelled with the role across the move, and the Volt usually moves at the moment a new strike overtakes the old one.

The new input is the absolute net GEX **at the strike the level is sitting on at that bar**, from the same per-strike ladder the heat grid uses.

```js
v = Math.abs(netGex[strikeHeld][bar])
```

### 3.1 Scale: Voltick's own size law

Use `heatT` from `web/src/heatscale.js`. It's a square root up to a p90 reference and a log above it, so one monster strike can't flatten every other band.

```js
// every |net GEX| value a band actually draws (all three rows, before the cap)
REF = Math.max(p90(heldValues), HEAT_FLOOR * gMax)   // HEAT_FLOOR = 0.35
k   = heatT(v, REF)                                  // 0..1
```

### 3.2 The 3 pm cap

Into the close, 0DTE gamma piles onto one strike. On 9/29 the SPX 7670 strike reached 14.4B against a pre-3 pm maximum of 7.35B. Left alone, that would set the scale for the whole day.

```js
I3   = index of the 15:00 bar
gMax = max |net GEX| over every strike, bars [0, I3)
for bars >= I3:  v = Math.min(v, gMax)          // clamp before heatT
```

The axis label still shows the real value, with "(capped)" added when it was clamped. A faint dashed gold line marks 3:00 pm.

| 9/29 | Pre-3 pm max | Day peak | Cap applied |
|---|---|---|---|
| SPX | 7.35B | 14.43B | yes |
| SPY | 0.70B | 1.37B | yes |
| QQQ | 3.38B | 3.38B | no (peak came before 3 pm) |

### 3.3 Half-height in pixels

```js
HMIN = 0.8
HMAX = Math.min(11, 0.42 * pxPerStrike)   // two neighbours at full size never touch
h    = HMIN + (HMAX - HMIN) * k
```

### 3.4 Smoothing never crosses a hop

Apply `smoothSeries(k, 3)` (±1 bar) **inside a single run only**. Reset it at every strike change and every hole. Otherwise the old strike's size smears into the new one.

## 4. Geometry of one run

Some terms used below:

- `bs` is the bar spacing in px, and `half = bs / 2`.
- `a` and `b` are the run's first and last readings.
- `hopIn` is true when an earlier run in the same chain exists, meaning the level arrived from another strike.
- `hopOut` is true when a later run in the same chain exists, meaning the level leaves to another strike.

```js
OV = ov * bs                                   // overlap length (per style)
x0 = a.x - half - (hopIn  ? OV : 0)
x1 = b.x + half + (hopOut ? OV : 0)
```

**Overhang samples.** Take 8 samples across each overhang. These are the bars before `a` on a hop-in, and after `b` on a hop-out. Each sample stays at the run's **own** strike (`y = a.y` or `b.y`) and takes its width from **that strike's own |net GEX| at that bar**. The band that's leaving draws the old strike's real, decaying GEX, and the band that's arriving draws the new strike's real, building GEX.

**Fade weight**, from 0 at the far tip of an overhang to 1 inside the run:

```js
fw = x => {
  let w = 1
  if (hopIn)  w = Math.min(w, sstep((x - x0) / (OV + half)))
  if (hopOut) w = Math.min(w, sstep((x1 - x) / (OV + half)))
  return w
}
sstep = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
```

**Width multiplier** at each sample:

```js
e = pinch + (1 - pinch) * fw(x)
if (!hopIn)  e = Math.min(e, taperE(x, x0, +Infinity, 4 * bs))  // true start: bandPath taper
if (!hopOut) e = Math.min(e, taperE(x, -Infinity, x1, 4 * bs))  // true end
top = y - h * e ;  bot = y + h * e
taperE = (x, x0, x1, tp, tip = 0.12) =>
  tip + (1 - tip) * Math.sin(Math.min(1, Math.max(0, Math.min(x - x0, x1 - x) / tp)) * Math.PI / 2)
```

**Paint.** Draw one closed path per run. Fill and banks both use a horizontal `createLinearGradient(x0, 0, x1, 0)` with one colour stop per sample, so alpha can follow `fw(x)`.

```js
FILL = 0.20   // × 1.25 on the Volt
BANK = 0.55   // lineWidth 1

fillAt(x) = rgba(rowColour, fa * fw(x))
bankAt(x) = rgba(rowColour, BANK * Math.pow(fw(x), 1 + bankLead * 3))
```

## 5. The four styles

| Style | `ov` (bars) | `pinch` | `bankLead` | `heat` | What it reads like |
|---|---|---|---|---|---|
| **B1 · Crossfade** | 2.5 | 0.35 | 0 | – | A short overlap, and the band narrows to 35% as it fades. You see where it came from and where it went. |
| **B2 · Quick Swap** | 1.2 | 1.0 | 0.6 | – | About one bar of overlap and no narrowing. The banks fade before the fill, so each stretch ends flat and soft. The cleanest look on busy days. |
| **B3 · Dissolve** | 4.0 | 0 | 0.3 | – | A slow handoff where the old band thins to a point and the new one grows in from a point. It reads as GEX migrating rather than jumping. |
| **B4 · Crossfade + Heat** | 2.5 | 0.35 | 0 | ✓ | The B1 handoff plus heat ink (below). |

### B4 heat ink

`k` is the sample's size (0–1), and `lit` is Voltick's `growthHeat` for that reading (`web/src/trailheat.js`).

```js
fillAt(x) = rgba(mix(rowColour, PANEL, 0.5 * (1 - k)), (0.10 + 0.30 * k) * fw(x))  // deeper as it grows
bankAt(x) = rgba(mix(rowColour, '#ffffff', 0.35 * lit), (0.35 + 0.55 * lit) * fw(x)) // glows while building
lineWidth = 1.1

// Volt only: soft gold glow drawn under the band
ctx.shadowColor = 'rgba(255,201,51,.4)'; ctx.shadowBlur = 12
fill the same path with rgba(255,209,102, 0.12 * fw(x))
```

## 6. Level picks used in the prototype

These are approximations, used because the Postgres dump has per-strike GEX but not Voltick's real `levelPath` frames. The real build should keep Voltick's own Volt, Surge and Reversal, and change only what the width reads (section 3).

- **Volt:** the largest |net GEX| within ±0.8% of spot (±60 pts on SPX).
- **Surge:** the largest positive net GEX, excluding the Volt's strike.
- **Reversal:** the largest negative net GEX, excluding the Volt's strike.
- Any candidate under 3% of the Volt's size is ignored.
- Readings are bucketed to 5-minute bars, taking the last snapshot in each bar.

## 7. Getting the data again

`option_strike_gex_history` keeps only about 48 hours, so export a session before it rolls off.

```powershell
ssh -i $env:USERPROFILE\.ssh\cbedge root@178.156.137.36
```

```bash
cd /opt/dashboard
docker compose exec -T dashboard node server-v2/scripts/dump-strike-gex-window.js --symbol='$SPX' --out=/tmp/gexdump --gz
docker compose cp dashboard:/tmp/gexdump ./gexdump
exit
```

```powershell
cd "C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\generated"
New-Item -ItemType Directory -Force gexdump-YYYY-MM-DD | Out-Null
scp -i $env:USERPROFILE\.ssh\cbedge "root@178.156.137.36:/opt/dashboard/gexdump/*" .\gexdump-YYYY-MM-DD\
```

Each CSV has these columns: `id, timestamp (ms), date, expiry, spot, strike, net_gex, net_vol_gex, call_gamma, put_gamma, symbol, call_iv, put_iv, net_dex, net_vol_dex`. SPX is recorded from 00:00 ET. SPY and QQQ are regular session only (09:30–16:00).

## 8. Open items before shipping

1. **Per-strike GEX in `levelPath`:** feed Path Ribbon the per-strike |net GEX| for the strike each role holds, in place of `sz.volt`, `sz.surge` and `sz.rev`.
2. **Cap time:** decide whether the 3 pm cap is fixed at 15:00 ET or relative to the expiry (for example, the last 60 minutes before expiry).
3. **Style picker:** decide whether one of B1–B4 becomes the Path Ribbon default or they ship as a sub-option.
4. **Previews on real bar spacing:** Voltick runs at a 6px bar spacing in places, while these renders were about 9.6px (1m charts are denser still), and the notes in `HeatChart.jsx` record previews at the wrong spacing approving things before. Re-check the `ov` values at 6px before approving.
