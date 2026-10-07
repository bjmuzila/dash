import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { listMembers, upsertMember, revokeMember, importMembersFromStripe } from "@/lib/db";

/**
 * Owner-only CRUD for the MEMBER LIST, the paid list since 2026-10-07. Behind
 * the owner Admin page's Members card.
 *
 * A live member_access row is what "paying customer" means now (lib/db.ts
 * getSessionWithUser + server-v2/ws-auth.js). Stripe no longer opens or closes
 * the door: CB Edge is closed to new members and every subscription is set to
 * cancel, so each member simply has an end date here. When it passes, their
 * access ends. Members also open vela.cbedge.net (/api/vela/verify).
 *
 * GET                                   -> { rows }  every member, live first
 * POST { email, expiresAt?, note? }     add a member, or change their end date
 *                                       (YYYY-MM-DD, end of that day ET; blank
 *                                       = no end date). Also un-revokes.
 * POST { action: "import" }             copy any live Stripe subscription that
 *                                       is not on the list yet (boot does this
 *                                       too). Never shortens a date, never
 *                                       re-adds a revoked member.
 * DELETE ?email=...                     end access now (row stays as history)
 *
 * SECURITY: fails CLOSED, same as comp-access: unset/mismatched OWNER_USER_ID
 * -> 403.
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
    const rows = await listMembers();
    return NextResponse.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json().catch(() => ({}));

    if (body?.action === "import") {
      const added = await importMembersFromStripe();
      return NextResponse.json({ ok: true, added });
    }

    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    const note = body?.note != null ? String(body.note).trim().slice(0, 200) || null : null;

    // Same date rule as comp-access: a plain YYYY-MM-DD from the date input,
    // anchored to the END of that day in ET. Empty = no end date.
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

    await upsertMember(email, { expiresAt, note, grantedBy: gate.email });
    return NextResponse.json({ ok: true, email, expiresAt });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const email = (new URL(req.url).searchParams.get("email") || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email query param required" }, { status: 400 });
    const { revoked } = await revokeMember(email);
    return NextResponse.json({ ok: true, revoked, email });
  } catch (err) {
    return NextResponse.json({ error: "Revoke failed", detail: String(err) }, { status: 500 });
  }
}
