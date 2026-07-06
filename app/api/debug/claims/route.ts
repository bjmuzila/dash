import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

// TEMPORARY debug route: returns the signed-in caller's own decoded JWT claims
// so we can see exactly what is_paid/is_owner look like in a REAL live token,
// as opposed to the manual custom_access_token_hook(...) SQL test (which
// proves the DB logic works but not that a real minted token carries it).
// Safe to expose: a user can only see their own claims. DELETE once resolved.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;

  let claims: Record<string, unknown> | null = null;
  if (token) {
    try {
      const payload = token.split(".")[1];
      claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    } catch {
      claims = null;
    }
  }

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    is_paid: claims?.is_paid ?? null,
    is_owner: claims?.is_owner ?? null,
    exp: claims?.exp ?? null,
  });
}
