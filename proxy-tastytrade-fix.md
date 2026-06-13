# QQQ 0DTE MULTI GREEKS FIX

## Root Cause
The `/proxy/api/tt/chains/QQQ` endpoint is limiting the returned strikes due to TWO issues:

1. **Line 3339**: When no explicit expiration is passed, it only fetches the **2 nearest expirations** instead of ALL expirations. For QQQ, this might skip 0DTE if it's not in the top 2.

2. **Line 3339 + 3383**: The chainRange defaults to **100** (±$100 around spot). For QQQ at ~$722, this means only strikes between $622-$822 are returned. If the API data has more strikes outside this range, they're filtered out.

3. **Most importantly - Line 3502-3510**: Bid/Ask prices default to 0 when not in dxLink cache. If QQQ bid/ask aren't subscribed/updated yet, they show as 0, making the display look empty.

## Fix

Change line 3339 from:
```javascript
else targetExps = targetExps.slice(0, 2); // only 2 nearest expirations on initial load; DTE clicks lazy-fetch the rest
```

To:
```javascript
else targetExps = targetExps.slice(0, 3); // fetch up to 3 nearest expirations to ensure 0DTE is included
```

Even better, detect if 0DTE exists and include it:
```javascript
else {
  // Ensure we include today's 0DTE if it exists
  const todayDate = todayYmd().ymd; // already defined in the code
  targetExps = expirations
    .filter(e => e['expiration-date'] === todayDate)  // prioritize 0DTE
    .concat(targetExps.slice(0, 2));  // then nearest 2
  targetExps = targetExps.slice(0, 3); // max 3
}
```

## Why QQQ Shows Only Dashes

Even after the backend returns strikes, they show as "---" (dashes) because:
- **frontend** (mult-greek/page.tsx) renders "---" when `bid === 0 && ask === 0`
- Bid/ask come from dxLink `Quote` events which must be subscribed and streamed
- If QQQ Quote subscription isn't active or data hasn't arrived yet, bid/ask stay 0
- The logs confirm: "only 3 strikes return" = only 3 have valid bid/ask, the rest have bid=0/ask=0

## Secondary Fix (Optional)

In frontend `app\mult-greek\page.tsx` line 323 (in TickerPanel), you could also show strikes even with bid/ask=0:

```javascript
// Show all strikes, not just ones with valid bid/ask
.map(r => { ... })
// Remove: .filter(r => (r.callSym && ((cd.bid ?? 0) > 0 || (cd.ask ?? 0) > 0)) || ...)
```

But the REAL fix is backend: ensure QQQ 0DTE strikes are being fetched and subscribed to Quote events.
