# demo-owner — email-gated owner console demo

A standalone, **read-only, data-free** replica of `owner.cbedge.net` for showing a
prospective partner how the console is laid out and what lives on each screen.

- All 28 routes render, grouped exactly like the real rail.
- **Every customer, revenue, affiliate and visitor record is synthetic.** Emails use the
  reserved `.test` TLD so nothing can resolve to a real person.
- Ticker/market values are static illustrative numbers.
- Personal group (Budget / Reta / To-Do) renders a "not included" card — no titles, no data.
- No backend, no database, no API calls, no network requests at all. One HTML file.

Nothing in this build can reach production. It cannot be pointed at it either — there is no
fetch layer to repoint.

---

## 1. Build

```bash
cd demo-owner
node build.mjs        # → dist/index.html  (~87 KB, self-contained)
```

Source lives in `src/`:

| File | What |
|------|------|
| `src/data.js`   | every mock record — edit here to change what the partner sees |
| `src/ui.js`     | primitives: cards, tiles, tables, charts, gauges, the GEX ladder |
| `src/pages.js`  | the 28 page renderers |
| `src/shell.js`  | nav (mirrors `owner-vite/src/lib/nav.ts`), router, rail |
| `src/styles.css`| colors/spacing mirroring `owner-vite/src/lib/theme.ts` |

`node check.mjs` walks all 28 routes in a headless browser and fails on JS errors or empty pages.
Run it after editing.

---

## 2. Deploy to `demo.cbedge.net`

**a. Ship the code** — normal path, `push.ps1` on the laptop → GitHub → VPS pull.

**b. Add the service** to the VPS `docker-compose.yml` (see `compose.snippet.yml`):

```yaml
  demo-owner:
    build: ./demo-owner
    container_name: demo-owner
    restart: unless-stopped
    ports:
      - "127.0.0.1:8084:80"
```

**c. Add the tunnel route** in `/etc/cloudflared/config.yml`, **above** the catch-all
(see `cloudflared.snippet.yml`):

```yaml
  - hostname: demo.cbedge.net
    service: http://127.0.0.1:8084
```

Then:

```bash
cd /opt/dashboard && git pull && docker compose build demo-owner && docker compose up -d demo-owner
sudo systemctl restart cloudflared
```

**d. DNS** — add a CNAME for `demo` pointing at the tunnel (Cloudflare adds it automatically
if you use `cloudflared tunnel route dns <tunnel> demo.cbedge.net`).

---

## 3. The email gate — Cloudflare Access

This is the part that makes it a private link. Access sits **in front of** the container, so the
demo itself needs no login code at all.

Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application**
→ **Self-hosted**:

| Field | Value |
|-------|-------|
| Application name | `CB Edge — owner demo` |
| Session duration | `24 hours` |
| Domain | `demo.cbedge.net` |

Then **Add a policy**:

| Field | Value |
|-------|-------|
| Policy name | `Partner review` |
| Action | `Allow` |
| Include → Emails | the partner's email, plus your own |

Login method: leave **One-time PIN** enabled. He visits the link, types his email, gets a
6-digit code, and he's in. No account for him to create, no password for you to issue.

**Revoking is one click** — delete the policy, or remove his email from it. The link dies
immediately for him and stays alive for you.

Free plan covers up to 50 Access users, so this costs nothing.

---

## 4. Before you send the link

- [ ] Open every group yourself once. Confirm no real names, amounts or tickers slipped in.
- [ ] Decide whether the **Market** group goes out at all — ΔGEX Board, Daily Grades, Results
      and Backtests describe your method at a business level. Deleting four entries from
      `NAV.groups` in `src/shell.js` removes them from the build entirely.
- [ ] NDA first if the Market group is included.
- [ ] Set the Access session to 24h so a forwarded link expires on its own.

---

## 5. Taking it down

```bash
cd /opt/dashboard && docker compose stop demo-owner && docker compose rm -f demo-owner
```

Then delete the Access application and the tunnel ingress rule.
