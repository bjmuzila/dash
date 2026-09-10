# CB Edge site audit — 2026-09-10

Scope: the public landing page (`/` → `components/landing/*`) first, then the
signed-out funnel around it (`/pricing`, `/sign-in`, `/sign-up`, `/docs`,
`/explore/*`), the root layout, middleware, and the three public APIs the
landing page draws on. Live checks were made against cbedge.net at ~04:30 ET.
No code was changed. Each item says where it is and what to do about it.

Severity: **P1** = a visitor sees something false or broken today.
**P2** = funnel friction / SEO / a11y. **P3** = hygiene and stale comments.

---

## HOME PAGE (`/`)

### P1 — The product video and its poster show the old v2 board, dated July/June

`components/landing/HeroVideo.tsx` plays `public/hero-loop.mp4` (captured
**Tue 7/14**, SPX 7,540) with `public/landing-bg.png` as the poster (captured
**6/22**, SPX 7,505). Both are the v2 dashboard: the old silver wordmark, an
**ICT** tab, **Test Lab** and **Owner** tabs in the nav, "MVC" (the name Core
replaced), and the poster's status bar shows `dash-1fa2.onrender.com/home`.
The badge over it reads **"LIVE DASHBOARD"**. Every feature card beside it
sells v3, and the page's own header comment says ICT is off the grid.

Fix: re-capture on v3 (a 10–14s silent loop of `/v3`), replace both files,
and change the badge to something true ("Product capture · v3" or drop it).
`public/whole-board-preview.png` (Sept 8) looks like the right poster
candidate. Also: the component is still on `HOME_THEME` with hardcoded
rgba, a 14px radius, a glow shadow and `backdropFilter` — every rule the
2026-09-05 v3 note in `LandingClient.tsx` says the landing no longer has.

### P1 — The link-preview image advertises TPO and ICT

`app/opengraph-image.tsx` (what X / Discord / iMessage render for any
cbedge.net link) has feature chips **"TPO · Squeeze Scanner"** and
**"ICT Alerts"**. Both were removed from the product and from the explore
pages on 2026-09-05. Swap for the current four (GEX, Flow, Premarket Prep,
Scanner / Initial Balance).

### P1 — Any unknown URL, including `/robots.txt` and `/sitemap.xml`, 307s to the landing page

Verified live: `/this-page-does-not-exist`, `/robots.txt` and `/sitemap.xml`
all return the landing page with a 200. Cause: `middleware.ts` sends every
signed-out request that is not a `PUBLIC_PATTERN` to `/`, and the matcher's
extension exclusion list has no `txt` or `xml`. Consequences: no robots.txt
(crawlers get HTML), no sitemap, and every dead link on the web is a soft-404
that Google treats as a duplicate of the home page.

Fix: add `txt|xml|webmanifest` to the matcher exclusion; add `public/robots.txt`
and an `app/sitemap.ts` listing `/`, `/pricing`, `/docs`, `/whats-new`,
`/explore/<slug>` for each `EXPLORE_SLUGS` entry plus `/explore/seasonality`,
and the four legal pages. Consider returning a real 404 (`app/not-found.tsx`
already exists) for signed-out hits on non-public paths instead of a redirect.

### P2 — Receipts ledger: all 8 rows are hits with identical text, and two sessions are missing

`/api/public-ledger` today: 8 rows, 8 HIT, every "What happened" cell reads
"Reached and held — price turned at the level". The section's whole argument
is "we show the misses"; a table where every row is the same sentence reads
as curated even though it is not. Two things would help without touching the
grading rule:

1. Show the `outcome` field the route already returns (`pivot` / `chop`) — the
   UI ignores it, and it is the one column that varies row to row.
2. Widen `MAX_ROWS` from 8 to 15–20 so a 88.6% hit rate has room to show a
   miss (at n=8 the chance of zero misses is ~38%).

Data gap: newest graded row is **2026-09-04**. With Labor Day on 09-07, the
09-05 and 09-08 sessions should both be graded by now and are not in
`confidence_log`. `ageDays` is 6, under the route's `STALE_DAYS=10`, so the
header still says "auto-graded daily". Check the confidence-grader job.

### P2 — Primary CTA fails contrast

White text on `V3.cyan` (#219ebc) is **3.1:1** — below WCAG AA (4.5:1) for the
15px "Get full access" button and the 11px "GET FULL ACCESS" nav button.
`/pricing`'s own join button uses dark ink (`#04121a`) on the same cyan, which
passes at ~9:1. Make `v3PrimaryButton` and `PublicNav.ctaBtn` dark-on-cyan
(or a darker cyan) — one edit in `v3Theme.ts` and one in `PublicNav.tsx`.

### P2 — Landing loads fire two analytics beacons

`LayoutShell` (bare route path) mounts `VisitTracker` (page_key `home`) and
`app/layout.tsx` mounts `MarketingPageTracker` (page_key `public:landing`) —
both call `usePageLoadStatus` on `/`, `/pricing`, `/docs`, `/explore/*`, the
legal pages, `/sign-in`, `/sign-up`. Each was added to fix "public pages are
untracked" and each says it is the only one. Session entry is claimed once
(sessionStorage guard) so session counts are right, but every public page
load writes two `page_visits` rows under two keys, which inflates page-level
counts in the owner Overview. Keep `MarketingPageTracker` (it has the stable
`public:` keys) and drop `VisitTracker` from `LayoutShell`.

### P2 — Nav "Overview" points at an anchor that does not exist

`PublicNav.PUBLIC_NAV[0].href` is `/#overview`; nothing on the landing page
has `id="overview"`. Give the hero section that id (or point the link at `/`).

### P3 — Small landing items

- The value strip says "15s chain-to-screen · no polling delay" directly above
  a free tile that polls every 15s against a 15s server cache (worst case
  ~30s). True for the paid socket feed; slightly off for the tile beside it.
- Strip cells keep `borderRight` when stacked at ≤620px, and have no
  `borderBottom`, so on phones the four facts run together with a stray right
  edge. Add a bottom hairline and drop the right one under 620px.
- `LiveLevelPanel` refetches on both `visibilitychange` and `focus`; a click
  back into the window fires both. Harmless, one fetch wasted.
- `GradedLedger` row key is `${date}-${level}` — collides if two sessions
  ever share a date and level. Use the index as a tie-breaker.
- Four components in `components/landing/` are not imported by the landing
  page and are pre-launch artifacts: `SplashScreen.tsx` (countdown to
  2026-07-07), `LaserEtchIntro.tsx`, `DashboardMock.tsx`,
  `BetaComingSoonBanner.tsx`. Move to `Vanilla/` once a grep confirms no other
  importer. Same for `public/beta-coming-soon.html` and `public/hero.png`
  (1.3 MB, no reference found in the files audited).

---

## THE FUNNEL AROUND IT

### P1 — `/pricing` "Check out the dashboard with delayed data →" bounces straight back

For a signed-in, unpaid user, `app/pricing/page.tsx` links to `/home`.
`app/home/page.tsx` now does `if (!access.ok) redirect("/pricing")` — the
delayed-snapshot mode was retired. The link is a round trip to the same page.
Remove the link (and the `PAID_EXEMPT` comment in `middleware.ts` and the
whole header comment of `app/home/layout.tsx`, both of which still describe
the retired delayed mode).

### P2 — Theme break between the landing page and the page its CTA lands on

`/` , `PublicNav` and `/explore/[slug]` are v3-flat (`v3Theme.ts`).
`/pricing`, `/explore/seasonality`, `/sign-in`, `/sign-up` and `AuthForm` are
still v2 `HOME_THEME` glass: `shellGlow`, `homeGlossPanelStyle`, 999px pills,
`textShadow`, `opacity` on body text, literal rgba. A visitor goes flat →
glass → flat inside one click path, and `/pricing` is the page that takes the
money. Port `/pricing` and the auth pages to `v3Theme` first.

### P2 — Sign-in still shows the old logo

`app/sign-in/[[...sign-in]]/page.tsx` hardcodes `/cb-edge-logo.png`;
`app/sign-up/...` uses `BRAND_LOGO_SRC` (the 3.0 lockup). `lib/brand.ts`
exists precisely so this cannot happen. Also the sign-in page hardcodes
`background: "#05060A"`.

### P2 — `/docs` documents v2 and skips most of what the landing sells

The KB's page list is Home, Traders Dashboard, Options Chain, Analytics, ES
Candles, Journal, Feedback, Greeks Dashboard, Multi-Greek Grid, Estimated
Moves — the v2 surfaces. There is no doc for Flow, Premarket Prep, Top Change
Scanner, Watch Scanner or Initial Balance (five of the seven landing feature
cards), and it uses the long form "CB — Core Bullseye" throughout, which the
rest of the site dropped on 09-05. Lowest-effort fix: retitle the v2 pages
to their v3 names and add one short section per missing feature that links
to the matching `/explore/<slug>` page.

### P2 — `PublicNav` has no mobile menu

Links hide at ≤960px with no hamburger. On a phone, Docs is unreachable from
the nav and Pricing only via the CTA button.

### P2 — Metadata

- No per-page `description` on `/` — it inherits the root "Your edge. Their
  loss…" line. Give the landing a real 150-char description (the hero sub
  works), and `/pricing` and `/docs` their own.
- No `alternates.canonical`. Live links resolve to `www.cbedge.net`, while
  `metadataBase` is `https://cbedge.net` — og:url and canonical will disagree
  with the served host. Set `NEXT_PUBLIC_SITE_URL` to the canonical host and
  add canonical URLs.
- `viewport.maximumScale: 1` disables pinch-zoom (Lighthouse a11y fail).
  Remove it; the phone build handles its own gestures.

### P3 — Redirect hops and labels

- `PricingActions` "Go to dashboard" → `/home` → `/v3` (two hops; link `/v3`).
- `app/not-found.tsx`: primary "Back to Home" → `/home`, secondary
  "Dashboard" → `/`. Labels are swapped relative to where they go.
- `/sign-in` default `next` is `/home` → `/v3`; point it at `/v3`.

---

## REPO HYGIENE (noticed on the way)

- Root has a stray file literally named
  `-tree -r 0de5e07 --name-only  findstr -i homeTheme` (a PowerShell redirect
  accident) and `isolate-00000165717CD000-30752-v8.log` (1 MB). Delete.
- `gex_strike_history.csv` (64 MB) and `ESU6 - 5 min - RTH.csv` (3 MB) sit at
  the root and are not in `.gitignore`. Verify they are not committed.
- `AGENTS.md` "Versioning" section says `YYYY.MM.DD-vN`; `package.json` is
  `v9.10.5`. The AGENTS.md pasted into the Cowork instructions is also an
  older copy than the one in the repo (the repo copy has the v3-default,
  owner-surface and budget-protection sections; the pasted one does not).
- Security headers: `X-Frame-Options`, COOP, CORP and Permissions-Policy are
  set in `next.config.js`; there is no `Content-Security-Policy` and no HSTS
  from the app (Cloudflare may add HSTS — confirm in the dashboard).

---

## What is working well

The free `LiveLevelPanel` and the two receipts endpoints were all live and
consistent at audit time (`/api/public-levels` ok, spot 7620 / Core 7600;
`/api/public-stats` three cards, all over their n floors; ledger dated and
fresh). The landing copy contains no trial language anywhere, matching the
09-09 checkout change. All 19 internal links on the page resolve to real
routes, including every `/explore/<slug>` in `FEATURES`. The page is flat
v3, uses only `v3Theme` tokens, and reads cleanly at 390px apart from the
strip borders noted above.

## Suggested order

1. Re-capture the hero video/poster on v3; fix the OG image chips.
2. Matcher + robots.txt + sitemap; decide 404-vs-redirect for unknown paths.
3. Remove the `/pricing` → `/home` bounce link and its stale comments.
4. CTA contrast (dark ink on cyan) — one-line theme change.
5. Drop the duplicate beacon.
6. Show `outcome` in the ledger, widen `MAX_ROWS`, check the grader for 09-05 / 09-08.
7. Port `/pricing` + auth pages to v3; fix sign-in logo.
8. Docs refresh; mobile nav; metadata/canonical; remove `maximumScale`.
