import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { listUnsubscribes, addUnsubscribe, removeUnsubscribe } from "@/lib/db";

// Owner-only management of the global email suppression list.
//   GET    → list every suppressed email (who unsubscribed).
//   POST   → { email } manually suppress an address.
//   DELETE → ?email=... re-subscribe (remove from the list).
//
// SECURITY: fails CLOSED — unset/misconfigured OWNER_USER_ID rejects all.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, status: 401 };
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return { ok: false, status: 403 };
  return { ok: true };
}

export async function GET() {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  try {
    const rows = await listUnsubscribes();
    return NextResponse.json({ ok: true, count: rows.length, unsubscribes: rows });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    const { added } = await addUnsubscribe(email, "manual");
    return NextResponse.json({ ok: true, added, email });
  } catch (err) {
    return NextResponse.json({ error: "Add failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  try {
    const email = (req.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email query param required" }, { status: 400 });
    const { removed } = await removeUnsubscribe(email);
    return NextResponse.json({ ok: true, removed, email });
  } catch (err) {
    return NextResponse.json({ error: "Remove failed", detail: String(err) }, { status: 500 });
  }
}
