import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import {
  getBzilaAlerts,
  insertBzilaAlert,
  updateBzilaAlert,
  deleteBzilaAlert,
} from "@/lib/db";

// "Bzila alerts" — owner-authored broadcasts surfaced in the toolbar bell.
// GET is readable by paid subscribers (and the owner); everyone else gets an
// empty list so the bell renders nothing. Writes (POST/PATCH/DELETE) are the
// real gate — owner only via the session's isOwner claim. The client-side
// compose/edit/delete controls are cosmetic; this route enforces access.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — latest 5 alerts for paid users / owner.
export async function GET() {
  const session = await getServerSession();
  if (!session || !(session.isPaid || session.isOwner)) {
    return NextResponse.json({ alerts: [] });
  }
  try {
    const alerts = await getBzilaAlerts(5);
    return NextResponse.json({ alerts });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

// POST — create/send a new alert (owner only).
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const title = String(b?.title ?? "").slice(0, 120);
    const body = String(b?.body ?? "").trim().slice(0, 2000);
    if (!body) return NextResponse.json({ error: "Empty body" }, { status: 400 });
    const id = await insertBzilaAlert(title, body);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}

// PATCH — edit an existing alert (owner only).
export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const id = Number(b?.id);
    const title = String(b?.title ?? "").slice(0, 120);
    const body = String(b?.body ?? "").trim().slice(0, 2000);
    if (!id || !body) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    await updateBzilaAlert(id, title, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Update failed", detail: String(err) }, { status: 500 });
  }
}

// DELETE — remove an alert (owner only). id via ?id= or JSON body.
export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const url = new URL(req.url);
    let id = Number(url.searchParams.get("id"));
    if (!id) {
      const b = await req.json().catch(() => ({}));
      id = Number(b?.id);
    }
    if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    await deleteBzilaAlert(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Delete failed", detail: String(err) }, { status: 500 });
  }
}
