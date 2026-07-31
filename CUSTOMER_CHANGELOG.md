# What's New

A plain-language log of updates to the dashboard. Each day compiles into one section.

## Friday 7/31/2026

* The ES Candles page now loads noticeably faster — it was opening three separate live-data connections at once and downloading several times more data than it actually used. The home dashboard got the same treatment.
* Fixed the historical GEX bubbles and heatmap not showing at all. The chart was only ever drawing the live minute going forward; everything earlier in the session was silently failing to load.
* Redesigned the Overlays menu — the toggles now sit in two columns instead of one long list, the sliders line up properly, and every slider has up/down arrows so you can nudge a value by exactly one step instead of fighting the handle.
* The CB line moved into the Bubbles controls and can now be switched off. It was always on before, with no way to hide it — and the top bubble already marks the same strike.
* Removed the VSA candle coloring.
* Switching between ES, SPY and QQQ now re-centers the chart on the new symbol's price. Before, jumping from ES to SPY left the price axis stuck up at ES levels with the candles off-screen.
* The current-price line is now a neutral gray instead of flipping green and red with each bar, so it stays readable against the Call Wall / Put Wall levels.
* Added the weekly estimated-move bands to the PDH/ON overlay button, now labelled PDH/ON+EM.
* The Overlays menu no longer runs off the edge of the screen on smaller laptop displays, and it scrolls instead of overflowing when the window is short.
* Fixed the missing site icon in the browser tab.

## Thursday 7/30/2026

* Hovering any of the four Strike History charts now shows the reading right on the chart — the value in a tag beside your cursor and the time on the bottom axis — instead of only in the summary line above. Spot reads to the cent while you hover.

## Wednesday 7/29/2026

* Added a new **OI** tab to the Option Chain, next to GEX, DEX, CHEX and VEX — it shows the open interest sitting at each strike, with calls above the current price and puts below.
* The OI tab also shows how much open interest changed overnight, so you can see the positioning that was actually opened or closed since the previous session. It needs two days of readings before the change column fills in.
* Fixed the Option Chain date header — a sliver of the rows underneath is no longer visible above it while you scroll.
* The sector wheel on the Traders Dashboard now labels the biggest winners and losers right on the wheel, and the middle reads **S&P 500** — or the sector name once you click in to zoom.
* Added a **Snapshot** button to the Traders Dashboard. One click copies a picture of the whole page to your clipboard, ready to paste straight into Discord or a note.
* Fixed the sector wheel's Top/Bottom list printing on top of the wheel on wider screens.

## Tuesday 7/28/2026

* Smoothed out the spot price in the Option Chain Replay — it now glides between updates instead of jumping every few frames, and the dashed spot line lines up correctly with the price axis.

## Monday 7/27/2026

* Started the new Options dashboard layout — ticker dropdown with Favorites and Watchlist, a daily/yearly heatmap, the S&P 500 sunburst, a candlestick chart and live orderflow, all following whichever ticker you pick.
* The heatmap and sunburst now stay on screen no matter which Options tab you're on. Everything is still empty placeholders while the live data gets connected.
* New **Flip X** overlay on ES Candles — the gamma flip now draws as a glowing trail across the whole session, brightest at the current bar, so you can see where the flip has been and where it sits right now. A single tag tells you whether price is currently in positive or negative gamma.
* Your bubble settings finally stick. The 1m/5m setting and the Bubbles on/off switch are now remembered along with the sliders, so the chart reopens exactly as you left it — and a new **Save default** button lets you pin your favorite setup and get back to it in one click.

## Sunday 7/26/2026

* Added a new SPX heatmap on the Options page showing 2 years of daily market performance.
* Fixed the heatmap's info popup so it now appears right next to your cursor instead of jumping to the bottom of the page.

## Saturday 7/25/2026

* Fixed the free feature pages (Initial Balance, GEX, TPO, Estimated Moves and Confidence Score) — the real delayed results now actually load instead of showing "results populate at the end of each trading day."
* Added a new **Options** page to the toolbar, replacing the old unused Lookup button. It's a placeholder for now while the real thing gets built out over the next few days.

## Friday 7/24/2026

* Fixed the Multi-Greek strike popup so its 15-minute, 30-minute and since-open GEX change actually loads instead of getting stuck on "building…"
* Made the Multi-Greek strike ladder text match the Option Chain page's size for a more consistent look.
* Rebuilt the Multi-Greek page: each ticker now shows its own 4 closest expirations of Net GEX side by side (instead of the DEX/CHEX/VEX columns), and uses that ticker's real expiration dates — so TSLA starts at its nearest Friday instead of a blank day.
* Added Call Wall, Put Wall and Core Bullseye (CB/CW/PW) levels to each ticker's header and highlighted them on the ladder, with toggles to show or hide the ladder markers.
* Clicking any strike now opens a single popup with that strike's call/put volume, open interest and premium, plus its Net GEX change over the last 15 min, 30 min and since the open — and it closes when you click anywhere off it.
* Cleaned up the Option Chain Replay popup — removed the small print at the bottom and moved the CB Edge logo to the bottom-left corner.
* Fixed the blank rows in Option Chain Replay — it now captures more strikes at each snapshot, so the replay shows a fuller strike ladder instead of gaps.

## Thursday 7/23/2026

* Streamlined the IB Stats page down to the three cards that matter — the Live Read, the IB Read (4 families), and the 10:30 Probability Engine gauges — and cleared out the rest of the clutter.
* The "Last 5 Sessions" strip on the IB Read card now refreshes on its own every trading day instead of getting stuck on old dates.
* Cleaned up the look of the cards across the dashboard — the faint gray glow at the top of each card is gone, so card backgrounds are now a clean, solid color.

## Tuesday 7/21/2026

* Added an **IB tab** to the home page calendar tab group, so you can pull up the full Initial Balance board straight from the home screen without opening the ES-candles chart.
* Added a new **Condition** view for SPY and QQQ (on the Test page) that reads each one's market condition at a glance — a bullish/bearish rating with stars, a live call-vs-put money-flow (WAVE) chart, and a 0-DTE gamma map marking support/resistance levels versus acceleration zones. The price line now tracks the correct SPY/QQQ price.

## Monday 7/20/2026

* Added a new IB stat that shows how a **narrow, normal, or wide opening range** tends to play out — whether it breaks one side, both sides, or neither — with the actual point ranges for each.
* Added two new "reference candle" stats: the **8am hour** (how often the day later takes out both its high and its low, and by what time) and the **2–3pm hour** (breaks one side, both, or neither into the close).
* Reworked the **streaks** stat to answer it directly — at 2 bars in a row, your odds of a 3rd; at 3, your odds of a 4th; and so on — plus the odds a fresh move ever runs that long.
* Fixed the **IB-width stats** that were coming up empty; narrow / normal / wide now fill in.
* The **IB preview** that pops up when you hover the IB button on the ES-candles chart now shows just today's live IB read — no page toolbar or history tables cluttering it.
* ES Candles now loads faster and no longer loses the historical gamma bubbles and heatmap when the page opens.
* Redesigned the GEX bubble controls: choose how many strike levels show, highlight the strongest walls, set the min/max bubble size, and use a brightness slider to make the biggest walls stand out.
* End-of-day GEX now also records the combined gamma across all expirations excluding 0DTE.

## Sunday 7/19/2026

* Cleaned up the Scanner's **Market Profile (TPO)** tab — all the faint gray text is now crisp white, and the section titles are color-coded so each card is easier to pick out at a glance.
* The **Signals & Alerts** list on that tab now has a bold header with a live counter that turns green and shows how many alerts are triggering right now.
* Moved the TPO profile chart to the top of the tab, above the signals, so you see the profile first.
* Added a new **Squeeze** page — a single-screen Gamma Exposure board with the live spot, Net / Call / Put / Total GEX, the Call Wall, Put Wall and Zero Gamma (flip) level all across the top.
* The Strike Profile chart shows gamma stacked by strike — green for call gamma, red for put gamma — with the spot marked and the Call Wall and Put Wall strikes outlined, plus an All / Near toggle to zoom to the strikes around price.
* Added a **Gamma Squeeze Screener** that scores how primed the tape is for a squeeze out of 100, calls the bias bullish or bearish, and breaks the score down by gamma regime, wall proximity, flow, volume and dealer positioning — with the key levels and trigger price listed underneath. Everything updates live off the same feed as the rest of the desk.
* Added a new **Order Book** view — its own page plus a tab in the Test Lab — that reads the live options tape for SPX, SPY and QQQ and shows whether traders are buying the near-term dip or hedging further out, with key metrics and a bar for each expiration.

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
