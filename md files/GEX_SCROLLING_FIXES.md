# GEX Chart Scrolling Fixes

## Main Cause

The SPX chart was not actually blocked by the Bzila Flow tab.

The real issue was that a later TastyTrade adapter override was still fetching the main SPX GEX chain with:

```js
range=100
```

That gave the chart only a narrow strike window around spot. Mouse wheel zoom and drag pan were working, but there were not enough extra strikes loaded for SPX to scroll or resize into.

The working fix was changing the adapter fetch to:

```js
range=all
```

Specifically:

```js
const resp = await fetch(`http://localhost:3001/proxy/api/tt/chains/${tickerEncoded}?range=all`);
```

This must be applied anywhere the overview SPX GEX chart fetches its chain data, especially late-file adapter overrides that replace `fetchGEX`.

## Files Fixed

- `pages/overview.js`
- `index.html`
- `pages/index.html`

The HTML files were only updated to bump the cache token so the browser loads the latest chart code.

## Required Fetch Rules

For the main SPX GEX chart:

```js
/proxy/api/tt/chains/SPX?range=all
```

or, inside the adapter:

```js
const tickerEncoded = encodeURIComponent(ticker === 'SPX' ? '$SPX' : ticker);
const resp = await fetch(`http://localhost:3001/proxy/api/tt/chains/${tickerEncoded}?range=all`);
```

For lazy DTE expiration loading:

```js
/proxy/api/tt/chains/SPX?range=1000&expiration=YYYY-MM-DD
```

or use `range=all` if full strike navigation is needed for every expiration.

For SPY/QQQ comparison charts:

```js
/proxy/api/tt/chains/SPY?range=all
/proxy/api/tt/chains/QQQ?range=all
```

## Scrolling Logic

The chart uses a viewport object:

```js
let ovViewport = {
  count: DEFAULT_GEX_STRIKE_COUNT,
  leftStart: null,
  rightStart: null
};
```

- `count` is how many strikes are visible.
- `leftStart` is the first visible SPX strike index.
- `rightStart` is the first visible SPY/QQQ strike index.

Wheel scrolling changes `count`.

Dragging changes `leftStart` or `rightStart`.

## Cursor-Anchored Wheel Zoom

The wheel handler should zoom toward the mouse cursor, not just zoom from the center.

```js
const onWheel = e => {
  if (!rawChain.length) return;

  tooltip.style.display = 'none';
  e.preventDefault();
  e.stopPropagation();

  const p = panelForEvent(e);
  const panelLeft = p.side === 'right' ? p.rect.width / 2 : 0;
  const panelW = Math.max(1, p.rect.width / 2);

  const anchor = {
    side: p.side,
    fraction: ovClamp((p.x - panelLeft) / panelW, 0, 1)
  };

  const factor = e.deltaY > 0 ? 1.16 : 0.86;
  applyCount((ovViewport.count || DEFAULT_GEX_STRIKE_COUNT) * factor, anchor);
};

scroll.addEventListener('wheel', onWheel, { passive: false });
```

Important: `passive:false` is required because the handler calls `preventDefault()`.

## Apply Count Logic

This preserves the strike under the mouse while zooming.

```js
const applyCount = (nextCount, anchor = null) => {
  const compareSource = compareRawChain.length
    ? compareRawChain
    : buildFallbackCompareRows(overviewCompareTicker);

  const leftRows = ovBuildChartRows(rawChain);
  const rightRows = ovBuildChartRows(compareSource);
  const maxLen = Math.max(leftRows.length, rightRows.length, MIN_GEX_STRIKE_COUNT);

  const oldCount = ovViewport.count || DEFAULT_GEX_STRIKE_COUNT;
  const count = ovClamp(
    Math.round(nextCount),
    MIN_GEX_STRIKE_COUNT,
    Math.max(MIN_GEX_STRIKE_COUNT, maxLen)
  );

  if (count === oldCount) return;

  const nextStart = (side, rows, fallbackStart) => {
    const rowCount = rows.length;
    if (!rowCount) return 0;

    const visibleOld = Math.min(oldCount, rowCount);
    const visibleNew = Math.min(count, rowCount);
    const oldStart = ovClamp(fallbackStart || 0, 0, Math.max(0, rowCount - visibleOld));

    let dataIndex;
    let fraction;

    if (anchor && anchor.side === side) {
      fraction = ovClamp(anchor.fraction, 0, 1);
      dataIndex = oldStart + fraction * visibleOld;
    } else {
      fraction = 0.5;
      dataIndex = oldStart + visibleOld / 2;
    }

    return ovClamp(
      Math.round(dataIndex - fraction * visibleNew),
      0,
      Math.max(0, rowCount - visibleNew)
    );
  };

  ovViewport.leftStart = nextStart('left', leftRows, ovViewport.leftStart);
  ovViewport.rightStart = nextStart('right', rightRows, ovViewport.rightStart);
  ovViewport.count = count;

  setConfiguredStrikeCount(count);
  markOverviewUserInteraction();
  drawOverviewChart();
};
```

## Drag Pan Logic

Dragging should move the strike start index.

```js
const beginDrag = e => {
  if (e.button !== undefined && e.button !== 0) return;

  const p = panelForEvent(e);
  tooltip.style.display = 'none';

  const info = rowsForSide(p.side);
  if (!info.rows.length) return;

  drag = {
    side: p.side,
    startX: e.clientX,
    startLeft: ovViewport.leftStart || 0,
    startRight: ovViewport.rightStart || 0,
    pxPerStrike: Math.max(
      2,
      p.rect.width / 2 / Math.max(1, ovViewport.count || DEFAULT_GEX_STRIKE_COUNT)
    )
  };

  markOverviewUserInteraction();
  canvas.style.cursor = 'grabbing';

  try {
    scroll.setPointerCapture(e.pointerId);
  } catch (err) {}

  e.preventDefault();
};
```

```js
const continueDrag = e => {
  if (!drag) return;

  const dx = e.clientX - drag.startX;
  const shift = Math.round(-dx / drag.pxPerStrike);
  const side = rowsForSide(drag.side);
  const maxStart = Math.max(
    0,
    side.rows.length - Math.min(ovViewport.count || DEFAULT_GEX_STRIKE_COUNT, side.rows.length)
  );

  if (drag.side === 'right') {
    ovViewport.rightStart = ovClamp(drag.startRight + shift, 0, maxStart);
  } else {
    ovViewport.leftStart = ovClamp(drag.startLeft + shift, 0, maxStart);
  }

  markOverviewUserInteraction();
  drawOverviewChart();
  e.preventDefault();
};
```

## Event Binding Fix

Do not bind duplicate handlers every time the overview page redraws.

```js
function initOvEvents() {
  const scroll = document.getElementById('overview-scroll');
  const canvas = document.getElementById('overview-canvas');
  if (!scroll || !canvas) return;
  if (scroll.dataset.ovNavReady === '1') return;

  scroll.dataset.ovNavReady = 'binding';

  scroll.style.overflow = 'hidden';
  scroll.style.touchAction = 'none';
  scroll.style.userSelect = 'none';
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.cursor = 'grab';

  scroll.addEventListener('wheel', onWheel, { passive: false });
  scroll.addEventListener('pointerdown', beginDrag);
  scroll.addEventListener('pointermove', continueDrag);
  scroll.addEventListener('pointerup', endDrag);
  scroll.addEventListener('pointercancel', endDrag);

  scroll.dataset.ovNavReady = '1';
}
```

Avoid assigning both:

```js
scroll.onwheel = onWheel;
canvas.onwheel = onWheel;
scroll.addEventListener('wheel', onWheel, { passive:false });
```

That can create confusing behavior and browser warnings.

## Bzila Flow Check

Bzila Flow should not block the GEX chart if the views are toggled like this:

```js
if (chartView) chartView.style.display = isChart ? 'flex' : 'none';
if (bzilaView) bzilaView.style.display = isBzila ? 'flex' : 'none';
```

Because the inactive tab is `display:none`, it cannot intercept wheel or pointer events.

## Cache Busting

After changing `pages/overview.js`, update the script token in both HTML entry files:

```html
<script src="pages/overview.js?v=NEW_VERSION"></script>
```

Files:

- `index.html`
- `pages/index.html`

Then hard refresh the browser.

## Quick Debug Checklist

1. Confirm browser is loading the newest `overview.js?v=...`.
2. Confirm SPX chain request uses `range=all`, especially in the late adapter override.
3. Confirm SPX proxy response has hundreds of strikes, not only a narrow range.
4. Confirm `overview-scroll` has the wheel listener.
5. Confirm `ovViewport.count` changes when using mouse wheel.
6. Confirm `ovViewport.leftStart` changes when dragging the SPX side.
7. Confirm `ov-bzila-view` is `display:none` while chart is active.

