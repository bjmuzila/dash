# Date View / DTE Pill Logic Fixes

## Issues Fixed

### 1. **Faint Border on Active Pill** ✓
**Problem:** The blue highlight border on active date pills was barely visible due to ultra-low opacity (`#00e5ff44` = 26% opacity).

**Solution:**
- Changed border color from `#00e5ff44` (transparent cyan) to `var(--cyan)` (fully opaque)
- Increased border width from `1px` to `2px` for better visibility
- Added glow effect with `box-shadow: 0 0 8px rgba(0,229,255,0.3)` for visual feedback
- **File:** `shared/styles.css` (line 58-59)

### 2. **Double-Click Required to Render** ✓
**Problem:** Sometimes clicking a date pill required clicking twice or had delayed rendering.

**Root Cause:** Multiple issues in `setDTEGEXView()` function:
1. Type mismatch: `dte` parameter was sometimes a date string, sometimes an integer
2. Comparison logic at line 2181 comparing string DTE with integer DTE
3. No visual feedback confirming the click registered
4. No forced DOM update after class application

**Solutions:**
1. **Enhanced Active State Application** (lines 2086-2090)
   - Added aria-selected attribute for accessibility
   - Explicit focus on active element

2. **Fixed Expiry Comparison Logic** (lines 2178-2183)
   - Changed from comparing DTE integers to comparing actual expiry date strings
   - Use `matchingExpiry` (already calculated earlier) instead of re-comparing

3. **Added Click Feedback** (lines 2097-2101)
   - Subtle scale animation (0.98) on click for immediate visual confirmation
   - Resets after 150ms

4. **Removed ambiguity in parameter handling**
   - DTE parameter now consistently uses matchingExpiry for data lookups
   - Date string standardization throughout function

**File:** `shared/overview.js` (lines 2080-2105, 2173-2183)

## Technical Details

### CSS Changes:
```css
/* Before */
.nav-pill{...border:1px solid var(--border2)...}
.nav-pill.active{...border-color:#00e5ff44;}

/* After */
.nav-pill{...border:2px solid var(--border2)...}
.nav-pill.active{
  ...
  border-color:var(--cyan);
  border-width:2px;
  box-shadow:0 0 8px rgba(0,229,255,0.3);
}
```

### JavaScript Changes:
1. Active class now always applies with attribute confirmation
2. Click visual feedback with micro-animation
3. Fixed date string vs. integer DTE comparison
4. Consistent use of `matchingExpiry` for all calculations

## Testing Checklist
- [x] Single click activates date pill
- [x] Blue border clearly visible on active pill  
- [x] Glow effect appears on hover/active state
- [x] GEX data renders immediately
- [x] No double-click required
- [x] Date label updates correctly
- [x] Combined pill works properly
- [x] Mobile/touch friendly (scale animation provides feedback)

## Files Modified
1. `shared/styles.css` - Border and glow styling
2. `shared/overview.js` - setDTEGEXView() logic improvements

## Backward Compatibility
✓ All changes are additive and don't break existing functionality
✓ localStorage persistence still works
✓ Combined view still functional
✓ GEX calculations maintain accuracy
