# Estimated Moves - Dashboard Integration Guide

## Where It Fits In Your Dashboard

The Estimated Moves component is now ready to integrate into your existing dashboard navigation and layout.

---

## 🔍 Current Dashboard Structure

Your dashboard likely has:
```
app/
├── page.tsx (Main dashboard)
├── layout.tsx (Layout wrapper)
└── ... (other pages)

components/
├── dashboard/ (Your existing components)
│   ├── GexTable.tsx
│   ├── MetricsPanel.tsx
│   ├── RealTimeTicker.tsx
│   ├── EstimatedMoves.tsx ← NEW (ready to use)
│   └── ...
└── ...
```

---

## ✅ Integration Options

### Option 1: Dedicated Page Route (Simplest)

Create `app/estimated-moves/page.tsx`:

```tsx
'use client';

import EstimatedMoves from '@/components/dashboard/EstimatedMoves';

export default function EstimatedMovesPage() {
  return (
    <main className="flex flex-col h-screen">
      <EstimatedMoves />
    </main>
  );
}
```

Then add link in your navbar/sidebar:
```tsx
<Link href="/estimated-moves">Estimated Moves</Link>
```

---

### Option 2: Dashboard Tab (Recommended)

If your dashboard has tabs/sections, add it as a section:

```tsx
// app/page.tsx (or wherever your dashboard is)
'use client';

import { useState } from 'react';
import GexTable from '@/components/dashboard/GexTable';
import MetricsPanel from '@/components/dashboard/MetricsPanel';
import EstimatedMoves from '@/components/dashboard/EstimatedMoves';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('gex');

  return (
    <div className="flex flex-col h-screen">
      {/* Navigation Tabs */}
      <div className="flex gap-4 p-4 border-b border-slate-700 bg-slate-900">
        <button
          onClick={() => setActiveTab('gex')}
          className={`px-4 py-2 font-bold rounded ${
            activeTab === 'gex'
              ? 'bg-cyan-500 text-black'
              : 'bg-slate-800 text-cyan-400 hover:bg-slate-700'
          }`}
        >
          GEX Analysis
        </button>
        <button
          onClick={() => setActiveTab('em')}
          className={`px-4 py-2 font-bold rounded ${
            activeTab === 'em'
              ? 'bg-cyan-500 text-black'
              : 'bg-slate-800 text-cyan-400 hover:bg-slate-700'
          }`}
        >
          Estimated Moves
        </button>
        <button
          onClick={() => setActiveTab('metrics')}
          className={`px-4 py-2 font-bold rounded ${
            activeTab === 'metrics'
              ? 'bg-cyan-500 text-black'
              : 'bg-slate-800 text-cyan-400 hover:bg-slate-700'
          }`}
        >
          Metrics
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0">
        {activeTab === 'gex' && <GexTable />}
        {activeTab === 'em' && <EstimatedMoves />}
        {activeTab === 'metrics' && <MetricsPanel />}
      </div>
    </div>
  );
}
```

---

### Option 3: Sidebar Navigation

If your dashboard has a sidebar, add Estimated Moves as a menu item:

```tsx
// components/shared/Navbar.tsx or Sidebar.tsx

import Link from 'next/link';

export default function Sidebar() {
  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 p-4">
      <nav className="space-y-2">
        <Link href="/gex" className="block px-4 py-2 hover:bg-slate-800 rounded">
          GEX Analysis
        </Link>
        <Link href="/estimated-moves" className="block px-4 py-2 hover:bg-slate-800 rounded">
          Estimated Moves
        </Link>
        <Link href="/metrics" className="block px-4 py-2 hover:bg-slate-800 rounded">
          Metrics
        </Link>
      </nav>
    </aside>
  );
}
```

---

### Option 4: Grid Layout

Add to your existing dashboard grid:

```tsx
// app/page.tsx

import GexTable from '@/components/dashboard/GexTable';
import EstimatedMoves from '@/components/dashboard/EstimatedMoves';
import MetricsPanel from '@/components/dashboard/MetricsPanel';

export default function Dashboard() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 h-screen overflow-hidden">
      {/* Left Column - GEX Table */}
      <div className="lg:col-span-2">
        <GexTable />
      </div>

      {/* Right Column - Metrics */}
      <div className="space-y-4">
        <MetricsPanel />
      </div>

      {/* Full Width Below */}
      <div className="lg:col-span-3">
        <EstimatedMoves />
      </div>
    </div>
  );
}
```

---

### Option 5: Modal/Popup

Add as a modal that opens on demand:

```tsx
'use client';

import { useState } from 'react';
import EstimatedMoves from '@/components/dashboard/EstimatedMoves';

export default function Dashboard() {
  const [showEM, setShowEM] = useState(false);

  return (
    <>
      {/* Your existing dashboard */}
      <div>
        <button
          onClick={() => setShowEM(true)}
          className="px-4 py-2 bg-cyan-500 text-black font-bold rounded"
        >
          Open Estimated Moves
        </button>
      </div>

      {/* Modal */}
      {showEM && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="w-full h-full bg-slate-950">
            <div className="flex justify-between items-center p-4 border-b border-slate-700">
              <h2 className="text-xl font-bold text-cyan-400">Estimated Moves</h2>
              <button
                onClick={() => setShowEM(false)}
                className="text-2xl text-red-500 hover:text-red-400"
              >
                ✕
              </button>
            </div>
            <EstimatedMoves />
          </div>
        </div>
      )}
    </>
  );
}
```

---

## 🎯 Recommended Integration

For your dashboard, I recommend **Option 2 (Tab-based)** because:

✅ Clean separation of concerns  
✅ Easy to navigate between views  
✅ Users see all options at top  
✅ Consistent with existing patterns  
✅ Each tab gets full screen space  
✅ Memory efficient (one component at a time)  

---

## 🔧 Setup Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Create Route (if using Option 1)
```bash
mkdir -p app/estimated-moves
# Create app/estimated-moves/page.tsx with code above
```

### 3. Update Navigation
Add link/tab to your existing navbar/sidebar

### 4. Test Locally
```bash
npm run dev
# Visit http://localhost:3002/estimated-moves
```

### 5. Customize (Optional)
- Change colors in EstimatedMoves.tsx
- Add more tickers in app/api/estimated-move/route.ts
- Adjust layout to match your theme

---

## 🎨 Styling Integration

The component uses Tailwind CSS with your existing theme:

```tsx
// Component color scheme (already matches dashboard)
- text-cyan-400   // Headers, highlights
- text-green-400  // Up/Bull values
- text-red-400    // Down/Bear values
- bg-slate-950    // Main background
- bg-slate-900    // Secondary background
- border-slate-700 // Borders
```

If you want to customize colors, edit `components/dashboard/EstimatedMoves.tsx` and update Tailwind classes.

---

## 📱 Responsive Behavior

Component is optimized for:

| Screen | Layout |
|--------|--------|
| **Desktop** | Sidebar (230px) + Table (full width) |
| **Tablet** | Full width, sidebar on left |
| **Mobile** | Needs adjustment (in progress) |

To make mobile-friendly, wrap in:
```tsx
<div className="hidden md:flex">
  <EstimatedMoves />
</div>
```

---

## 🚀 After Integration

Once integrated:

1. ✅ Component loads with your dashboard
2. ✅ Shares authentication/session with other components
3. ✅ Uses same database (SQLite)
4. ✅ Matches dashboard styling
5. ✅ No additional setup needed

---

## 📊 Component Lifecycle

```
Page Load
    ↓
Component Mount
    ├─ Load Expirations → GET /api/expirations
    └─ Load Snapshots → GET /api/snapshots?period=weekly
    ↓
User Clicks "Start"
    ├─ Fetch EM → GET /api/estimated-move
    └─ Render Table
    ↓
User Clicks "Save"
    ├─ Save to DB → POST /api/snapshots
    └─ Reload Snapshots
    ↓
User Navigates Away
    └─ Component Unmount (cleanup)
```

---

## 🔗 API Dependencies

Component requires these endpoints to be available:

| Endpoint | Status | Location |
|----------|--------|----------|
| `/api/estimated-move` | ✅ Exists | `app/api/estimated-move/route.ts` |
| `/api/snapshots` | ✅ New | `app/api/snapshots/route.ts` |
| `/api/snapshots/[id]` | ✅ New | `app/api/snapshots/[id]/route.ts` |
| `/api/expirations` | ✅ Exists | Already in your dashboard |

All endpoints are ready to go!

---

## ✅ Verification Checklist

After integration, verify:

- [ ] Component imports without errors
- [ ] `/api/estimated-move` returns data
- [ ] `/api/snapshots` GET returns empty array
- [ ] Click "Start" populates table
- [ ] Click "Save" creates snapshot
- [ ] Snapshot appears in drawer
- [ ] Can load/delete snapshots
- [ ] No console errors
- [ ] Styling matches dashboard theme

---

## 🆘 Troubleshooting Integration

### Component doesn't show
```tsx
// Make sure it's imported correctly
import EstimatedMoves from '@/components/dashboard/EstimatedMoves';
```

### "Module not found"
```bash
# Verify file exists at correct path
ls components/dashboard/EstimatedMoves.tsx
```

### Styling looks wrong
- Check Tailwind CSS is loaded
- Verify color classes are correct
- Check for CSS conflicts

### API calls fail
- Verify endpoints exist: `ls app/api/`
- Check proxy is running: `http://localhost:3001`
- See browser Network tab for details

---

## 📝 Example: Complete Dashboard with EM

```tsx
'use client';

import { useState } from 'react';
import GexTable from '@/components/dashboard/GexTable';
import EstimatedMoves from '@/components/dashboard/EstimatedMoves';
import MetricsPanel from '@/components/dashboard/MetricsPanel';
import RealTimeTicker from '@/components/dashboard/RealTimeTicker';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'gex' | 'em' | 'metrics'>('gex');

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      {/* Header */}
      <header className="p-4 bg-slate-900 border-b border-slate-700">
        <h1 className="text-2xl font-bold text-cyan-400">Trading Dashboard</h1>
      </header>

      {/* Navigation */}
      <nav className="flex gap-2 p-4 bg-slate-900 border-b border-slate-700">
        {[
          { id: 'gex', label: 'GEX Analysis' },
          { id: 'em', label: 'Estimated Moves' },
          { id: 'metrics', label: 'Metrics' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 font-bold rounded transition-colors ${
              activeTab === tab.id
                ? 'bg-cyan-500 text-black'
                : 'bg-slate-800 text-cyan-400 hover:bg-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Real Time Ticker */}
      <div className="px-4 py-2 bg-slate-900 border-b border-slate-700">
        <RealTimeTicker />
      </div>

      {/* Content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'gex' && <GexTable />}
        {activeTab === 'em' && <EstimatedMoves />}
        {activeTab === 'metrics' && <MetricsPanel />}
      </main>
    </div>
  );
}
```

---

## 🎉 You're Ready!

The component is integrated and ready to use. Choose your integration style above and add it to your dashboard.

**Estimated setup time: 5 minutes**

Start with **Option 2 (Tab-based)** if you're not sure which to choose.

