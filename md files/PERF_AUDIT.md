# Performance Audit — CB Edge Dashboard
_Symptom reported: sluggish even on revisit · UI freezes / janky scroll · slow data after page shows. Felt in dev, prod, and both._

The lag is **not** first-load webpack compile (already mitigated in `next.config.js`) and **not** the server WS layer (already throttled + content-deduped — the bandwidth fix landed). The cost is **client-side runtime in code that stays mounted across navigation**, plus **no client data cache**. Findings are ranked by impact ÷ effort.

---

## P0 — `useWsLifecycle` floods React on every mouse-move / scroll
**File:** `hooks/useWsLifecycle.ts`
**Evidence:** The activity handler fires on `mousemove`, `scroll`, `wheel` and runs on *every* event:
```js
const activityEvents = ["mousemove","mousedown","keydown","touchstart","scroll","wheel"];
const onActivity = () => { if (visible()) setShouldConnect(true); armIdleTimer(); };
```
`armIdleTimer()` does a `clearTimeout` + `setTimeout` on every tick, and `setShouldConnect(true)` is called constantly. Worse, the hook is mounted **3+ times at once** — `TopBar` (every page) + `home` + `es-candles` each instantiate their own copy of all six listeners. Moving the mouse over a chart runs the full handler several times per frame.
**Why it matters:** Directly explains janky scroll + click/nav latency on streaming pages.
**Fix:** debounce activity re-arm to ~1s, and **lift to one shared provider** so it instantiates once.
```js
// useWsLifecycle.ts — throttle the re-arm so a single move doesn't churn timers
let lastArm = 0;
const onActivity = () => {
  const t = Date.now();
  if (t - lastArm < 1000) return;        // ADD: ignore sub-second bursts
  lastArm = t;
  if (visible()) setShouldConnect(true);
  armIdleTimer();
};
```
Then make it a context (`WsLifecycleProvider` in `LayoutShell`) and have `TopBar`/`home`/`es-candles` read `useContext` instead of calling the hook. One listener set for the whole app.
**Impact: High · Effort: Low (throttle) → Medium (provider)**

---

## P1 — No client-side data cache: every page refetches from scratch on revisit
**Evidence:** No `swr` / `react-query` anywhere in `app/**`. Pages fetch in `useEffect(... , [])` on mount; the "cache"/"revalidate" hits were API-route config, not client. Navigating away and back re-hits `/api/*` and shows empty UI until it returns.
**Why it matters:** This is the "slow data after the page shows" + "sluggish on revisit" symptom.
**Fix:** add SWR (tiny, no provider required) and wrap the per-page mount fetches.
```bash
npm i swr
```
```ts
// example: app/greeks/page.tsx
import useSWR from "swr";
const fetcher = (u: string) => fetch(u).then(r => r.json());
// replace the useEffect+useState mount fetch with:
const { data } = useSWR("/api/quotes-batch?symbols=SPX,VIX", fetcher, {
  revalidateOnFocus: false,
  dedupingInterval: 15_000,   // revisits within 15s are instant from cache
});
```
Start with the 3–4 heaviest non-streaming pages. Leave WS-driven pages on their sockets.
**Impact: High · Effort: Medium**

---

## P2 — `TopBar` opens a 2nd `/ws/gex` socket **and** an SSE stream on every page
**File:** `components/shared/TopBar.tsx`
**Evidence:** TopBar is persistent chrome (mounted on every dashboard route). It opens its own `new WebSocket(".../ws/gex")` (line ~328) for ES/VIX/SPX *and* an `EventSource("/api/insights/gex/stream")` (line ~280). So on the home page you have TopBar's WS+SSE **plus** the page's own WS — duplicate parsing of the same frames.
**Why it matters:** Two parsers for the same data, doubled per-frame work, on top of the page's own.
**Fix:** publish the live prices once (you already stash `window.__gexAppState`) and have TopBar read from a shared store/context instead of its own socket. At minimum, gate the SSE behind `shouldConnect` so it closes when idle/backgrounded like the WS does.
**Impact: Medium-High · Effort: Medium**

---

## P3 — Client does heavy per-frame work on the `gex` frame; only `home` mitigates it
**Files:** `app/home/page.tsx` (has the fix), all other GEX consumers (don't)
**Evidence:** The server coalesces the ~100KB `gexRows` frame to every 6s, but each client still parses + recomputes (chain reduce, heatmap, colorMeta, MVC scans) on receipt. `home` added frame-coalescing + `HEAVY_FRAME_MS` flushing because it "blocks the main thread for seconds and freezes clicks/navigation" (author's own comment). That mitigation is **per-page**, not shared.
**Why it matters:** Any other page consuming fast frames re-freezes. It's the same root cause as P0 but on the data side.
**Fix:** extract home's coalescing into a shared `useThrottledGexFrame()` hook and use it everywhere a socket feeds heavy recompute.
**Impact: Medium · Effort: Medium**

---

## P4 — Sidebar collapsed-group header navigates via `router.push` (no prefetch)
**File:** `components/shared/Sidebar.tsx` (lines ~468–469)
**Evidence:** Leaf nav items are `<Link>` (prefetch ✓). The collapsed-group header uses `onClick={() => router.push(...)}` on a `<div>`, which skips Next's prefetch — that path feels slower than the others.
**Fix:** render the group header as a `<Link href={firstItem.href}>` (keep the flyout behavior) so it prefetches on hover.
**Impact: Low-Medium · Effort: Low**

---

## P5 — Duplicate `useNotes(user?.id)` in `GlobalToolbar` and `NotesDock`
**Files:** `components/shared/GlobalToolbar.tsx`, `components/shared/NotesDock.tsx`
**Evidence:** Both independently call `useNotes(user?.id)` → two localStorage reads + parses + two state copies of the same notes on every dashboard route.
**Why it matters:** Minor (localStorage is cheap), but it's redundant work in persistent chrome and the two copies can drift.
**Fix:** lift notes into the existing `NotesPanelProvider` (or a sibling `NotesProvider`) and have both components consume it.
**Impact: Low · Effort: Low**

---

## Recommended order
1. **P0 throttle** (one-line, biggest felt win) → then P0 provider.
2. **P1 SWR** on the heaviest non-streaming pages.
3. **P2 / P3** to kill duplicate sockets + share the frame throttle.
4. **P4 / P5** quick cleanups.

## Confirm with a 3-min profile (optional, before/after)
- DevTools **Performance** → record while navigating + scrolling. Long yellow "scripting" blocks during mouse-move = P0 confirmed.
- **Performance Monitor** → watch "JS event listeners" climb as you visit pages = duplicate-mount confirmed (P0/P2).
- **Network** → see pages refetch on revisit = P1 confirmed.
