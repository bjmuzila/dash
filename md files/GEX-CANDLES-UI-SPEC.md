# GEX Candles · UI spec for Voltick

A candlestick chart with the options gamma ladder painted on top of it as bubbles, a live
strike rail beside it, the day's named levels tagged on the pane, and a replay mode that
scrubs back through a recorded session.

This doc describes **what the user sees and how it behaves**. It is a port of CB Edge's
"GEX Candles" card, written so it can be rebuilt inside Voltick with Voltick's own
components, tokens and data. It deliberately leaves out CB Edge file paths and internals.

---

## 0 · Read this first (instructions for Claude)

1. **Build it the Voltick way.** Use Voltick's existing chart component, tokens
   (`theme.jsx`), fonts, breakpoints and copy rules. Find the existing chart first and
   extend it rather than adding a second charting library.
2. **Voltick's design system wins.** Where this doc names a colour, size or word that
   conflicts with Voltick's design system, Voltick's rule applies. The colour mapping in
   §3 already does this translation; follow it.
3. **The numbers in this doc are tuned, not guessed.** Sizes, spacings, thresholds and
   alphas each came from fixing a visible bug. Keep them unless you measure a reason not to.
4. **Ask before replacing anything that already works** in Voltick (an existing chart,
   an existing level calculation, an existing route). Additive first.
5. **Compliance applies to every label.** Levels are described as locations and mechanics,
   never as buy, sell, signal, entry, target, stop or prediction.
6. Build in the order in §15 and check each item in the acceptance list before moving on.

---

## 1 · The picture

### 1.1 Desktop card

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ GEX Candles    [⏱ Replay]   [SPX ▾]  [5m ▾]  [ETH ▾]  [⚙]                   TV credit │ ← header
├─────────────────────────────────────────────────────────────────┬─────────┬───────────┤
│ ★ VOLT 5,850.00                                          0:42   │ 5,900.00│           │
│ EM+ 5,892.40 ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ │         │ EM+       │
│ ‖ CW 5,875.00         ·   ·   ·   ·   ·   ·   ·              │ 5,875.00│ CW ▬▬▬▬   │
│                     ┃                                           │         │           │
│  ●   ●   ●   ◉   ◉ ┃ ◉   ◉   ◉   ◉                           │ 5,850.00│ ★ ▬▬▬▬▬▬▬ │
│ ┃┃ ┃ ┃┃ ┃ ┃┃  ┃┃┃  ┃ ┃ ┃┃ ┃┃                                   │         │           │
│   ●   ●   ●   ●   ●   ●   ●                            ┄┄┄┄┄┄│ 5,825.00│ ▬▬        │ ← spot line
│ ‖ PW 5,800.00   ·   ·   ·   ·   ·   ·                          │         │ PW ▬▬▬▬▬  │
│ EM− 5,807.60 ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ ‐ │ 5,800.00│ ▬▬▬       │
│ ▂▃▅▂▁▃▂▆▃▂▁▂  (volume strip, bottom fifth)                  [⤓] │         │           │
├─────────────────────────────────────────────────────────────────┴─────────┴───────────┤
│ 09:30      10:00      10:30      11:00  …                                   16:00 ET │ ← time axis
└───────────────────────────────────────────────────────────────────────────────────────┘
      plot pane (candles + bubbles + tags)                   price axis    GEX rail 96px
```

Legend: `●` peer bubble (sign colour) · `◉` leader bubble (the one gold mark per time
bucket) · `·` small peer · `┃` candles · `┄` dashed spot line · `‐ ‐` EM hairline ·
`0:42` countdown to the next bar · `[⤓]` jump to now.

### 1.2 Regions, left to right

| Region | Width | Holds |
|---|---|---|
| Plot pane | flexible | candles, volume strip, bubble layer, level tags, EM lines, spot line, countdown, jump-to-now |
| Price axis | the chart's own | prices at 2 decimals, mono |
| GEX rail | **96 px fixed** | one row per strike, pinned to that strike's exact height on the price axis |
| Time axis | full width, bottom ~26 px | times in **ET**, always |

### 1.3 Phone card (≤ 760 px, Voltick's breakpoint)

```
┌──────────────────────────────────────┐
│ GEX Candles   [SPX|ES]   [5m·1D·RTH ⚙]│ ← one settings button, shows current values
├──────────────────────────────────────┤
│ ★ VOLT 5,850.00                0:42  │
│ ‖ CW 5,875.00   ·  ·  ·  ·  ·        │
│  ●  ●  ◉  ◉  ◉  ◉            5,875.00│
│ ┃┃ ┃ ┃┃ ┃┃┃ ┃                         │
│ ‖ PW 5,800.00  ●  ●  ●       5,800.00│
│ ▂▃▅▂▁▃▂▆                        [⤓] │ ← jump-to-now, 44 px tap target
├──────────────────────────────────────┤
│ 09:30   11:00   12:30   14:00   16:00│
└──────────────────────────────────────┘
          (no GEX rail on phone)
```

Tapping the settings button opens a **bottom sheet** holding every control (§7.3).

---

## 2 · What the chart is saying

- **Each bubble** = one reading of one strike's net GEX at one moment of the session.
- **Size** = that strike's share of **the day's** biggest reading (not the minute's).
- **Colour** = the sign of the gamma (positive vs negative).
- **The gold one** in each time bucket = the biggest level in that bucket.
- **The rail** = the same ladder right now, as bars, each row level with its strike.
- **Tags on the pane** = the three named levels (strongest, call wall, put wall) and the
  day's expected-move band.

A reader should find the biggest level at a glance without reading any text: it is the
gold trail.

---

## 3 · Colour mapping (CB Edge → Voltick)

CB Edge's colours collide with Voltick's reserved vocabulary, so they are **not** copied.
Use this mapping. Always import the token, never paste a hex.

| Element | CB Edge used | **Use in Voltick** | Why |
|---|---|---|---|
| Positive-gamma bubble fill, leader ring + glow | blue `#29b6f6` | whatever the Volt Board uses for **positive / call gamma**; if nothing, `GOOD` `#3ddc8e` | Voltick reserves `#4d8cff` blue for surge/walls. Bubbles are data, so `GOOD` is legal |
| Negative-gamma bubble fill, leader ring + glow | red `#ff4757` | whatever the Volt Board uses for **negative / put gamma**; if nothing, `BAD` `#ff6b7a` | same |
| Leader bubble (biggest in each bucket) | gold `#ffb300` / `#ffd76a` | **Decision for the Voltick owner**, see note below | |
| Strongest level tag + rail tag ("CB") | yellow `#ffd600` | **Volt** `#ffd166` with `★`, label `VOLT` | Same concept: the single strongest level on the board |
| Call wall tag ("CW") | blue | walls `#4d8cff` with `‖`, label `CW` | Voltick's reserved wall colour |
| Put wall tag ("PW") | red | walls `#4d8cff` with `‖`, label `PW` | Both are walls; the label says which side |
| EM± band tags + hairlines | violet `#b07be0` | `SKY` `#7fb0ff` | Violet `#b48cff` is Voltick's **gamma flip**. One colour for both edges (it is one symmetric band, not a direction) |
| Candles up / down | theme candle tokens | Voltick's chart candle colours | Keep what the chart already uses |
| Volume | candle colours washed back | same candle colours at **34 %** alpha | A volume bar can never disagree with its candle |
| Text in chips / tags | white | `PAPER`, numbers in `MONO` | No grey text in Voltick |

**Leader bubble colour, decision needed.** In CB Edge gold means "the wall", so the
per-bucket leader is gold. In Voltick `#ffd166` means "the Volt, and nothing else".
Options:

- **A (recommended):** leader uses Volt amber. The leader *is* the strongest level at that
  moment, and the gold trail will usually run along the Volt. Confirm with Gnotz617 that
  this counts as "the Volt".
- **B:** leader keeps its sign colour, drawn larger with a white-cored gradient
  (`PAPER` centre) and the sign ring. No reserved colour used.

Do not pick a near-miss amber. Voltick's test suite fails on hand-minted hexes.

**Optional Voltick extra:** if Voltick already computes the gamma flip, add a fourth tag,
`⚡︎ FLIP 5,838.00`, in flip violet `#b48cff`, using `FLIP_MARK` (never a bare `⚡`).

---

## 4 · Candles

### 4.1 Look

- **No grid lines.** A horizontal line through a column of bubbles reads as a level, and
  levels are exactly what the bubbles carry. Keep the axis borders, drop the grid.
- **Time axis in ET** for every user. 09:30 must be 09:30 everywhere.
- **Prices at 2 decimals**, mono. Tags on the pane use the same format so the tag and the
  axis can never show two different numbers for one level.
- **Volume** is an overlay strip inside the same pane (not a second pane): it owns the
  bottom **20 %**, the candles keep an **8 %** top margin and give up **24 %** at the
  bottom while volume is on. Each volume bar is coloured by **its own** candle's direction.
  One pane means one set of coordinates for the bubbles.
- **Spot line:** dashed horizontal line at the last price (toggle).
- **Countdown:** time until the forming bar closes, top right (toggle). Hidden in replay.
- **Jump to now** button, bottom right of the plot, clear of the axis.
- If the charting library draws its logo inside the pane, move the attribution to the card
  header instead (and keep it visible, it is usually a licence term).

### 4.2 Timeframes and session

| Control | Options | Default |
|---|---|---|
| Interval | 1m · 5m · 15m · 30m · 1h | 5m |
| Session | RTH (09:30 to 16:00 ET) · ETH (adds overnight) | ETH |
| Days | 1D · 2D · 3D | 1D |
| Tape (SPX only) | SPX cash · ES futures | SPX |

- 15m / 30m / 1h bars are **anchored to 09:30 ET**, not to the hour. The cash open must be a
  bar boundary.
- RTH just hides the out-of-session bars; the overnight gap closes by itself.
- 2D / 3D widen the candles only. **Bubbles and rail show the newest session only.**

### 4.3 Framing (what the pane shows when it opens)

- The window is **one RTH session wide** (390 minutes of bars): 09:30 on the left edge,
  16:00 on the right. Later in the day the session fills the pane; earlier, the blank space
  on the right is the part of the day that has not happened yet.
- **Early in the day, centre the live candle** instead of pinning one candle to the left edge
  with six empty hours beside it:
  `leftEdge = min(sessionStartBar, newestBar − span / 2)`.
  The two terms meet a little after midday, so it slides with no jump.
- Minimum window **30 bars** (390 minutes is only 6 bars at 1h).
- **After a timeframe change the newest candle must still be on screen.** Re-check the frame
  a moment later (next frame, ~150 ms, ~600 ms) and re-apply if the library re-laid it out.
  Also re-apply if the pane is mostly empty (< 40 % candles) or zoomed way out (> 1.6×
  a session).
- **Coming back to a hidden tab or a collapsed panel** must not leave the candles squeezed in
  the middle with whitespace on both sides. Re-frame on becoming visible / getting a size.
- Never re-frame on the regular data poll. That would fight the user's own zoom.

### 4.4 Live price and the forming bar

- The live price extends the forming bar several times a second. When the closed-bar feed is
  one bar behind, **open the next bar** rather than dropping ticks.
- A new bar's open is the **previous bar's close**, not the first tick this tab happened to
  see. Two tabs opened seconds apart must draw the same candle.
- On a symbol switch, throw away the invented forming bar, or the old symbol's price gets
  appended to the new chart.
- In replay, **no live price at all**.

### 4.5 Bad data

A bar with a zero, a non-number, high below open/close, low above open/close, or a wick
wider than **25 % of the close** is **dropped, never repaired**. One bad bar autoscales the
pane to 0 to 9,000 and flattens the whole day into a line. The next poll will publish the
real bar. Same rule for a live tick more than 25 % away from its bar.

---

## 5 · The bubble layer

### 5.1 Rules

| Rule | Behaviour |
|---|---|
| **One bubble per strike per time bucket** | The trail is a *sample*, not a line. Last reading in the bucket wins |
| **4 strikes per bucket, at least 1 each side of spot** | Rank by \|net GEX\|, force the best above spot and the best below, fill the rest from the ranking |
| **Size grows with net GEX** | relative to **the whole day's** biggest reading (§5.4) |
| **Peers carry the sign** | positive / negative gamma colour (§3) |
| **One leader per bucket** | the bucket's biggest, drawn larger with the leader treatment (§5.6) |
| **Old dots survive** | never smaller than **1.2 px**, age only fades opacity a little (to 75 %) |
| **Overlap is limited** | no mark covered more than half way (§5.5) |
| **History is the whole day** | nothing is ever removed or smoothed |

**Deliberately absent, do not add:** a size cutoff, an automatic row count, sliders for
curve / floor / cap, an "Auto" mode, smoothing, hysteresis, or dwell. The chart has one
right answer at a time. A setting is a question the user has to keep re-answering.

### 5.2 Dots, not lines

Draw each reading as a separate stamp. Never connect a strike's readings with a stroke:
at a session's zoom a stroke per reading merges into a **solid bar**, and a bar claims "the
level was this for the whole stretch" where dots say "it was sampled, and here is each
reading".

### 5.3 Bucket and stride

- **Bucket = the bar interval**, capped at **5m**. So 1m bars → 1m buckets; 5m, 15m, 30m, 1h
  bars → 5m buckets. Changing the interval visibly changes the bubbles immediately.
- A "Bubble bucket" setting can **pin** 1m or 5m (default Auto).
- **Stride:** when buckets are too close to draw legibly, draw every Nth bucket so drawn
  dots sit about **11 px** apart. Each drawn dot is still one real bucket. Zoom in and the
  stride returns to 1. (A pinned 1m/5m bucket may go tighter, 2.5 px.)
- **Do not lower the 11 px target.** Below about 4 px per dot every mark hits the 1.2 px
  floor and the size difference between the 4 strikes disappears.
- Measure the pixel spacing **locally**, at the current zoom near the middle of the pane,
  not from the data's full span.

### 5.4 Size

```
t  = (1 − rankMix) × (|gex| / dayMax) ^ 0.75  +  rankMix × rank
rx = floor + t × (cap − floor)     (leader: × topBoost, capped)
ry = same vertically × aspect
```

| Bucket | cap px | floor px | leader boost | ring max px | aspect | rankMix |
|---|---|---|---|---|---|---|
| 1m | 9 | 1.6 | 1.60 | 1.1 | **1.15** | **0.4** |
| 5m | 13 | 2.5 | 1.55 | 1.4 | 1 | 0 |
| 15m | 16 | 3.0 | 1.50 | 1.6 | 1 | 0 |
| 30m | 18 | 3.5 | 1.46 | 1.8 | 1 | 0 |
| 60m | 20 | 4.0 | 1.42 | 2.0 | 1 | 0 |

- **Per-bucket-size numbers are required.** A 13 px cap is right at 5m and turns 1m into
  ribbons.
- At **1m only**, marks are slightly taller than wide (aspect 1.15) and 40 % of the size comes
  from rank, so four near-equal strikes still read as 1st to 4th. Never let rank change the
  order.
- Peers are also capped at **0.46 × the dot spacing**; the leader at **0.56 × spacing** (past
  half on purpose, consecutive leaders touch slightly, which reads as bubbles, not ovals).
- A **Bubble size** slider scales everything: 0.5× to 2.5×, step 0.1, default 1.
- A mark is never wider than it is tall.

**dayMax is the day's biggest reading, always.** Normalising per bucket makes quiet minutes
swell to full size. In replay, use the **whole session's** max, not "biggest so far", or every
dot on screen shrinks each time the cursor reaches a bigger reading.

### 5.5 Placement and overlap

- **A bubble sits on its candle.** Its x is the centre of the candle containing that minute,
  plus the fraction of the way through the bar. Not on the seam between two candles (a
  half-bar offset is the classic bug), and not missing because the minute did not land
  exactly on a bar timestamp.
- Use the **real** list of bar times, not "open + n × interval": 09:30-anchored bars, the
  short last bar, and feed gaps all break arithmetic.
- A reading may land up to **two bars past** the newest candle (the candle feed can lag).
  Further than that, it is not drawn.
- **Within a bucket:** neighbours shrink vertically toward the floor, then take up to 3 px of
  sideways jitter.
- **Across the pane:** after placement, no mark may be covered more than half way by another.
  Leaders are placed first, then by size; whatever comes later shrinks, or is dropped if even
  a speck would be half covered. At the open, when ten minutes land in a few pixels, what
  survives should be the big levels.
- Clip bubbles to the plot area. They must never paint over the price labels.

### 5.6 Leader treatment

- Fill: radial gradient, light centre (`PAPER`) to the leader colour at the rim (§3).
- **Ring** in the leader's **sign colour**, width = **13 %** of the mark's radius, clamped
  between 0.45 px and the bucket's ring max. Draw it **inside** the edge, not straddling it.
- **Glow** in the sign colour, up to 7 px blur, alpha 0.6 × age, but **only as much as the
  gap beside the mark allows**. At tight zoom there is no glow. A glow painted across a 2 px
  gap is what turns a row of leaders into one sausage.
- If the mark is an oval, build the gradient in the oval's own shape so the rim colour
  reaches all sides.

**Tried and rejected, do not repeat:** the leader colour on every mark with a sign ring (tiny
marks become one muddy smudge, the sign is lost), and pale tints of the sign colours (a pale
2 px pink dot is indistinguishable from a pale 2 px blue one).

### 5.7 Which strikes each bucket shows

Default **per bar**: each bucket keeps the strikes it chose then, so a level that traded at the
11:00 high keeps its dots up there. Alternative **latest**: use the current bucket's 4 strikes
and plot those strikes back through the day. Neither mode ever removes a reading.

### 5.8 Which expiry

**Always the nearest expiry. No picker.** On a weekend show the previous Friday's expiry (the
session that actually happened). On a trading day, don't wait for the expiry list to load:
assume today's date, fetch, and correct if the list disagrees.

---

## 6 · Levels on the pane and the rail

### 6.1 The three named levels

| Tag | Name | Rule |
|---|---|---|
| `★ VOLT` | Strongest level | biggest \|net GEX\| strike on the ladder |
| `‖ CW` | Call wall | biggest positive GEX **above** spot, excluding the Volt strike |
| `‖ PW` | Put wall | most negative GEX **below** spot, excluding the Volt strike |

Exclude the Volt strike **before** picking the walls, or the strongest level and a wall land on
the same strike and the next level price has to get through disappears. If Voltick already
computes a Volt and walls, **use Voltick's values** so the chart agrees with the board.

### 6.2 Pane tags

```
★ VOLT 5,850.00        ‖ CW 5,875.00        ‖ PW 5,800.00        EM+ 5,892.40 ‐ ‐ ‐ ‐ ‐
```

- Small chips on the **left edge** of the plot (the right side already has the price axis and
  the rail).
- The chip's vertical centre sits **exactly at the level's price**. The height is the line.
  **No horizontal line** for Volt / CW / PW.
- Price inside the chip at 2 decimals, mono.
- Chip: 12 px tall, mono ~9 px, weight 700, `R_SM` radius, fill in the level colour with the
  matching dark ink for text (or outline style, whichever Voltick's chips use).
- Round y to whole pixels (+0.5 for 1 px lines) so nothing blurs.
- Tags draw **even when bubbles are off** or history has not loaded.

### 6.3 Expected-move band (EM+ / EM−)

- Two tags, `EM+` and `EM−`, one colour for both (`SKY`), each with a **dashed hairline**
  across the pane: dash 3 on / 4 off, alpha **0.45**. The line starts **after** the chip, never
  under it.
- It is the **daily** band (front-expiry ATM straddle around the previous close), not a
  weekly one.
- **Frozen for the session:** computed once at the first read of the day and never
  recomputed, so the line at 14:00 is the same line someone saw at 10:00. If no band exists,
  draw nothing. Never estimate one on the client.
- Separate toggles: **EM** (tags) and **EM line** (hairlines). EM line is disabled, not
  hidden, while EM is off.
- **Collision:** if an EM chip would overlap a wall chip (within 12 px vertically), slide the
  EM chip **right**, past the other chip. **Never move a tag up or down**: a tag off its price
  is a tag that lies. The call wall sitting on EM+ is the day's most important picture, so
  this case must look clean.
- In replay, show that session's band, or none if it predates recording. Never today's band on
  an old day.

### 6.4 GEX rail

```
 tag col   bar (always grows right from one baseline)
 ┌────┬──────────────────────┐
 │ CW │▬▬▬▬▬▬▬               │   ← positive gamma colour
 │    │▬▬▬                   │
 │ ★  │▬▬▬▬▬▬▬▬▬▬▬▬▬▬       │   ← Volt row
 │    │▬▬                    │   ← negative gamma colour
 │ PW │▬▬▬▬▬▬▬▬▬▬            │
 └────┴──────────────────────┘
```

- **96 px** column, right of the price axis. Desktop only.
- Each row: a fixed-width tag column (blank if untagged, so every bar starts at the same x),
  then one bar anchored left that always grows right. Length = magnitude, colour = sign.
- **No strike number, no dollar value printed.** The axis already gives the height and the bar
  gives the size. Hover shows the exact figure, e.g. `+1.2B`.
- A strike can carry two tags (e.g. `★` and `CW`).
- **Every row sits at the exact pixel height of its strike on the price axis**, and follows pan,
  zoom and autoscale every frame. It must never drift from the candles or the bubbles.
- **Thinning:** place rows in priority order (Volt, CW, PW, then by size). Hide any row that
  would land within **15 px** of one already placed, and any row within 2 px of the top or
  bottom edge. Every visible row is exactly level with its strike.
- Rows start hidden until the first position is known (no flash of rows stacked at the top).
- Empty state: `No ladder yet`.

---

## 7 · Controls

### 7.1 Desktop header (folded)

```
GEX Candles   [⏱ Replay]   [AAPL ▾]*   [SPX ▾]   [5m ▾]   [ETH ▾]   [⚙]            TV credit
                           *copies only   tape    interval  session  layers
```

Each segmented control shows **only its current value**; click opens the full group right
under it. Spelled out it was eleven buttons, ten saying what the chart is *not* set to, and the
row fell off a half-width card. Folded, it fits a quarter-width card.

- **Tape** (SPX · ES) only appears when the symbol is SPX.
- **Session follows tape:** switching to ES sets ETH, back to SPX sets RTH. A default, not a
  lock: the session menu still works.
- **Symbol:** the first card follows the page's ticker and has no picker. Every added copy of
  the card gets its own ticker picker (the point of a second card is a second ticker).

### 7.2 ⚙ Layers panel

```
┌ Layers ────────────────────────────────────────────┐
│ DAYS          [1D] 2D  3D                           │
│ LAYERS        [Bubbles] [GEX rail] [Levels] [EM]    │
│               [EM line] [Volume] [Spot line]        │
│               [Countdown]                           │
│ GEX BASIS     [Vol+OI]  Vol                         │
│ BUBBLE BUCKET [Auto]  1m  5m                        │
│ BUBBLE SIZE   ●────────○──────────  1.0×            │
└─────────────────────────────────────────────────────┘
```

- Section labels uppercase mono, ~10 px, weight 600, letter-spacing ~.08em (Voltick label
  style).
- A dependent control is **disabled, never removed**: EM line while EM is off, Bubble size
  while Bubbles are off. The slider keeps its value for when it comes back.

### 7.3 Phone bottom sheet

One header button showing the current values (`5m · 1D · RTH`) opens a sheet with
**Interval**, **Session**, then everything from the Layers panel, as open segmented groups.
All targets ≥ **44 px**. The **SPX | ES** switch stays in the header on phone too (it is the
control people reach for mid-session).

### 7.4 Settings (saved per card)

| Setting | Default | Why this default |
|---|---|---|
| Interval | 5m | |
| Session | ETH (RTH on SPX cash) | |
| Days | 1D | the board's job is today; max 3 |
| Bubbles | on | |
| GEX basis | Vol + OI | OI plus today's volume; "Vol" = volume only |
| GEX rail | on | it is the numbers behind the bubbles |
| Levels | on | fastest read of the day's levels, costs no width |
| EM / EM line | on | a band nobody switched on is a band nobody knows exists |
| Volume | on | half of every bar's story |
| Spot line | on | |
| Countdown | on | |
| Bubble bucket | Auto | follows the interval |
| Bubble size | 1.0× | |
| Tape | SPX | |

Each card saves its own settings. The phone never overwrites the stored desktop values (the
rail is suppressed on phone, not switched off).

---

## 8 · ES tape (SPX gamma on ES futures candles)

ES trades 40 to 60 points above SPX cash, and the strikes are SPX strikes. On the ES tape,
**every strike is shifted up by the ES minus SPX basis** before a bubble, rail row, level tag
or EM line is placed. Without it every level sits one basis too low.

- Use a **daily** basis (ES 16:00 close minus SPX close), one value per session; history bubbles
  use their own day's value. It moves about a point a day.
- A basis that is not between 0 and 250 is **rejected**, never clamped.
- If there is no usable basis, draw levels unshifted and say so under the header:
  `ES·SPX basis unavailable · levels drawn at SPX cash strikes`.
- The GEX values themselves never change, only where they sit.

If Voltick has no ES candles, skip the tape switch entirely.

---

## 9 · Replay

### 9.1 Transport bar (docked below the chart, pushes it up, never covers it)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [Fri 09-18 ▾] 5 sessions recorded   10:42 ET   bar 38/78   ◀  ⏯  ▶                   │
│ ●━━━━━━━━━━━━━━━━━━━━━━━━○───────────────────────────────────  [1×▾]  [🔒 Axis] [Live]│
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- Opened from the **⏱ Replay** header button (or a dedicated replay page). A normal card does
  nothing extra until replay is entered.
- **Session picker** lists only days that actually have data, with a count ("5 sessions
  recorded") so a short list reads as a limit, not a bug. If the selected day ages out, fall
  back to the newest.
- Speeds **0.5× · 1× · 2× · 4× · 8×**, about **700 ms per bar at 1×**.
- The cursor is a **time**, not a bar index, so switching 1m → 5m keeps the same moment.
- Candles, bubbles, rail and level tags are all clipped to the cursor time together. They can
  never disagree about what time it is.
- **Live** returns to the live chart.

### 9.2 Behaviour while rewound

- Live price, forming bar and countdown are **off**.
- A finished session does not poll.
- **Axis lock (🔒), default ON in this chart:** the price axis is fixed to the **whole replayed
  session's** high/low range (with normal margins), so levels do not appear to slide as the day is
  revealed. The time axis does not auto-scroll one bar per step (turn off the library's
  "shift on new bar" while locked) or the bubbles shimmer a bar sideways each frame. Re-arm the
  lock on entering replay, picking a session, or pressing Live.
- **Replay stamp inside the pane:** ticker, expiry, session date and cursor time in one corner,
  the Voltick wordmark in the opposite corner. Screen recordings get cropped; a clip of a rewound
  chart that does not say so misleads.

---

## 10 · Status and empty states

Copy follows Voltick rules: no em-dashes, no grey text, plain and specific.

| Shown | When |
|---|---|
| `Loading…` | no candles yet, request in flight |
| `No candles recorded for SPX yet.` | no candles, not loading |
| `No GEX history in view` | bubble data exists but none of it is in the visible window (so an empty layer is never mistaken for a broken one) |
| `No ladder yet` (in the rail) | rail has no data |
| `ES·SPX basis unavailable · levels drawn at SPX cash strikes` | ES tape with no usable basis |

At the very start of a replay, one candle on screen is not "no candles". Base the empty message
on the full day's candles, not the clipped ones.

Demo mode: Voltick's usual `Example data only, not a live quote.` line / DEMO badge applies here too.

---

## 11 · Data the UI needs

Describe these to whatever Voltick's engine / API provides; the UI does not care about route names.

| Data | Shape | Refresh |
|---|---|---|
| Candles | bars `{ time (bar open, ms), open, high, low, close, volume }` for 1 to 7 days | ~30 s poll |
| Live price | latest price for the symbol | push (socket / SSE); poll every 3 s only if the push is silent for 8 s |
| GEX history | per **minute**: `{ time, spot, strikes: [{ strike, net, netVol }] }`, ~**30 strikes** per minute, **nearest expiry**, newest session | ~60 s |
| Expiry list | dates, nearest first | ~5 min |
| Daily EM band | `{ high, low }` for the session, frozen at first read | ~5 min (only so the first read of the day happens on a board left open) |
| ES basis (ES tape only) | one value per session day | ~30 min |

Notes:

- `net` = OI-based GEX + today's volume GEX; `netVol` = volume only. The "GEX basis" setting picks
  between them.
- Ask for ~30 strikes and rank locally; asking for exactly 4 means ranking can never see a new strike.
- **The GEX history is the heavy one** (one row per minute). Keep the reach to one session.
- A reply of `0` or an empty list is normal (pre-open, fresh subscribe), not an error. Never draw it.
- If Voltick's engine only computes the ladder "now" and does not keep a per-minute history,
  **this is the first thing to build**, and the demo feed must produce history too, or the bubbles
  will be empty in the sandbox.
- On a symbol switch, clear the old symbol's GEX history **before** the new one arrives, or the old
  ticker's bubbles draw over the new ticker's candles.

---

## 12 · Feel and performance

- The bubble canvas redraws **only when the view actually changes** (pan, zoom, autoscale, resize,
  or new data). A chart sitting still costs nothing.
- Live ticks go straight to the chart, **never through component state**. Same for the countdown
  (update the DOM node once a second). Same for rail row positions (write only when a row moved).
- A hidden tab or card does no drawing work, and repaints once when it becomes visible.
- Size comes from a resize observer, not a layout read every frame.
- Load the chart library lazily so pages without the chart don't pay for it.

---

## 13 · What is intentionally not included

EMAs, Bollinger bands, RSI, volume profile / TPO overlays, a gamma heatmap, an expiry picker,
bubble tuning sliders or an Auto mode, and a multi-day GEX reach. Leave them out unless asked.

---

## 14 · Don'ts

1. Don't connect bubbles into lines.
2. Don't normalise bubble size per bucket, or "so far" in replay.
3. Don't place bubbles between candles or compute bar times with arithmetic.
4. Don't lower the 11 px dot spacing.
5. Don't draw horizontal lines for Volt / CW / PW. The tag is at the price.
6. Don't move a tag vertically to avoid a collision.
7. Don't recompute the EM band on the client.
8. Don't clamp bad bars or bad basis values. Drop / reject them.
9. Don't use Voltick's reserved colours for anything but their meaning (walls blue, flip violet,
   Volt amber, reversal magenta).
10. Don't use em-dashes, grey text, or buy / sell / signal / target language in any label.
11. Don't hide a control because another is off. Disable it.
12. Don't re-frame the chart on a data poll.

---

## 15 · Build order and acceptance

1. **Data first.** Per-minute GEX history for the nearest expiry exists (live and demo).
   ✔ A request for today returns ~390+ minutes × ~30 strikes.
2. **Candles.** Interval / session / days, ET axis, no grid, volume strip, framing rules.
   ✔ Opening at 09:35 centres the live candle. ✔ Switching 1m ↔ 15m keeps the newest candle on screen.
3. **Bubbles.** Bucketing, stride, size table, placement, overlap, leader.
   ✔ Four bubbles over four 5m candles sit on the candle centres. ✔ 1m → 5m visibly changes the layer.
   ✔ Zoomed all the way out, the 4 strikes still show 4 different sizes.
4. **Pane tags.** Volt / CW / PW chips at their prices, EM band with collision slide.
   ✔ With bubbles off the tags still draw. ✔ CW on EM+ shows two readable chips on one row.
5. **Rail.** 96 px, aligned rows, thinning, hover value.
   ✔ Pan and zoom: every visible rail row stays level with its strike on the axis.
6. **Controls.** Folded header, Layers panel, settings saved per card, copies get a ticker picker.
7. **Phone.** ≤ 760 px: one button + sheet, no rail, 44 px targets, SPX | ES in header.
8. **Replay.** Transport, clipped layers, axis lock default on, stamp in pane.
   ✔ At 8× the bubbles do not shimmer or shrink as the cursor moves.
9. **Polish.** Empty states, demo line, compliance read of every string.
