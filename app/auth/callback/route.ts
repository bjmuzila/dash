import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * OAuth + email-confirmation callback. Supabase redirects here with a `code`
 * after Google sign-in or an email-confirmation click. We exchange the code for
 * a session (cookies are set via the SSR server client) and then redirect to
 * `next` (defaults to /home). Errors fall back to /sign-in with a flag.
 */
// Behind Cloudflare + the VPS proxy, req.url's host is the internal loopback
// (localhost:3002), so new URL(req.url).origin would redirect users to localhost
// after OAuth. Resolve the real public origin from forwarded headers / an
// explicit base URL first, mirroring the Stripe routes' publicOrigin().
function publicOrigin(req: NextRequest, fallback: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return fallback;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin: urlOrigin } = new URL(req.url);
  const origin = publicOrigin(req, urlOrigin);
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
