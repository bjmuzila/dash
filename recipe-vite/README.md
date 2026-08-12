# recipe-vite — recipe.cbedge.net

The cookbook. Paste a recipe link, get a recipe; scale it to how many you're
feeding; send the ingredients to the grocery list you already use.

Structured like the Julienne cooking app — photo-first recipe page, serif
titles, one filled action per screen — in the CB Edge dark theme, so it sits
next to budget.cbedge.net as the same product rather than a visitor.

`src/theme.ts` is a verbatim copy of `budget-vite/src/theme.ts` plus a
`minutes()` helper. Copied, not imported, for the same reason the auth screens
are — see **Deliberately standalone** below. If you retune a colour in budget,
bring it here by hand.

## Where things live

| Thing | File |
|---|---|
| Backend logic (import, CRUD, hand-off) | `server-v2/_lib-household-recipes.cjs` |
| Routes (`/api/hh/recipes`) | `server-v2/household-routes.cjs` |
| Tables (`hh_recipes`, the two `recipe_id` columns) | `server-v2/_lib-household.cjs` → `ensureSchema()` |
| Parser tests (no DB, no network) | `server-v2/_lib-household-recipes.selftest.js` |
| SPA | this folder |

## It shares the household's data on purpose

Same login as budget.cbedge.net (`hh_users` / `hh_session`) — one password, one
PIN, one account.

More than that, it shares the *tables*:

- **"Add all"** inserts real `hh_list_items` rows, aisle-sorted, at the scaled
  amount. They appear on budget.cbedge.net's grocery list immediately, because
  it is the same list. There is no mirror and no sync step to get out of date.
- **"Pick a day"** inserts an `hh_meals` row, so the recipe shows up on the week
  board with its ingredients attached to it.

Both carry `recipe_id` back to the recipe, and both are `ON DELETE SET NULL` —
deleting a recipe must not pull tortillas off a list you're standing in the shop
holding.

## Import: structured data first, AI second

`POST /api/hh/recipes {action:'import'}` does this, in order:

1. Fetch the page (15s cap, 3MB cap, http/https only, private address space
   refused).
2. Look for a `schema.org/Recipe` node in any `application/ld+json` block,
   including inside `@graph`. Most food blogs publish one because Google
   requires it. This path is **free, instant and exact**.
3. Only if that's missing or has no ingredients: strip the page to text and ask
   Claude for structured JSON. Pasted text (an Instagram caption, a note) always
   takes this path — there's nothing structured in loose text to read.

Import **never writes to the database**. It returns a draft for the review
screen; nothing is saved until you press save there.

### The one secret

AI fallback needs `ANTHROPIC_API_KEY` in `.env.local` (read by the **dashboard**
container — the key never reaches the browser). Optional:
`RECIPE_AI_MODEL`, default `claude-sonnet-4-5`.

Without it, link imports of sites with structured data still work and the Paste
tab says so up front instead of failing after a 20-second wait.

## Photos are copied, not linked

`hh_recipe_images` — one row per recipe, `bytes BYTEA`, keyed by `recipe_id`.

A TikTok or Instagram cover is a **signed CDN URL with an expiry in it**. Keep
the link and the picture 403s a day later; a cookbook built on remote links
decays into placeholder tiles. So `captureImage()` copies the bytes at import
time, in the background — saving a recipe never waits on someone else's CDN, and
`imageSrc()` falls back to the still-fresh `image_url` until the copy lands.

It's a **separate table on purpose**: nothing can pull image bytes into a list
query by accident. The index screen selects twenty rows to draw 64px thumbnails.

`etag` is a content hash, and the client appends it as `?v=`. That's what makes
the year-long `immutable` cache header safe — replace a photo, the URL changes,
every phone refetches.

Your own photos: the camera button on the recipe screen. `downscale()` shrinks
the pick to 1400px JPEG **in the browser** and posts it as a data URL — no
`sharp` in the backend, no multipart parser, no multi-megabyte upload.

Backfill after deploying this, for recipes imported earlier:

```bash
docker compose exec -T dashboard node server-v2/scripts/backfill-recipe-images.js
```

## Ingredients are stored three ways

```
{ raw: "1 1/2 cups whole milk", qty: 1.5, unit: "cup", item: "whole milk", aisle: "dairy" }
```

`raw` is what you read while cooking and always wins on screen. The parsed
pieces exist for two jobs only: scaling, and the grocery hand-off.

The parser is deliberately conservative. When a line doesn't fit the shape —
"a pinch of flaky salt" — `qty` stays null and the raw line is used everywhere,
because you cannot double a pinch and a scaled `0.375 tsp` is worse than no
number at all.

`formatQty` exists **twice**: once in the server lib, once in
`src/pages/Recipe.tsx`. The servings stepper has to re-render on every tap and a
round trip per tap would feel broken. Change one, change both — the selftest is
the shared contract.

## Dev

```bash
npm install
npm run dev              # http://localhost:5176

# against the local backend (repo root, in another terminal):
npm run dev              # server-v2 on :3001

# against the VPS, with a real session:
VITE_BACKEND=https://recipe.cbedge.net BACKEND_COOKIE='hh_session=…' npm run dev
```

`BACKEND_COOKIE` is not `VITE_`-prefixed, so it stays in `vite.config.js` and
never reaches the browser bundle.

Run the parser tests after touching anything in the import path:

```bash
node server-v2/_lib-household-recipes.selftest.js
```

## Deploy

The compose service is `recipes` (nginx on `127.0.0.1:8084`, loopback only).

```bash
docker compose build recipes && docker compose up -d recipes
```

First deploy also needs the tunnel hostname. In `/etc/cloudflared/config.yml`,
**above** the catch-all 404 rule:

```yaml
  - hostname: recipe.cbedge.net
    service: http://127.0.0.1:8084
```

then:

```bash
cloudflared tunnel route dns <tunnel> recipe.cbedge.net
systemctl restart cloudflared
```

The `hh_recipes` table and the two `recipe_id` columns are created by
`ensureSchema()` on the dashboard container's first household request after
deploy. No migration to run.

## Deliberately standalone

No `@/app/...` alias into the Next app, no import from `budget-vite`. The auth
screens (`Login`, `SetPin`, `ChangePassword`, `PinPad`) started as copies of
budget-vite's and are meant to stay copies: these apps build and deploy
independently, and a shared module would mean a change for the budget screens
can break the cookbook's build. The `auth` block in `src/api.ts` is the only
part that must stay identical, and it's small enough to eyeball.
