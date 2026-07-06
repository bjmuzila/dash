import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";

// GET /api/auth/me -> the current session's { id, email, isOwner, isPaid } or
// { user: null } if signed out. Backs AuthProvider's client-side auth state
// now that there's no Supabase session object to read in the browser.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: session.userId,
      email: session.email,
      isOwner: session.isOwner,
      isPaid: session.isPaid,
    },
  });
}
