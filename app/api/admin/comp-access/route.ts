import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { listCompAccess, grantCompAccess, revokeCompAccess } from "@/lib/db";

/**
 * Owner-only CRUD for comped access — the "give this email what a paying
 * customer sees" switch behind the Admin page's Comped Access card.
 *
 * A grant writes one `comp_access` row; `getSessionWithUser()` ORs a live row
 * into `is_paid`, which is the single flag middleware.ts gates every paid route
 * on. It deliberately does NOT touch `users.is_owner`, so a comped account
 * still gets bounced from /owner/*, /social-media, /home3, /v3 and every
 * ownerApiGate endpoint.
 *
 * GET    -> { rows: CompAccessRow[] }   live comps (not revoked, not expired)
 * POST   { email, note?, expiresAt? }   grant or re-grant
 * DELETE ?email=...                     revoke
 *
 * SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403. Same posture
 * as the sibling /api/admin/* routes. This endpoint can hand out paid access,
 * so it is NOT wired to the INTERNAL_API_TOKEN bypass that the scheduler-facing
 * routes use (lib/auth/ownerApiGate): there is no automated caller for it.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireOwner(): Promise<{ id: string; email: string } | NextResponse> {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || user.id !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return user;
}

export async function GET() {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const rows = await listCompAccess();
    return NextResponse.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const note = String(body?.note ?? "").trim().slice(0, 200) || null;

    // expiresAt arrives as a plain YYYY-MM-DD from the date input. Anchor it to
    // the END of that day in ET rather than midnight UTC — otherwise picking
    // "today" would expire the comp at 8pm the previous evening, which reads as
    // "I granted it and it never worked". Empty/absent = never expires.
    //
    // The offset is hardcoded to EST (-05:00) rather than resolved per-date, so
    // a summer expiry runs one extra hour. That is the deliberate direction to
    // be wrong in: a comp that lasts an hour too long is invisible; one that
    // ends an hour early is a customer locked out of what they were promised.
    const rawExpiry = String(body?.expiresAt ?? "").trim();
    let expiresAt: string | null = null;
    if (rawExpiry) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawExpiry)) {
        return NextResponse.json({ error: "expiresAt must be YYYY-MM-DD" }, { status: 400 });
      }
      const end = new Date(`${rawExpiry}T23:59:59-05:00`);
      if (Number.isNaN(end.getTime())) {
        return NextResponse.json({ error: "expiresAt is not a real date" }, { status: 400 });
      }
      expiresAt = end.toISOString();
    }

    const row = await grantCompAccess(email, { note, expiresAt, grantedBy: gate.email });
    return NextResponse.json({ ok: true, row });
  } catch (err) {
    return NextResponse.json({ error: "Grant failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const email = (new URL(req.url).searchParams.get("email") || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email query param required" }, { status: 400 });
    const { revoked } = await revokeCompAccess(email);
    return NextResponse.json({ ok: true, revoked, email });
  } catch (err) {
    return NextResponse.json({ error: "Revoke failed", detail: String(err) }, { status: 500 });
  }
}
