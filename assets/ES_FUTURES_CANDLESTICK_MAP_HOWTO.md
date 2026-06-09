# Recreating the ES Futures Candlestick Map

This file documents how to rebuild the ES Futures Candlestick Map that was temporarily put offline. The original implementation lives in `pages/overview.js` inside the `positioningState` / `drawPositioningChart` section.

## Goal

Create a self-contained chart panel that:

- Shows ES 5-minute candles.
- Overlays SPX-derived ES levels: Call Wall, Put Wall, and GEX Flip.
- Draws prior RTH high/low and overnight high/low.
- Draws a right-side 0DTE GEX profile converted from SPX strikes to ES-equivalent levels.
- Supports zoom, pan, crosshair, live ES price line, and responsive resize.

## Files To Touch

- `pages/overview.js`
- `pages/overview.html` only if the panel shell needs to be restored or moved.
- `proxy-tastytrade.js` only if candle endpoints or dxLink subscriptions need repair.

## Re-enable The Feature

In `pages/overview.js`, find the constants near the chart code:

```js
const CANDLE_CHART_OFFLINE = true;
const POSITIONING_CHART_OFFLINE = true;
```

Set the ES map flag back to:

```js
const POSITIONING_CHART_OFFLINE = false;
```

Leave `CANDLE_CHART_OFFLINE` alone unless the separate compact candle panel should also return.

## Required Data Flow

The chart uses two ES data sources:

1. Snapshot candles:

```js
proxyGet('/dxlink/candles?symbol=' + encodeURIComponent(positioningState.candleSymbol))
```

Default candle symbol:

```js
candleSymbol: '/ESM6{=5m}'
```

2. Live dxLink websocket stream:

```js
new WebSocket(`${proto}://localhost:3001/ws/dxlink`)
```

Subscribe to:

```js
symbols: [positioningState.candleSymbol, positioningState.tradeSymbol]
```

Default trade symbol:

```js
tradeSymbol: '/ESM6'
```

Check the current ES contract before restoring. If the contract rolled, update both symbols consistently.

## Rebuild Steps

1. Mount the panel in `renderLiveFeedPanel()`.

Use a header with three level chips:

- `positioning-callwall`
- `positioning-putwall`
- `positioning-flip`

Use the chart wrapper and canvas IDs:

- `positioning-chart-wrap`
- `positioning-chart-canvas`
- `positioning-chart-status`

2. Keep all chart state in `positioningState`.

Minimum fields:

```js
{
  candles: [],
  zoomX: 1,
  zoomY: 1,
  offset: 0,
  priceOffset: 0,
  crosshair: null,
  drag: false,
  yDrag: false,
  raf: 0,
  fetchTimer: null,
  resizeObs: null,
  fetching: false,
  hasCentered: false,
  ws: null,
  tradeSymbol: '/ESM6',
  candleSymbol: '/ESM6{=5m}'
}
```

3. Fetch initial candle history.

Implement `fetchPositioningCandles()` to call `/dxlink/candles`, normalize rows to:

```js
{ t, o, h, l, c, v }
```

Sort by `t`, keep the latest session window, and request a redraw.

4. Subscribe to live updates.

Implement `startPositioningDxLinkCandles()` to connect to `/ws/dxlink`, subscribe to candle and trade symbols, then:

- Merge `CANDLE_DATA` rows directly.
- Use trade rows only to reconstruct the current 5-minute candle when no real candle exists yet.

5. Draw the canvas in `drawPositioningChart()`.

Core drawing order:

- Clear and resize canvas using `devicePixelRatio`.
- Calculate visible candle window from `zoomX` and `offset`.
- Calculate price range from visible candles plus overlay levels.
- Draw price grid and right-side labels.
- Draw time labels.
- Draw Call Wall, Put Wall, GEX Flip.
- Draw prior RTH high/low and overnight high/low.
- Draw right-side 0DTE GEX profile.
- Draw candles.
- Draw live ES price line.
- Draw crosshair.

6. Convert SPX levels to ES.

Use the existing helper:

```js
getESLevelsFromSPX(window._levels || {})
```

This depends on:

```js
spxLevelToES(level)
getESCloseBasis()
```

7. Convert SPX 0DTE GEX strikes to ES.

Use `getPositioning0DTEGexRows()`:

- Find the 0DTE expiration in `expiryMap`.
- Combine call/put GEX by strike.
- Convert strike with `spxLevelToES(strike)`.
- Return `{ strike, netGEX }` rows.

8. Restore interactions.

Bind events once in `initPositioningChartEvents()`:

- Mouse drag inside chart: pan through time and price.
- Mouse drag on right axis: vertical scale.
- Wheel: X zoom.
- Shift+wheel or right-axis wheel: Y zoom.
- Double click: reset zoom/pan.
- ResizeObserver: redraw on panel resize.

## Proxy Requirements

`proxy-tastytrade.js` must support:

- `GET /dxlink/candles?symbol=/ESM6%7B=5m%7D`
- `WS /ws/dxlink`
- Candle cache updates from dxLink `Candle` events.
- Trade updates from dxLink `Trade` / `TradeETH` events.

If the chart does not populate, check:

- `/proxy/api/status`
- `candleCache` in the status response.
- Whether the current ES contract symbol matches the active contract.
- Whether `dxHistoryChannelOpen` is true.

## Verification Checklist

- The panel says `ES · 5m · N bars` after load.
- Candles draw across the chart, not compressed into one edge.
- Call Wall, Put Wall, and GEX Flip chips show ES levels.
- Horizontal level lines appear when the level is inside the visible price range.
- Right-side 0DTE GEX profile appears when `expiryMap` has 0DTE data.
- Wheel zoom and drag pan work.
- No repeated websocket reconnect loop appears in the console.
- `node --check pages/overview.js` passes.
- `node --check proxy-tastytrade.js` passes.

## Rollback

To put the feature offline again without deleting code:

```js
const POSITIONING_CHART_OFFLINE = true;
```

The panel will stop fetching candles and stop opening the websocket.
