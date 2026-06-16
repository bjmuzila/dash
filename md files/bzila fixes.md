# Bzila Multi-Stock Flow System Documentation

## 1. Overview
The Bzila Multi-Stock Flow System tracks option premium drift across multiple tickers, providing real-time visualization of buying and selling pressure.

## 2. Calculation Logic
### Premium Formula
The premium for a single trade is calculated as:
**Premium = (Price × Size × 100)**
* **Price Source:** Mid-Price = (Bid + Ask) / 2
* **Multiplier:** 100 (standard option contract size)

### Aggregated Flow
Snapshots are taken per ticker for the nearest expiration date:
* **Total Call Premium:** Σ(Mid-Price × Volume × 100) for OTM Calls.
* **Total Put Premium:** Σ(Mid-Price × Volume × 100) for OTM Puts.
* **Net Flow:** Net = Total Call Premium - Total Put Premium

### OTM Condition
* **Calls:** Strike Price > Underlying Spot Price
* **Puts:** Strike Price < Underlying Spot Price

## 3. Rendering Pipeline
### Time Alignment
X-axis positions are mapped to time using a linear ratio:
**X = PaddingLeft + ((Timestamp - MarketOpenMs) / (MarketCloseMs - MarketOpenMs)) * CanvasWidth**

### Drawing Order
1.  **Clear:** Use `ctx.clearRect` on every frame.
2.  **Grid:** Draw horizontal lines and zero-line.
3.  **Data Lines:** Plot Call (Green), Put (Red/Inverted), and Net (Gold) paths using `lineTo`.
4.  **Sync:** Ensure timestamps are sorted before plotting to maintain left-to-right flow.

## 4. Database & Persistence
### Hydration
1.  Query current date records from `premiumFlow` object store.
2.  Sort by `timestamp` ascending.
3.  Rebuild `state.flowHistory`.

### Saving Strategy
* **Minute Snapshots:** Aggregate flow saved via `setInterval`.
* **Reset:** Daily purge of `premiumFlow` at 9:30 AM ET.

## 5. Big Block Trades
### UI Configuration
* **Placement:** The Big Block feed resides to the right of the SPX Premium Flow chart.
* **Controls:** Each symbol (ES and NQ) has dedicated range sliders for filtering:
    * **ES Default:** 100 contracts
    * **NQ Default:** 70 contracts
* **Toggles:** Checkboxes provided for individual symbol visibility (Show ES / Show NQ).

### Data Handling
* **Trade Processing:** Incoming trades are filtered against the slider values dynamically (`if size < minSize return`).
* **Feed Display:** Valid trades are unshifted into a `bigBlocks` array, capped at 200 entries to maintain UI performance.
* **Persistence:** Valid big block trades are saved immediately via `DB.saveBigTrade` (Ticker, Price, Size, Side, Timestamp).

## 6. Multi-Stock Tab (3x3 Grid)
### UI Layout
* **Grid:** 3x3 layout for SPY, QQQ, AAPL, AMD, AMZN, GOOGL, META, MSFT, NVDA, TSLA.
* **Component Design:** Each card mimics the SPX Premium Flow UI (canvas, symbol header, capture buttons).

### Data & Rendering
* **Expirations:** Batched data for 0DTE to 7DTE.
* **Time Alignment:** 9:30 AM to 4:00 PM ET window, rendered left-to-right via timestamp synchronization.
* **Premium Calculation:** Aggregated per ticker using nearest expiration OTM call/put premiums (Mid-price calculation).
* **Reset Strategy:** Daily reset for all multi-stock premium flow data at 9:30 AM ET to ensure session-specific accuracy.

### Batching Logic
* **Constraint:** API limit of 2 requests/second.
* **Implementation:** Symbols are grouped into batches of 100 with a 600ms delay between batches to stay under the rate limit.
