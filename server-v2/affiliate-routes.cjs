'use strict';
/**
 * server-v2/affiliate-routes.cjs — every /api/aff/* route.
 *
 * Kept OUT of api-router.js on purpose, exactly like household-routes.cjs:
 * that file is already enormous, and the affiliate program is a separate
 * product with a separate identity system. api-router touches this in two
 * places only:
 *   1. an `auth: 'affiliate'` branch in enforceAuth()
 *   2. one require + one call, right before the dispatcher
 *
 * ROUTES
 *   -- public (affiliate.cbedge.net, signed out) ---------------------------
 *   GET  /api/aff/go?code=X&to=/pricing   public     — log the click, set the
 *        attribution cookie, 302 to cbedge.net. This is the ONE route here that
 *        does not answer JSON. nginx maps /r/<CODE> onto it so the shareable
 *        link is affiliate.cbedge.net/r/FLOWDESK.
 *   GET  /api/aff/code-check?code=X       public     — live availability on the
 *        apply form. Deliberately says only taken/available, never who holds it.
 *   POST /api/aff/auth/apply              public     — creates a PENDING row
 *   POST /api/aff/auth/login              public     — sets aff_session
 *   POST /api/aff/auth/logout             public     — clears it
 *   GET  /api/aff/auth/me                 public     — 200 {affiliate} or 401,
 *        never a redirect: the SPA renders its own login screen.
 *
 *   -- affiliate (signed in, any status) -----------------------------------
 *   GET  /api/aff/stats                   affiliate
 *   GET  /api/aff/creatives               affiliate  — post copy + link, stamped
 *   GET  /api/aff/code-requests           affiliate
 *   POST /api/aff/code-request            affiliate  — REQUEST, not an edit
 *   POST /api/aff/payout-method           affiliate  — stripe | paypal | zelle
 *
 *   -- owner (owner.cbedge.net) --------------------------------------------
 *   GET  /api/aff/owner/summary           owner      — the three tab counts
 *   GET  /api/aff/owner/roster            owner      — onboarding + active
 *   POST /api/aff/owner/decide            owner      — approve / decline
 *   POST /api/aff/owner/affiliate         owner      — pause / activate / tier / note
 *   POST /api/aff/owner/code-request      owner      — approve / reject a swap
 *   GET  /api/aff/owner/payouts?period=   owner
 *   POST /api/aff/owner/payout            owner      — approve / paid / hold
 *   POST /api/aff/owner/adjust            owner      — manual refund / clawback
 *
 *   -- internal (Stripe webhook, x-internal-token) -------------------------
 *   POST /api/aff/internal/referral       owner      — enforceAuth lets an
 *        internal-token caller through before any session check, which is how
 *        app/api/stripe/webhook reaches this without a cookie.
 *
 * WHY THE STRIPE SIDE IS A HTTP HOP AND NOT AN IMPORT
 *   The webhook is a Next route (app/api/stripe/webhook/route.ts) and this is a
 *   plain CommonJS module in the server-v2 process. Next cannot require it, and
 *   bundling it would mean an esbuild step nothing else in server-v2 has. Both
 *   run in the SAME container, so the hop is a loopback POST — same cost as a
 *   function call, and the coupling stays one JSON shape wide.
 */

const aff = require('./_lib-affiliate.cjs');

/** Stripe is optional here. Without it, approving an affiliate still issues the
 *  code — it just does not ALSO mint a customer-facing promotion code. */
let Stripe = null;
try { Stripe = require('stripe'); } catch { /* promo codes off */ }

const nostore = { 'Cache-Control': 'no-store' };
const authHeaders = (cookie) =>
  cookie ? { ...nostore, 'Set-Cookie': cookie } : nostore;

/** Where a referral link lands. Overridable so staging doesn't send traffic to prod. */
const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://cbedge.net').replace(/\/+$/, '');
const AFFILIATE_URL = (process.env.AFFILIATE_APP_URL || 'https://affiliate.cbedge.net').replace(/\/+$/, '');

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!Stripe || !key) return null;
  try { return new Stripe(key); } catch { return null; }
}

/**
 * Mint (or reuse) the customer-facing promotion code for an affiliate, so the
 * code they advertise can literally be typed at checkout — Stripe Checkout
 * already runs with allow_promotion_codes:true. Requires
 * STRIPE_AFFILIATE_COUPON_ID (the shared discount every affiliate code grants).
 *
 * BEST EFFORT, ALWAYS. Approval must succeed even when Stripe is unreachable or
 * unconfigured: without a promotion code the link + cookie path still attributes
 * every sale, which is the part that pays people. Returns the id or null.
 */
async function ensurePromotionCode(code) {
  const couponId = (process.env.STRIPE_AFFILIATE_COUPON_ID || '').trim();
  const stripe = stripeClient();
  if (!couponId || !stripe) return null;
  try {
    const existing = await stripe.promotionCodes.list({ code, limit: 1 });
    if (existing.data?.[0]) return existing.data[0].id;
    const promo = await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: couponId },
      code,
      metadata: { source: 'affiliate' },
    });
    return promo.id;
  } catch (err) {
    console.warn('[affiliate] promotion code not minted for', code, '-', err?.message || err);
    return null;
  }
}

/** The post templates the affiliate dashboard renders. Copy lives here (server
 *  side) so it can be edited without a front-end deploy. */
function creativeTemplates(code) {
  const link = `${AFFILIATE_URL}/r/${code}`;
  return [
    {
      id: 'gex-walls',
      label: 'GEX heatmap',
      render: 'heatmap',
      text: `Dealer walls for today are set. Call Wall, Put Wall, Bullseye — all live.\n\nThis is the CB Edge GEX map, updating all session.\n${link}`,
    },
    {
      id: 'es-em',
      label: 'ES candles + EM band',
      render: 'candles',
      text: `ES against the estimated-move band overnight. Full session context on CB Edge.\n\nCode ${code}\n${link}`,
    },
    {
      id: 'phone',
      label: 'Phone build',
      render: 'phone',
      text: `The part nobody else does: a phone build actually built for the phone. Heatmap, chain, EM, econ calendar — all live.\n${link}`,
    },
    {
      id: 'chain',
      label: 'Options chain',
      render: 'chain',
      text: `Full SPX chain with greeks, whale prints and a 0DTE scanner in one place.\n\n${link}`,
    },
  ];
}

function registerAffiliateRoutes({ register, send, readJson }) {
  if (!aff.available) {
    console.warn('[affiliate] no DB bundle — /api/aff/* not registered');
    return 0;
  }
  let n = 0;
  const add = (path, def) => { register(path, def); n++; };

  const fail = (res, code, error) => send(res, code, { error }, nostore);

  // ── Click redirect ────────────────────────────────────────────────────────
  // The only non-JSON route in this file. Order matters: the cookie is set on
  // the SAME response as the 302, so a visitor who never comes back still
  // carries the attribution when they eventually buy.
  // HEAD is listed alongside GET deliberately. X, Discord, Slack and iMessage
  // all send HEAD when they unfurl a pasted link, and the dispatcher 405s any
  // method not named here — which would break the preview on every post an
  // affiliate makes. res.end() with no body is the correct HEAD response, and
  // the click still logs, which is what we want from a real unfurl anyway.
  add('/api/aff/go', {
    auth: 'public', methods: ['GET', 'HEAD'],
    async handler(req, res) {
      let code = '', to = '/pricing';
      try {
        const u = new URL(req.url || '/', 'http://localhost');
        code = String(u.searchParams.get('code') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
        const raw = u.searchParams.get('to') || '/pricing';
        // Relative paths ONLY. An open redirect on a link people are paid to
        // spread is a phishing kit with a marketing budget.
        to = /^\/[A-Za-z0-9/_\-?=&.]*$/.test(raw) ? raw : '/pricing';
      } catch { /* defaults */ }

      const affiliate = code ? await aff.recordClick(code, req, to) : null;
      const days = affiliate?.cookie_days || aff.DEFAULT_COOKIE_DAYS;
      const dest = `${SITE_URL}${to}${to.includes('?') ? '&' : '?'}ref=${encodeURIComponent(code)}`;

      const headers = { Location: dest, 'Cache-Control': 'no-store' };
      // An unknown/paused code still redirects — the visitor is not the one who
      // made the mistake — it just carries no cookie and credits nobody.
      if (affiliate) headers['Set-Cookie'] = aff.refCookie(affiliate.code, days);
      res.writeHead(302, headers);
      res.end();
    },
  });

  // ── Code availability (apply form) ───────────────────────────────────────
  add('/api/aff/code-check', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      try {
        const u = new URL(req.url || '/', 'http://localhost');
        const c = aff.normalizeCode(u.searchParams.get('code'));
        if (c.error) { send(res, 200, { ok: false, reason: c.error }, nostore); return; }
        const free = await aff.codeAvailable(c.code);
        send(res, 200, { ok: free, code: c.code, reason: free ? null : `"${c.code}" is already taken.` }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  // ── Apply / login / logout / me ──────────────────────────────────────────
  add('/api/aff/auth/apply', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 32 * 1024);
        const result = await aff.apply(body, req);
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true, affiliate: aff.publicAffiliate(result.affiliate) }, authHeaders(result.cookie));
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  add('/api/aff/auth/login', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 8192);
        const result = await aff.login({ email: body?.email, password: body?.password, req });
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true, affiliate: aff.publicAffiliate(result.affiliate) }, authHeaders(result.cookie));
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  // Public so a stale cookie can always be cleared — a signed-out state you
  // cannot reach is worse than no logout at all.
  add('/api/aff/auth/logout', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try { await aff.destroySession(req); } catch { /* clear regardless */ }
      send(res, 200, { ok: true }, authHeaders(aff.clearCookie()));
    },
  });

  add('/api/aff/auth/me', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      const row = await aff.affiliateFromRequest(req);
      if (!row) { send(res, 401, { error: 'no-session' }, nostore); return; }
      let cookie = null;
      if (aff.shouldSlide(row)) {
        try {
          const r = await aff.refreshSession(req);
          if (r) cookie = aff.sessionCookie(r.token, aff.SESSION_DAYS * 24 * 60 * 60);
        } catch { /* keep the existing cookie */ }
      }
      send(res, 200, { affiliate: aff.publicAffiliate(row) }, authHeaders(cookie));
    },
  });

  // ── Affiliate dashboard ──────────────────────────────────────────────────
  add('/api/aff/stats', {
    auth: 'affiliate', methods: ['GET'],
    async handler(req, res, _ctx, verdict) {
      try {
        // A pending applicant has no ledger yet. Return the empty shape rather
        // than a 403: the waiting-room view renders the same tiles at zero.
        if (verdict.affiliate.status !== 'active') {
          send(res, 200, { pending: true, stats: null, affiliate: aff.publicAffiliate(verdict.affiliate) }, nostore);
          return;
        }
        const stats = await aff.affiliateStats(verdict.affiliate.id);
        send(res, 200, {
          pending: false,
          affiliate: aff.publicAffiliate(verdict.affiliate),
          link: `${AFFILIATE_URL}/r/${verdict.affiliate.code}`,
          stats,
        }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  add('/api/aff/creatives', {
    auth: 'affiliate', methods: ['GET'],
    async handler(req, res, _ctx, verdict) {
      const a = verdict.affiliate;
      if (a.status !== 'active' || !a.code) { send(res, 200, { creatives: [] }, nostore); return; }
      send(res, 200, {
        code: a.code,
        link: `${AFFILIATE_URL}/r/${a.code}`,
        creatives: creativeTemplates(a.code),
      }, nostore);
    },
  });

  add('/api/aff/code-requests', {
    auth: 'affiliate', methods: ['GET'],
    async handler(req, res, _ctx, verdict) {
      const { rows } = await aff.pool.query(
        `SELECT id, from_code, to_code, reason, status, created_at, decided_at, decided_note
           FROM aff_code_requests WHERE affiliate_id = $1 ORDER BY created_at DESC LIMIT 25`,
        [verdict.affiliate.id]);
      send(res, 200, { requests: rows }, nostore);
    },
  });

  // A code EDIT is a request. This never touches aff_affiliates.code — see the
  // approval rule in _lib-affiliate.cjs.
  add('/api/aff/code-request', {
    auth: 'affiliate', methods: ['POST'],
    async handler(req, res, _ctx, verdict) {
      try {
        const a = verdict.affiliate;
        if (a.status !== 'active') { fail(res, 403, 'Your application is still under review.'); return; }
        const body = await readJson(req, 8192);
        const c = aff.normalizeCode(body?.code);
        if (c.error) { fail(res, 400, c.error); return; }
        if (c.code === a.code) { fail(res, 400, 'That is already your code.'); return; }
        if (!(await aff.codeAvailable(c.code, a.id))) { fail(res, 409, `"${c.code}" is already taken.`); return; }

        const open = await aff.pool.query(
          `SELECT 1 FROM aff_code_requests WHERE affiliate_id=$1 AND status='pending' LIMIT 1`, [a.id]);
        if (open.rows.length) { fail(res, 409, 'You already have a code change waiting for approval.'); return; }

        const { rows } = await aff.pool.query(
          `INSERT INTO aff_code_requests (affiliate_id, from_code, to_code, reason)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [a.id, a.code, c.code, String(body?.reason || '').slice(0, 1000) || null]);
        send(res, 200, { ok: true, request: rows[0] }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  add('/api/aff/payout-method', {
    auth: 'affiliate', methods: ['POST'],
    async handler(req, res, _ctx, verdict) {
      try {
        const body = await readJson(req, 8192);
        const method = String(body?.method || '');
        if (!aff.PAYOUT_METHODS.includes(method)) { fail(res, 400, 'Pick Stripe, PayPal or Zelle.'); return; }
        const detail = String(body?.detail || '').trim().slice(0, 200);
        // Zelle and PayPal are an email or a phone number — worthless without
        // one, so the detail is required for those two. Stripe Connect onboards
        // separately, so a blank detail there is normal.
        if (method !== 'stripe' && !detail) { fail(res, 400, 'Add the email or phone number to pay.'); return; }
        await aff.pool.query(
          `UPDATE aff_affiliates SET payout_method=$2, payout_detail=$3 WHERE id=$1`,
          [verdict.affiliate.id, method, detail || null]);
        send(res, 200, { ok: true }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  // ── Owner ────────────────────────────────────────────────────────────────
  add('/api/aff/owner/summary', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try {
        await aff.ensureSchema();
        const { rows } = await aff.pool.query(`
          SELECT
            (SELECT COUNT(*) FROM aff_affiliates WHERE status='pending')::int      AS pending,
            (SELECT COUNT(*) FROM aff_affiliates WHERE status='active')::int       AS active,
            (SELECT COUNT(*) FROM aff_code_requests WHERE status='pending')::int   AS code_requests,
            (SELECT COUNT(*) FROM aff_payouts WHERE status IN ('pending','approved'))::int AS open_payouts,
            (SELECT COALESCE(SUM(commission_cents),0) FROM aff_referrals
              WHERE status IN ('holding','cleared'))::int                          AS owed_cents,
            (SELECT COALESCE(SUM(commission_cents),0) FROM aff_referrals
              WHERE status='paid')::int                                            AS paid_cents,
            (SELECT COALESCE(SUM(gross_cents),0) FROM aff_referrals
              WHERE period = to_char(now() AT TIME ZONE 'America/New_York','YYYY-MM'))::int AS mtd_gross_cents,
            (SELECT COUNT(*) FROM aff_referrals WHERE kind='link')::int            AS referred_members`);
        send(res, 200, { summary: rows[0], period: aff.currentPeriod(), tiers: aff.TIERS }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  add('/api/aff/owner/roster', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try {
        const rows = await aff.ownerRoster();
        send(res, 200, {
          affiliates: rows,
          tiers: aff.TIERS,
          reserved: Array.from(aff.RESERVED_CODES),
        }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  add('/api/aff/owner/decide', {
    auth: 'owner', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 16 * 1024);
        const id = Number(body?.id);
        if (!id) { fail(res, 400, 'id is required'); return; }
        const cur = await aff.pool.query(`SELECT * FROM aff_affiliates WHERE id=$1`, [id]);
        const row = cur.rows[0];
        if (!row) { fail(res, 404, 'No such applicant.'); return; }

        if (body?.action === 'decline') {
          await aff.pool.query(
            `UPDATE aff_affiliates
                SET status='declined', decided_at=now(),
                    decline_reason=$2, internal_note=COALESCE($3, internal_note)
              WHERE id=$1`,
            [id, String(body?.reason || '').slice(0, 1000) || null,
             String(body?.note || '').slice(0, 2000) || null]);
          send(res, 200, { ok: true, status: 'declined' }, nostore);
          return;
        }

        // Approve. The owner can override the code they asked for — which is the
        // whole reason RESERVED_CODES is re-checked here and not only on apply.
        const c = aff.normalizeCode(body?.code || row.requested_code);
        if (c.error) { fail(res, 400, c.error); return; }
        if (!(await aff.codeAvailable(c.code, id))) { fail(res, 409, `"${c.code}" is already taken.`); return; }

        const tier = Math.min(aff.MAX_TIER_PCT, Math.max(0, Number(body?.tier_pct) || row.tier_pct || 10));
        const cookieDays = Math.min(365, Math.max(1, Number(body?.cookie_days) || row.cookie_days || aff.DEFAULT_COOKIE_DAYS));
        const promoId = await ensurePromotionCode(c.code);

        await aff.pool.query(
          `UPDATE aff_affiliates
              SET status='active', code=$2, tier_pct=$3, cookie_days=$4,
                  promotion_code_id=COALESCE($5, promotion_code_id),
                  internal_note=COALESCE($6, internal_note),
                  approved_at=COALESCE(approved_at, now()), decided_at=now(),
                  decline_reason=NULL
            WHERE id=$1`,
          [id, c.code, tier, cookieDays, promoId,
           String(body?.note || '').slice(0, 2000) || null]);
        send(res, 200, { ok: true, status: 'active', code: c.code, promotion_code_id: promoId }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  add('/api/aff/owner/affiliate', {
    auth: 'owner', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 16 * 1024);
        const id = Number(body?.id);
        const action = String(body?.action || '');
        if (!id) { fail(res, 400, 'id is required'); return; }

        if (action === 'pause') {
          await aff.pool.query(`UPDATE aff_affiliates SET status='paused' WHERE id=$1`, [id]);
        } else if (action === 'activate') {
          await aff.pool.query(`UPDATE aff_affiliates SET status='active' WHERE id=$1 AND code IS NOT NULL`, [id]);
        } else if (action === 'tier') {
          const tier = Math.min(aff.MAX_TIER_PCT, Math.max(0, Number(body?.tier_pct) || 0));
          // NOTE this changes the rate for FUTURE invoices only. Existing
          // subscriptions keep the rate frozen on their link row — see
          // recordReferral(). That is deliberate: a tier bump is a raise, not a
          // retroactive re-price of money already accrued.
          await aff.pool.query(`UPDATE aff_affiliates SET tier_pct=$2 WHERE id=$1`, [id, tier]);
        } else if (action === 'note') {
          await aff.pool.query(`UPDATE aff_affiliates SET internal_note=$2 WHERE id=$1`,
            [id, String(body?.note || '').slice(0, 4000) || null]);
        } else {
          fail(res, 400, 'Unknown action.');
          return;
        }
        send(res, 200, { ok: true }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  add('/api/aff/owner/code-request', {
    auth: 'owner', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 8192);
        const id = Number(body?.id);
        if (!id) { fail(res, 400, 'id is required'); return; }
        const cur = await aff.pool.query(`SELECT * FROM aff_code_requests WHERE id=$1`, [id]);
        const rq = cur.rows[0];
        if (!rq || rq.status !== 'pending') { fail(res, 404, 'No pending request.'); return; }

        if (body?.action === 'reject') {
          await aff.pool.query(
            `UPDATE aff_code_requests SET status='rejected', decided_at=now(), decided_note=$2 WHERE id=$1`,
            [id, String(body?.note || '').slice(0, 1000) || null]);
          send(res, 200, { ok: true, status: 'rejected' }, nostore);
          return;
        }

        if (!(await aff.codeAvailable(rq.to_code, rq.affiliate_id))) {
          fail(res, 409, `"${rq.to_code}" was taken while this sat in the queue.`);
          return;
        }
        // Keep the old code alive for a grace window by default. Every link and
        // screenshot already posted still attributes; without this a rename is
        // a silent revenue cut for whoever accepted it.
        const keepDays = Math.max(0, Math.min(180, Number(body?.keep_old_days ?? 30)));
        const promoId = await ensurePromotionCode(rq.to_code);

        await aff.pool.query(
          `UPDATE aff_affiliates
              SET prev_code = code,
                  prev_code_until = CASE WHEN $3 > 0 THEN now() + ($3::int * INTERVAL '1 day') ELSE NULL END,
                  code = $2,
                  promotion_code_id = COALESCE($4, promotion_code_id)
            WHERE id = $1`,
          [rq.affiliate_id, rq.to_code, keepDays, promoId]);
        await aff.pool.query(
          `UPDATE aff_code_requests SET status='approved', decided_at=now(), decided_note=$2 WHERE id=$1`,
          [id, String(body?.note || '').slice(0, 1000) || null]);
        send(res, 200, { ok: true, status: 'approved', code: rq.to_code, keep_old_days: keepDays }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  add('/api/aff/owner/payouts', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try {
        const u = new URL(req.url || '/', 'http://localhost');
        const period = String(u.searchParams.get('period') || aff.currentPeriod()).slice(0, 7);
        const rows = await aff.buildPayouts(period);
        const periods = await aff.pool.query(
          `SELECT DISTINCT period FROM aff_referrals ORDER BY period DESC LIMIT 24`);
        const history = await aff.pool.query(`
          SELECT p.period, p.commission_cents, p.method, p.reference, p.paid_at,
                 a.name, a.code
            FROM aff_payouts p JOIN aff_affiliates a ON a.id = p.affiliate_id
           WHERE p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 40`);
        send(res, 200, {
          period,
          periods: periods.rows.map((r) => r.period),
          payouts: rows,
          history: history.rows,
          hold_days: aff.HOLD_DAYS,
        }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  add('/api/aff/owner/payout', {
    auth: 'owner', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 16 * 1024);
        const id = Number(body?.id);
        const action = String(body?.action || '');
        if (!id) { fail(res, 400, 'id is required'); return; }

        if (action === 'approve') {
          await aff.pool.query(
            `UPDATE aff_payouts SET status='approved', approved_at=now() WHERE id=$1 AND status='pending'`, [id]);
        } else if (action === 'hold') {
          await aff.pool.query(
            `UPDATE aff_payouts SET status='held', note=$2 WHERE id=$1 AND status <> 'paid'`,
            [id, String(body?.note || '').slice(0, 1000) || null]);
        } else if (action === 'paid') {
          const method = aff.PAYOUT_METHODS.includes(String(body?.method)) ? String(body.method) : null;
          const ref = String(body?.reference || '').trim().slice(0, 120);
          if (!ref) { fail(res, 400, 'A payment reference is required.'); return; }
          const cur = await aff.pool.query(`SELECT * FROM aff_payouts WHERE id=$1`, [id]);
          const p = cur.rows[0];
          if (!p) { fail(res, 404, 'No such payout.'); return; }
          if (p.status === 'paid') { fail(res, 409, 'That payout is already marked paid.'); return; }
          await aff.pool.query(
            `UPDATE aff_payouts
                SET status='paid', paid_at=now(),
                    method=COALESCE($2, method), reference=$3,
                    note=COALESCE($4, note)
              WHERE id=$1`,
            [id, method, ref, String(body?.note || '').slice(0, 1000) || null]);
          // Flip the ledger rows this payout covers, so they stop counting as
          // owed. Scoped by (affiliate, period) — the same key the payout row is
          // unique on — and only rows that actually cleared the refund window.
          await aff.pool.query(
            `UPDATE aff_referrals SET status='paid'
              WHERE affiliate_id=$1 AND period=$2 AND status IN ('holding','cleared')`,
            [p.affiliate_id, p.period]);
        } else {
          fail(res, 400, 'Unknown action.');
          return;
        }
        send(res, 200, { ok: true }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  // Manual refund / clawback. Stripe refunds do not arrive here automatically —
  // wiring every refund event is a bigger surface than it is worth for a
  // handful a month, and getting it half-right silently mis-pays people. This
  // writes an explicit negative row instead, which is auditable.
  add('/api/aff/owner/adjust', {
    auth: 'owner', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 8192);
        const affiliateId = Number(body?.affiliate_id);
        const cents = Math.round(Number(body?.commission_cents) || 0);
        if (!affiliateId || !cents) { fail(res, 400, 'affiliate_id and a non-zero amount are required.'); return; }
        const period = String(body?.period || aff.currentPeriod()).slice(0, 7);
        const { rows } = await aff.pool.query(
          `INSERT INTO aff_referrals
             (affiliate_id, kind, gross_cents, rate_pct, commission_cents, period, status, note)
           VALUES ($1,'refund',0,0,$2,$3,'cleared',$4) RETURNING *`,
          [affiliateId, -Math.abs(cents), period, String(body?.note || '').slice(0, 500) || 'manual adjustment']);
        send(res, 200, { ok: true, row: rows[0] }, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  // ── Internal (Stripe webhook) ────────────────────────────────────────────
  add('/api/aff/internal/referral', {
    auth: 'owner', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 32 * 1024);
        const result = await aff.recordReferral(body);
        send(res, 200, result, nostore);
      } catch (err) { fail(res, 500, String(err?.message || err)); }
    },
  });

  return n;
}

module.exports = { registerAffiliateRoutes };
