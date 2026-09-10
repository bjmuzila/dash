"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { V3, V3_TEXT, v3GhostButton, v3PrimaryButton } from "@/components/landing/v3Theme";

// Client buttons for the pricing page. Subscribe → POST /api/stripe/checkout with
// the chosen { plan } and redirect to the returned Stripe Checkout URL.
// Manage billing → POST /api/stripe/portal. Both routes return { url }.
//
// monthlyLabel / yearlyLabel let the page show real prices (e.g. "$50/mo").
//
// No promo plumbing: pricing is flat ($50/mo, $500/yr) and checkout takes no
// codes, so the request body is just the chosen plan.
export default function PricingActions({
  hasAccess,
  hasBilling,
  monthlyLabel = "Subscribe monthly",
  yearlyLabel = "Subscribe yearly",
}: {
  hasAccess: boolean;
  hasBilling: boolean;
  monthlyLabel?: string;
  yearlyLabel?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<"monthly" | "yearly" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkout(plan: "monthly" | "yearly") {
    setError(null);
    setLoading(plan);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setError(data?.error || "Something went wrong. Please try again.");
        setLoading(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Network error. Please try again.");
      setLoading(null);
    }
  }

  async function portal() {
    setError(null);
    setLoading("portal");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setError(data?.error || "Could not open billing. Please try again.");
        setLoading(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Network error. Please try again.");
      setLoading(null);
    }
  }

  // v3 controls (2026-09-10): solid accent primary, ghost secondary. The
  // "dark-glass cyan" these used to share with the old landing is gone with it.
  const full: React.CSSProperties = { width: "100%", boxSizing: "border-box", cursor: "pointer", fontSize: V3_TEXT.body };
  const primary: React.CSSProperties = { ...v3PrimaryButton, ...full };
  const secondary: React.CSSProperties = { ...v3GhostButton, ...full, borderColor: V3.cyan, color: V3.cyan };
  const muted: React.CSSProperties = { ...v3GhostButton, ...full, fontWeight: 600 };
  const busy = loading !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {hasAccess ? (
        // /v3 directly — /home is one redirect hop to the same place.
        <button style={primary} onClick={() => router.push("/v3")}>
          Go to dashboard
        </button>
      ) : (
        <>
          <button
            style={{ ...primary, opacity: busy ? 0.6 : 1 }}
            disabled={busy}
            onClick={() => checkout("monthly")}
          >
            {loading === "monthly" ? "Redirecting…" : monthlyLabel}
          </button>
          <button
            style={{ ...secondary, opacity: busy ? 0.6 : 1 }}
            disabled={busy}
            onClick={() => checkout("yearly")}
          >
            {loading === "yearly" ? "Redirecting…" : yearlyLabel}
          </button>
        </>
      )}

      {hasBilling && (
        <button
          style={{ ...muted, opacity: busy ? 0.6 : 1 }}
          disabled={busy}
          onClick={portal}
        >
          {loading === "portal" ? "Opening…" : "Manage billing"}
        </button>
      )}

      {error && <p style={{ color: V3.down, fontSize: V3_TEXT.base, margin: 0 }}>{error}</p>}
    </div>
  );
}
