# What's New

A plain-language log of updates to the dashboard. Each day compiles into one section.

## Sunday 7/5/2026

* New: haven't subscribed yet? You can now check out the Home page and Multi Greek page for free with your account — data refreshes about every 30 minutes instead of live.
* Added a "50% off with code CB-BETA" banner on the free preview pages to make the current beta discount easy to spot.
* The quick-access side panel and menu now clearly show Home and Multi Greek as available on the free plan, with everything else marked "Upgrade" until you subscribe.

## Saturday 7/4/2026

* The Estimated Moves page now shows a Recent Track Record for any ticker you look up — whether last week's estimated move was a hit or miss, plus the hit rate over the last 5 weeks.
* ES Candles now calls out actionable trade signals — it watches the key levels on the heatmap (the flip, the call and put walls, and the CB level) and flags long or short setups in a new "Signals" strip as price reacts to them.
* Fixed Estimated Moves weekly scoring — the latest week's win/loss results now record correctly (this Saturday's run scored the full 379-ticker board).
* Each signal is rated 1–5 so the strongest setups — especially where several levels stack up — stand out at a glance. These are alerts to guide your own trades; the dashboard never places orders for you.

## Friday 7/3/2026

* The Options Chain toolbar now shows a running total of the selected greek across every strike and expiration on screen, updating instantly as you switch between GEX, DEX, CHEX and VEX.
* Added a Volatility Skew Calculator to the Greeks page — plug in put, call, and at-the-money implied vol to see the skew instantly, with a plain-English guide on what each skew level means and how to trade it.
* New quick-access GEX panel — tap the new toolbar button to slide open a side panel and jump between Home, ES Candles, Multi Greek, Flow, Analytics and more without leaving your current page.
* ES Candles now opens cleanly inside the new panel, with the toolbar and chart resizing to fit the space.
* Multi Greek keeps SPX, SPY and QQQ side by side in the panel, and its numbers are easier on the eyes with a softer white.

## Thursday 7/2/2026

* Analytics page loads a bit faster — removed a duplicate data pull that was fetching the same chart history twice.
* Redesigned the Options Flow page — pick any watched ticker to see its live "Net Drift" chart of call vs put premium across the full 9:30–4:00 trading day, with a volume bar and a raw order stream below.
* Options Flow now tracks the full watchlist of tickers, and the chart fills in the whole day's history from the market open instead of only what's happened since you opened the page.
* Redesigned the Greeks page — GEX, DEX, CHEX and VEX now show as clean dial gauges (zero at top, green for positive, red for negative) instead of the old mini-charts.
* Added a live GEX/DEX zero-line crossings log so you can see exactly when dealer positioning flips sign, with noise filtering so brief blips don't create false flips.
* Added a Data On/Off button on the Greeks page so you can pause the live feed when you're not watching.
* Fixed false "flips" caused by a stale price feed — the SPX price is now checked for freshness before it's used, plus a live feed-health indicator on the owner page.
* Greeks now update in real time from a single live feed instead of refreshing once a minute.
* Added a Combined view to Options Flow — see order flow across every ticker on one tape, with a one-tap switch to exclude the big indexes (SPX, NDX, etc.).
* The Combined flow view now lets you filter for the really big trades — the premium slider goes all the way up to $5 million.
* With a premium filter set, the Combined tape now reaches back across the whole trading day instead of just the most recent activity.
* Polished the buttons and view switchers on the Options Flow page to match the rest of the dashboard's look.

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
