"use client";

// Stripe checkout success landing. The subscription row is written by the
// webhook, but the signed-in user's JWT still carries the OLD `is_paid` claim
// until the access token refreshes — which would bounce them off every gated
// route (except /home, which does a live DB check). So we force a session
// refresh here to mint a token with `is_paid: true`, then forward to the app.
//
// This route is public (see PUBLIC_PATTERNS in middleware.ts) so the pre-refresh
// (still-unpaid) token can reach it without being redirected to /pricing.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export default function CheckoutSuccessPage() {
  const router = useRouter();

  useEffect(() => {
    let done = false;
    const supabase = getSupabaseBrowser();

    // Poll a short while: the webhook may land a beat after the redirect. Each
    // refreshSession re-runs the access-token hook, so once the row is written
    // the new token carries is_paid: true.
    async function settle() {
      for (let i = 0; i < 6 && !done; i++) {
        const { data } = await supabase.auth.refreshSession();
        const token = data.session?.access_token;
        if (token && readClaim(token, "is_paid")) {
          done = true;
          router.replace("/home");
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      // Fallback: /home's server layout does a live DB access check, so send
      // them there regardless — a genuinely-paid user still gets in.
      if (!done) router.replace("/home");
    }

    settle().catch(() => router.replace("/home"));
    return () => { done = true; };
  }, [router]);

  return (
    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
      <p style={{ opacity: 0.8 }}>Finalizing your subscription…</p>
    </main>
  );
}

function readClaim(accessToken: string, key: string): boolean {
  try {
    const payload = accessToken.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json)?.[key] === true;
  } catch {
    return false;
  }
}
