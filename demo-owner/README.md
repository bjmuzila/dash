# demo-owner — email-gated owner console demo

A standalone, **read-only, data-free** replica of `owner.cbedge.net` for showing a
prospective partner how the console is laid out and what lives on each screen.

**Served at two URLs, one build.** `demo.cbedge.net` is this container directly.
`voltick.cbedge.net/demo/` is the same container, proxied by `voltick-vite`'s
nginx, where it is the first entry on the merger sandbox's contents board. There
is no second copy: `node build.mjs` plus a `demo-web` rebuild updates both.

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
  demo-web:
    build: ./demo-owner
    container_name: demo-web
    restart: unless-stopped
    ports:
      - "127.0.0.1:8087:8087"
```

**c. Add the tunnel route** in `/etc/cloudflared/config.yml`, **above** the catch-all
(see `cloudflared.snippet.yml`):

```yaml
  - hostname: demo.cbedge.net
    service: http://127.0.0.1:8087
```

Then:

```bash
cd /opt/dashboard && git pull && docker compose build demo-web && docker compose up -d demo-web
sudo systemctl restart cloudflared
```

**d. DNS** — add a CNAME for `demo` pointing at the tunnel (Cloudflare adds it automatically
if you use `cloudflared tunnel route dns <tunnel> demo.cbedge.net`).

---

## 3. The email gate — Cloudflare Access

This is the part that makes it a private link. Access sits **in front of** the container, so the
demo itself needs no login code at all.

**One allowlist, two hostnames.** `demo.cbedge.net` and `voltick.cbedge.net` admit the same
people: Brandon, plus whoever he adds. So the emails live in a reusable **Access Group** rather
than being typed into each application, or the two drift and someone revoked from one keeps the
other.

Cloudflare dashboard → **Zero Trust** → **Access** → **Groups** → **Add a group**:

| Field | Value |
|-------|-------|
| Group name | `CB Edge insiders` |
| Include → Emails | your own, plus each email you hand out |

Then → **Applications** → **Add an application** → **Self-hosted**, once per hostname:

| Field | Value |
|-------|-------|
| Application name | `CB Edge — owner demo` / `CB Edge — Voltick sandbox` |
| Session duration | `24 hours` |
| Domain | `demo.cbedge.net` / `voltick.cbedge.net` |

Each gets one policy: Action `Allow`, and the **only** Include is the `CB Edge insiders` group.

Login method: leave **One-time PIN** enabled. A guest visits the link, types their email, gets a
6-digit code, and they are in. No account for them to create, no password for you to issue.

**Revoking is one click** — remove the email from the group. Both links die for that person at
once, and stay alive for everyone else.

If someone should see the demo but NOT the sandbox, give the demo application its own policy with
that email instead of the group. Keep the group as the default; a per-application email list is
the exception, not the pattern.

Free plan covers up to 50 Access users, so this costs nothing.

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
cd /opt/dashboard && docker compose stop demo-web && docker compose rm -f demo-web
```

Then delete the Access application and the tunnel ingress rule.

**Note:** `voltick.cbedge.net/demo/` proxies to this container, so stopping `demo-web` also puts
a 502 on that route. Remove the `/demo` entry from `voltick-vite/src/lib/nav.ts` and the
`location /demo/` block from `voltick-vite/nginx.conf` in the same change.
