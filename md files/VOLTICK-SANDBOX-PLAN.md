# voltick.cbedge.net — the Voltick sandbox

**Goal.** A URL where Gnotz617 (or anyone) can open the real Voltick site with
Brandon's change in it, and where an edit made for the sandbox is directly
PR-able to his repo.

**Decisions made:** Voltick lives as a **git submodule of `bjmuzila/Voltick`**.
It runs on **demo data** — no feed adapter.

---

## 1. Why demo data, and what that buys

Voltick picks its feed at boot, and with no keys set it picks the demo one:

```js
server.js:2336   let usingDemo = !tradier && !theta;
server.js:26293  if (usingDemo) demoTick = createDemoFeed();
```

So an unconfigured Voltick is not a broken Voltick — it is a working site with
an amber DEMO badge on it. That is the repo's own designed behaviour, and its
CLAUDE.md already prescribes it as the review loop: *"run `npm run dev` at the
repo root (engine + site; demo mode works with no keys) and click the thing you
changed."*

**The reviewer is looking at the change, not the numbers.** Accepting that
deletes the hard half of this project:

| Not needed | Because |
|---|---|
| `server/cbedge.js` feed adapter | no live feed |
| Confirming `/api/chains` carries per-leg IV | the engine has demo chains |
| An `avgVolumes` equivalent | ditto |
| TT proxy load + rate limits | nothing is pulled |
| The penny-offset licensing call | demo data is nobody's market data, so nothing can be wrong on a page someone else opens |
| Any API keys at all | `.env` stays empty |

And the demo mode will not surprise you by flipping: the self-heal at
`server.js:7308` only turns demo OFF when a real chain loads, and with no keys
one never will.

---

## 2. What to actually build

Five things. Model each on `voltick-v3`, which already does the same shape.

**1 · The submodule.**

```
spx-gex-dashboard-tt-fixed/
  voltick/            ← submodule → bjmuzila/Voltick, branch bzilabranch
  docker-compose.yml  ← + voltick-sandbox service
  voltick-vite/nginx.conf ← + a location for it
```

The working copy IS the fork, so an edit in `voltick/` commits to
`bzilabranch` and PRs with the existing `/voltick` skill. No copying changes
back by hand, no drift — that is the whole reason for the submodule.

**2 · A compose service**, published on `127.0.0.1` only. **Never give it its
own Cloudflare Tunnel hostname** — the only thing that should reach it is
nginx, carrying the gate. voltick-v3's README makes this point about a static
SPA; it matters more here, because this one has a real backend behind it.

**3 · An nginx location** behind the same `auth_request` every other voltick
path uses. One difference from voltick-v3, and it is the easy thing to miss:
**this is a Node process with a WebSocket, not a static SPA.** It needs

```nginx
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection "upgrade";
```

Without them the board loads and then never ticks, which reads as a data bug
and is a proxy bug.

Serve it at the **root** of voltick.cbedge.net, with voltick-v3 staying on
`/v3/*`. Voltick's router expects to own `/`; putting it under a prefix means
editing the submodule's Vite `base` and router basename purely for the
sandbox's benefit, which then rides along in every PR. Not worth it.

**4 · A writable directory for Voltick's own DB — and it is NOT a database
server.** This reads like "stand up SQLite" and it is not. `server/db.js:10`
imports `DatabaseSync` from **`node:sqlite`**, which is built into Node itself
(`engines: node >=22.5`, already required). There is nothing to install, no
daemon, no service, and CB Edge's Postgres does not come into it.

It opens exactly one file:

```js
db.js:18  export const DATA_DIR = process.env.DATA_DIR || __dirname;
db.js:27  new DatabaseSync(path.join(DATA_DIR, "voltick.db"), { timeout: 5000 })
```

So: a named docker volume, `DATA_DIR` pointed at it. It must exist and be
writable or boot fails. Losing it costs nothing here — the sandbox has no data
worth keeping.

**Do not port this to Postgres.** `db.js` is 76 KB written against the
synchronous `DatabaseSync` API throughout, it is Gnotz617's schema, and a
rewrite would be both large and un-PR-able. The embedded file is the right
answer for a sandbox.

**5 · `--recurse-submodules` on the VPS pull** (and
`git submodule update --init --remote` on the first deploy). **This is the most
likely way the whole thing fails quietly** — without it the sandbox builds the
submodule commit that was pinned on day one, forever, and looks like it is
working. Put it in the deploy script and in `AGENTS.md`.

### Env

Everything blank, with one exception:

```
SYMBOLS=SPX,SPY,QQQ,IWM,NDX
```

The default watchlist is ~500 names (`server.js:410`). The sandbox does not
need them and the demo generator should not be asked for them.

Leave `STRIPE_*`, `THETA_PROXY_URL`, `TRADIER_API_KEY`, `DISCORD_*`,
`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FRED_API_KEY` and `WORKERS` unset.
Voltick self-hides each of those surfaces when its key is blank — that is
documented per-key in `server/.env.example`, not a guess.

### Auth

Do not configure Stripe. The nginx gate is the door. Inside Voltick, seed one
subscriber account so the site believes you are a member and the paywall paths
render as a member sees them rather than being bypassed —
`server/seedaccount.js` and `server/make-subscriber.js` both already exist.

---

## 3. Build order

1. Add the submodule, pinned to `bzilabranch`.
2. Compose service + volume. Bring it up locally first and confirm the board
   draws with the DEMO badge — before any nginx or VPS work.
3. nginx location, with the WebSocket headers.
4. Fix the VPS pull to recurse submodules. **Verify it** by changing one
   visible string in the submodule and watching it reach the site. If that
   doesn't work, nothing after it can be trusted.
5. Seed the subscriber account; confirm the gate holds for a logged-out
   browser.

Step 2 is the real milestone — everything before it is cheap, everything after
it is plumbing.

---

## Later: real numbers, if they are ever wanted

This does not need deciding now, and nothing above changes if it is.

Only **four** methods of Voltick's feed client are reached from `server.js` —
`quotes`, `expirations`, `chain`, `avgVolumes` — and `tradier.js` calls itself
the swap point in its own header. A `server/cbedge.js` implementing those four
against CB Edge's TastyTrade proxy would light the sandbox up on Brandon's
data, with `engine.js` and the whole UI untouched.

The engine computes gamma, vega and delta itself (Black-Scholes) from the IV on
each leg, so the adapter only has to supply `strike`, `option_type`,
`open_interest`, `volume`, `bid`, `ask` and `greeks.mid_iv`
(`server.js:2799–2824`).

Three things to settle **before** writing it, not after:

1. Does `/api/chains` carry per-leg implied volatility? `implied-volatility`
   appears in `server-v2/api-router.js:2574` but nothing in voltick-v3 parses
   it. Without IV the engine has no greeks and the board is flat.
2. `avgVolumes` has no CB Edge equivalent — find what it feeds and whether a
   stub is survivable.
3. The penny offset. Voltick applies a 1¢ offset on three paths because of
   ThetaData's derived-data licence. On a different feed that licence does not
   apply, but TastyTrade has its own terms — and this becomes a live question
   the moment real prices reach a page someone else can open.

Keep `cbedge.js` **outside** the submodule (COPY it in at container build) so
the fork stays clean and a CB Edge feed client never rides along in a PR.
