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
| The process that serves them | `server-v2/household-server.js` |
| Its image | `deploy/household/Dockerfile` + `package.json` |
| Tables (`hh_recipes`, `hh_recipe_images`, the `recipe_id` columns) | `server-v2/_lib-household.cjs` → `ensureSchema()` |
| Parser tests (no DB, no network) | `server-v2/_lib-household-recipes.selftest.js` |
| SPA | this folder |

## It does NOT run in the trading app's process

`/api/hh/*` is served by the **`household` container** (`household:3010`), not
the dashboard. nginx here proxies `/api` straight to it.

That split happened because `server-v2` is baked into the dashboard image: a
one-line fix to a recipe parser meant `docker compose build dashboard` — a full
`next build` — and a restart that dropped `/ws/gex` and made Theta reconnect.
Shipping a cookbook tweak at 10:30am took the GEX feed down mid-session. It also
meant a leak in the recipe photo path shared a heap with the feed recorders.

**The database is still shared, on purpose.** Same `DATABASE_URL`, same
`hh_users` login, same `hh_list_items` grocery list. The process boundary buys
isolation; a data boundary would only buy work — and would cost the one feature
that makes this app worth having.

`household-routes.cjs` was already a mountable router taking
`{ register, send, readJson }` and uses no `ctx`, so `household-server.js` is
just a small host for it. No route is implemented twice.

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

## The tabs

`Cookbook · Add · Week · More`.

**Week** replaced a "Saved" tab that was the cookbook filtered to
`favorite = true` — a whole tab for one boolean, on a screen where everything is
already saved by definition. That distinction only earns a tab in an app with a
*Discover* feed you don't own; this one has no such feed. ★ is a chip in the
Cookbook filter row now, `/saved` redirects to `/cookbook`.

The slot went to the thing that had nowhere to live: **what you actually
planned**. Before it, "Pick a day" wrote a row you could only see by opening
budget.cbedge.net, which made planning feel like it went nowhere.

Week reads `hh_meals` — the same rows the household week board writes. A meal
typed over there with no recipe attached (a takeaway) shows here too, greyed and
unclickable: hiding it would make "Thursday is free" a lie.

## The Cookbook wall

The index is a masonry wall of photo cards under one large search box, not a
list of rows. Photos are what you actually recognise a saved recipe by; a 64px
circle crop and a title read like a database table of food.

Three things about it are load-bearing:

**It is JS-distributed flex columns — not `columns:`, not a grid.** CSS
multi-column fills top-to-bottom PER COLUMN, so on a phone recipe #2 lands
halfway down the screen. Cards are dealt round-robin across N lanes instead, so
reading order stays left-to-right while the cards keep unequal heights. A
`ResizeObserver` picks N from the container width — roughly 210px per card, so
two lanes on a 390px phone and five on a laptop.

**Card image heights are hashed from the recipe id** (132–204px). That is the
wall's rhythm, and hashing keeps it stable: a height that changed on re-render
would make the whole page jump every time a query settled.

**The page grid is `minmax(0, 1fr)`.** The chip and sort rows scroll sideways,
and an implicit `auto` track sizes itself to their FULL content — which pushes
the entire page off a 390px screen. This one is easy to reintroduce.

The chips are the category facet with the server's counts; there is no mood
taxonomy, because a mood row that is really "dinner" wearing a costume is a
second name for something that already has one. Cook time and source
(TIKTOK / REELS / WEB) ride the photo as scrim badges, with NEW / PART taking
the corner ahead of the source. The card gets ONE metadata line — "Never made"
when it applies, the ingredient count otherwise: 170px is about 26 characters of
9px mono and anything longer wraps ragged on half the wall.

⌘K focuses search, Escape clears it, and the ⌘K hint renders only on a fine
pointer — on a phone there is no keyboard to press it on.

## Sorting, and "main ingredient"

The Cookbook sorts on the **server**: recently added, recently changed, name,
main ingredient, cook time, most cooked, calories. Every key maps to a fixed
`ORDER BY` fragment in a whitelist — there is no path from a query parameter into
the query text, and the selftest asserts that.

Sorting client-side would have sorted the *page*, not the cookbook. Same reason
search is server-side: it covers ingredients, which the index rows don't carry.

`main_ingredient` is a **stored column**, written at import and recomputed when
the title or the ingredients change. Deriving it per query means unpacking a
JSONB array for every row of the index screen, twice, to ORDER BY it.

The guess reads the **title first**: "Cheesy Butter Chicken Garlic Bread" has
sixteen ingredients and one of them is the point — an ingredient-first scan files
it under *ciabatta loaf*, the line that happens to be listed first. Only when the
title says nothing does it fall back to the best-ranked ingredient aisle (meat →
produce → dairy → …). When neither is confident it stays **null** and sorts last:
a recipe filed under a random pantry item sorts somewhere absurd, which is worse
than sitting where you can see it needs a hand.

Backfill after deploying, or your whole existing library sits in the NULL bucket:

```bash
docker compose exec -T household node server-v2/scripts/backfill-recipe-derived.js
# after editing the HEROES list:
docker compose exec -T household node server-v2/scripts/backfill-recipe-derived.js --force
```

## Bulk import

Paste up to 60 links, walk away. `hh_recipe_import_jobs` + `_items` — real rows,
so progress survives a container restart and a batch that was mid-flight when
the process died is **resumed on boot** (`resumeImportJobs`, called from
`household-server.js` only — import work has no business in the trading process).

Thirty TikToks is thirty page fetches and thirty Claude calls: minutes. So the
POST returns a job id immediately and the client polls; two at a time, which is
polite to the sites and keeps the AI spend legible.

**Bulk saves without review, and that's deliberate.** Single imports never write
until you press save; bulk writes immediately with `needs_review = true`. A
review queue you must clear before anything lands is a queue nobody clears at
thirty items — you'd sit through twenty screens or abandon the batch and lose the
lot. Saving first and flagging second means the work is never wasted: the
recipes are searchable and cookable at once, and "to review" is a filter on the
Cookbook plus a banner on each recipe with one button to clear it.

Failures are per-row: a dead link records its error next to its URL and the other
fifty-nine carry on. **Retry failed** requeues only those rows — a batch of a
hundred always throws off a few timeouts, and re-pasting the list to catch six of
them would re-check a hundred URLs.

### The "is this even a recipe" gate

A TikTok favourites export is **not** a recipe list — it's everything you ever
bookmarked. Brandon's is 1,480 items and includes CapCut tutorials.

Every non-recipe used to cost a full Claude call before returning "that doesn't
look like a recipe", which is paying an LLM to repeat what the caption already
said. `recipeSignals()` reads the caption first and skips the API when there's no
food in it — the page fetch still happens (free, and it's what produced the
caption), so the saving is precisely the expensive half. On 1,480 links that's
roughly $25 → $6.

It scores amounts (`500g`, `2 tbsp`, `350F`), method verbs, recipe words
(`ingredients`, `macros`, `serves`) and food nouns from the same HEROES list the
main-ingredient guess uses. **One strong signal passes, or two weak ones** — it
is deliberately generous, because a false negative is one manual import and a
false positive is about two pence. Rejections are `NOT FOOD` in the progress
list, counted apart from failures, and not retried. A single link rejected by
the gate offers **Import anyway**.

The JSON-LD path is never gated: a page carrying `recipeIngredient` has already
proved what it is.

### "Full recipe in bio"

Creators split into two habits and they need opposite handling.

**The caption links the write-up** → follow it. The blog almost certainly
publishes JSON-LD, so following turns a partial caption into an exact recipe,
free. `source_url` stays the VIDEO — that's what you saved, what you'll want to
watch, and what `source_key` is derived from, so swapping in the blog URL would
make your export list re-import every one of these next batch. The followed page
goes in `recipe_url` and shows as **Full recipe ↗** next to **Watch**.

Aggregators (`linktr.ee`, `beacons.ai`, `stan.store`, …), socials and affiliate
shops are never followed — a bio link is a menu of buttons, and fetching one
burns an AI call on a page with no food in it. One hop only: a link on a recipe
page is a *related* recipe, not this one.

**The caption just says "recipe in bio"** → nothing to follow. It imports with
`partial = true` and `partial_note` set to the creator's own words, and the
recipe page carries a banner above the ingredients. Above, deliberately: finding
out at step four, mid-cook, is the failure this exists to prevent. **I filled it
in** clears the flag. Rows show `PART`, which beats `NEW` — incomplete is worth
knowing before you open it.

If the gate rejects such a caption entirely, the miss reason quotes the phrase,
so the by-hand list distinguishes "the recipe is in their bio" from "this is a
dog video".

### The by-hand pile

`GET /api/hh/recipes/bulk?misses=1` returns every link that never became a
recipe, **across every job** — with its status, its reason and a link out to the
video. The Bulk tab shows it as a "Not imported" card with **Copy URLs** and
**Download .txt**.

Not per-job on purpose: twenty-five batches is twenty-five progress panels, and
nobody opens each one to copy six URLs out of it.

The list **shrinks by itself**. It excludes any URL that ever succeeded in any
job (retry and re-paste both leave the old failed row behind) and any URL whose
recipe now exists by `source_key` (covers importing it by hand). `DISTINCT ON`
keeps the most recent attempt, so the reason shown is why it failed *last*.

### Duplicates, and why the check runs twice

TikTok's **data export does not write the pretty URL**. Favourites come out as
`tiktokv.com/share/video/<id>`, the app's share sheet gives `vm.tiktok.com/<code>`,
and the site itself writes `tiktok.com/@handle/video/<id>`. All three are one
video, so `sourceKey()` normalises to `tiktok:<id>` (`instagram:<code>`, else
host + path) and that is the column bulk import matches on.

The check runs **before** the fetch — one indexed lookup, no page and no AI call
— and **again after**, because a short share code carries no id and only the
resolved URL can tell you it's something you already have. A skip is reported as
`HAVE IT`, not as a failure, and counted separately.

Same reason `sourceName` reads the page (`"uniqueId"` in TikTok's rehydration
blob) before the URL: an export link has no handle in it at all, so URL-only
credit would file a hundred imports under "tiktokv.com".

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

Two services. `recipes` is the SPA (nginx on `127.0.0.1:8084`); `household` is
the backend (`127.0.0.1:3010`). Neither restart touches the trading dashboard.

```bash
# backend change (import, routes, schema, photos)
docker compose build household && docker compose up -d household

# UI change
docker compose build recipes && docker compose up -d recipes
```

Check it came up:

```bash
curl -s http://127.0.0.1:3010/health      # {"ok":true,"routes":29,"db":true}
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
