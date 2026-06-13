# Estimated Moves - Next.js Integration Setup

## Overview

The Estimated Moves page has been fully integrated into the Next.js project with:
- React component (`EstimatedMoves.tsx`) using Tailwind CSS
- API routes for estimated move calculations
- SQLite backend for snapshot persistence
- Full weekly expiration tracking and support

## Files Created/Modified

### New Files
1. **components/dashboard/EstimatedMoves.tsx** - React component (500+ lines)
2. **app/api/snapshots/route.ts** - Snapshots list & create endpoint
3. **app/api/snapshots/[id]/route.ts** - Individual snapshot get/delete

### Modified Files
1. **app/api/estimated-move/route.ts** - Added expiration parameter support
2. **lib/math/estimated-moves.ts** - Expanded with utility functions & types
3. **lib/db.ts** - Added snapshot management functions
4. **package.json** - Added sqlite3 dependency

## Installation & Setup

### 1. Install Dependencies
```bash
cd bzila-dashboard
npm install
# This will install sqlite3 which requires native build tools
```

If you encounter sqlite3 build issues:
```bash
# macOS
brew install python@3.11
npm install

# Windows
# Make sure you have Visual C++ Build Tools installed
npm install

# Linux
apt-get install build-essential python3
npm install
```

### 2. Database Schema

The snapshots table will be auto-created on first API call. Schema:

```sql
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'weekly',
  tableHtml TEXT NOT NULL,
  expirations TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### 3. Import the Component

In your dashboard page (e.g., `app/page.tsx` or a route that displays it):

```tsx
import EstimatedMoves from '@/components/dashboard/EstimatedMoves';

export default function Dashboard() {
  return (
    <div className="flex-1">
      <EstimatedMoves />
    </div>
  );
}
```

### 4. Start Development Server

```bash
npm run dev
# Server runs on http://localhost:3002
```

Navigate to your page to see the Estimated Moves component.

---

## Component Features

### Estimated Move Calculation

**Primary Formula** (when IV available):
```
EM = 0.84 × avgIV × indexClose × √(DTE/365)
```

**Fallback Formula** (when IV=0):
```
EM = (callMid + putMid) × 0.85
```

### Strike Selection

1. ATM (closest to index close)
2. Must have both CALL and PUT
3. IV validation (0.2%–25% of underlying)
4. Futures use stable Friday 4pm close (not real-time mark)

### Tickers Supported

Currently configured:
- **SPX** - S&P 500 Index
- **/ES** - E-mini S&P 500 Futures
- **SPY** - SPDR S&P 500 ETF
- **QQQ** - Invesco QQQ ETF
- **/NQ** - E-mini NASDAQ-100 Futures

To add more tickers, edit `app/api/estimated-move/route.ts`:

```typescript
const TICKERS = [
  { ticker: "SPX",  chainSym: "SPX",  isFuture: false },
  { ticker: "/ES",  chainSym: "SPX",  isFuture: true  },
  { ticker: "SPY",  chainSym: "SPY",  isFuture: false },
  { ticker: "QQQ",  chainSym: "QQQ",  isFuture: false },
  { ticker: "/NQ",  chainSym: "NDX",  isFuture: true  },
  // Add new tickers here
];
```

---

## API Endpoints

### GET /api/estimated-move
Calculate estimated moves for all tickers.

**Query Parameters:**
- `expiration` (optional) - Target expiration date (YYYY-MM-DD)

**Response:**
```json
{
  "expiration": "2026-06-19",
  "date": "2026-06-12",
  "rows": [
    {
      "ticker": "SPX",
      "close": 5432.10,
      "em": 45.50,
      "up": 5477.60,
      "down": 5386.60,
      "expiration": "2026-06-19"
    }
  ]
}
```

### GET /api/snapshots
List all snapshots for a period.

**Query Parameters:**
- `period` (optional) - Filter by period ("weekly", "daily", etc.)

**Response:**
```json
[
  {
    "id": 1,
    "timestamp": 1718186723000,
    "date": "6/12/2026",
    "time": "03:45:23 PM",
    "period": "weekly",
    "tableHtml": "...",
    "expirations": ["2026-06-19"]
  }
]
```

### POST /api/snapshots
Save a new snapshot.

**Request Body:**
```json
{
  "timestamp": 1718186723000,
  "date": "6/12/2026",
  "time": "03:45:23 PM",
  "period": "weekly",
  "tableHtml": "<tr>...</tr>...",
  "expirations": ["2026-06-19", "2026-06-26"]
}
```

**Response:** (201 Created)
```json
{
  "id": 1,
  "timestamp": 1718186723000,
  "date": "6/12/2026",
  "time": "03:45:23 PM",
  "period": "weekly",
  "tableHtml": "...",
  "expirations": ["2026-06-19", "2026-06-26"]
}
```

### GET /api/snapshots/[id]
Retrieve a specific snapshot.

**Response:** Same as POST /api/snapshots

### DELETE /api/snapshots/[id]
Delete a snapshot.

**Response:** (200 OK)
```json
{
  "id": 1,
  "message": "Deleted"
}
```

---

## Component Interaction

### User Workflow

1. **Load Page**
   - Component mounts
   - Loads available expirations
   - Loads previous snapshots
   - Sets status to "Ready"

2. **Click "Start"**
   - Fetches quotes for all tickers
   - Loads option chain for target expiration
   - Calculates ATM EM for each
   - Renders table with results
   - Updates "Last Sync" timestamp

3. **Select Expiration (Optional)**
   - Dropdown overrides auto-Friday selection
   - User can manually pick any available Friday

4. **Save Snapshot**
   - Captures current table HTML
   - Saves timestamp + metadata to SQLite
   - Refreshes sidebar drawer with new snapshot
   - Shows save time in status

5. **Load Snapshot**
   - Click on snapshot in drawer
   - Parses saved HTML
   - Renders table with previous data
   - Shows load time in status

6. **Delete Snapshot**
   - Click × button on snapshot
   - Confirms with dialog
   - Deletes from database
   - Refreshes drawer

---

## State Management

### Component State
```typescript
const [rows, setRows] = useState<EMRow[]>([]);           // Table rows
const [expiration, setExpiration] = useState<string>(''); // Selected exp
const [expirations, setExpirations] = useState<string[]>([]); // All exps
const [snapshots, setSnapshots] = useState<EMSnapshot[]>([]); // Saved
const [loading, setLoading] = useState(false);            // Loading state
const [status, setStatus] = useState('Ready');            // Status text
const [lastSync, setLastSync] = useState('--');           // Last sync time
const [showDrawer, setShowDrawer] = useState(false);      // Drawer toggle
const [expOverride, setExpOverride] = useState('');       // Manual exp
```

### Data Types
```typescript
interface EMRow {
  ticker: string;
  close: number;
  em: number;
  up: number;
  down: number;
  expiration: string;
  strike?: number;
  error?: string;
}

interface EMSnapshot {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  period: string;
  tableHtml: string;
  expirations: string[];
}
```

---

## Styling

The component uses Tailwind CSS with custom color scheme:

| Color | Use |
|-------|-----|
| `text-cyan-400` | Headers, highlights, EM values |
| `text-green-400` | Up/Bull values |
| `text-red-400` | Down/Bear values |
| `text-yellow-400` | EM calculations |
| `bg-slate-950` | Main background |
| `bg-slate-900` | Secondary background |
| `border-slate-700` | Borders |

### Customization

To change colors, edit the Tailwind classes in `EstimatedMoves.tsx`.

For a global theme, update `tailwind.config.ts` to define custom colors.

---

## Performance Optimization

### Caching

1. **Quote Cache** - 5 second cache to avoid refetch per symbol
2. **Chain Cache** - Per (symbol, expiration) to avoid duplicate calls
3. **Snapshot List** - Loaded once on mount

### Batching

- 4 tickers processed in parallel per batch
- 300ms delay between batches to avoid API throttle
- Total time: ~6-10 seconds for 5 tickers

### API Response Times

| Endpoint | Time |
|----------|------|
| `/api/estimated-move` | 2-5s (quotes + chains) |
| `/api/snapshots` | <100ms |
| `/api/snapshots/:id` | <100ms |

---

## Error Handling

### Graceful Degradation

- Single ticker error doesn't stop refresh
- Failed rows show muted (55% opacity) with error tooltip
- Uses `Promise.allSettled()` for resilience

### Common Issues

**"No data to save"**
- Click "Start" first to load estimates

**"Save failed"**
- Check browser console for API error
- Verify `/api/snapshots` endpoint is accessible

**"Failed to load expirations"**
- Check if `/api/expirations` is working
- Verify proxy is running at `http://localhost:3001`

**All rows have errors**
- Check if PROXY endpoint is accessible
- Verify options chains are available for the expiration

---

## Development

### File Structure
```
bzila-dashboard/
├── components/
│   └── dashboard/
│       └── EstimatedMoves.tsx          # React component
├── app/
│   └── api/
│       ├── estimated-move/
│       │   └── route.ts                # EM calculation
│       ├── snapshots/
│       │   ├── route.ts                # GET/POST snapshots
│       │   └── [id]/
│       │       └── route.ts            # GET/DELETE individual
│       └── expirations/
│           └── route.ts                # Available expirations
├── lib/
│   ├── db.ts                           # Database functions
│   └── math/
│       └── estimated-moves.ts          # EM logic & utilities
└── package.json
```

### Adding New Features

**Add a new ticker:**
1. Edit `app/api/estimated-move/route.ts` TICKERS array
2. Add chainSym mapping if needed
3. Restart dev server

**Add more snapshot periods (Daily, Monthly, etc.):**
1. Add period to snapshot save call
2. Update component to filter by multiple periods
3. Update drawer to show tabs for each period

**Add export to CSV:**
1. Implement in component: parse all snapshots
2. Flatten to rows: [date, time, period, ticker, close, em, up, down]
3. Generate blob and trigger download

---

## Troubleshooting

### SQLite Build Issues

If `npm install` fails on sqlite3:

**Option 1: Use sql.js (pure WASM, no native compilation)**
```bash
npm remove sqlite3
npm install sql.js
# Then use sql.js API in routes
```

**Option 2: Pre-built sqlite3**
```bash
npm install --build-from-source
```

### Database Not Persisting

- Verify DB_PATH points to correct location
- Check file permissions on `trading_metrics.db`
- Ensure `CREATE TABLE` is running on first request

### Component Not Displaying

1. Verify import in page: `import EstimatedMoves from '@/components/dashboard/EstimatedMoves'`
2. Check dev console for errors
3. Verify `/api/estimated-move` and `/api/expirations` endpoints exist
4. Check network tab for failed API calls

### Stale Expirations

- Expirations are cached on mount
- Refresh page to reload
- Consider adding manual refresh button

---

## Production Deployment

### Environment Variables

```bash
# .env.production
DB_PATH=/var/data/trading_metrics.db
NEXT_PUBLIC_API_BASE=https://api.example.com
```

### Database Backups

```bash
# Backup SQLite DB
cp /var/data/trading_metrics.db /var/backups/trading_metrics.db.$(date +%s)

# Restore from backup
cp /var/backups/trading_metrics.db.1234567890 /var/data/trading_metrics.db
```

### Monitoring

Track:
- Snapshot creation rate
- Failed EM calculations (error rows)
- Database file size growth
- API response times

---

## Future Enhancements

1. **Daily/Monthly Periods** - Add UI to switch periods
2. **Historical Charting** - Plot EM changes over time
3. **Backtest** - Compare predicted vs actual moves
4. **Alerts** - Notify when EM exceeds threshold
5. **Mobile Responsive** - Adjust layout for mobile
6. **Dark/Light Theme Toggle** - Let users choose theme
7. **Export to CSV** - Download all snapshots as CSV
8. **Webhook Sharing** - POST to Discord/Slack webhook on new snapshot

---

## Support & Questions

- Check component README in comments
- Review test cases for API endpoints
- Inspect network tab for API responses
- Check browser console for client-side errors
- Review server logs for backend errors

