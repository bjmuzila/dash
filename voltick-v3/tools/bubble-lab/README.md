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

**All of this runs on your laptop.** The lab is a dev tool — it never ships and
it has nothing to do with the VPS. (The VPS only ever gets code through
`push.ps1` -> GitHub -> `docker compose build`, so a file edited locally is not
there yet, and does not need to be.)

### 1. Capture a session — in the browser, no cookie

Open a logged-in **cbedge.net** tab, open devtools (F12) -> Console, paste the
whole of `capture-in-browser.js`, change `NAME` / `NOTE` at the top, press enter.
It downloads one JSON file.

The page is already authenticated, so a same-origin `fetch` carries the session
for free — there is no cookie to copy and nothing to escape.

Move the downloaded file into `cbedge-v3/tools/bubble-lab/fixtures/`.

### 2. Build and open

```bash
cd cbedge-v3
npm run lab
open tools/bubble-lab/lab.html     # Windows: just double-click it
```

That is the whole loop. Edit `bubbles.ts` or `settings.ts`, run `npm run lab`
again (or `npm run lab:watch`), refresh the page.

### The terminal capture, if you want six in a loop

`capture.mjs` does the same three requests from Node, which means it needs the
session cookie handed to it:

```bash
printf '%s' 'PASTE_THE_WHOLE_COOKIE' > /tmp/cb.cookie
node tools/bubble-lab/capture.mjs --name fri-pin --symbol SPX \
  --note "hard pin" --cookie-file /tmp/cb.cookie
```

Cookie: devtools -> Network -> any `/api/*` request -> Request Headers -> Cookie
-> copy the whole value. `--cookie "..."` and `CB_COOKIE=...` work too, and
`--base http://localhost:3000` if you are running it on the VPS.

Do not paste the `...` out of a README as a placeholder — a typographic ellipsis
is above character 255 and an HTTP header cannot hold one, which is what Node's
`Cannot convert argument to a ByteString` means. `capture.mjs` catches that case
and says so, but the browser capture above avoids the whole subject.

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
| `capture-in-browser.js` | paste into the console on a logged-in tab; downloads one fixture. The easy path |
| `capture.mjs` | the same three requests from Node, for scripting a batch. Needs a cookie |
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
