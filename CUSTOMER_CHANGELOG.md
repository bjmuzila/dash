# What's New

A plain-language log of updates to the dashboard. Each day compiles into one section.

## Sunday 7/19/2026

* Added a new **Squeeze** page — a single-screen Gamma Exposure board with the live spot, Net / Call / Put / Total GEX, the Call Wall, Put Wall and Zero Gamma (flip) level all across the top.
* The Strike Profile chart shows gamma stacked by strike — green for call gamma, red for put gamma — with the spot marked and the Call Wall and Put Wall strikes outlined, plus an All / Near toggle to zoom to the strikes around price.
* Added a **Gamma Squeeze Screener** that scores how primed the tape is for a squeeze out of 100, calls the bias bullish or bearish, and breaks the score down by gamma regime, wall proximity, flow, volume and dealer positioning — with the key levels and trigger price listed underneath. Everything updates live off the same feed as the rest of the desk.

## Saturday 7/18/2026

* **The 3.0 dashboard is live.** A rebuilt, faster version of the dashboard — the same tools you already use, now on a lighter, quicker-loading foundation that makes moving between pages feel near-instant.

## Friday 7/17/2026

* The Options Chain cells now show the dollar gamma (GEX premium) again instead of a percentage.
* In the Options Chain's OI + Vol view, an ❌ now marks the strike with the biggest volume-driven gamma for each expiration, so you can spot where the day's option volume is piling up.

## Thursday 7/16/2026

* Fixed the Call Wall, Put Wall and Flip lines on the ES candle chart jittering a point or two every time price updated, which also made the whole chart nudge sideways. The levels now hold still and only move when they've genuinely moved.
* Fixed the home page GEX heatmap flickering — it used to add or drop a strike every time price ticked, shuffling the rows under your cursor. The strike list now holds still and only shifts once price has actually moved 5 strikes.
* Every value in the home page GEX heatmap now reads in plain millions with no decimals (like +$412M), so the columns line up and stop twitching as numbers update.

## Wednesday 7/15/2026

* The ES candle chart is now a tab right on the main GEX chart on the home page — click **ES Candles** to swap the gamma bars for the live 5-minute chart, and click **GEX** to swap back. It's the full chart with its own toolbar, and it opens with the gamma bubbles already turned on.
* ES Candles has moved off the bottom of the home page, out of the Economic Calendar row.
* Added an optional **VSA** overlay to the ES candle chart that highlights candles where the effort and the result don't match — heavy volume that went nowhere (absorption), or a big move nobody showed up for (a run through thin liquidity). Flagged candles are drawn hollow so they stand out at a glance. Volume for each bar is compared against what's normal *for that time of day*, so the 9:30 open isn't judged against lunch. Five sliders let you tune how strict it is — start loose, then tighten until only the genuinely unusual bars get marked.

## Wednesday 7/15/2026

* The TPO Structures tab now labels today's profile in plain English — the levels the market left behind are outlined right on the chart, and hovering one tells you what it is and what it usually means ("Excess high — selling tail. Singles at the high, period closed back inside. Fade it.") instead of a colored tick mark you had to decode.
* The "Open business" list now names each level the same way, so a rejection high and an unfinished high no longer look alike at a glance — they're opposite trades.
* Added 5 / 10 / 30-session views to the TPO profile. The chart opens on today's profile centered on price, and the 30-session view also gives the historical hit rates a much deeper sample to work from.

## Tuesday 7/14/2026

* Added a new **Stat Prompter** tab to the Scanner — a library of ready-made questions about how the opening-hour range behaves, answered on nine years of ES and NQ history with one click. Ask things like "ES broke the high but NQ broke the low — who's usually right?", "when a breakout fails, does it just chop or does it rotate all the way to the other side?", and "if we're still stuck inside the range at 2pm, which way does it break into the close?"
* The Stat Prompter opens with a live map of today's opening range — your actual high, low and midpoint, with every extension target priced out in points and labelled with how often the market has historically reached it. It tells you plainly that those odds assume a breakout actually happens, so a level with a big number next to it doesn't get over-trusted.
* Added time-of-day, volatility and trend-vs-chop stats built from nine years of one-minute bars — when the range actually shows up during the day, how big a typical bar is at each hour, and whether the market at your timeframe tends to keep going or snap back.
* Added a 0DTE button to the Options Flow filters — one click jumps the tape and chart to today's expiration (or the nearest contract if there isn't one), and clicking it again goes back to all expirations.
* Fixed the Recent ticker dropdown on the Flow page hiding behind the Net Drift chart.
* Replaced the Balance / Imbalance scanner tab with a new **TPO Structures** tab — a classic Market Profile letter chart of the last 5 sessions, so you can see where the market actually spent its time and where it just passed through.
* The chart is drag-to-pan and zoomable, and a Split view spreads the letters out by time so you can watch the session's auction develop period by period.
* Alongside it, an "Open business" list tracks the levels the market left unfinished — rejection highs and lows, unfinished extremes it's likely to come back and take out, and thin gaps it tends to race through — showing how old each one is, how far it sits from price, and whether it's ever been retested.

## Monday 7/13/2026

* Added a market State Rail to the Greeks tab on the home page — four live power bars showing the dealer gamma regime, whether volatility is cheap or expensive right now, which way dealer hedging is leaning, and where the options skew sits, with a plain-English "current play" call underneath (sell premium, buy convexity, fade the range, or stand aside).
* The volatility bar compares what the market is *actually* doing to what options are *charging* for it — so you can see at a glance whether premium is rich or cheap, rather than guessing. When the live price feed goes quiet it now says so instead of showing a confident but meaningless reading.
* Fixed the GEX levels on the ES Candles chart. Because SPX and ES futures trade at a gap that changes over time, older levels on the chart were being placed using today's gap — so the further back you looked, the more wrong they were. Every day's levels now use that day's own gap, so the heatmap bands and the CB line finally sit where they actually were.
* The chart's levels are no longer thrown off outside market hours. When the cash market is closed, SPX stops updating while futures keep moving, and the chart was mistaking that for a real change — putting every level tens of points off. It now holds the last true reading until the market reopens.
* The heatmap no longer goes blank from the 6pm futures open through midnight — the overnight session now shows.
* Fixed the ES Candles snapshot printing the chart twice in one image.
* GEX bubbles are now solid-colored instead of hollow rings, and the three biggest strikes in each minute stand out clearly so you can see where the gamma is at a glance.
* The IB Stats tab on the Scanner now shows all 14 Initial Balance rules against today's live session in one place, right at the top: today's IB high, low, mid and width, whether the IB has formed yet, and every rule sorted into what's in play, what hasn't triggered yet, and what simply isn't on the table today.
* Rules that haven't triggered yet now show you the odds *if* they do fire — so before a break even happens, you can see how often that break historically runs, fails, or reverses.
* Before 10:30am the board clearly labels every read as provisional, since the IB isn't final until then.
* Fixed the IB width tables, which were showing all zeros — narrow, normal and wide day-type stats now populate correctly.
* Fixed a bug where the previous day's session could bleed into today's Initial Balance levels.

## Monday 7/13/2026

* ES Candles has a new **Bubbles** overlay: every minute it drops a bubble at each strike, sized by how much gamma is sitting there — blue for calls, red for puts. Watch the bubbles swell and shrink through the day to see exactly where dealers are building or bleeding gamma. It loads with the full session already filled in, and there's a slider to dial the bubble size to your taste.
* The old GEX Lines overlay has been retired — the bubbles show the same thing with a time dimension.

## Sunday 7/12/2026

* Fixed the Inverse FVG setup, which had barely been logging anything — it had recorded just 3 setups in a month when it should have been finding several a day. It now tracks properly (124 over the last 18 sessions).
* Corrected how ICT setup results are scored. The old scoring was accidentally using price information that wouldn't have been available at the time of entry, which made the win rates look far better than they really were. All the stats on the results page are now measured honestly, so expect the numbers to be lower — and trustworthy.
* Order Block and Judas Swing setups are now recorded at the moment you could actually take the trade, rather than at a price that was only identifiable in hindsight.
* Removed the Dark Pool section from the Flow page — the off-exchange print data wasn't reliable enough to trade off of, so it's gone rather than left as noise.
* GEX Scanner now opens with a Top 10 card grid showing the biggest gamma moves of the last 15 minutes at a glance, filtered to strikes at least 5% out of the money by default.
* Retired the Greeks Sensitivity and Vol Pin tabs from the Scanner to keep the page focused on the tools that are actually working.
* The Economic Calendar now shows earnings right in the schedule: the biggest companies reporting each day (over $100B in market cap) appear as their own row — premarket names before that day's news, after-hours names after the 4pm close — with a company logo and ticker for each.
* The Scanner's IB Stats tab now leads with a live read of today's session: a breakout-direction gauge, an expansion matrix showing the odds of a one-sided trend vs a two-sided chop day, the tactical rule that's active right now, and one overall bullish-or-bearish break score.
* The long historical stat tables are tucked away so the tab opens straight to what matters for today's trade.
* The GEX heatmap has a new Vol GEX Speed column showing how fast volume-based gamma is being built up or torn down at each strike over the last 30 seconds, minute, or 5 minutes — a wall growing as price approaches it often means a pin, while one draining away can mean a breakout is coming.

## Saturday 7/11/2026

* New "IB Stats" tab in the Scanner — every Initial Balance (9:30–10:30) trading rule backtested over nine years of ES and NQ data, ranked by hit rate so you can see at a glance which ones actually have an edge and which are coin flips.
* IB Stats also shows when the initial balance typically breaks, how the day of the week changes the odds, what counts as a narrow vs wide opening range, and how far breakouts usually run — with an ES / NQ switcher.

## Friday 7/10/2026

* The Signals feed on the Home page now updates itself — live CB, options-flow, and GEX wall & flip alerts appear automatically during market hours, on top of any you write in by hand.
* The GEX scanner has a new "Best overall" ranking that blends dollar size with percentage growth, plus Strong / Big % / Very strong tags (with thresholds you can adjust) to surface the highest-conviction strikes.
* Swapped the scanner's All/OTM filter for a clearer Positive / Negative switch — Positive finds out-of-the-money strikes above price with growing positive gamma, Negative finds ones below price with growing negative gamma — plus an adjustable "how far out-of-the-money" distance selector.
* Flow GEX is now more accurate — trades that can't be confirmed as a buy or a sell (no live bid/ask at the time) no longer skew the reading, and the volume-based version can now reflect whether that volume was actually buying or selling.

## Thursday 7/9/2026

* Added new Flow, Greeks, Scanner, and ES Candles tabs right on the Home page next to the Economic Calendar — check them without leaving Home.
* Fixed the SPX Flow view loading slowly.
* Continued building the new homepage design — the option chain now follows the ticker switcher at the top, and sizing/scrolling is fixed so everything fits your window properly.
* Greek gauges on the new homepage are now simple trend-line sparklines (green when positive, red when negative) instead of dial gauges.
* Top stat cards on the new homepage now show 5 and 15 minute call/put wall history alongside live bull/bear and in-the-money/out-of-the-money percentages.
* The floating menu button on the new homepage now opens real popups — Economic Calendar, Option Flow (with an adjustable minimum premium setting), Notes, and quick links to Trader Dashboard and Analytics.
* On the Option Chain page, you can now click any 0DTE SPX price to pull up that specific contract's flow history chart — and fixed that chart getting stuck loading.
* Option Chain page: the price you're centered on now stays in the middle of the table when it loads, and the "% strikes shown" dropdown is back.

## Wednesday 7/8/2026

* Fixed font sizing on the Walls & Flows test tab — text is now consistently readable at 15px with 16px titles for better hierarchy and scannability.
* Removed ES Candles from the Quick Pages sidebar pin menu — the sidebar now shows only the most-used dashboard pages.

## Tuesday 7/7/2026

* Fixed ES Candles heatmap drifting throughout the day — GEX levels now stay locked in place instead of moving around as market conditions change, so intraday price action aligns with the levels you saw earlier.
* Initial Balance card on Analytics now shows the IB high, mid, low, and range prominently at the top, plus live rule evaluations (Inside Day Exception, Timing Curve, Single-Break vs Double-Break patterns) that update as the session develops.
* Confidence Score card now correctly shows "HIT" when a breakout is hit but continues lower instead of reversing — no false "pivot" labels when the market trends through multiple checkpoints.
* Added a new Dark Pool view to the Flow page — see the heaviest price levels where off-exchange (dark pool) activity has been concentrated for your selected ticker, with a quick toggle between Intraday, 5-day, and 7-day views.
* Flow page text is now bigger and easier to read, with brighter white labels throughout.

## Monday 7/6/2026

* Added an early-preview "Regime Engine" tab to the Test Lab — detects whether ES/NQ futures are trending, choppy, or panicking, with a probability tree showing likely paths ahead.
* Test Lab's GEX Levels strike table now shows the strikes closest to price by default, with the rest just a scroll away.
* Volatility Pin Scanner now sorts the strongest pin setups (Pinning, then Squeezing) to the top automatically, and every column header can be clicked to sort the table however you like.
* Fixed the Options Positioning cards (SPX, NDX, SPY, QQQ) that were stuck showing "no data" — they now update live from the scanner.
* Added a new "Your Watchlist" row under Options Positioning — type in any 4 tickers you want to track, and your picks are saved to your account.
* Added a new "Words from Bzila" card to the top of the Traders Dashboard — click to expand and read the latest note.
* The sign-in and sign-up page is now wider and easier to use.
* Password reset emails now match our branded look instead of a plain, generic message.

## Sunday 7/5/2026

* The AM TBR indicator on ES Candles now draws right on top of the live candle chart using real price data, instead of a separate mock preview chart underneath.
* Added a new "Test Lab" section to the menu — an early preview area for experimental features (GEX Levels, Flow Inventory, Options Positioning), with an overview page explaining what each one does. These are early builds, so feedback is welcome.
* Cleaned up the AM TBR description text on ES Candles.
* New TPO toggle on ES Candles — shows a rolling overnight/day-session profile (value area high/low, point of control, and midpoint) right on the chart.
* The GEX-by-strike rail on ES Candles now resizes its bars to match the chart when you zoom in or out, so they're always easy to read and never overlap.

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
