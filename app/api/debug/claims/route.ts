import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";

// Debug route: returns the signed-in caller's own resolved session (is_paid /
// is_owner / etc). Originally this decoded a Supabase JWT's claims to sanity
// check the custom_access_token_hook; there's no JWT/claims layer anymore --
// is_owner/is_paid are just live DB reads now, so this reports those directly.
// Safe to expose: a user can only see their own session.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  return NextResponse.json({
    userId: session.userId,
    email: session.email,
    is_paid: session.isPaid,
    is_owner: session.isOwner,
  });
}
