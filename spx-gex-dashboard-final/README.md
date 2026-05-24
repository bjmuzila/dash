# SPX GEX Dashboard - Modular Structure

Your dashboard has been broken down into separate, organized files for easier maintenance and development.

## 📁 File Structure

```
spx-dashboard/
├── index.html                 # Main shell - topbar, nav, page loading
├── pages/
│   ├── overview.html          # Overview page (GEX Chart, Table, History)
│   ├── gex.html              # GEX Strike Ladder (SPX/SPY/QQQ/4th)
│   ├── bzila.html            # Bzila Flow page
│   ├── database.html         # Database page
│   ├── trading.html          # Trading/Journaling page
│   ├── stats.html            # Stats page
│   └── insights.html         # Insights page
├── shared/
│   ├── styles.css            # All CSS (variables, layout, components)
│   ├── api.js                # TastyTrade API calls
│   ├── calculations.js       # GEX/DEX formulas
│   └── app.js                # Global state, event bus, utilities
└── README.md                 # This file
```

## 🚀 How It Works

### Main Shell (`index.html`)
- Contains the topbar (clock, prices, controls)
- Contains the left navigation
- Loads page HTML files dynamically via `fetch()`
- Includes all shared JavaScript modules

### Page Files (`pages/*.html`)
Each page file contains ONLY its HTML structure:
- No `<html>`, `<head>`, or `<body>` tags
- Just the page content div and any page-specific scripts
- Gets loaded into the `#content-panel` div

### Shared Modules (`shared/*.js`)

**api.js** - TastyTrade API interaction
- `loadToken()`, `saveToken()`, `apiCall()`
- `fetchOptionsChain()`, `fetchQuote()`
- `doLogout()`

**calculations.js** - GEX/DEX math
- `calculateNetGEX()`, `calculateNetDEX()`
- `calculateCumulativeDEX()`
- `findGEXFlip()`, `findCallWall()`, `findPutWall()`
- `formatGEX()`, `formatStrike()`

**app.js** - Global utilities
- `AppState` - shared state object
- `EventBus` - pub/sub for cross-component communication
- `safeSet()` - safe DOM manipulation
- Clock updates, auto-refresh, navigation helpers

## 💡 Page Loading Flow

1. User clicks "GEX" in left nav
2. `loadPage('gex')` is called
3. Fetches `pages/gex.html` via JavaScript
4. Injects HTML into `#content-panel`
5. Calls `init_gex()` if it exists
6. Emits `page-changed` event

## 🔧 Adding a New Page

1. Create `pages/your-page.html` with your HTML
2. Add nav item to `index.html`:
   ```html
   <div class="nav-item" onclick="loadPage('your-page')" data-page="your-page">
     <span class="nav-icon">🎯</span>Your Page
   </div>
   ```
3. (Optional) Add `init_your_page()` function in your page HTML
4. Done!

## 📝 Important Notes

### Page-Specific JavaScript
If a page needs JavaScript, include it at the bottom of the page file:
```html
<div id="page-yourpage">
  <!-- Your HTML -->
</div>

<script>
function init_yourpage() {
  // This runs when page loads
  console.log('Page initialized!');
}

// Other page-specific functions
function doSomething() {
  // ...
}
</script>
```

### Cross-Page Communication
Use the event bus:
```javascript
// Listen for events
window.EventBus.on('data-updated', (data) => {
  console.log('Data changed:', data);
});

// Emit events
window.EventBus.emit('data-updated', newData);
```

### Accessing Shared Functions
All shared modules export to `window`:
```javascript
// API calls
await window.API.fetchQuote('SPX');

// Calculations
const netGEX = window.CALC.calculateNetGEX(row);

// State
window.AppState.spotPrice = 7500;

// Utilities
window.safeSet('element-id', 'New text');
```

## 🎯 Next Steps

### What's Already Done
✅ CSS extracted to `shared/styles.css`
✅ Page HTML files created (overview, gex, bzila, etc.)
✅ Main `index.html` shell with navigation
✅ Shared module structure (api.js, calculations.js, app.js)

### What You Need to Do
⚠️ **Extract all JavaScript from your original file:**

The original file has ~2000+ lines of JavaScript starting at line 4397. You need to:

1. **Review each function** and decide where it belongs:
   - API-related → `shared/api.js`
   - Calculation-related → `shared/calculations.js`
   - Page-specific (overview only) → `pages/overview.html` bottom
   - Page-specific (GEX only) → `pages/gex.html` bottom
   - Global utilities → `shared/app.js`

2. **Keep Chart.js logic** with the pages that use it

3. **Test incrementally:** Start with Overview page, make it work, then move to GEX page, etc.

## 🔍 Testing

To test this structure, you need a simple web server (can't open `index.html` directly due to `fetch()` restrictions):

```bash
# Python 3
python3 -m http.server 8000

# Node.js
npx http-server .

# PHP
php -S localhost:8000
```

Then open: `http://localhost:8000`

## ⚡ Benefits of This Structure

1. **Easier to Find Things** - GEX table code is in `pages/overview.html` or `pages/gex.html`, not buried in 6,600 lines
2. **Easier to Edit** - Change one page without touching others
3. **Easier to Test** - Test individual pages in isolation
4. **Easier to Collaborate** - Multiple people can work on different pages
5. **Easier to Add Features** - New pages don't bloat the main file
6. **Better Version Control** - Git diffs are cleaner per-file
7. **Reusable Code** - Shared modules can be used across pages

## 🎨 Styling

All CSS is in `shared/styles.css`. CSS variables make theming easy:
```css
:root {
  --bg0:#080c10;
  --cyan:#00e5ff;
  --green:#00e676;
  /* ... */
}
```

Change these to restyle the entire dashboard.

## 🐛 Troubleshooting

**"Failed to load page"**
- Check browser console for errors
- Make sure you're running a web server (not opening file:// directly)
- Check that page file exists in `pages/` folder

**"Function not defined"**
- Make sure shared modules are loaded in `index.html`
- Check that function is exported to `window` object
- Check browser console for script errors

**Page loads but doesn't work**
- Check if page needs `init_pagename()` function
- Check browser console for JavaScript errors
- Make sure page-specific JS is at bottom of page HTML

## 📧 Support

If you have questions about the structure, just ask!
