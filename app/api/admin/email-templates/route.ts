import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { founderThankYouEmail, founderThankYouText, FOUNDER_THANKYOU_SUBJECT } from "@/lib/emails/founder-thankyou";
import { maintenanceEmail, maintenanceEmailText, MAINTENANCE_SUBJECT } from "@/lib/emails/maintenance";
import { launchEmail, launchEmailText, LAUNCH_SUBJECT } from "@/lib/emails/launch";
import { launchPromoEmail, launchPromoText, LAUNCH_PROMO_SUBJECT } from "@/lib/emails/launch-promo";
import { subscriberThankYouEmail, subscriberThankYouText, SUBSCRIBER_THANKYOU_SUBJECT } from "@/lib/emails/subscriber-thankyou";
import { pricingApologyEmail, pricingApologyText, PRICING_APOLOGY_SUBJECT } from "@/lib/emails/pricing-apology";

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
  ];
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
  // No id: return the list (id + label only) for a picker.
  return NextResponse.json({
    ok: true,
    templates: templates.map((t) => ({ id: t.id, label: t.label })),
  });
}
