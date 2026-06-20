# Shareable EM & Levels via Pine Seeds

Goal: publish **one** TradingView indicator that everyone can add, and it shows
**your** levels — no copy-paste, no per-user updates. It works because
`request.seed()` inside the indicator reads **your** GitHub data repo.

## How it works

```
ticker_levels (Postgres)
      │   pine-seeds-export.js  (run daily, after levels publish)
      ▼
your forked seeds repo
  data/<repo>/SPX_EM_UP.csv ...        ← one CSV per level, daily OHLCV bars
  symbol_info/<repo>.json              ← describes every symbol
      │   git push  →  TradingView "Check data" action validates + loads
      ▼
published Pine indicator  request.seed(user, repo, "SPX_EM_UP", close)
      │
      ▼
anyone who adds the indicator sees your levels
```

## Hard limits (read first)

- **End-of-day only.** Data pushed today appears on charts **tomorrow**. Real-time
  is *not* available via Pine Seeds (only via TradingView brokerage integration).
  Fine for weekly EM (static all week); not for intraday.
- **One value per symbol per day.** Each level is its own symbol (O=H=L=C=value).
- **Repo must be private** and **registered** with TradingView (one-time).
- **`request.seed()` args must be string literals** — the published indicator is
  hardcoded to one ticker (SPX). Clone the script per extra ticker.
- If you stop pushing for 3 months, TradingView drops the data.

## One-time setup

1. Fork the template repo `tradingview-pine-seeds/seed_crypto_santiment` (it has the
   correct structure + the **Check data** GitHub Action). Make your fork **private**.
   Pick a repo name starting with `seed_`, e.g. `seed_em_levels`.
2. Delete its sample `data/` and `symbol_info/` contents.
3. Request registration: follow `tradingview-pine-seeds/docs` → open the
   onboarding issue / form linked there with your repo name. Wait for approval.

## Daily update

```
# from the project root; point --out at your local clone of the seeds repo
DATABASE_URL=<your-url> node pine-seeds/pine-seeds-export.js \
    --repo seed_em_levels \
    --out  /path/to/seed_em_levels \
    --tickers SPX

cd /path/to/seed_em_levels
git add . && git commit -m "Update levels" && git push
```

After push, open the repo's **Actions** tab and confirm the **Check data** run is
green. Levels show on charts the next day.

### Automatic (wired into the weekly publisher)

`server-v2/levels-auto-publish.js` runs the export + `git add/commit/push`
automatically after each successful weekly publish — **no-op unless** these env
vars are set (so it stays off until you've cloned + registered the repo):

```
PINE_SEEDS_OUT=/path/to/your/local/clone/of/seed_em_levels   # required to enable
PINE_SEEDS_REPO=seed_em_levels                               # optional, default
```

The local clone at `PINE_SEEDS_OUT` must have push credentials configured (the
server runs `git push` non-interactively — use a credential helper or SSH key).
Leave the vars unset to manage updates manually with the command above.

## Publish the indicator

1. Open `SPX-EM-Levels-Seeds.pine` in TradingView's Pine Editor.
2. Find/replace `YOUR_GITHUB_USER` → your GitHub account, and confirm the repo
   name matches `--repo` (default `seed_em_levels`). All 8 `request.seed` lines.
3. Add to chart, confirm levels draw, then **Publish script** →
   *Invite-only* (control who sees it) or *Public*.
4. Share the published-script link. Anyone who adds it gets your levels.

### Another ticker (e.g. NDX)

Duplicate the `.pine`, replace the `SPX_` symbol prefixes with `NDX_`, retitle,
publish separately. (Pine can't switch seed symbols dynamically.)
