# voltick-vite · voltick.cbedge.net

The sandbox for the Voltick and CB Edge merger. Its own Vite SPA, its own nginx,
its own subdomain, on the same box as everything else. Nothing here is customer
facing and nothing here is load bearing.

## Access

**Email and password, on the CB Edge account you already have.** No second
password system, and no Cloudflare Access.

The session cookie is domain-wide, which is the whole trick: it is how
`owner.cbedge.net` reads `/api/auth/me` today, so a session created by signing
in at cbedge.net is readable here.

**The gate is nginx, not React.** `auth_request /_vkauth` calls
`/api/voltick/verify` (`server-v2/api-router.js`) BEFORE serving `index.html`,
`/assets/*` or `/demo/`. A React gate would have already shipped the whole
bundle, and the owner console behind `/demo/`, to the browser before deciding to
hide it. Hidden is not "not sent".

| Answer | Meaning | What nginx does |
|---|---|---|
| 200 | owner, or a live `voltick_access` row | serves the file |
| 401 | no session | `denied.html` |
| 403 | signed in, no grant | `denied.html` |
| 503 | the backend could not tell | `denied.html` |

`public/denied.html` is the only unauthenticated page, and it is a standalone
file rather than a route in the SPA for exactly that reason. Gating fails
CLOSED: a database hiccup denies rather than admits.

### Who gets in

`voltick_access` — a table built as a deliberate twin of `comp_access`. A grant
buys **voltick.cbedge.net and nothing else**: not paid access on cbedge.net
(that is still a comp) and not owner access.

Managed from the owner console, two surfaces onto one endpoint
(`/api/admin/voltick-access`):

- **`/owner/admin` → Voltick Access** — the full panel, beside Comped Access:
  grant with a note and an expiry, resend an invite, revoke.
- **`/owner` → the Voltick card** — one field and a Grant button, for when you
  just want someone in.

Granting provisions the CB Edge account with no password and mails a 7-day
set-password link, the same one-shot token machinery forgot-password uses. The
recipient never signs up: they click, pick a password, and they are in. An
account that already has a password gets a plain "the sandbox is open to you"
note with **no** token in it.

Revoking stamps `revoked_at` and never deletes the account. Access is gone on
that session's next cache miss, about 8 seconds.

## /demo · the owner console

The first entry on the contents board is the owner console demo, at
**`voltick.cbedge.net/demo/`**. It is the same build that answers
`demo.cbedge.net`: `nginx.conf` proxies `/demo/` to the `demo-web` container over
the compose network rather than copying the HTML into this image, so
`node demo-owner/build.mjs` plus a `demo-web` rebuild updates both hostnames and
this image never holds a second, staler copy of a 290KB page.

It is listed in `nav.ts` with `external: true`, which keeps it out of the React
router and renders it as a real anchor. A client-side `Link` to a path nginx owns
would route internally and land on `NotFound`.

## Shape

```
voltick-vite/
  Dockerfile        node build stage → nginx
  nginx.conf        listen 8088; /api /proxy /ws → dashboard:3002; /demo/ → demo-web:8087
  src/
    theme.ts        the Voltick tokens. Import them, never hand-mint a hex.
    index.css       the aurora, hover, focus, selection
    lib/nav.ts      THE CONTENTS LIST. Home renders it, App routes from it.
    pages/registry.ts   key → lazy() import
    pages/          one file per page
    components/     Shell (the bar), PageCard (PageShell, Card, Chip)
```

## Adding a page · two edits

1. An item in `src/lib/nav.ts` with a `key`, a `path`, a `label` and a one line
   `note`.
2. That same `key` in `src/pages/registry.ts`, pointing at a `lazy()` import.

Miss the second and the route renders `Placeholder`, which is the intended state
for something listed but not yet written. There is no third edit: the route is
generated from the same array the contents board renders, so a link and the route
that answers it cannot drift apart.

For something nginx serves rather than the SPA (another container, a static file,
a Next route), mark the item `external: true` and skip step 2. It then gets no
router entry and renders as a plain anchor, so the click is a real navigation.

## Design rules that are defects when broken

They are restated at the top of `src/theme.ts` and rendered live at
`/design-system` and `/colours`. In short:

1. A reserved colour means exactly one thing. Import the token. A near-miss hex
   is worse than a reuse.
2. No grey text. Secondary information is size, weight, spacing, position.
3. No em-dashes in anything a user reads. Middle dot, comma, colon, parentheses.
   Code comments are exempt.
4. Never buy, sell, signal, entry, target, stop or prediction. Mechanics and
   locations only.
5. Dark only.

The full reference is `md files/VOLTICK-DESIGN-SYSTEM.md`. Voltick's own
`web/src/theme.jsx` is the upstream source of truth; when the two disagree, that
file wins and `src/theme.ts` gets updated.

## Local dev

```bash
cd voltick-vite
npm install
npm run dev            # http://localhost:5175
```

`/api`, `/proxy` and `/ws` are proxied to `VITE_BACKEND` (default
`http://localhost:3001`, the repo-root `npm run dev`). To point dev at prod,
set `VITE_BACKEND=https://cbedge.net` and paste an authenticated `document.cookie`
into `BACKEND_COOKIE` in `voltick-vite/.env` (not `VITE_` prefixed, so it stays
server side and never ships to the bundle).

`/feed-check` exists to prove the reverse proxy is wired: a path that answers
with `text/html` is not proxied, it fell through to nginx's SPA fallback.

## Deploy

Part of the root `docker-compose.yml` as the `voltick` service on
`127.0.0.1:8088`. Reached only through the Cloudflare Tunnel. On the VPS, add to
`/etc/cloudflared/config.yml` **above** the catch-all 404 rule:

```yaml
- hostname: voltick.cbedge.net
  service: http://127.0.0.1:8088
```

then:

```bash
cloudflared tunnel route dns <tunnel> voltick.cbedge.net
systemctl restart cloudflared
docker compose build voltick && docker compose up -d voltick
```

`/demo/` needs `demo-web` running, which it already is for `demo.cbedge.net`.
Compose declares `depends_on: demo-web`, so `up -d voltick` starts it if it is
not.

The gate needs `dashboard` running (that is where `/api/voltick/verify` lives),
which `depends_on` already guarantees. Deploy the dashboard before, or with,
this container: a voltick image whose backend has no `/api/voltick/verify` route
answers 404 to every `auth_request`, and nginx denies everything, including you.

**Cloudflare Access is no longer used here.** It gated this subdomain until the
login shipped; delete that application once you have signed in through the new
gate. Leaving both on means two prompts to get to one page.

### Verifying the gate

```bash
curl -sI https://voltick.cbedge.net | head -1        # no cookie  -> 200 denied.html
curl -sI https://voltick.cbedge.net/demo/ | head -1  # no cookie  -> 200 denied.html
```

nginx serves `denied.html` with a 200, not a 401, because it is a page a person
reads rather than an error a client handles. To see the gate's own answer:

```bash
docker exec voltick-web wget -qS -O /dev/null http://dashboard:3002/api/voltick/verify 2>&1 | head -3
```

That should be `401` from inside the container with no cookie attached. A `404`
there means the dashboard image predates `/api/voltick/verify`.
