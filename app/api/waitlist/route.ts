import { NextRequest, NextResponse } from "next/server";
import { addWaitlistEmail, listWaitlist } from "@/lib/db";
import { appendWaitlistRowToSheet } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "throwawaymail.com", "yopmail.com", "trashmail.com",
  "getnada.com", "sharklasers.com", "dispostable.com", "maildrop.cc",
  "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com",
]);

function normalizeEmail(raw: string): string {
  const e = raw.trim().toLowerCase();
  const [local, domain] = e.split("@");
  if (!domain) return e;
  // Gmail ignores dots + everything after '+'
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const base = local.split("+")[0].replace(/\./g, "");
    return `${base}@gmail.com`;
  }
  // Other providers: strip +tag only
  return `${local.split("+")[0]}@${domain}`;
}

// POST /api/waitlist  { email: string }  → stores launch-notify signups.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawEmail = String(body?.email ?? "").trim().toLowerCase();
    const email = normalizeEmail(rawEmail);

    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ ok: false, error: "Invalid email." }, { status: 400 });
    }

    const domain = email.split("@")[1];
    if (DISPOSABLE_DOMAINS.has(domain)) {
      return NextResponse.json({ ok: false, error: "Please use a permanent email address." }, { status: 400 });
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
