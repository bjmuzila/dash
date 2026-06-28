"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

export const dynamic = "force-dynamic";

type State = "idle" | "working" | "done" | "error";

function UnsubscribeInner() {
  const params = useSearchParams();
  const email = params.get("e") || "";
  const token = params.get("t") || "";

  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    setState("working");
    setMsg("");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setState("error");
        setMsg(data?.error || "Could not unsubscribe. The link may be invalid.");
        return;
      }
      setState("done");
      setMsg(data.message || "You've been unsubscribed.");
    } catch {
      setState("error");
      setMsg("Network error. Please try again.");
    }
  }

  const invalidLink = !email || !token;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        backgroundImage: T.shellGlow,
        color: T.text,
        fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          borderRadius: 16,
          border: `1px solid ${T.border}`,
          borderTop: `2px solid rgba(33,158,188,0.55)`,
          background: `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.08) 0%, transparent 60%), rgba(13,17,25,0.6)`,
          padding: "30px 28px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, color: T.cyan }}>CB Edge</div>

        {state === "done" ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: "18px 0 8px" }}>You're unsubscribed</h1>
            <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.5, margin: 0 }}>{msg}</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: "18px 0 8px" }}>Unsubscribe</h1>
            <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.5, margin: "0 0 20px" }}>
              {invalidLink
                ? "This unsubscribe link is missing information. Please use the link from your email."
                : <>Stop launch-update emails to <strong style={{ color: T.text }}>{email}</strong>?</>}
            </p>

            {!invalidLink && (
              <button
                onClick={run}
                disabled={state === "working"}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: state === "working" ? "rgba(255,255,255,0.08)" : `linear-gradient(180deg, ${T.cyan}, #00b8c4)`,
                  color: state === "working" ? "rgba(255,255,255,0.6)" : "#04121a",
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: state === "working" ? "default" : "pointer",
                }}
              >
                {state === "working" ? "Working…" : "Confirm unsubscribe"}
              </button>
            )}

            {state === "error" && (
              <p style={{ color: T.red, fontSize: 13, marginTop: 14, marginBottom: 0 }}>{msg}</p>
            )}
          </>
        )}

        <div style={{ marginTop: 22, fontSize: 12.5 }}>
          <Link href="/" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>
            ← Back to cbedge.net
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  );
}
