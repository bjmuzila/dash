# Bubble Lab

A contact sheet for the GEX bubble layer: **the live `bubbles.ts`, drawn against
frozen real sessions, all of them at once.**

## Why this exists

Every tuning round on this layer was the same loop: look at one live chart,
change a constant, deploy, look again tomorrow. One sample per twenty minutes,
and the sample is whatever the market happened to do that day — so a change that
fixes a pinned Friday quietly wrecks a trend day and nobody finds out for a week.
That loop produced, in order: eleven bands when the setting said four, rows
dashed into dots, caterpillar lumps, thirty-pixel bands, and a session-wide
ranking that deleted the day's biggest wall because gamma grows into the bell.
Every one of those is visible in two seconds on a sheet of six sessions.

An HTML mockup with sliders does not work either, and it is worth being precise
about why: it is not the renderer that ships, and it is not real data. Both
diverge the moment either side is touched. This tool bundles the **actual
modules** — `entry.ts` re-exports `bubbles.ts` and `settings.ts`, nothing is
copied — and feeds them **captured sessions**. If a cell here looks right, the
card looks right, because the layer never sees anything but the four functions in
`BubbleGeometry`.

## Use it

```bash
cd cbedge-v3

# 1. freeze a session (needs a logged-in cookie for the API routes)
node tools/bubble-lab/capture.mjs --name fri-pin --symbol SPX \
  --note "hard pin, price parked on 7700 all afternoon" \
  --cookie "sb-access-token=…; sb-refresh-token=…"

# 2. bundle the live modules + every fixture
node tools/bubble-lab/build.mjs        # or --watch while editing bubbles.ts

# 3. open it — no server, file:// works
open tools/bubble-lab/lab.html
```

Sliders on the left mutate `BUBBLE_AUTO` and `BUBBLE_STYLE` in place and redraw
every cell. When it looks right, **Copy constants** puts them on the clipboard in
the shape `settings.ts` wants them pasted. Nothing in this page writes to the
app.

## The fixtures to capture

One of each, and keep them forever. These are the days that have broken this
layer:

| name | what it stresses |
|---|---|
| a hard pin | one wall, price parked on it — the case where everything looks fine |
| a flat board | six strikes within a few percent, nothing dominant — the ladder is unrankable if the curve is wrong |
| a trend day | price travels 50+ points, the ladder migrates — rows must enter and leave without dashing |
| a lopsided board | the whole top of the board on one side of spot — the min-per-side rule |
| a half day | short session, so the time-of-day scale is stressed at both ends |
| an overnight | captured pre-open, book frozen — the layer must draw something sane |

Each cell also prints two numbers: **rows** (what a vertical slice holds — this
should equal `levels`) and **strikes** (how many distinct rows the whole trail
carries). When those two diverge wildly, the selection is drifting per column.
That single readout is what would have caught the eleven-band bug on day one.

## Files

| file | |
|---|---|
| `capture.mjs` | hits `/api/expirations`, the GEX history route and `/api/snapshots/etf-candles`, writes `fixtures/<name>.json` |
| `build.mjs` | esbuild-bundles `entry.ts` → `lab.bundle.js`, inlines fixtures → `fixtures.js` |
| `entry.ts` | re-exports the live modules; the only file that knows where they live |
| `lab.html` | the sheet, the synthetic geometry, and the controls |

`lab.bundle.js`, `fixtures.js` and `fixtures/*.json` are generated and
git-ignored. The three source files are not — they are the tool.

## The one thing to keep true

`bubbles.ts` stays split: `buildBubbleModel()` pure over columns, `drawBubbles()`
pure over a `BubbleGeometry`. That split is what lets this page render the real
thing with a linear stand-in for lightweight-charts' scales and no chart library
at all. If either half starts reaching for a chart object, the lab stops being
able to test what ships — and the twenty-minute screenshot loop comes back.
