# What's New

A plain-language log of updates to the dashboard. Each day compiles into one section.

## Thursday 7/2/2026

* Analytics page loads a bit faster — removed a duplicate data pull that was fetching the same chart history twice.
* Redesigned the Options Flow page — pick any watched ticker to see its live "Net Drift" chart of call vs put premium across the full 9:30–4:00 trading day, with a volume bar and a raw order stream below.
* Options Flow now tracks the full watchlist of tickers, and the chart fills in the whole day's history from the market open instead of only what's happened since you opened the page.
* Redesigned the Greeks page — GEX, DEX, CHEX and VEX now show as clean dial gauges (zero at top, green for positive, red for negative) instead of the old mini-charts.
* Added a live GEX/DEX zero-line crossings log so you can see exactly when dealer positioning flips sign, with noise filtering so brief blips don't create false flips.
* Added a Data On/Off button on the Greeks page so you can pause the live feed when you're not watching.
* Fixed false "flips" caused by a stale price feed — the SPX price is now checked for freshness before it's used, plus a live feed-health indicator on the owner page.
* Greeks now update in real time from a single live feed instead of refreshing once a minute.

## Tuesday 6/30/2026

* Dashboard loads faster — the live feed warms up on its own and reconnects automatically if data hiccups.
* New sign-in experience — Google or email/password with a cleaner, on-brand login screen.
* GEX chart appears instantly on page load with snappier live updates.
* Fixed Volume Net GEX showing blank on 0DTE — Volume-Only and combined Net GEX now read correctly.
* General home page speed improvements across the board.

## Monday 6/29/2026

* Upgraded to a new market data provider for faster, more accurate options, greeks, and index pricing.
* Loaded 2 years of historical gamma data to power Confidence Score and MVC comparisons.
* Confidence Score now works on weekends and pre-market — falls back to last session's data automatically.
* New Confidence tab on Results tracks 9:45, 10:30, and noon MVC levels each day.
* Fails page improvements — open fades show "OPEN," levels stay marked correctly, and history moved to its own tab.

## Sunday 6/28/2026

* Live subscriber chat added to the notes panel — members can talk in real time.
* Beta countdown launched — beta opened June 30, official launch July 3.
* Estimated Moves expanded to 500+ stocks with footprint & order-flow strategies coming in August.
* Full dashboard visual refresh — consistent dropdowns, cards, toolbars, and pickers across every page.
* ICT chart upgraded with a full week of history, switchable timeframes, and live-setup prioritization.

## Saturday 6/27/2026

* Added this What's New page so you can follow along with updates.
* New floating toolbar design with a glowing blue/teal border.
* Streamlined GEX navigation to the most-used pages.
* Estimated Moves win/loss scoring is now more accurate.
* Various performance and reliability improvements behind the scenes.
