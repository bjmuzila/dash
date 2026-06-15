# Quotes Panel - Real-Time Quote Updates

## Overview

The quotes panel provides real-time price tracking for multiple market symbols with automatic percentage change calculations based on previous day close prices. It uses a websocket connection (via dxLink when available) with an API fallback for continuous data updates.

## Architecture

### Components

**1. quotes-manager.js** - Core Manager (shared/quotes-manager.js)
- Centralizes all quote data and state management
- Handles dxLink websocket subscriptions
- Falls back to API polling if websocket unavailable
- Manages previous close prices
- Notifies subscribers of quote changes

**2. quotes.html** - UI Component (pages/quotes/quotes.html)
- Displays quotes in a sortable list
- Shows price, bid/ask, and % change
- Includes search/filter functionality
- Auto-updates when quotes change

### Data Flow

```
WebSocket (dxLink)
    ↓
QuotesManager.updateQuote()
    ↓
State updated { symbol, bid, ask, last }
    ↓
Previous close loaded from /proxy/api/spx-prevclose
    ↓
% Change calculated: (last - prevClose) / prevClose * 100
    ↓
Subscribers notified → UI updates
    ↓
API Polling (fallback if ws unavailable)
```

## API Endpoints Required

### 1. Previous Close Prices
```
GET /proxy/api/spx-prevclose
Response: { SPX: 5500.5, ES: 5510.0, NQ: 18900.0, IWM: 2200.0, ".GSPC": 5500.5 }
```

### 2. Quote Batch (Fallback/Initial)
```
GET /proxy/api/tt/quotes-batch?symbols=SPX,ES,NQ,IWM
Response: [
  { symbol: "SPX", last: 5505.0, bid: 5504.5, ask: 5505.5 },
  { symbol: "ES", last: 5510.0, bid: 5509.5, ask: 5510.5 },
  ...
]
```

### 3. Subscription Ready (Optional)
```
POST /proxy/api/subscription-ready
Body: { pageId, symbols[], timeout, threshold }
Response: { ready: bool, timeout: bool, count: int, total: int }
```

## Usage

### Basic Initialization
```javascript
// Auto-initializes on load with default symbols
window.QuotesManager.init(['SPX', 'ES', 'NQ', 'IWM', '.GSPC']);
```

### Getting Quotes
```javascript
// Get all quotes
const allQuotes = window.QuotesManager.getQuotes();

// Get filtered quotes
const spxQuotes = window.QuotesManager.getQuotes('SPX');

// Get single quote
const quote = window.QuotesManager.getQuote('SPX');
// Returns: { symbol: 'SPX', bid: 5504.5, ask: 5505.5, last: 5505.0, updated: timestamp }
```

### Getting Change Data
```javascript
const change = window.QuotesManager.getChange('SPX');
// Returns: {
//   change: 5.0,           // absolute change from previous close
//   changePercent: 0.091,  // % change from previous close
//   up: true,              // direction
//   down: false,
//   icon: '▲'              // visual indicator
// }
```

### Subscribing to Updates
```javascript
const unsubscribe = window.QuotesManager.subscribe((data) => {
  console.log(`${data.symbol} updated:`, data.quote);
  console.log(`Change: ${data.change.changePercent}%`);
}, 'SPX'); // Optional filter

// Later, unsubscribe
unsubscribe();
```

### Manual Operations
```javascript
// Fetch latest quotes from API
await window.QuotesManager.fetchQuotesAPI();

// Reload previous closes
await window.QuotesManager.loadPrevCloses();

// Start polling (auto-starts if WebSocket unavailable)
const pollInterval = window.QuotesManager.startPolling(1000); // 1 second

// Check status
const status = window.QuotesManager.getStatus();
// Returns: { wsConnected, symbolCount, symbols[], quoteCount, prevCloseCount }
```

## WebSocket vs API Polling

### Automatic Selection
The system automatically chooses the best data source:

1. **WebSocket (dxLink)** - Used if available
   - Real-time updates
   - Lower latency
   - Reduced bandwidth
   - Requires DXFeedClient initialization

2. **API Polling** - Fallback if WebSocket unavailable
   - Requests every 1 second by default
   - Adjustable interval via `startPolling(intervalMs)`
   - More reliable (works anywhere)

### Force Polling
```javascript
// Explicitly start polling (even if WebSocket available)
window.QuotesManager.startPolling(1500); // 1.5 second interval
```

## Integration with Quotes Panel

The quotes.html page automatically:

1. Initializes QuotesManager
2. Loads previous close prices
3. Subscribes to symbol changes
4. Renders quotes with color-coded changes
5. Provides search/filter functionality
6. Auto-refreshes on quote updates

### Display Features
- **Green ▲** for up moves
- **Red ▼** for down moves
- **Bid/Ask** spread
- **% Change** from previous close
- Real-time updates with hover effects

## Configuration

### Symbols to Track
Edit the initialization in quotes-manager.js:
```javascript
window.QuotesManager.init(['SPX', 'ES', 'NQ', 'IWM', '.GSPC']);
```

### Polling Interval
Default is 1 second. Adjust in UI or code:
```javascript
window.QuotesManager.startPolling(2000); // 2 seconds
```

### Previous Close Refresh
Auto-refreshes every 60 seconds. Edit in quotes-manager.js:
```javascript
setInterval(() => this.loadPrevCloses(), 60000); // Change to preferred interval
```

## Error Handling

All API calls include try-catch blocks and log to console:
```
[QuotesManager] Failed to load previous closes: error message
[QuotesManager] API fetch failed: error message
[QuotesManager] Subscriber callback error: error message
```

## Performance Notes

- **Memory**: Stores one quote object per symbol (~100 bytes each)
- **Network**: ~1KB per API request, minimal if using WebSocket
- **CPU**: Negligible - updates are batched and debounced
- **Polling**: 1 second default = ~86K requests/day (can increase interval)

## Troubleshooting

### Quotes not updating
1. Check browser console for [QuotesManager] errors
2. Verify `/proxy/api/tt/quotes-batch` endpoint responds
3. Check `/proxy/api/spx-prevclose` for previous closes
4. Run `window.QuotesManager.getStatus()` to see connection state

### Previous closes not loading
```javascript
// Manually trigger reload
window.QuotesManager.loadPrevCloses().then(() => {
  console.log('Closes reloaded:', window.QuotesManager.getStatus());
});
```

### Force API fetch
```javascript
// Use this if polling seems stuck
window.QuotesManager.fetchQuotesAPI();
```

## Browser Compatibility

- Modern browsers with WebSocket support
- Falls back to HTTP polling (no WebSocket needed)
- Works in all environments (localhost, HTTPS, etc.)

## Future Enhancements

- [ ] WebSocket reconnect with exponential backoff
- [ ] Quote history tracking (OHLC)
- [ ] Volume/spread analytics
- [ ] Custom column formatting
- [ ] Export to CSV
- [ ] Alert system (price thresholds)
- [ ] Multi-leg quote grouping
