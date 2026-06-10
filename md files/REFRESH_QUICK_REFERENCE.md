# Refresh Button Quick Reference

## What Happens When You Click "↻ Now"

### Visual States (in order)

```
1. [↻ Now]                           (t=0ms) User clicks
          ↓
2. [↻ Refreshing...]  (disabled)     (t=0ms) Immediate feedback
          ↓
3. [✓ Refreshed]      (green glow)   (t=~1.5s) Success
          ↓
4. [↻ Now]                           (t=3.3s) Ready again
```

## Timeline

| Time | State | Action |
|------|-------|--------|
| 0ms | Idle → Click | User clicks button |
| 0-10ms | Transitioning | Text changes to "Refreshing..." |
| 0-2000ms | Refreshing | API call fetches GEX data |
| ~1500ms | Complete | Data returns, success/error determined |
| 1500-3300ms | Feedback | Green glow (success) or red glow (error) |
| 3300ms+ | Normal | Button returns to "↻ Now", ready to click again |

## What You'll See

### Step 1: You Click
Button says: `↻ Now` (cyan text, clickable)

### Step 2: Immediate Feedback
Button says: `↻ Refreshing...` (grayed out, disabled)

This happens **instantly** so you know the click registered.

### Step 3: Success or Error
**If successful:**
- Button says: `✓ Refreshed` (bright green, glowing)
- Message lasts 1.8 seconds

**If error:**
- Button says: `✗ Failed` (bright red, glowing)
- Message lasts 1.8 seconds

### Step 4: Back to Normal
Button says: `↻ Now` (cyan text, clickable)
- Countdown timer resets to 30s
- Ready for next manual refresh

## Why This Design

✅ **Instant feedback** - Know your click registered  
✅ **Clear status** - See what's happening  
✅ **Success celebration** - Green glow = all good  
✅ **Error visibility** - Red glow = problem  
✅ **Prevents mistakes** - Can't double-click  
✅ **Self-healing** - Auto-resets, no manual fix needed  

## Keyboard Shortcuts

Currently: None

Future: Could add Ctrl+R or Cmd+R to trigger refresh

## If Something Goes Wrong

**Button stuck disabled?**
- Refresh the page (Ctrl+R or Cmd+R)
- Should reset to normal state

**No green glow?**
- Check if API call succeeded (DevTools → Network)
- See red glow instead = error occurred

**Can't click again?**
- Wait 3-4 seconds for button to fully reset
- If longer, reload page

## Console Messages (Developer)

If you open DevTools (F12):

**On success:**
```
[GEX] Greeks ready for 2026-06-09 after 145ms
```

**On error:**
```
[Refresh] Error: Network request failed
```

## Settings

All timing is hard-coded:
- Success/Error glow duration: **1.8 seconds**
- Disabled opacity: **0.6** (60% visibility)
- Button re-enables after: **1.8 seconds + reset**

To change these, edit `shared/overview.js` line ~3892:
```javascript
await new Promise(r => setTimeout(r, 1800));  // 1800ms = 1.8s
```

## Mobile / Touch

- Works on mobile browsers
- Button feedback visible on touch
- Glow effect works on all devices
- No special mobile version needed

## Accessibility

- Color + text indicates state (green = good, red = bad)
- Button disabled state is clear (disabled attribute + opacity)
- Screen readers see button state change
- Text is large enough to read easily

## Common Questions

**Q: Why does it say "Refreshing..." even if already loading?**
A: To show you the click registered, even if the API is slow.

**Q: Why 1.8 seconds for success display?**
A: Long enough to see and process, short enough to not feel slow.

**Q: What if I close the page during refresh?**
A: That's fine. The button state doesn't matter if page closes.

**Q: Does it show different message for different errors?**
A: Currently shows generic "Failed" message. Could be enhanced.

**Q: Can I disable the green glow?**
A: Not easily. Would require editing the code.

**Q: Is there a refresh history?**
A: Not currently. Could be added in future.

## Related Features

- **Auto-refresh:** Runs every 30 seconds (shows countdown)
- **Pause:** Click "⏸ Pause" to stop auto-refresh
- **Manual only:** When paused, only manual refresh works
- **Countdown:** Shows seconds until next auto-refresh

## Files to Know

- `shared/overview.js` - Contains the refresh logic
- `shared/styles.css` - Contains button styling
- `index.html` - Button HTML and layout

## Status Indicators in UI

| Element | Means |
|---------|-------|
| "↻ Now" | Ready to refresh |
| "↻ Refreshing..." | Working, please wait |
| "✓ Refreshed" | Success! Data updated |
| "✗ Failed" | Error occurred |
| Green glow | Everything OK |
| Red glow | Problem happened |
| Grayed out | Button disabled |

---

**Made:** Jun 2026  
**Status:** ✅ Active and working  
**Last tested:** June 8, 2026
