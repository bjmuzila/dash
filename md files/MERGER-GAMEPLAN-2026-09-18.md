# CB Edge — Post-Merger Gameplan

**Status: PLAN ONLY. Nothing in this document has been implemented.**
Drafted 2026-09-18. Every file path below was verified against the repo as it
stands today.

---

## 1. End state

CB Edge stops being a product you sell and becomes two things at once:

1. **A closing account** for existing paying customers — they keep the full
   dashboard, unchanged, until their current subscription runs out.
2. **Your personal trading platform** — nothing is deleted, the feed keeps
   running, you keep using it after the last customer leaves.

Public-facing, cbedge.net becomes a one-page merger notice pointing at Voltick,
with a Sign in button for people who already have an account.

Explicit non-goals:

- No feature removal from the dashboard.
- No forced migration of customers.
- No change to budget / recipe / daily / owner — those are separate products on
  the same box and this plan does not touch them. (`daily.cbedge.net` has its
  own Stripe and its own signup; make sure nothing in Phase 1 leaks into
  `daily-vite/` or `server-v2/daily-routes.cjs`.)

---

## 2. Phases

| Phase | What | When |
|---|---|---|
| 0 | Decisions + inventory (§8 open questions answered) | before anything |
| 1 | Close the front door — no new users, no new charges | merger announcement day |
| 2 | Landing page becomes the merger notice | same day as Phase 1 |
| 3 | Affiliate program wind-down + removal | after final payouts clear |
| 4 | In-app notice to existing customers | day 1–3 after announcement |
| 5 | Feed / cost reduction (measured, not guessed) | week 2 onward, rolling |
| 6 | Last subscription ends → personal-use mode | whenever the last sub lapses |

Phases 1, 2 and 4 are one deploy each and should go out close together so the
site never says two different things at once. Phase 5 is slow and reversible on
purpose.

---

## 3. Phase 1 — No new users, no new charges

The gate has to hold at three layers, because killing only the UI leaves the API
open.

### 3.1 UI layer
- `app/sign-up/` — replace the page body with a short "CB Edge is not accepting
  new accounts" notice + link to Voltick + link to `/sign-in`. Do not delete the
  route; a 404 on a link someone bookmarked or an old email looks broken.
- `components/landing/PublicNav.tsx` — drop every "Start" / "Sign up" / pricing
  CTA. Keep **Sign in**. Keep Docs if you want the KB public.
- `app/pricing/` — either redirect to `/` or replace with the merger notice.
  Middleware currently treats `/pricing` as both PUBLIC and PAID_EXEMPT
  (`middleware.ts` lines ~49 and ~341), so it is reachable by anyone; whatever it
  says is public.
- `app/checkout/` — `/checkout/success` is a public route (`middleware.ts` ~58).
  Leave the success page alive briefly for in-flight sessions, then retire.
- Promo redirectors (`/bday` and friends, noted at `middleware.ts` ~92) — delete.
  These 302 into `/pricing`.
- `app/api/waitlist/` — turn off; a waitlist for a product that is closing is a
  promise you can't keep.

### 3.2 API layer (the one that actually matters)
- `/api/auth/signup` — return 403 unconditionally. It is in the PUBLIC allow-list
  at `middleware.ts` ~65, so middleware will not stop it.
- `app/api/stripe/` — refuse new Checkout Session creation. Keep the **webhook**
  handler fully alive: it is what flips `isPaid` off when a subscription ends,
  and Phase 6 depends on it firing correctly.
- `app/api/offers/` — audit, likely retire with pricing.

### 3.3 Provider layer (belt and braces, outside the repo)
- **Supabase Auth** — turn off public sign-ups in the project settings. This is
  the real hard stop; everything above is the polite version.
- **Stripe** — archive the live prices/payment links so a stale checkout URL
  cannot create a subscription. Do this *after* confirming no in-flight checkout
  sessions.

### 3.4 What must NOT change in Phase 1
`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, forgot-password,
reset-password, and the Turnstile widget. Existing customers have to be able to
log in, and to recover an account they lose access to, for the whole wind-down.

---

## 4. Phase 2 — Landing page = merger notice

`app/page.tsx` already does the right structural thing and should keep doing it:

```
signed in  → /v3   (desktop)  |  /v3/m/gex  (phone, UA test)
signed out → LandingClient
```

Change only the signed-out branch.

- New component, e.g. `components/landing/MergerClient.tsx`. **Do not gut
  `LandingClient.tsx`** — swap the import in `app/page.tsx` and leave the old
  file unimported until you are sure, then delete it in a separate commit.
  It reuses `v3Theme.ts` so the notice still looks like CB Edge.
- Content: what merged, what it means for current customers (access continues to
  the end of your paid period, nothing is being removed), a primary link to
  Voltick, a secondary **Sign in** button.
- Metadata in `app/page.tsx` (`TITLE` / `DESC`) currently reads
  *"$50/mo, cancel anytime"* — rewrite both, plus the OG/Twitter blocks. Nested
  metadata **replaces** the layout's, so spell it out in full as it already does.
- `app/opengraph-image.png` — regenerate; the current card sells the product.
- `app/sitemap.ts` — drop `/pricing` and the `/explore/*` acquisition pages.
  Keep `/`, legal, and `/docs` if the KB stays up.
- `components/landing/BetaComingSoonBanner.tsx`, `HeroVideo.tsx`,
  `DashboardMock.tsx`, `LaserEtchIntro.tsx`, `SplashScreen.tsx`,
  `ReceiptsStrip.tsx`, `GradedLedger.tsx`, `LiveLevelPanel.tsx` — all
  sales-page furniture. Decide per-component: `GradedLedger` / `LiveLevelPanel`
  are the public "receipts" and may be worth keeping as proof; the rest are not.
- **Voltick destination is an open question** — `voltick.cbedge.net` is behind a
  Cloudflare Access one-time-PIN policy on an email allowlist (see the `voltick`
  service comment in `docker-compose.yml`). A public landing page cannot link
  there as-is. Either the link points at Voltick's real public domain, or that
  Access policy comes off first.

---

## 5. Phase 3 — Affiliate removal

There are **two separate things** named "affiliate". Confirm which one you meant
before any of this runs (§8).

### 5.1 The affiliate portal (its own app)
- SPA: `affiliate-vite/` — `pages/Landing.tsx`, `Apply.tsx`, `Dashboard.tsx`,
  `CodePage.tsx`, `Creatives.tsx`, `Payouts.tsx`, `Terms.tsx`, `Login.tsx`
- Backend: `server-v2/affiliate-routes.cjs`, `server-v2/_lib-affiliate.cjs`
- Container: `affiliates` service in `docker-compose.yml` (`127.0.0.1:8085`)
- Hostname: `affiliate.cbedge.net` via the Cloudflare Tunnel config
- Auth + data: `aff_affiliates` / `aff_session` / `aff_*` tables — a completely
  separate auth system from customer sessions

Order of operations:

1. **Stop new applications first** — `Apply.tsx` + its route. Nothing else.
2. Notify existing affiliates; state the final commission cutoff date.
3. **Pay out everything owed.** `Payouts.tsx` is the record; do not remove the
   container while a balance exists.
4. Remove the public surface: drop the `affiliate.cbedge.net` hostname from
   `/etc/cloudflared/config.yml`, restart cloudflared, comment out the
   `affiliates` service in `docker-compose.yml`.
5. **Keep the `aff_*` tables.** Payout history is a financial record. Removing
   the container costs nothing; dropping the tables is irreversible and there is
   no upside.
6. Delete `affiliate-vite/` and the two `server-v2` files only once (4) has been
   live and quiet for a full billing cycle.

### 5.2 The referral link surface on cbedge.net
Separate and smaller: the `?ref=` capture in `middleware.ts` (~line 224–230,
where it notes that stashing a ref on a public route can mis-attribute a later
sign-up) and `server-v2/_lib-attribution.cjs`. With sign-ups closed, `?ref=`
capture is dead weight — strip it in the same commit as §3.2 so attribution and
signup die together.

---

## 6. Phase 4 — Telling existing customers

- **In-app banner** in v3 shell (`cbedge-v3/src/shell/`), dismissible but
  persistent per-session: what merged, *their* access-until date, the Voltick
  link. This is the only v3 change in the whole plan.
- **One email**, not a sequence. `server-v2/lifecycle-email-scheduler.js` today
  runs onboarding/growth sequences — those become wrong the day Phase 1 ships.
  Disable them and send a single merger announcement.
- **Stripe cancel-at-period-end**, set in bulk on live subscriptions on the
  announcement date. Nobody gets charged for a renewal into a closing product,
  and `isPaid` flips off naturally at each customer's own period end — which is
  exactly the "until the end of the subscription" behaviour you want, with zero
  code changes to the paid gate.
- **Do not touch the paid gate** (`middleware.ts` ~330–352, `PAID_EXEMPT`). It
  already does the right thing: sub ends → `isPaid` false → `/home` (the
  delayed-data dashboard). Customers land somewhere sane instead of a 403.
- Decide whether `/home` (unpaid landing) also gets the merger notice. It
  probably should, since that is where every lapsed customer ends up.

---

## 7. Phase 5 — Dumbing down the feeds

**Measure first.** `/api/page-visits` already logs visits (middleware keeps that
route ungated specifically so logging survives — see the note at ~line 97). Pull
30 days of page-visit counts, rank the pages, and only then cut the recorders
that feed pages nobody opened. Cutting by guess is how a page silently goes
stale and you find out three weeks later.

### 7.1 Biggest lever: `/ws/gex` bandwidth
AGENTS.md is blunt about this — the socket is uncacheable, counts 100% as
Cloudflare bandwidth served, and has run up a bill three times
(2026-08-21, 08-31, 09-01). With a shrinking user base:

- Re-audit the `?topics=` union. One subscriber that omits `topics` forces the
  whole socket back to the unscoped firehose — find any that do.
- Consumers that open their **own** sockets and bypass topic scoping entirely:
  `app/home/HomeClient.tsx`, `WhaleOrdersPanel`, `hooks/useNqCandles`, and the
  `owner-vite` / `home3-vite` apps. With v2 effectively retired, several of these
  are pure cost.
- **Run `scripts/ws-scope-check.mjs` after every socket change.** Non-negotiable;
  that is what it exists for.
- The `'upgrade'` guard in `server-v2/server-with-proxy.js` stays. Removing it
  costs ~53GB/day. Do not "clean it up".

### 7.2 Recorder audit (`server-v2/`)
Each of these is an independent yes/no, ranked by "is this feeding something
anyone — including you — actually opens":

Likely first to go quiet: `etf-gex-recorder.js`, `etf-candle-recorder.js`,
`etf-live-candles.js`, `far-cb-recorder.js`, `scanner-recorder.js`,
`forward-scanner-recorder.js`, `mult-greek-gex-recorder.js`,
`mult-greek-snapshot-recorder.js`, `condor-mark-recorder.js`,
`atm-prem-*-recorder.js`, `earnings-calendar-recorder.js`,
`strike-growth-recorder.js`, `oi-daily-recorder.js`, `tpo-profiles-recorder.js`.

Almost certainly stays (personal use + the public graded-levels proof):
the SPX/GEX core path, `levels-engine.js`, `levels-auto-publish.js`,
`eod-gex-recorder.js`, `eod-strike-gex-recorder.js`, `signals-engine.js`,
`gex-history-writer.js`, `premarket-baseline.js`, `walls-recorder.js`.

**Prefer slowing to deleting.** Halving a recorder's interval is one number and
trivially reversible; deleting it loses the continuous history that makes the
data worth having. Intervals and the source switch live in
`server-v2/config/data-source.js` and each recorder's own header.

Also in scope: the tables AGENTS.md flags as *not rebuildable from a recorder*
(line ~52) — those recorders are load-bearing and must keep running regardless
of who is looking.

### 7.3 Marketing automation
`discord-bot.js`, `server-v2/discord-bot-poster.js`, `discord-relay.js`,
`econ-calendar-discord.js`, `mg-ladder-discord.js`,
`scheduled-posts-store.js`, `day-post-writer.js`. The customer-facing/promotional
ones stop; the ones that alert *you* about your own trades stay. Note the
`discord-relay` dedupe state is a mounted volume (`./state`) — if you stop and
later restart it, it re-primes.

### 7.4 Third-party spend
TastyTrade and ThetaData tiers, Cloudflare, Hetzner. The ThetaTerminal container
is already gone from compose. Once §7.2 lands, re-check what data entitlement you
still need versus what you are paying for — this is probably the single largest
real-dollar saving in the whole plan and it is a vendor conversation, not code.

---

## 8. Open questions — answer before Phase 1

1. **Merger date** — the day the landing page flips and cancel-at-period-end goes
   on. Everything else keys off it.
2. **Voltick link target** — public Voltick domain, or does the Cloudflare Access
   policy on `voltick.cbedge.net` come off first?
3. **"Affiliate link page"** — the whole affiliate program (§5.1), or just the
   referral/`?ref=` surface on cbedge.net (§5.2)? The plan covers both but they
   are different amounts of work.
4. **Outstanding affiliate balances** — any owed? That gates §5.1 step 4.
5. **Customer offer** — do current CB Edge subscribers get anything at Voltick (a
   code, a grandfathered rate)? Changes the wording of the banner and the email.
6. **Refunds** — annual subscribers mid-term: let them ride to period end
   (current plan), or refund pro-rata?
7. **How long does cbedge.net stay up** after the last subscription lapses? The
   answer decides whether Phase 6 is "keep serving the public notice" or "point
   the domain at Voltick and run the dashboard on a private hostname".
8. **`/docs`, `/whats-new`, `/explore/*`** — keep public as SEO/reference, or
   fold into the merger notice?

---

## 9. Do-not-touch list

- `owner-vite/` — live internal console at owner.cbedge.net. **Budget data inside
  it is protected**; nothing gets deleted without explicit confirmation.
- `budget-vite/`, `recipe-vite/`, `daily-vite/` and their backends
  (`household-server.js`, `daily-server.js`, `_lib-household*`, `_lib-daily*`).
  Separate products, separate auth, separate Stripe. This plan does not reach
  them — verify that each Phase 1 change is scoped to the trading dashboard.
- `app/`, `app-vite/`, `components/dashboard/` (v2) — ask-first per AGENTS.md.
  The landing/auth pages in `app/` that this plan *does* touch are the Next.js
  marketing surface, not the v2 dashboard, but call them out in the commit so
  the distinction stays obvious.
- The `'upgrade'` guard in `server-v2/server-with-proxy.js` (§7.1).
- Non-rebuildable tables flagged in AGENTS.md ~line 52.

---

## 10. Suggested commit sequence

1. `signup: close new-account creation (UI + API + waitlist)`
2. `landing: merger notice replaces sales page; metadata + sitemap`
3. `attribution: drop ?ref= capture now that signup is closed`
4. `v3: merger banner in shell`
5. `email: disable lifecycle sequences, send merger announcement`
6. `affiliate: stop new applications` → *(payouts clear)* → `affiliate: retire portal`
7. …then Phase 5, one recorder or topic per commit, each with a note on what it
   fed and how to turn it back on.

Each of those is independently revertible, which is the point — nothing here
should need a big-bang deploy.
