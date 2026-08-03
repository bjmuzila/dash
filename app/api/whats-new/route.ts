import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { loadCustomerChangelog } from "@/lib/whatsNewChangelog";
import { readHidden, writeHidden, hideKey, type HiddenEntry } from "@/lib/whatsNewHidden";

// Owner-only endpoint for the What's New page. Lets the owner hide a single
// bullet straight from the page.
//
// This used to DELETE the line out of CUSTOMER_CHANGELOG.md. It no longer
// touches that file: the markdown is baked into the Docker image at build time
// and the repo is not bind-mounted, so those edits evaporated on the next
// redeploy (and desynced the site from the changelog on disk). Hides are now
// recorded in ./state/whats-new-hidden.json, which IS bind-mounted - see
// lib/whatsNewHidden.ts. Hiding is reversible; nothing is destroyed.
//
// Fail-closed: unset OWNER_USER_ID denies, not opens.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export const dynamic = "force-dynamic";

async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, status: 401, message: "Not signed in." };
  if (!OWNER_USER_ID) {
    // Loud, specific message: this is the failure that used to surface as a
    // silently reappearing bullet with no explanation.
    console.error("[whats-new] OWNER_USER_ID is not set in the server environment - hide/restore denied");
    return { ok: false, status: 403, message: "Server is missing OWNER_USER_ID." };
  }
  if (userId !== OWNER_USER_ID) return { ok: false, status: 403, message: "Not the owner account." };
  return { ok: true };
}

// GET - owner-only list of currently hidden bullets, newest hide first.
export async function GET() {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });
  const hidden = await readHidden();
  return NextResponse.json({ hidden });
}

// DELETE - hide one bullet from the public page.
export async function DELETE(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  try {
    const { date, item } = (await req.json()) as { date?: string; item?: string };
    if (!date || !item) {
      return NextResponse.json({ error: "date and item are required" }, { status: 400 });
    }

    // Confirm the bullet really exists in the changelog before recording a hide,
    // so a stale page can't write junk keys that never match anything.
    const entries = await loadCustomerChangelog();
    const section = entries.find((e) => e.date.trim() === date.trim());
    const exists = !!section && section.items.some((it) => it.trim() === item.trim());
    if (!exists) {
      return NextResponse.json(
        { error: "That update is no longer in the changelog - reload the page." },
        { status: 404 }
      );
    }

    const hidden = await readHidden();
    const key = hideKey(date, item);
    if (!hidden.some((h) => hideKey(h.date, h.item) === key)) {
      const entry: HiddenEntry = {
        date: date.trim(),
        item: item.trim(),
        hiddenAt: new Date().toISOString(),
      };
      await writeHidden([entry, ...hidden]);
    }

    return NextResponse.json({ ok: true, hiddenCount: hidden.length + 1 });
  } catch (err) {
    console.error("[whats-new] hide failed", err);
    return NextResponse.json({ error: "Hide failed", detail: String(err) }, { status: 500 });
  }
}

// POST - un-hide a bullet (undo). Body: { date, item }.
export async function POST(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  try {
    const { date, item } = (await req.json()) as { date?: string; item?: string };
    if (!date || !item) {
      return NextResponse.json({ error: "date and item are required" }, { status: 400 });
    }

    const hidden = await readHidden();
    const key = hideKey(date, item);
    const next = hidden.filter((h) => hideKey(h.date, h.item) !== key);
    if (next.length !== hidden.length) await writeHidden(next);

    return NextResponse.json({ ok: true, hiddenCount: next.length });
  } catch (err) {
    console.error("[whats-new] restore failed", err);
    return NextResponse.json({ error: "Restore failed", detail: String(err) }, { status: 500 });
  }
}
