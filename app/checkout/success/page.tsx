"use client";

// Stripe checkout success landing. Unlike the old Supabase-JWT setup (where
// is_paid was baked into an access token that needed an explicit refresh),
// is_paid is now read live from Postgres on every request (via
// getSessionWithUser's join, cached for a few seconds -- see
// lib/auth/session.ts). So there's nothing to "refresh": just poll our own
// /api/auth/me briefly to absorb the short race against the Stripe webhook
// landing, then forward to /home either way.
//
// This route is public (see PUBLIC_PATTERNS in middleware.ts) so a
// still-unpaid session can reach it without being redirected to /pricing.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { trackXEvent, X_SUBSCRIBE_EVENT_ID } from "@/lib/analytics/xPixel";

export default function CheckoutSuccessPage() {
  const router = useRouter();

  useEffect(() => {
    let done = false;

    async function settle() {
      for (let i = 0; i < 6 && !done; i++) {
        try {
          const res = await fetch("/api/auth/me", { cache: "no-store" });
          const data = await res.json();
          if (data?.user?.isPaid) {
            done = true;
            trackXEvent(X_SUBSCRIBE_EVENT_ID);
            router.replace("/home");
            return;
          }
        } catch {
          // ignore, retry
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      // Fallback: /home's server layout does a live DB access check, so send
      // them there regardless — a genuinely-paid user still gets in.
      if (!done) router.replace("/home");
    }

    settle();
    return () => { done = true; };
  }, [router]);

  return (
    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
      <p style={{ opacity: 0.8 }}>Finalizing your subscription…</p>
    </main>
  );
}
