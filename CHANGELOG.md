# Changelog

## 2026-06-14 (session 9) — Economic Calendar Overhaul + Nav Restore

### Economic Calendar Full Page (`app/economic-calendar/page.tsx`)
- Complete rewrite to match target layout: left column (day label + time), right column (impact·country badge, bold title, A/F/P values)
- Multi-select filter dropdown — checkboxes for High·USD, High, Medium, Low, All (can combine e.g. High·USD + Medium simultaneously)
- Google Sheets daily quote fetched from `/api/calendar-quote` and displayed italic below header
- All blue/muted text replaced with white
- Larger fonts throughout (title 15px, time 13px, date headers 14px, impact 11px)
- Date section headers with TODAY badge for current day
- Removed all Trump calendar references — FF data only

### EconCalendarPanel (`components/dashboard/EconCalendarPanel.tsx`)
- Full rewrite to match same layout as full page (left time/day column, right content column)
- Multi-select filter dropdown (same High·USD + High + Medium + Low + All)
- Google Sheets daily quote block below header
- Stale events (>30 min past) faded to 32% opacity, pushed below divider
- 60s interval tick for live stale detection
- Removed dead `/api/trump-calendar` fetch — FF-only data
- White text throughout, bigger fonts (title 12px, time 11px)

### New API Route (`app/api/calendar-quote/route.ts`)
- Proxies `/proxy/api/quote-of-day` from Vanilla through Next.js
- 1hr revalidation cache

### TopBar Nav (`components/shared/TopBar.tsx`)
- Restored "Econ Calendar" → `/economic-calendar` at top of NAV_ITEMS (had been removed in session 8)

### Version
- Bumped to `2026.6.14-v13`

## 2026-06-14 (session 8) — Bug Fixes, Calendar Enhancements, Quotes Panel

### Options Chain (`app/options-chain/page.tsx`)
- Fixed % range dropdown not filtering — `filtered` useMemo now depends on `renderTick` instead of `liveData` ref (which never changes identity)
- Added `useEffect` to bump `renderTick` on `rangePercent` change so filter applies immediately

### Multi-Greek (`app/mult-greek/page.tsx`)
- Auto-loads on mount when expirations are ready — no need to click GO manually

### Econ Calendar Page (`app/economic-calendar/page.tsx`)
- Fixed background color to `#05080d` (was using CSS vars that rendered as pure black in some contexts)
- Events now show next 7 days (rolling window from today) instead of Mon–Fri current week only

### EconCalendarPanel (`components/dashboard/EconCalendarPanel.tsx`)
- Same 7-day rolling window fix applied to Overview panel
- Added "POTUS" option to impact filter dropdown
- Added "President" purple (`#a855f7`) impact color

### Trump Calendar (`app/api/trump-calendar/route.ts`) — NEW
- New API route fetching `https://media-cdn.factba.se/rss/json/trump/calendar-full.json`
- Filters out "executive time", "pool call", "in-town pool" noise events
- 30-min in-memory cache
- Events tagged with `impact: "President"` and rendered in purple

### Calendar Merge (both Econ Calendar page + EconCalendarPanel)
- Both now fetch ForexFactory + Trump calendar in parallel and merge/sort by date+time

### Quotes Panel (`components/shared/QuotesPanel.tsx`)
- Expanded to fill full sidebar height via flex layout
- Row height slider at bottom (16–56px) for adjustable density
- Font size scales with row height

### Sidebar (`components/shared/Sidebar.tsx`)
- Wrapper div changed from `overflowY: auto` to `display: flex, flexDirection: column` so QuotesPanel can fill available space

### Nav Cleanup (`components/shared/TopBar.tsx`)
- Removed "Quotes", "GEX Ladder", "Econ Calendar" from NAV_ITEMS
- `app/quotes/page.tsx` — redirects to `/`
- `app/gex/page.tsx` — redirects to `/`
- `app/top10/page.tsx` — redirects to `/`

### push-to-github skill (`skills/push-to-github/SKILL.md`)
- Updated to auto-read package.json, compute version, bump it, and output ready-to-paste PowerShell block

### Version
- Bumped to `2026.6.14-v11`

## 2026-06-14 (session 6) — UI Polish: Chevron Buttons, Sidebar, TopBar, Heatmap

### Sidebar (`components/shared/Sidebar.tsx`)
- Replaced scrolling ticker with static sorted list (highest % → lowest, nulls last), live via WS + REST seed
- Background fixed to `#05080d` on both collapsed and expanded states to match the GEX chart
- QuotesPanel + DailyEmPanel now fill the sidebar from the top (no empty spacer gap)
- Collapse/expand buttons replaced with bare chevron SVG (no border box)

### TopBar (`components/shared/TopBar.tsx`)
- Removed empty ROW 2 strip — only renders when Peak GEX data is present
- Page selector dropdown temporarily removed then restored (with `useRouter`/`usePathname`/`NAV_ITEMS`)

### GEX Toolbar (`components/dashboard/GexToolbar.tsx`)
- Replaced +/− expand/collapse buttons with a single chevron button (rotates 180° on toggle)
- Collapse now hides only the toolbar controls — chart stays visible at full height
- New props: `chartOpen: boolean`, `onToggleChart: () => void`
- Removed unused `useCallback` import

### Overview Page (`app/page.tsx`)
- Added `gexToolbarOpen` state wired to GexToolbar chevron
- Removed thick 16px heatmap divider — heatmap has no left border
- Heatmap collapse/expand chevrons use same bare-chevron style with 180° rotation
- Collapsed heatmap shows slim 20px re-open tab

### Version
- Bumped to `2026.6.14-v15`

## 2026-06-14 (session 5) — Sidebar Collapse Rail + Toolbar Cleanup

### GEX Heatmap Column Layout
- `components/dashboard/GexHeatmap.tsx` — narrowed strike column `80px → 68px`; changed column headers and data cells from `textAlign: right` to `center`

### Sidebar Version Number
- `components/shared/Sidebar.tsx` — added version footer pulled dynamically from `package.json` via `resolveJsonModule` import; displays at bottom of sidebar

### Sidebar Nav Removal
- `components/shared/Sidebar.tsx` — removed all page nav links (superseded by TopBar dropdown); sidebar now contains only QuotesPanel, DailyEmPanel, and version footer

### Sidebar Collapse Rail
- `components/shared/Sidebar.tsx` — full rewrite: collapsed state renders a 36px rail with `▶` expand button, live vertical auto-scrolling price ticker (`CollapsedTicker`), and tiny version label; `onOpen` prop added
- `components/shared/LayoutShell.tsx` — sidebar always mounted on desktop; passes `collapsed={!sidebarOpen}` and `onOpen` instead of hiding with `display: none`; mobile behavior unchanged

### TopBar Cleanup
- `components/shared/TopBar.tsx` — removed "Current MVC" and "GEX Flip" from Row 2; Row 2 now shows Peak GEX only; moved `SnapButton mode="share"` to Row 1 (before Save Snap and logo)

### GEX Chart Expand/Collapse Buttons
- `components/dashboard/GexToolbar.tsx` — added `onExpandChart` / `onCollapseChart` props; rendered as `+` / `−` icon buttons (inline SVG, cyan accent, `#0a1628` bg, hover state) right of toolbar
- `app/page.tsx` — wired `onExpandChart` (+10% splitPct, max 85%) and `onCollapseChart` (−10%, min 15%) to toolbar

## 2026-06-14 (session 4) — Mobile + UI Polish

### Mobile Responsive Layout
- `app/layout.tsx` — added viewport meta tag; swapped sidebar+main for `<LayoutShell>`
- `components/shared/LayoutShell.tsx` (new) — client wrapper: sidebar is a fixed overlay on mobile with backdrop, floating `☰` FAB when closed; sidebar collapses on all screen sizes via `◀` button inside sidebar header
- `components/shared/Sidebar.tsx` — accepts `onClose`/`isMobile` props; always shows `◀` collapse button at top; nav links close sidebar on mobile tap; removed duplicate "Econ Calendar" nav entry
- `components/shared/TopBar.tsx` — Row 1 uses `flexWrap: wrap`; Row 2 gets `topbar-row2` class (hidden on mobile via CSS)
- `app/globals.css` — `@media (max-width: 767px)` breakpoint: hides Row 2, stacks overview page vertically, makes main scrollable, hides resize handle
- `app/page.tsx` — adds `overview-root` class for CSS targeting

### Heatmap Panel Collapse Tab
- `app/page.tsx` — replaced 4px resize divider with 16px border strip containing a centered `▶/◀` tab button; heatmap panel animates open/closed (`width` transition); arrows only visible on hover via CSS

### Heatmap Toolbar Collapse
- `app/page.tsx` — intensity slider toolbar now collapsible via `▲/▼` toggle; collapsed state shows slim 22px bar with label + current intensity value; arrow only visible on hover

### Vertical Drag Resize — Chart vs Bottom Panels
- `app/page.tsx` — replaced hardcoded `flex: "0 0 50%"` with `splitPct` state (default 50%); 5px drag handle with grip dots between GEX chart and bottom panels (Calendar / ES Stats / Snapshot); draggable 15%–85% range

### TT LIVE Dropdown Button
- `components/shared/TopBar.tsx` — merged `● TT LIVE` badge and `⋮` button into single clickable button; amber when connected, muted when disconnected; opens existing status dropdown

### Page Nav Dropdown in TopBar
- `components/shared/TopBar.tsx` — added `<select>` page navigator in Row 1; auto-selects current page via `usePathname`; navigates on change via `useRouter`

## 2026-06-13 (session 3)

### ES Stats Ladder — Current Price Row in Timeline
- `components/dashboard/EsStatsLadder.tsx` — added "ES NOW" row sourced from `esSpot` prop (same `spotPrice` state already passed from `app/page.tsx`)
- All rows (5 levels + spot) are now sorted descending by value so the current price appears at its correct position in the ladder
- Spot row renders with a filled cyan dot, cyan label/value, and subtle cyan background tint — visually distinct from level rows
- Data wiring unchanged: `esSpot` prop is already fed by the same WebSocket-backed `spotPrice` used by the GEX toolbar

## 2026-06-13 (session 2)

### Built Dynamic Economic Calendar via Next.js API
- Created `app/api/econ-calendar/events.json` — persistent data file, source of truth for all pages
- Created `app/api/econ-calendar/route.ts` — GET serves events.json; POST writes new events to disk
- Updated `Vanilla/pages/overview/overview.js` — `ECON_EVENTS` now fetched from `/api/econ-calendar` on load instead of hardcoded
- Updated `Vanilla/economic-calendar-importer.js` — after parsing JSON or OCR screenshot, POSTs events to API to persist permanently; falls back gracefully if server write fails

### Updated Economic Calendar (overview.js)
- Replaced week of June 8–12 events with June 15–19 week
- **Mon Jun 15:** Empire State Mfg Survey, Industrial Production, Capacity Utilization, NAHB Housing Index
- **Tue Jun 16:** Housing Starts, Import Prices
- **Wed Jun 17:** Retail Sales, Mfg & Trade Inventories, Pending Home Sales, U.S. Interest Rate Decision
- **Thu Jun 18:** Weekly Jobless Claims, Philly Fed Business Outlook, Leading Indicators
- **Fri Jun 19:** No events scheduled
