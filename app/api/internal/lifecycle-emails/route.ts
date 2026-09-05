import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { ownerOrInternal, gateDenied } from "@/lib/auth/ownerApiGate";
import {
  getLapsedTrialCandidates,
  getSignupNoPurchaseCandidates,
  getTrialWinback,
  listTrialWinbacks,
  type LifecycleCandidate,
} from "@/lib/db";
import { shouldOfferWinback, winbackEnabled, winbackFirstMonthCents, winbackOfferDays } from "@/lib/winback";
import { sendLifecycleOffer } from "@/lib/lifecycleOffers";

/**
 * The nightly lifecycle-email sweep. Two campaigns, one pass.
 *
 *   trial-lapsed        Took the free trial, never became a customer.
 *                       The Stripe webhook already fires this in real time; the
 *                       sweep is the CATCH-UP for everyone it never saw — a
 *                       lapse from before the feature shipped, a webhook Stripe
 *                       gave up retrying, an hour the container was down.
 *   signup-no-purchase  Made an account, never bought, never even trialed.
 *                       Sweep only: "never came back" is the absence of an
 *                       event, so there is nothing for a webhook to fire on.
 *
 * Both offer the same thing — one month at $30, then the normal monthly price —
 * and lib/lifecycleOffers.ts is the single path that claims, mints and sends it.
 * One offer per person across BOTH campaigns; the claim is a conditional insert,
 * so this overlapping the webhook is harmless by construction.
 *
 * WHO CALLS IT: server-v2/lifecycle-email-scheduler.js, daily at ~10:00 ET over
 * loopback with INTERNAL_API_TOKEN — the same shape every other in-process
 * scheduler in server-v2 uses. The owner can also POST it by hand.
 *
 *   GET  ?days=…            DRY RUN. Who WOULD be mailed, plus the current
 *                           settings and the recent offer log. Sends nothing.
 *   POST { dryRun?, limit? } Runs the sweep.
 *
 * SAFETY RAILS, because this is the one endpoint that can mail a lot of people:
 *   · The candidate SQL already excludes owners, comped accounts, the global
 *     unsubscribe list, banned addresses, and anyone who has an offer.
 *   · Every trial-lapsed candidate is re-checked against Stripe by
 *     shouldOfferWinback() — our status column can lag, and a discount mailed to
 *     a paying customer is the expensive mistake.
 *   · A hard per-run cap (LIFECYCLE_MAX_PER_RUN, default 25) and a max-age
 *     window on sign-ups (SIGNUP_NUDGE_MAX_AGE_DAYS, default 60), so the first
 *     run cannot blast the entire back catalogue.
 *   · One send at a time. This is a nightly job with nothing waiting on it, and
 *     serial sends keep it under Resend's rate limit without any bookkeeping.
 *
 * Env:
 *   WINBACK_ENABLED             master kill switch (shared with the webhook path)
 *   LIFECYCLE_MAX_PER_RUN       default 25
 *   WINBACK_SWEEP_MIN_AGE_DAYS  default 1  — leave a fresh lapse to the webhook
 *   SIGNUP_NUDGE_MIN_AGE_DAYS   default 3  — let a new sign-up settle in first
 *   SIGNUP_NUDGE_MAX_AGE_DAYS   default 60 — blast radius
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Serial Stripe + Resend calls; give the whole sweep room rather than half-
// finishing it and leaving rows claimed with no mail sent.
export const maxDuration = 300;

const intEnv = (name: string, dflt: number, min: number, max: number): number => {
  const n = Number.parseInt((process.env[name] || "").trim(), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

const maxPerRun = () => intEnv("LIFECYCLE_MAX_PER_RUN", 25, 1, 500);
const winbackMinAgeDays = () => intEnv("WINBACK_SWEEP_MIN_AGE_DAYS", 1, 0, 365);
const signupMinAgeDays = () => intEnv("SIGNUP_NUDGE_MIN_AGE_DAYS", 3, 1, 365);
const signupMaxAgeDays = () => intEnv("SIGNUP_NUDGE_MAX_AGE_DAYS", 60, 2, 3650);

interface RunLine {
  kind: "trial-lapsed" | "signup-no-purchase";
  email: string;
  result: string;
  code?: string;
}

/**
 * Lapsed trials. Every candidate is re-verified against Stripe before anything
 * is claimed — the SQL says "our row thinks this is dead", and Stripe says
 * whether they ever actually paid.
 */
async function sweepLapsedTrials(budget: number, dryRun: boolean): Promise<RunLine[]> {
  const out: RunLine[] = [];
  if (budget <= 0) return out;

  const stripe = getStripe();
  // Over-fetch: shouldOfferWinback rejects some of these, and a candidate that
  // is rejected should not eat a slot in the budget.
  const candidates = await getLapsedTrialCandidates(winbackMinAgeDays(), budget * 3);

  for (const c of candidates) {
    if (out.filter((l) => l.result === "sent").length >= budget) break;
    if (!c.email || !c.stripe_subscription_id || !c.stripe_customer_id) continue;

    let sub;
    try {
      sub = await stripe.subscriptions.retrieve(c.stripe_subscription_id);
    } catch (err) {
      out.push({ kind: "trial-lapsed", email: c.email, result: `stripe-error: ${String(err).slice(0, 80)}` });
      continue;
    }

    const skip = await shouldOfferWinback({
      stripe,
      sub,
      email: c.email,
      customerId: c.stripe_customer_id,
    });
    if (skip) {
      out.push({ kind: "trial-lapsed", email: c.email, result: `skip: ${skip}` });
      continue;
    }

    if (dryRun) {
      out.push({ kind: "trial-lapsed", email: c.email, result: "would-send" });
      continue;
    }

    const res = await sendLifecycleOffer({
      stripe,
      kind: "trial-lapsed",
      source: "sweep",
      email: c.email,
      clerkUserId: c.clerk_user_id,
      customerId: c.stripe_customer_id,
      lapsedSubscriptionId: c.stripe_subscription_id,
    });
    out.push(
      res.ok
        ? { kind: "trial-lapsed", email: c.email, result: "sent", code: res.code }
        : { kind: "trial-lapsed", email: c.email, result: `not-sent: ${res.reason}` }
    );
  }

  return out;
}

/**
 * Dormant sign-ups.
 *
 * No Stripe check to make here — these people have no subscription at all, and
 * the SQL has already excluded everyone who must not be mailed. The one extra
 * read is getTrialWinback(): the candidate query joins trial_winback on
 * clerk_user_id, but the table is KEYED ON EMAIL, so an offer row written before
 * a user row existed (or against a differently-spelled address) would not be
 * caught by that join. This closes it on the canonical key.
 */
async function sweepDormantSignups(budget: number, dryRun: boolean): Promise<RunLine[]> {
  const out: RunLine[] = [];
  if (budget <= 0) return out;

  const stripe = getStripe();
  const candidates: LifecycleCandidate[] = await getSignupNoPurchaseCandidates(
    signupMinAgeDays(),
    signupMaxAgeDays(),
    budget * 2,
  );

  for (const c of candidates) {
    if (out.filter((l) => l.result === "sent").length >= budget) break;
    if (!c.email) continue;

    if (await getTrialWinback(c.email)) {
      out.push({ kind: "signup-no-purchase", email: c.email, result: "skip: already-offered" });
      continue;
    }

    if (dryRun) {
      out.push({ kind: "signup-no-purchase", email: c.email, result: "would-send" });
      continue;
    }

    const res = await sendLifecycleOffer({
      stripe,
      kind: "signup-no-purchase",
      source: "sweep",
      email: c.email,
      clerkUserId: c.clerk_user_id,
      customerId: c.stripe_customer_id,
    });
    out.push(
      res.ok
        ? { kind: "signup-no-purchase", email: c.email, result: "sent", code: res.code }
        : { kind: "signup-no-purchase", email: c.email, result: `not-sent: ${res.reason}` }
    );
  }

  return out;
}

function settings() {
  return {
    enabled: winbackEnabled(),
    firstMonthCents: winbackFirstMonthCents(),
    offerDays: winbackOfferDays(),
    maxPerRun: maxPerRun(),
    winbackMinAgeDays: winbackMinAgeDays(),
    signupMinAgeDays: signupMinAgeDays(),
    signupMaxAgeDays: signupMaxAgeDays(),
  };
}

/** Dry run — who would be mailed tonight, plus what has already gone out. */
export async function GET(req: NextRequest) {
  const gate = await ownerOrInternal(req);
  if (!gate.ok) return gateDenied(gate);
  try {
    const cfg = settings();
    if (!cfg.enabled) {
      return NextResponse.json({ ok: true, dryRun: true, settings: cfg, note: "WINBACK_ENABLED is off", lines: [] });
    }
    const lapsed = await sweepLapsedTrials(cfg.maxPerRun, true);
    const dormant = await sweepDormantSignups(cfg.maxPerRun, true);
    const lines = [...lapsed, ...dormant];
    return NextResponse.json({
      ok: true,
      dryRun: true,
      settings: cfg,
      wouldSend: lines.filter((l) => l.result === "would-send").length,
      lines,
      recent: await listTrialWinbacks(50),
    });
  } catch (err) {
    return NextResponse.json({ error: "Preview failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await ownerOrInternal(req);
  if (!gate.ok) return gateDenied(gate);
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body?.dryRun);
    const cfg = settings();

    if (!cfg.enabled) {
      return NextResponse.json({ ok: true, skipped: "WINBACK_ENABLED is off", settings: cfg });
    }

    // The caller may ask for LESS than the configured cap, never more — a hand
    // POST with limit:5000 must not become a mass mailing.
    const asked = Number.parseInt(String(body?.limit ?? ""), 10);
    const budget = Number.isFinite(asked) ? Math.min(cfg.maxPerRun, Math.max(1, asked)) : cfg.maxPerRun;

    // Lapsed trials first: they asked for the product most recently, and if the
    // budget runs out, that is the half worth spending it on.
    const lapsed = await sweepLapsedTrials(budget, dryRun);
    const sentSoFar = lapsed.filter((l) => l.result === "sent").length;
    const dormant = await sweepDormantSignups(budget - sentSoFar, dryRun);

    const lines = [...lapsed, ...dormant];
    const sent = lines.filter((l) => l.result === "sent").length;
    console.log(
      `[lifecycle-emails] sweep ${dryRun ? "(dry run) " : ""}finished — ` +
      `${sent} sent, ${lines.length - sent} skipped, budget ${budget}`
    );

    return NextResponse.json({ ok: true, dryRun, budget, sent, settings: cfg, lines });
  } catch (err) {
    console.error("[lifecycle-emails] sweep failed:", err);
    return NextResponse.json({ error: "Sweep failed", detail: String(err) }, { status: 500 });
  }
}
