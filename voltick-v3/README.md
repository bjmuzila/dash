# voltick-v3 · voltick.cbedge.net/v3

Voltick's own board. It STARTED as a copy of `cbedge-v3` and has nothing to do
with it from here on.

## The two are separate products

An edit made here does not go to v3, and nothing here is a staging step for
cbedge.net. They share a starting point and a code shape, and that is all. v3 is
Brandon's own; this is what the merged product is being built out of.

So there is no promote path, deliberately. An earlier version of this folder
shipped `tools/merger.mjs`, which could copy a file back into `cbedge-v3` — that
was built on a misreading and **should be deleted**. If it is still there, it is
a loaded gun pointed at the live app:

```powershell
Remove-Item tools\merger.mjs
```

Divergence from v3 is not drift here. It is the plan.

## What it is

**Home is the cards.** `/v3` is every card in `src/board/catalog.tsx` as a tile.
Click one and that card opens on its own, full width, with live data, to be
looked at, audited or worked on. `/v3/cards/multi-greek` is a real link, so one
card can be sent to someone.

It is not a rebuild of the cards: it calls `CardDef.render()`, the same call the
grid board makes. The real card, its real controls, its real bugs. A card added
to the catalog gets a tile with no edit to the page.

The old grid board is still there, at `/v3/board`, as a page like any other. The
full pages (Premarket, Options Chain, Flow, Scanner, …) are listed under the
tiles and are their own routes, unchanged.

## The palette

`src/design/tokens.css` is the one file that turns this from CB Edge into
Voltick. v3's rule — no colour literal anywhere in `src/` outside that file —
held across every card, which is why repainting the whole app was editing 73
values and touching no component.

Keep that rule. `npm run check:theme` is what enforces it, and it is worth
running by hand even though the build no longer does: the moment a card carries
a hex of its own, the palette stops being one file and this app starts needing a
designer instead of a token.

`src/shell/Brand.tsx` is type, not art, because Voltick's mark is not mine to
invent. Drop the real asset in that one file when it exists.

## Serving

`voltick-v3` in the root `docker-compose.yml`, on `127.0.0.1:8089`, loopback
only. NOT a Cloudflare Tunnel hostname of its own — the only thing that reaches
it is voltick-web's `location ^~ /v3/`, which carries the same `auth_request`
gate every other voltick path does. Give it its own hostname and you have
published it with no gate in front of it.

```bash
npm run dev                  # localhost:5273/v3
docker compose build voltick-v3 && docker compose up -d voltick-v3
```

`build` here is `tsc --noEmit && vite build`. It deliberately does not run
`check-theme.mjs` or `check-budgets.mjs`, which measure this app against v3's
theme baseline and byte budgets — a different palette can only fail those.

---

# Inherited from cbedge-v3

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
