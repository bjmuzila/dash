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

// Owner-only. Returns rendered email templates (subject + html + text) so the
// /admin/emails compose page can load a preset with one click instead of pasting
// raw HTML. Read-only; does not send anything.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

type Template = { id: string; label: string; subject: string; html: string; text: string };

function buildTemplates(): Template[] {
  return [
    {
      id: "subscriber-thankyou",
      label: "Subscriber thank-you + weekend dashboard",
      subject: SUBSCRIBER_THANKYOU_SUBJECT,
      html: subscriberThankYouEmail(),
      text: subscriberThankYouText(),
    },
    {
      id: "pricing-apology",
      label: "Pricing apology — refund/credit for current members",
      subject: PRICING_APOLOGY_SUBJECT,
      html: pricingApologyEmail(),
      text: pricingApologyText(),
    },
    {
      id: "pricing-comparison",
      label: "Pricing comparison — why pay $199-699/mo (MONTH/YEAR)",
      subject: PRICING_COMPARISON_SUBJECT,
      html: pricingComparisonEmail(),
      text: pricingComparisonText(),
    },
    {
      id: "try-cbedge-30",
      label: "Signed up, never subscribed — $30 first month (TRY30)",
      subject: TRY_CBEDGE_30_SUBJECT,
      html: tryCbEdge30Email(),
      text: tryCbEdge30Text(),
    },
    {
      id: "scanner-catch",
      label: "Scanner social proof — PLTR 140C +129.6%",
      subject: SCANNER_CATCH_SUBJECT,
      html: scannerCatchEmail(),
      text: scannerCatchText(),
    },
    {
      id: "flow-catch",
      label: "Flow tape social proof — AMD 550P +217.7%",
      subject: FLOW_CATCH_SUBJECT,
      html: flowCatchEmail(),
      text: flowCatchText(),
    },
    {
      id: "auto-gex-trial",
      label: "Auto GEX feature pitch — 2-day free trial CTA",
      subject: AUTO_GEX_TRIAL_SUBJECT,
      html: autoGexTrialEmail(),
      text: autoGexTrialText(),
    },
    {
      id: "cb-confidence",
      label: "CB Confidence hit rate — 71-86% this week",
      subject: CB_CONFIDENCE_SUBJECT,
      html: cbConfidenceEmail(),
      text: cbConfidenceText(),
    },
    {
      id: "reorg-beta-notice",
      label: "Reorg heads-up — Scanner/Test are always beta",
      subject: REORG_BETA_NOTICE_SUBJECT,
      html: reorgBetaNoticeEmail(),
      text: reorgBetaNoticeText(),
    },
    {
      id: "founder-thankyou",
      label: "Founder thank-you (auto-welcome)",
      subject: FOUNDER_THANKYOU_SUBJECT,
      html: founderThankYouEmail(),
      text: founderThankYouText(),
    },
    {
      id: "maintenance",
      label: "Maintenance — hardware upgrade",
      subject: MAINTENANCE_SUBJECT,
      html: maintenanceEmail(),
      text: maintenanceEmailText(),
    },
    {
      id: "launch",
      label: "Fully launched — 20% off (LAUNCH)",
      subject: LAUNCH_SUBJECT,
      html: launchEmail(),
      text: launchEmailText(),
    },
    {
      id: "launch-promo",
      label: "🚀 Launch sale promo — 20% off (LAUNCH)",
      subject: LAUNCH_PROMO_SUBJECT,
      html: launchPromoEmail(),
      text: launchPromoText(),
    },
    {
      id: "weekly-edge",
      label: "📰 The Weekly Edge — market recap + FOMC/earnings preview + CB results",
      subject: WEEKLY_EDGE_SUBJECT,
      html: weeklyEdgeEmail(),
      text: weeklyEdgeText(),
    },
    {
      id: "subscriber-price-match",
      label: "💲 Subscriber price match — monthly subscribers moved to $45/mo",
      subject: SUBSCRIBER_PRICE_MATCH_SUBJECT,
      html: subscriberPriceMatchEmail(),
      text: subscriberPriceMatchText(),
    },
    {
      id: "edge-catch-amd",
      label: "⚡ EDGE + heatmap — AMD 505C +283% · MSFT +17.4%",
      subject: EDGE_CATCH_AMD_SUBJECT,
      html: edgeCatchAmdEmail(),
      text: edgeCatchAmdText(),
    },
    {
      id: "nopants-promo",
      label: "🎒 Kids-in-school promo — $300/yr, 2 spots (NOPANTS)",
      subject: NOPANTS_PROMO_SUBJECT,
      html: noPantsPromoEmail(),
      text: noPantsPromoText(),
    },
    {
      id: "nopants-extension",
      label: "⏳ NOPANTS extension — sold out in 30 min, 3 more at $300",
      subject: NOPANTS_EXTENSION_SUBJECT,
      html: noPantsExtensionEmail(),
      text: noPantsExtensionText(),
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
  const userId = await getServerUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  const templates = buildTemplates();
  if (id) {
    const t = templates.find((x) => x.id === id);
    if (!t) return NextResponse.json({ error: "Unknown template" }, { status: 404 });
    return NextResponse.json({ ok: true, template: t });
  }
  // No id: return the list (id + label only) for a picker, newest template on top.
  return NextResponse.json({
    ok: true,
    templates: newestFirst(templates).map((t) => ({ id: t.id, label: t.label })),
  });
}
