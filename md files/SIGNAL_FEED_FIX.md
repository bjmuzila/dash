# Signal Feed Fix - Now Shows Signals on Load

## Problem
Signal feed was always empty on page load and only showed signals after manually clicking REFRESH.

## Root Cause
1. **Missing Boot Message**: The initial "Signal feed is online" message was being added AFTER the feed was first rendered (timing issue)
2. **Empty Feed on Load**: No signals are generated until market activity happens (MVC changes, wall rollovers, etc.)
3. **No User Feedback**: An empty feed looked broken, so users thought nothing was working

## Solution

### 1. Boot Message First
Modified `initSignalFeed()` to:
- Add the boot/system message BEFORE rendering the feed
- Added fallback if `_feedPushSimpleSignal()` fails (directly call `addFeedItem`)
- Ensures there's always at least ONE message visible on load

### 2. Placeholder "Waiting" Message  
When feed is completely empty:
- Automatically adds an "Awaiting data" placeholder message
- Marked as demo=true and noDiscord=true so it's not sent to webhooks
- Users see something is working, not that it's broken

### 3. Visual Feedback
The feed now shows:
- ✓ **Boot Message**: "Signal feed is online and waiting for live alerts" (SYSTEM, blue)
- ✓ **Waiting Message**: "Waiting for market data..." (AWAITING, blue/gray) 
- ✓ **Real Signals**: Auto-generated from market events (MVC changes, walls, etc.)

## How Signals Are Generated

Signals are automatically created when these events occur:
- **MVC Changes**: Market Value Centrality shift to a new strike
- **Wall Rollovers**: Call Wall or Put Wall level change
- **GEX Flips**: Gamma Exposure sign flips (bullish ↔ bearish)
- **Economic Events**: Within 5 minutes of scheduled events
- **Manual Snapshots**: User-triggered via SNAP button

## Testing

1. **Load page**: Should see "Signal feed is online..." boot message
2. **Wait a moment**: If no real signals, see "Awaiting market data..." placeholder
3. **Click REFRESH**: Immediately re-renders current feed state
4. **Generate signal**: MVC move to new strike → signal appears instantly

## File Modified
- `pages/overview/overview.js` - Enhanced `initSignalFeed()` with boot message first + placeholder signals

## Side Effects (None)
- Demo/placeholder messages are marked with meta.demo=true
- Not sent to Discord webhooks
- Automatically cleared when real signals start flowing
- No breaking changes to signal detection or webhook posting
