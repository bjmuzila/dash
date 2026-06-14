# Estimated Moves - Quick Start (5 minutes)

## Prerequisites
- Node.js 18+
- npm or yarn
- SQLite3 development libraries (auto-installed via npm)

## Installation

```bash
cd bzila-dashboard
npm install
```

## Add to Dashboard

### Option 1: Full Page Route
Create `app/estimated-moves/page.tsx`:

```tsx
import EstimatedMoves from '@/components/dashboard/EstimatedMoves';

export default function EstimatedMovesPage() {
  return (
    <div className="flex flex-col h-screen">
      <EstimatedMoves />
    </div>
  );
}
```

### Option 2: Dashboard Component
Add to your existing dashboard page:

```tsx
import EstimatedMoves from '@/components/dashboard/EstimatedMoves';

export default function Dashboard() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <EstimatedMoves />
      </div>
      {/* Other dashboard widgets */}
    </div>
  );
}
```

### Option 3: Modal/Sidebar
```tsx
import { useState } from 'react';
import EstimatedMoves from '@/components/dashboard/EstimatedMoves';

export default function Dashboard() {
  const [showEM, setShowEM] = useState(false);

  return (
    <>
      <button onClick={() => setShowEM(true)}>View EM</button>
      {showEM && (
        <div className="fixed inset-0 bg-black/50 z-50">
          <div className="absolute inset-0">
            <EstimatedMoves />
          </div>
          <button onClick={() => setShowEM(false)} className="absolute top-4 right-4">✕</button>
        </div>
      )}
    </>
  );
}
```

## Start Development Server

```bash
npm run dev
```

Navigate to your dashboard page. You should see:
- Header with "Estimated Moves"
- Sidebar with "Last Sync" and "Weekly" drawer
- Empty table with "Click Start to load estimated moves"

## Test It

1. **Click "Start"**
   - Table should populate with 5 tickers (SPX, /ES, SPY, QQQ, /NQ)
   - Last Sync timestamp should update
   - Status should show "Live" (green)

2. **Click "Save"**
   - Status shows "Saving..."
   - Then "Saved"
   - Snapshot appears in drawer with date/time

3. **Click Snapshot**
   - Table reloads with previous data
   - Status shows "Loaded [date]"

4. **Delete (×) button**
   - Confirm dialog
   - Snapshot removed from drawer

5. **Select Expiration**
   - Dropdown shows available Fridays
   - Override auto-selection
   - Next "Start" uses manual expiration

## Common Issues

### Build Error: sqlite3
**Solution**: Install build tools
```bash
# macOS
brew install python@3.11

# Windows - Install Visual C++ Build Tools for Visual Studio

# Linux
sudo apt-get install build-essential python3
```

Then retry: `npm install`

### "No snapshots table"
- First API call auto-creates it
- Check browser console for errors
- Verify DB file exists: `../trading_db_complete/trading_metrics.db`

### "Failed to load expirations"
- Verify `/api/expirations` endpoint exists
- Check proxy is running: `http://localhost:3001`
- See browser Network tab for details

### All rows show errors
- Check proxy availability
- Verify PROXY URL in `app/api/estimated-move/route.ts`
- Look for option chain failures in console

## File Locations

```
bzila-dashboard/
├── components/dashboard/
│   └── EstimatedMoves.tsx          ← React component
├── app/api/
│   ├── estimated-move/route.ts     ← EM calculations
│   ├── snapshots/
│   │   ├── route.ts                ← GET/POST snapshots
│   │   └── [id]/route.ts           ← GET/DELETE individual
│   └── expirations/route.ts        ← Available expirations
├── lib/
│   ├── db.ts                       ← Database utilities
│   └── math/estimated-moves.ts     ← EM formulas
├── QUICK_START.md                  ← This file
├── ESTIMATED_MOVES_SETUP.md        ← Full setup guide
└── ESTIMATED_MOVES_CHANGES.md      ← What was changed
```

## Key Commands

```bash
# Install
npm install

# Development
npm run dev

# Build for production
npm run build

# Start production
npm start

# Clean node_modules (if issues)
rm -rf node_modules package-lock.json
npm install
```

## Database

Snapshots are automatically stored in SQLite at:
```
../trading_db_complete/trading_metrics.db
```

Table `snapshots` is auto-created on first POST.

To inspect:
```bash
# Install sqlite3 CLI if not present
brew install sqlite3  # macOS
apt-get install sqlite3  # Linux

# Query snapshots
sqlite3 ../trading_db_complete/trading_metrics.db
sqlite> SELECT * FROM snapshots ORDER BY id DESC LIMIT 5;
sqlite> .exit
```

## Customization

### Change Tickers
Edit `app/api/estimated-move/route.ts`:
```typescript
const TICKERS = [
  { ticker: "SPX",  chainSym: "SPX",  isFuture: false },
  { ticker: "/ES",  chainSym: "SPX",  isFuture: true  },
  { ticker: "AAPL", chainSym: "AAPL", isFuture: false },
  // Add more here
];
```

### Change Colors
Edit `components/dashboard/EstimatedMoves.tsx`:
- `text-cyan-400` → any Tailwind text color
- `text-green-400` → for bull/up
- `text-red-400` → for bear/down

### Change Database Path
Set environment variable:
```bash
# .env.local
DB_PATH=/custom/path/to/database.db
```

## Next Steps

1. **Read Full Setup**: See `ESTIMATED_MOVES_SETUP.md`
2. **Review Changes**: See `ESTIMATED_MOVES_CHANGES.md`
3. **Explore Code**: Check `EstimatedMoves.tsx` comments
4. **Test API**: Use curl or Postman to test endpoints
5. **Deploy**: Follow your standard deployment process

## Support

- Check console for errors: F12 → Console
- Check network tab: F12 → Network
- Review server logs: `npm run dev` output
- Read inline comments in component files

## Time Estimate

- **Setup**: 2 minutes (`npm install`)
- **Integration**: 1 minute (add component to page)
- **Testing**: 2 minutes (click buttons, verify)
- **Total**: ~5 minutes

Enjoy! 🚀

