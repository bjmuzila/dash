"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Client buttons for the pricing page. Subscribe → POST /api/stripe/checkout with
// the chosen { plan } and redirect to the returned Stripe Checkout URL.
// Manage billing → POST /api/stripe/portal. Both routes return { url }.
//
// monthlyLabel / yearlyLabel let the page show real prices (e.g. "$120 / mo").
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

  const btn: React.CSSProperties = {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  };
  const busy = loading !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {hasAccess ? (
        <button
          style={{ ...btn, background: "#22D3A6", color: "#04130E" }}
          onClick={() => router.push("/home")}
        >
          Go to dashboard
        </button>
      ) : (
        <>
          <button
            style={{ ...btn, background: "#22D3A6", color: "#04130E", opacity: busy ? 0.6 : 1 }}
            disabled={busy}
            onClick={() => checkout("monthly")}
          >
            {loading === "monthly" ? "Redirecting…" : monthlyLabel}
          </button>
          <button
            style={{
              ...btn,
              background: "transparent",
              color: "#22D3A6",
              border: "1px solid #22D3A6",
              opacity: busy ? 0.6 : 1,
            }}
            disabled={busy}
            onClick={() => checkout("yearly")}
          >
            {loading === "yearly" ? "Redirecting…" : yearlyLabel}
          </button>
        </>
      )}

      {hasBilling && (
        <button
          style={{ ...btn, background: "transparent", color: "#8B95A7", border: "1px solid #1C2230", fontWeight: 600, opacity: busy ? 0.6 : 1 }}
          disabled={busy}
          onClick={portal}
        >
          {loading === "portal" ? "Opening…" : "Manage billing"}
        </button>
      )}

      {error && <p style={{ color: "#F87171", fontSize: 13, margin: 0 }}>{error}</p>}
    </div>
  );
}
