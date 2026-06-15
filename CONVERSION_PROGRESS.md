# Proxy-to-Next.js Conversion Progress

## Completed
✅ Created `/lib/proxy/config.ts` - Configuration and state management
✅ Created `/lib/proxy/auth.ts` - TastyTrade authentication and token refresh
✅ Created `/app/api/[...proxy]/route.ts` - Catch-all API route for proxy requests
✅ Updated `estimated-moves.js` - Changed proxy base to `/api`

## Current Architecture
- **Frontend** calls `/api/proxy/api/tt/*` → Routes through catch-all
- **Catch-all route** (`/api/[...proxy]/route.ts`) intelligently routes to:
  - TastyTrade endpoints: Uses `lib/proxy/auth.ts` for direct API calls
  - Other proxy endpoints: Still routes to standalone 3001 server for now

## Remaining Work (To Consolidate into Single Server)

### High Priority (Required for Single Server)
1. **Create API routes for snapshots**
   - `/api/snapshots` (GET, POST)
   - `/api/snapshots/[id]` (DELETE)
   - `/api/snapshots/premium` (POST)

2. **Create API routes for flow data**
   - `/api/flow/calls` (POST)

3. **Move database logic** into shared library
   - Chain caching
   - Premium flow storage
   - Greeks history
   - Snapshot storage

4. **Extract all endpoint handlers from proxy-tastytrade.js**
   - `/proxy/api/auto-connect`
   - `/proxy/api/tt/quotes-batch`
   - `/proxy/api/tt/chains/[symbol]`
   - `/proxy/api/tt/expirations/[symbol]`
   - `/proxy/api/tt/option-marks`
   - `/proxy/api/tt/gex`
   - `/proxy/api/tt/gex-chain`
   - ... and ~30+ more endpoints

### Medium Priority (Performance & Features)
5. **WebSocket support** for dxLink streaming
   - Currently unsupported in Next.js serverless
   - May need custom server or streaming API routes

6. **Database initialization**
   - Move SQLite setup into Next.js lifecycle
   - Handle in `/app/api/[...proxy]/route.ts` or use middleware

### Low Priority (Polish)
7. **Environment variable validation**
8. **Error handling improvements**
9. **Logging utilities**

## How to Complete This

### For Quick Single-Server Setup
Currently, you can run:
```powershell
npm install concurrently --save-dev
npm run dev
```

This runs both 3001 (proxy) and 3002 (Next.js) simultaneously, but only the user sees 3002.

### For True Single-Server
Convert remaining endpoints in proxy-tastytrade.js to Next.js API routes following the pattern in `/lib/proxy/auth.ts`:

1. Extract helper functions into `/lib/proxy/` modules
2. Create corresponding `/app/api/*/route.ts` files
3. Update routing logic in `/app/api/[...proxy]/route.ts`

## Notes
- The TastyTrade API endpoints (in `/api/[...proxy]/route.ts`) now use native Next.js fetch instead of Node.js
- Token management is centralized in `lib/proxy/auth.ts`
- File paths are compatible with both Node.js (for proxy) and Next.js runtime
