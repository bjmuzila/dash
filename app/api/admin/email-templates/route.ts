import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { founderThankYouEmail, founderThankYouText, FOUNDER_THANKYOU_SUBJECT } from "@/lib/emails/founder-thankyou";
import { maintenanceEmail, maintenanceEmailText, MAINTENANCE_SUBJECT } from "@/lib/emails/maintenance";
import { launchEmail, launchEmailText, LAUNCH_SUBJECT } from "@/lib/emails/launch";
import { launchPromoEmail, launchPromoText, LAUNCH_PROMO_SUBJECT } from "@/lib/emails/launch-promo";
import { subscriberThankYouEmail, subscriberThankYouText, SUBSCRIBER_THANKYOU_SUBJECT } from "@/lib/emails/subscriber-thankyou";
import { pricingApologyEmail, pricingApologyText, PRICING_APOLOGY_SUBJECT } from "@/lib/emails/pricing-apology";
import { pricingComparisonEmail, pricingComparisonText, PRICING_COMPARISON_SUBJECT } from "@/lib/emails/pricing-comparison";
import { tryCbEdge30Email, tryCbEdge30Text, TRY_CBEDGE_30_SUBJECT } from "@/lib/emails/try-cbedge-30";
import { scannerCatchEmail, scannerCatchText, SCANNER_CATCH_SUBJECT } from "@/lib/emails/scanner-catch";
import { flowCatchEmail, flowCatchText, FLOW_CATCH_SUBJECT } from "@/lib/emails/flow-catch";
import { autoGexTrialEmail, autoGexTrialText, AUTO_GEX_TRIAL_SUBJECT } from "@/lib/emails/auto-gex-trial";
import { cbConfidenceEmail, cbConfidenceText, CB_CONFIDENCE_SUBJECT } from "@/lib/emails/cb-confidence";
import { reorgBetaNoticeEmail, reorgBetaNoticeText, REORG_BETA_NOTICE_SUBJECT } from "@/lib/emails/reorg-beta-notice";
import { weeklyEdgeEmail, weeklyEdgeText, WEEKLY_EDGE_SUBJECT } from "@/lib/emails/weekly-edge";
import { subscriberPriceMatchEmail, subscriberPriceMatchText, SUBSCRIBER_PRICE_MATCH_SUBJECT } from "@/lib/emails/subscriber-price-match";
import { edgeCatchAmdEmail, edgeCatchAmdText, EDGE_CATCH_AMD_SUBJECT } from "@/lib/emails/edge-catch-amd";
import { noPantsPromoEmail, noPantsPromoText, NOPANTS_PROMO_SUBJECT } from "@/lib/emails/nopants-promo";
import { noPantsExtensionEmail, noPantsExtensionText, NOPANTS_EXTENSION_SUBJECT } from "@/lib/emails/nopants-extension";
import { flowDialedInEmail, flowDialedInText, FLOW_DIALED_IN_SUBJECT } from "@/lib/emails/flow-dialed-in";
import { mobileFeedbackEmail, mobileFeedbackText, MOBILE_FEEDBACK_SUBJECT } from "@/lib/emails/mobile-feedback";
import { midnight300Email, midnight300Text, MIDNIGHT_300_SUBJECT } from "@/lib/emails/midnight-300";
import { edge3AnnualEmail, edge3AnnualText, EDGE3_ANNUAL_SUBJECT } from "@/lib/emails/edge3-annual";
import { seasonalityFreeEmail, seasonalityFreeText, SEASONALITY_FREE_SUBJECT } from "@/lib/emails/seasonality-free";
import { v3ComingSoonEmail, v3ComingSoonText, V3_COMING_SOON_SUBJECT } from "@/lib/emails/v3-coming-soon";
import { wholeBoardEmail, wholeBoardText, WHOLE_BOARD_SUBJECT } from "@/lib/emails/whole-board";
import { fomcHalfOffEmail, fomcHalfOffText, FOMC_HALF_OFF_SUBJECT } from "@/lib/emails/fomc-half-off";
import { voltickMergerEmail, voltickMergerText, VOLTICK_MERGER_SUBJECT } from "@/lib/emails/voltick-merger";
import { autopayOffEmail, autopayOffText, AUTOPAY_OFF_SUBJECT } from "@/lib/emails/autopay-off";
import { hiddenTemplateIdSet, hideTemplate, restoreTemplate } from "@/lib/emails/hiddenTemplates";

// Owner-only. Returns rendered email templates (subject + html + text) so the
// /admin/emails compose page can load a preset with one click instead of pasting
// raw HTML. Never sends anything.
//
// DELETE ?id=<id>  hides a template from the picker
// POST   { id }    restores a hidden one
//
// "Delete" is a HIDE, not a file removal: the templates below are compiled TS
// modules baked into the Docker image, so nothing on disk can be rewritten at
// runtime. The hidden-id list lives in the bind-mounted ./state dir - see
// lib/emails/hiddenTemplates.ts for the full reasoning.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

// Fails CLOSED, same as /api/admin/send-email: an unset OWNER_USER_ID rejects
// everyone rather than opening the endpoint to any signed-in user.
async function ownerGate(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}

// html/text are THUNKS, not rendered strings. buildTemplates() runs on every
// request — including the plain list request that only needs id + label — so
// eagerly rendering all ~20 bodies there meant one template throwing at runtime
// (e.g. a renamed opts field leaving `strip(undefined)` behind) failed the whole
// endpoint with a 500, and the compose page — which silently ignores a failed
// template fetch — dropped its entire Templates section. Rendering is now
// deferred to the single template actually being loaded, and wrapped in
// try/catch, so a broken template can only ever break itself.
type Template = { id: string; label: string; subject: string; html: () => string; text: () => string };

function buildTemplates(): Template[] {
  return [
    {
      id: "subscriber-thankyou",
      label: "Subscriber thank-you + weekend dashboard",
      subject: SUBSCRIBER_THANKYOU_SUBJECT,
      html: subscriberThankYouEmail,
      text: subscriberThankYouText,
    },
    {
      id: "pricing-apology",
      label: "Pricing apology — refund/credit for current members",
      subject: PRICING_APOLOGY_SUBJECT,
      html: pricingApologyEmail,
      text: pricingApologyText,
    },
    {
      id: "pricing-comparison",
      label: "Pricing comparison — why pay $199-699/mo (MONTH/YEAR)",
      subject: PRICING_COMPARISON_SUBJECT,
      html: pricingComparisonEmail,
      text: pricingComparisonText,
    },
    {
      id: "try-cbedge-30",
      label: "Signed up, never subscribed — $30 first month (TRY30)",
      subject: TRY_CBEDGE_30_SUBJECT,
      html: tryCbEdge30Email,
      text: tryCbEdge30Text,
    },
    {
      id: "scanner-catch",
      label: "Scanner social proof — PLTR 140C +129.6%",
      subject: SCANNER_CATCH_SUBJECT,
      html: scannerCatchEmail,
      text: scannerCatchText,
    },
    {
      id: "flow-catch",
      label: "Flow tape social proof — AMD 550P +217.7%",
      subject: FLOW_CATCH_SUBJECT,
      html: flowCatchEmail,
      text: flowCatchText,
    },
    {
      id: "auto-gex-trial",
      label: "Auto GEX feature pitch — 2-day free trial CTA",
      subject: AUTO_GEX_TRIAL_SUBJECT,
      html: autoGexTrialEmail,
      text: autoGexTrialText,
    },
    {
      id: "cb-confidence",
      label: "CB Confidence hit rate — 71-86% this week",
      subject: CB_CONFIDENCE_SUBJECT,
      html: cbConfidenceEmail,
      text: cbConfidenceText,
    },
    {
      id: "reorg-beta-notice",
      label: "Reorg heads-up — Scanner/Test are always beta",
      subject: REORG_BETA_NOTICE_SUBJECT,
      html: reorgBetaNoticeEmail,
      text: reorgBetaNoticeText,
    },
    {
      id: "founder-thankyou",
      label: "Founder thank-you (auto-welcome)",
      subject: FOUNDER_THANKYOU_SUBJECT,
      html: founderThankYouEmail,
      text: founderThankYouText,
    },
    {
      id: "maintenance",
      label: "Maintenance — hardware upgrade",
      subject: MAINTENANCE_SUBJECT,
      html: maintenanceEmail,
      text: maintenanceEmailText,
    },
    {
      id: "launch",
      label: "Fully launched — 20% off (LAUNCH)",
      subject: LAUNCH_SUBJECT,
      html: launchEmail,
      text: launchEmailText,
    },
    {
      id: "launch-promo",
      label: "🚀 Launch sale promo — 20% off (LAUNCH)",
      subject: LAUNCH_PROMO_SUBJECT,
      html: launchPromoEmail,
      text: launchPromoText,
    },
    {
      id: "weekly-edge",
      label: "📰 The Weekly Edge — market recap + FOMC/earnings preview + CB results",
      subject: WEEKLY_EDGE_SUBJECT,
      html: weeklyEdgeEmail,
      text: weeklyEdgeText,
    },
    {
      id: "subscriber-price-match",
      label: "💲 Subscriber price match — monthly subscribers moved to $45/mo",
      subject: SUBSCRIBER_PRICE_MATCH_SUBJECT,
      html: subscriberPriceMatchEmail,
      text: subscriberPriceMatchText,
    },
    {
      id: "edge-catch-amd",
      label: "⚡ EDGE + heatmap — AMD 505C +283% · MSFT +17.4%",
      subject: EDGE_CATCH_AMD_SUBJECT,
      html: edgeCatchAmdEmail,
      text: edgeCatchAmdText,
    },
    {
      id: "nopants-promo",
      label: "🎒 Kids-in-school promo — $300/yr, 2 spots (NOPANTS)",
      subject: NOPANTS_PROMO_SUBJECT,
      html: noPantsPromoEmail,
      text: noPantsPromoText,
    },
    {
      id: "nopants-extension",
      label: "⏳ NOPANTS extension — sold out in 30 min, 3 more at $300",
      subject: NOPANTS_EXTENSION_SUBJECT,
      html: noPantsExtensionEmail,
      text: noPantsExtensionText,
    },
    {
      id: "flow-dialed-in",
      label: "✅ Options flow is 100% — scanners/alerts next (subscriber update)",
      subject: FLOW_DIALED_IN_SUBJECT,
      html: flowDialedInEmail,
      text: flowDialedInText,
    },
    {
      id: "mobile-feedback",
      label: "📱 Mobile site feedback ask — what pages to add / adjust",
      subject: MOBILE_FEEDBACK_SUBJECT,
      html: mobileFeedbackEmail,
      text: mobileFeedbackText,
    },
    {
      id: "midnight-300",
      label: "⏳ Final call — 2 spots at $300/yr, ends at midnight (EDGE)",
      subject: MIDNIGHT_300_SUBJECT,
      html: midnight300Email,
      text: midnight300Text,
    },
    {
      id: "edge3-annual",
      label: "💎 Annual promo — $1,000/yr → $400/yr, no deadline (EDGE3)",
      subject: EDGE3_ANNUAL_SUBJECT,
      html: edge3AnnualEmail,
      text: edge3AnnualText,
    },
    {
      id: "seasonality-free",
      label: "📅 Free seasonality almanac — /explore/seasonality (no signup)",
      subject: SEASONALITY_FREE_SUBJECT,
      html: seasonalityFreeEmail,
      text: seasonalityFreeText,
    },
    {
      id: "v3-coming-soon",
      label: "🚀 Version 3 coming soon — faster charts, layouts, alerts, replays",
      subject: V3_COMING_SOON_SUBJECT,
      html: v3ComingSoonEmail,
      text: v3ComingSoonText,
    },
    {
      id: "whole-board",
      label: "🧩 The Whole Board — every panel on one screen (/app/board)",
      subject: WHOLE_BOARD_SUBJECT,
      html: wholeBoardEmail,
      text: wholeBoardText,
    },
    {
      id: "fomc-half-off",
      label: "FOMC half-off — $250/yr instead of $500, 2 spots",
      subject: FOMC_HALF_OFF_SUBJECT,
      html: fomcHalfOffEmail,
      text: fomcHalfOffText,
    },
    {
      id: "voltick-merger",
      label: "⚡ CB Edge is joining Voltick — merger announcement, 75% off (TICK75)",
      subject: VOLTICK_MERGER_SUBJECT,
      html: voltickMergerEmail,
      text: voltickMergerText,
    },
    {
      id: "autopay-off",
      label: "💳 Automatic payment turned off — no more charges, access stays on",
      subject: AUTOPAY_OFF_SUBJECT,
      html: autopayOffEmail,
      text: autopayOffText,
    },
  ];
}

// buildTemplates() is maintained oldest-first (new templates are appended per
// the checklist in EMAILS_HANDOFF.md). The picker wants newest-first, so
// reverse once here rather than requiring every caller to remember to.
function newestFirst(templates: Template[]): Template[] {
  return [...templates].reverse();
}

export async function GET(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return gate.res;

  const id = req.nextUrl.searchParams.get("id");
  const templates = buildTemplates();
  if (id) {
    // Deliberately NOT filtered by the hidden list: the picker's "Hidden"
    // section can still preview/restore one, and a hidden template is only
    // hidden from the list, not deactivated.
    const t = templates.find((x) => x.id === id);
    if (!t) return NextResponse.json({ error: "Unknown template" }, { status: 404 });
    try {
      return NextResponse.json({
        ok: true,
        template: { id: t.id, label: t.label, subject: t.subject, html: t.html(), text: t.text() },
      });
    } catch (err) {
      // Name the offender - a blank composer with no explanation is what made
      // the last one of these hard to spot.
      return NextResponse.json(
        { error: `Template "${t.id}" failed to render: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }
  }

  // No id: return the list (id + label only) for a picker, newest template on
  // top. Deleted (hidden) ones are dropped unless ?includeHidden=1, which the
  // owner page uses so it can render a "Hidden" section with restore buttons.
  // A hidden-list read failure must never take the whole picker down, so it
  // degrades to "nothing is hidden".
  const includeHidden = req.nextUrl.searchParams.get("includeHidden") === "1";
  let hidden: Set<string>;
  try {
    hidden = await hiddenTemplateIdSet();
  } catch (err) {
    console.error("[email-templates] hidden list read failed - showing all:", err);
    hidden = new Set<string>();
  }

  const list = newestFirst(templates)
    .filter((t) => includeHidden || !hidden.has(t.id))
    .map((t) => ({ id: t.id, label: t.label, hidden: hidden.has(t.id) }));

  return NextResponse.json({ ok: true, templates: list, hiddenCount: hidden.size });
}

// DELETE ?id=<id> - hide a template from the picker. Reversible via POST.
export async function DELETE(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return gate.res;

  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  // Reject unknown ids so a typo can't silently accumulate dead entries in the
  // state file.
  if (!buildTemplates().some((t) => t.id === id)) {
    return NextResponse.json({ error: "Unknown template" }, { status: 404 });
  }

  try {
    const hidden = await hideTemplate(id);
    return NextResponse.json({ ok: true, id, hidden: true, hiddenCount: hidden.length });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to delete template: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

// POST { id } - restore a previously deleted template.
export async function POST(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!buildTemplates().some((t) => t.id === id)) {
    return NextResponse.json({ error: "Unknown template" }, { status: 404 });
  }

  try {
    const hidden = await restoreTemplate(id);
    return NextResponse.json({ ok: true, id, hidden: false, hiddenCount: hidden.length });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to restore template: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
