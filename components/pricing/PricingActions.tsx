"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Client buttons for the pricing page. Subscribe → POST /api/stripe/checkout and
// redirect to the returned Stripe Checkout URL. Manage billing → POST
// /api/stripe/portal. Both routes return { url }.
export default function PricingActions({
  hasAccess,
  hasBilling,
}: {
  hasAccess: boolean;
  hasBilling: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(path: string, kind: "checkout" | "portal") {
    setError(null);
    setLoading(kind);
    try {
      const res = await fetch(path, { method: "POST" });
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

  const btn: React.CSSProperties = {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  };

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
        <button
          style={{ ...btn, background: "#22D3A6", color: "#04130E", opacity: loading ? 0.6 : 1 }}
          disabled={loading !== null}
          onClick={() => go("/api/stripe/checkout", "checkout")}
        >
          {loading === "checkout" ? "Redirecting…" : "Subscribe"}
        </button>
      )}

      {hasBilling && (
        <button
          style={{ ...btn, background: "transparent", color: "#8B95A7", border: "1px solid #1C2230", opacity: loading ? 0.6 : 1 }}
          disabled={loading !== null}
          onClick={() => go("/api/stripe/portal", "portal")}
        >
          {loading === "portal" ? "Opening…" : "Manage billing"}
        </button>
      )}

      {error && <p style={{ color: "#F87171", fontSize: 13, margin: 0 }}>{error}</p>}
    </div>
  );
}
