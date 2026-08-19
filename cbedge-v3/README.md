# cbedge-v3

Version 3 of the CB Edge dashboard. Frontend only — `server-v2` stays exactly as
it is and remains the source of all data. Lives beside `app-vite/`,
`owner-vite/`, `budget-vite/` and `recipe-vite/`, shares no code with any of
them, and is served at **`cbedge.net/v3/`** (owner-only until it ships) while v2
keeps `/app/*`.

The UI is deliberately blank. What is finished is the part that decides whether
the app feels fast, which is very hard to retrofit later and very easy to build
first.

## Start

```bash
npm install
cp .env.example .env.local        # point VITE_BACKEND_ORIGIN at the VPS
npm run dev                       # http://localhost:5273/v3/
```

No backend to hand:

```bash
npm run build:fast && npm run mock   # http://localhost:4310/v3/ with fake data
```

## What is already built

**Early boot.** The WebSocket opens in `index.html`, before the JS bundle is
fetched, and buffers frames until React takes over. The IndexedDB read starts in
the same breath. Measured on the mock server: first frame at 51ms, first paint at
80ms — the data beats the pixels.

**One store, per-field subscriptions, rAF coalescing.** Twenty frames inside one
animation frame produce one notification. A spot tick re-renders the spot number,
not the panel.

**Derived topic scoping.** The socket's `?topics=` scope comes from what is
actually subscribed. There is no list to maintain and therefore no way to forget
an entry and silently go stale. `npm run check:ws` drives a real browser against
a server that mirrors server-v2's filtering and proves it.

**Instant stale paint.** Last-known state is cached in IndexedDB and painted
immediately, dimmed, until live data replaces it. The screen is never empty and
there are no spinners on numbers.

**Budgets that fail the build.** `npm run build` measures every chunk in brotli
against `budgets.json` and exits non-zero if anything is over. Current initial
load is 69.5kb brotli against a 109kb ceiling.

**Dev perf overlay.** Bottom-right, backtick to toggle, stripped from production.
Shows paint, first-frame, store flushes/sec, socket state and topic count.

## What is not built

Everything visual. Tokens are placeholder values, primitives are structural
shells, and there is one blank page. That is the starting point, not an
oversight.

## Next

1. Fill in `src/design/tokens.css` as the palette gets decided.
2. Transcribe real frame shapes into `src/contract/frames.ts` from
   `server-v2/websocket-server.js`.
3. Build the GEX chart first — it is the hardest data path in the app, and a data
   layer that survives it will survive everything else.

See `AGENTS.md` for the rules and the file map.
