# daily.cbedge.net — what has to exist before it can take money

The code is written and it deploys. It will start, register its routes and serve
the landing page with none of the below in place — every integration reports
itself as "not set up" instead of crashing, which is deliberate so you can put
these in one at a time and watch each one go green in the container log.

Nothing here touches budget.cbedge.net.

---

## 1. Environment (`.env.local` on the VPS)

Add these. `STRIPE_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`RESEND_API_KEY` and `EMAIL_FROM` are already there and are shared — the daily
container reads the same file.

```
# daily.cbedge.net
DAILY_PORT=3011
DAILY_BASE_URL=https://daily.cbedge.net

# Encrypts stored Google refresh tokens at rest. Its own key, NOT HH_TOKEN_KEY:
# the two apps must not be able to read each other's tokens, and rotating one
# must not sign the other's users out of Google.
#   openssl rand -hex 32
DAILY_TOKEN_KEY=

# Stripe. Same account as CB Edge, its own products and its own webhook secret.
DAILY_STRIPE_PRICE_MONTHLY=price_...
DAILY_STRIPE_PRICE_ANNUAL=price_...
DAILY_STRIPE_WEBHOOK_SECRET=whsec_...
```

The container logs exactly what is missing at boot:

```
[daily] stripe: NOT configured — missing DAILY_STRIPE_PRICE_MONTHLY, ...
[daily] google: configured
[daily] mail: configured
```

## 2. Stripe

1. Create a **product** ("Daily") with two recurring prices — monthly and
   annual. The displayed prices are `$8/month` and `$80/year`; they live in
   `PLAN_DEFS` at the top of `server-v2/_lib-daily-billing.cjs`. **Change a price
   in Stripe and change it there in the same commit** — the landing page reads
   that array, Stripe charges its own number, and the two silently drifting is a
   marketing line that contradicts the receipt.
2. Add a **new webhook endpoint** at
   `https://daily.cbedge.net/api/daily/stripe/webhook`, subscribed to:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`.
   Its signing secret goes in `DAILY_STRIPE_WEBHOOK_SECRET`.

   **Do not reuse the CB Edge trading webhook or its secret.** One endpoint per
   app is what lets either be rotated, replayed or disabled without taking the
   other's billing down with it.
3. Turn on the **Customer portal** in Stripe's billing settings — Settings sends
   customers there to update a card or cancel, and it 400s if the portal has
   never been configured.

## 3. Google

In the existing OAuth client (the one budget.cbedge.net uses), add the
**authorised redirect URI**:

```
https://daily.cbedge.net/api/daily/google/callback
```

The scopes this app requests are wider than budget's, because it can create
events as well as read them:

```
openid email profile
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events
```

If the OAuth consent screen is still in testing mode, every customer has to be
on the test-users list — publish it before launch or Google will refuse them.

## 4. Cloudflare tunnel + DNS

In `/etc/cloudflared/config.yml`, **above** the catch-all 404 rule:

```yaml
  - hostname: daily.cbedge.net
    service: http://127.0.0.1:8086
```

Then:

```bash
cloudflared tunnel route dns <tunnel> daily.cbedge.net
systemctl restart cloudflared
```

## 5. Deploy

Same as everything else — code reaches the VPS only through GitHub:

```bash
# laptop
./push.ps1

# VPS
cd /opt/dashboard && git pull
docker compose build daily daily-web
docker compose up -d daily daily-web
docker compose logs -f daily
```

The schema builds itself on first boot (`CREATE TABLE IF NOT EXISTS`, same
pattern as `_lib-household.cjs`). There is no migration to run.

Check it came up:

```bash
curl -s localhost:3011/health
curl -s localhost:3011/api/daily/health   # says which integrations are configured
```

## 6. Smoke test, in this order

1. `https://daily.cbedge.net/` — the landing page renders and the plans block
   shows two prices. If it says billing isn't set up, Stripe env is missing.
2. Sign up. You should get a verification email and land on plan selection.
3. Pay with a Stripe test card. You should come back to `/welcome`, not a
   paywall. If you see a paywall for a second and then the app, the webhook was
   slow and `billing.sync()` repaired it — that is working as designed. If it
   stays, the webhook endpoint or its secret is wrong.
4. Connect Google Calendar from onboarding, then add an event from Today.
5. Open **Markets**. If the econ list is empty but the earnings list is not, the
   `./state` mount is wrong; if both are empty, check the note and warning lines
   the page renders — they say which feed failed and why.
6. Create a money account, add a bill, mark it paid.
7. Invite the second seat and accept the invite in a private window.

---

## Things worth knowing before you sell it

- **Two seats per household, hard-capped** (`HOUSEHOLD_SEATS` in
  `_lib-daily.cjs`). An invite link that could be pasted into a group chat would
  turn one subscription into a company account.
- **`past_due` still grants access.** Stripe retries a declined card for days and
  the app shows a banner throughout. Locking someone out of their shopping list
  the morning their card expires is the worse failure. `unpaid` and `canceled`
  are locked out.
- **Deleting a customer's data** is not wired to a button. It is a
  `DELETE FROM daily_households WHERE id = ...` — everything cascades from there.
  Worth a real endpoint before you have enough customers to get asked twice.
- **The terms and privacy pages** (`daily-vite/src/pages/Legal.tsx`) describe
  accurately what the software does. They are a starting draft, not reviewed
  advice. Have someone qualified read them before you take money.
- **`budget.cbedge.net` shares nothing with this** except a Postgres server and
  the `earnings_calendar` table it reads. No shared tables, no shared login, no
  shared cookie, no shared container.
