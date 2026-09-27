# Voltick · Chart ⚙ menu (proposed)

Proposal, 2026-09-26. Mocked up on voltick.cbedge.net/mockups → ⚙ Chart.
Old version: `web/src/HeatChart.jsx` (Style / Indicators / Draw popover).

## Summary

| | Old | New |
|---|---|---|
| Toolbar buttons | 4 (Style, Forward ▾, Trails, Full screen) | 3 (⚙ Chart, ✎ Draw, ⛶) |
| Popover tabs | Style · Indicators · Draw | Look · Layers · Studies |
| Controls on the first tab | ~22 | 11 |
| Places to toggle Trails | 2 | 1 |

## Toolbar

```
[⚙ Chart ▾] [✎ Draw] [⛶]
```

- **⚙ Chart ▾** opens the one popover (was "⚙ Style").
- **✎ Draw** is a tool, so it arms straight away. While drawing, a slim strip
  appears under the toolbar: `[colour] [⤺ Undo] [Clear]  Click a start point, then an end point · Esc to stop`.
- **⛶** full screen.
- **Forward ▾** and **● Trails** leave the toolbar (both move to Layers).

## Popover · three tabs by intent

### Look · how busy, how bold

| Row | Control |
|---|---|
| Preset | 3 cards: **Full** (every layer, full strength) · **Calm** (every layer, drawn quietly) · **Minimal** (named levels only). Changing anything below shows "● Custom". |
| How many | Slider 4 to 14 (was "Levels shown") |
| Named levels only | On / off (was "Key levels only") |
| Line length | Full · Stub · Tag (was Extended · Small · Labels) |
| Boldness ▾ | Folded to one line: `gamma 24 · nodes 43 · dark pool 0`. Opens to 3 sliders: Gamma levels, Node levels, Dark pool. |

### Layers · what is drawn, one row each

Each row: on/off switch, name, one-line hint, and (when on) a small style choice.

| Layer | Style choice |
|---|---|
| Level trails | Core · Ribbon · Path |
| Prior levels | 1d · 3d · 5d |
| Forward | Today · Week |
| Session ranges (prev day, pre-market, opening range) | Lines · Hairlines |
| Extended hours | none |
| Volume | Under · Own strip |
| Watermark | Large · Corner |

### Studies · only what is on the chart

- Lists the studies in use (e.g. EMA 9, VWAP), each with on/off, length and ✕.
- One **＋ Add a study** opens the catalogue:
  EMA · SMA / VWAP · VWAP bands / RSI · MACD · Williams %R.

### Footer

`Saved on this device                ↺ Reset`

## What changed and why

| Change | Why |
|---|---|
| Draw → toolbar button | It is a tool you use, not a setting you keep. |
| Forward ▾ → Layers | One more thing drawn on the chart. |
| Trails button → Layers | Two doors to one switch became one. |
| "Fine tune the six" (8 rows) → dissolved | Each hidden switch was really a style of a layer: Watermark Large/Corner, Volume Under/Own strip, Session ranges Lines/Hairlines. |
| Density → Preset cards | Each card says what it does; any change shows "Custom". |
| How bold → one fold under Look | Three sliders most people never move. |
| Indicators → Studies with one Add | Seven always-visible rows became only the ones in use. |
| Bubble rows → removed | Trail style covers it. |
| "YOUR DEVICE REMEMBERS" → footer | Said once, with Reset beside it. |
