import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getQuoteSymbols, upsertQuoteSymbols, type QuoteSymPref } from "@/lib/db";

export const dynamic = "force-dynamic";

// Per-user customized Quotes list for the toolbar dropdown. Keyed on the Clerk
// userId — never a client-supplied identity. Empty list => client falls back to
// the built-in defaults.

function sanitize(input: unknown): QuoteSymPref[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: QuoteSymPref[] = [];
  for (const it of input) {
    if (!it || typeof it !== "object") continue;
    const sym = String((it as Record<string, unknown>).sym ?? "").trim().toUpperCase().slice(0, 12);
    if (!sym || seen.has(sym)) continue;
    // Allow A-Z, 0-9, slash (futures), dot, caret, dash.
    if (!/^[A-Z0-9/.^-]+$/.test(sym)) continue;
    seen.add(sym);
    const labelRaw = String((it as Record<string, unknown>).label ?? sym).trim().slice(0, 12);
    out.push({ sym, label: labelRaw || sym });
    if (out.length >= 40) break;
  }
  return out;
}

export async function GET() {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const symbols = await getQuoteSymbols(userId);
    // Private (per-user) short cache: prefs change rarely, so let the browser
    // reuse them for 30s instead of a blocking DB round-trip on every load.
    // POST below is the only mutation and the client refetches on edit.
    return NextResponse.json(
      { symbols },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const symbols = sanitize(body?.symbols);
    await upsertQuoteSymbols(userId, symbols);
    return NextResponse.json({ ok: true, symbols });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
