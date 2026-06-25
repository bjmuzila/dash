# Stripe Go-Live Checklist — cbedge.net

Switch from sandbox/test to live payments. The #1 rule learned the hard way:
**the secret key, the price, and the webhook must all be from the SAME live
account.** Mixing accounts/modes = "No such price" / silent checkout failures.

Canonical host is `https://www.cbedge.net` (non-www 301-redirects and breaks
Stripe webhooks + redirects). Keep everything on `www`.

---

## 1. Live business name (required — checkout won't complete without it)
Stripe Dashboard → **turn Test mode OFF** (top-right) → you're now in LIVE.
- Settings → Business → set the public **business/account name**.
  (You only set this in the sandbox; live needs its own.)

## 2. Live product + price
Live mode → **Product catalog → Add product**
- Recurring price. Decide monthly vs yearly and NAME IT CONSISTENTLY
  (the sandbox said "yearly membership / $120 per month / billed monthly" —
  fix that wording so customers aren't confused).
- Open the price → copy its **API ID** → `price_...` (LIVE)

## 3. Live webhook endpoint
Live mode → **Developers → Webhooks → Add endpoint**
- URL: `https://www.cbedge.net/api/stripe/webhook`  (www!)
- Events:
  - checkout.session.completed
  - customer.subscription.created
  - customer.subscription.updated
  - customer.subscription.deleted
- Create → reveal **Signing secret** → `whsec_...` (LIVE)

## 4. Live secret key
Live mode → **Developers → API keys** → reveal **Secret key** → `sk_live_...`

## 5. Put all three LIVE values on the VPS
`nano /opt/dashboard/.env.local` — set (all from the live account):
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID=price_...        # live price from step 2
STRIPE_WEBHOOK_SECRET=whsec_...  # live endpoint from step 3
NEXT_PUBLIC_APP_URL=https://www.cbedge.net
```
Then:
```
cd /opt/dashboard && docker compose up -d --force-recreate
```

## 6. Verify key + price are the SAME live account (the critical check)
```
docker cp /tmp/check.js dashboard-dashboard-1:/app/check.js 2>/dev/null
docker exec -w /app dashboard-dashboard-1 node -e "const Stripe=require('stripe');const s=new Stripe(process.env.STRIPE_SECRET_KEY);Promise.all([s.accounts.retrieve(),s.prices.retrieve(process.env.STRIPE_PRICE_ID)]).then(([a,p])=>{console.log('account',a.id,'livemode? check dashboard');console.log('price FOUND',p.id,'recurring:',!!p.recurring);process.exit(0)}).catch(e=>{console.log('ERR:',e.message);process.exit(0)})"
```
Must print `price FOUND ... recurring: true` and an account id. If "No such
price" → key and price are different accounts. Fix before launch.

Also (owner, in browser): `https://www.cbedge.net/api/stripe/status`
→ all three present, `mode: live`.

## 7. Wipe test subscription rows before real customers
Test checkouts wrote rows. Clear them so live starts clean:
```
docker exec -w /app dashboard-dashboard-1 node -e "const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});p.query('DELETE FROM subscriptions').then(r=>{console.log('deleted',r.rowCount);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"
```

## 8. Clerk sign-ups
- Clerk dashboard → **Production instance** (match `pk_live_`) → Restrictions
  → "Enable restricted mode" must be **OFF** so real customers can register.
- Confirm `/sign-up` shows the form on www.cbedge.net.

## 9. Real end-to-end test (uses a REAL card now — live mode)
1. Incognito → www.cbedge.net → sign up as a NON-owner account
2. /home → redirects to /pricing → Subscribe
3. Pay with a REAL card (small first sub, you can refund/cancel after)
4. Lands on success → /home opens
5. Live webhook endpoint shows `200` on checkout.session.completed +
   customer.subscription.created
6. Cancel/refund that test sub via Manage billing if it was just a check

## 10. Commit the code so it survives deploys
On Windows: `/push` (uses `git add -A`). New files get wiped by deploys if
uncommitted — this bit you before.

---

### Gotchas that cost time during setup (don't repeat)
- Business name MUST be set or checkout silently fails.
- Webhook URL must be `www` (non-www 301s → Stripe marks delivery failed).
- Key + price + webhook all from the SAME account/mode.
- After ANY .env.local change: `docker compose up -d --force-recreate`
  (server-side vars only need recreate, not rebuild).
- NEXT_PUBLIC_* changes need a full `--build` (baked at build time).
- Stale `subscriptions` rows with old customer ids cause "No such customer" —
  wipe the table when switching accounts.
- Roll the sandbox secret key that got pasted in chat during testing.
