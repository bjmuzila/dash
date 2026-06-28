import { NextRequest, NextResponse } from "next/server";
import { unsubscribeWaitlistEmail } from "@/lib/db";
import { verifyUnsubscribe } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

async function doUnsubscribe(email: string, token: string) {
  if (!email || !token) {
    return NextResponse.json({ ok: false, error: "Missing email or token." }, { status: 400 });
  }
  if (!verifyUnsubscribe(email, token)) {
    return NextResponse.json({ ok: false, error: "Invalid or expired link." }, { status: 403 });
  }
  await unsubscribeWaitlistEmail(email);
  // Always report success on a valid token — don't leak whether the email exists.
  return NextResponse.json({ ok: true, message: "You've been unsubscribed." });
}

// POST /api/unsubscribe → marks the waitlist email unsubscribed.
// Accepts BOTH:
//   • JSON  { email, token }            (the confirmation page)
//   • RFC 8058 one-click: email+token in the query string, body is the form
//     field `List-Unsubscribe=One-Click` (Gmail/Apple "Unsubscribe").
// Token is the HMAC from the email link, so the request can't be forged.
export async function POST(req: NextRequest) {
  try {
    const qsEmail = req.nextUrl.searchParams.get("e");
    const qsToken = req.nextUrl.searchParams.get("t");

    let email = (qsEmail || "").trim().toLowerCase();
    let token = (qsToken || "").trim();

    // If not in the query string, read JSON body (confirmation page).
    if (!email || !token) {
      const body = await req.json().catch(() => ({}));
      email = String(body?.email ?? email).trim().toLowerCase();
      token = String(body?.token ?? token).trim();
    }

    return await doUnsubscribe(email, token);
  } catch (err) {
    console.error("[unsubscribe] failed:", err);
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 500 });
  }
}
