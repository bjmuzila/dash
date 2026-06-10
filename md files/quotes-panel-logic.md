# Quotes Panel Logic

The quotes panel is built from the live DXLink quote cache and then normalized so each row can show a daily percent move.

## What the panel shows

- Symbol label
- Daily percent change
- Up/down color and arrow

The current price is intentionally hidden in the panel. If a price is needed elsewhere, it is still available in the quote data, but the panel itself stays focused on the daily move.

## Data sources

The panel prefers live DXLink data first.

It can use:

- `Quote` data for the latest price and bid/ask
- `Trade` data for the most recent traded price
- `Summary` data for prior-close and session-close context
- batch quote fallback data when the live cache is missing a symbol

## Core rule

The percent move is computed with one simple rule:

1. Use the live percent if the feed already provides a real non-zero percent.
2. Otherwise compute percent from `lastPrice` versus `prevClose`.
3. If a symbol has a special session close requirement, use the summary-derived close first.
4. If the live data is incomplete, fill the missing pieces from batch fallback values.

## Equity behavior

For normal stocks like `AAPL`, the baseline is the previous trading day close.

That means the panel shows:

- current live price versus prior close
- percent change relative to that close

## Futures behavior

For futures like `ES` and `NQ`, the baseline comes from the summary/session close path instead of using the equity logic.

That matters because futures do not behave like cash equities and can have different close timing and settlement behavior.

The proxy now ensures:

- `ES` gets a usable previous-close baseline
- `NQ` also gets a usable previous-close baseline, even when the live summary is incomplete

## Why `0%` happened

The panel was sometimes receiving a live quote without a usable close baseline.

When that happened, it could fall through to `0%` even though the quote itself was valid.

The fix was to normalize the close fields and use a fallback hierarchy instead of trusting whichever field happened to arrive first.

## Implementation notes

Relevant logic lives in:

- `pages/overview/overview.js`
- `proxy-tastytrade.js`

The proxy is responsible for filling in missing close data for futures, especially `NQ`.
The overview page is responsible for rendering the simplified display and computing the final percent.

## Current panel presentation

The panel now shows:

- symbol
- daily percent change only

It does not show the current price.

