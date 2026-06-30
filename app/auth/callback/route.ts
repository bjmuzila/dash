import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * OAuth + email-confirmation callback. Supabase redirects here with a `code`
 * after Google sign-in or an email-confirmation click. We exchange the code for
 * a session (cookies are set via the SSR server client) and then redirect to
 * `next` (defaults to /home). Errors fall back to /sign-in with a flag.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/home";

  if (code) {
    const supabase = await getSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/sign-in?error=auth`);
}
