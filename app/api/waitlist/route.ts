import { NextRequest, NextResponse } from "next/server";
import { addWaitlistEmail, listWaitlist } from "@/lib/db";
import { appendWaitlistRowToSheet } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/waitlist  { email: string }  → stores launch-notify signups.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();

    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ ok: false, error: "Invalid email." }, { status: 400 });
    }

    const source = typeof body?.source === "string" ? body.source : "landing";
    const referrer = req.headers.get("referer");
    const user_agent = req.headers.get("user-agent");

    const { added } = await addWaitlistEmail({ email, source, referrer, user_agent });

    // Mirror new signups to Google Sheets. Fire-and-forget: a Sheets failure
    // must never break signup (the email is already safe in Postgres).
    if (added) {
      appendWaitlistRowToSheet({ email, source, referrer, user_agent }).catch((err) =>
        console.error("[waitlist] sheet append failed:", err?.message || err)
      );
    }

    return NextResponse.json({
      ok: true,
      added,
      message: added ? "You're on the list." : "You're already on the list.",
    });
  } catch (err) {
    console.error("[waitlist] insert failed:", err);
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 500 });
  }
}

// GET /api/waitlist?secret=...  → simple admin export of signups.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.WAITLIST_ADMIN_SECRET || secret !== process.env.WAITLIST_ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const rows = await listWaitlist();
    return NextResponse.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error("[waitlist] list failed:", err);
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 500 });
  }
}
