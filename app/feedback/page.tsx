"use client";

import { useState } from "react";
import { HOME_THEME, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { SegGroup, DockButton, type SegOption } from "@/components/shared/DockToolbar";

type Category = "bug" | "idea" | "note" | "other";

// Category options rendered with the GEX-toolbar segmented control (SegGroup).
const CATEGORY_OPTIONS: SegOption[] = [
  { value: "bug", label: "🐞 Bug" },
  { value: "idea", label: "💡 Idea" },
  { value: "note", label: "📝 Note" },
  { value: "other", label: "💬 Other" },
];

export default function FeedbackPage() {
  const [category, setCategory] = useState<Category>("note");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const msg = message.trim();
    if (!msg) { setError("Please write a message first."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message: msg, page: "/feedback" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed (${res.status})`);
      }
      setDone(true);
      setMessage("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell maxWidth={620} align="center">
        <Card accent="cyan">
          {/* Header — logo + title + blurb, inside the card */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, marginBottom: 24 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/cb-edge-logo.png"
              alt="CB Edge"
              style={{ height: 224, width: "auto", display: "block" }}
            />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.02em" }}>Feedback</div>
              <div style={{ fontSize: 12, color: HOME_THEME.green, marginTop: 4 }}>
                Your feedback shapes CB Edge — every bug you flag, idea you share, or note you leave helps make this platform one of the best out there. It always starts with you, the customer.
              </div>
            </div>
          </div>

          {done ? (
            <div style={{ textAlign: "center", padding: "32px 8px" }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Thanks — got it!</div>
              <div style={{ fontSize: 13, color: HOME_THEME.green, marginBottom: 20 }}>
                Your feedback was sent. We read every note.
              </div>
              <DockButton onClick={() => setDone(false)} style={{ height: 36, padding: "0 18px", fontSize: 12 }}>
                Send another
              </DockButton>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: HOME_THEME.green, marginBottom: 8, textAlign: "center" }}>
                  Type
                </div>
                <div className="seg-pill">
                  <SegGroup
                    options={CATEGORY_OPTIONS}
                    active={category}
                    onChange={(v) => setCategory(v as Category)}
                  />
                </div>
                {/* Round the SegGroup track + tiles into a fuller pill, and give
                    each tile (incl. inactive ones) a visible pill background so
                    they read as distinct buttons, matching the toolbar. */}
                <style>{`
                  .seg-pill > div { border-radius: 999px !important; padding: 5px !important; gap: 6px !important; }
                  /* Resting pill fill for every tile — stronger than SegGroup's
                     near-transparent default (overrides its inline style). */
                  .seg-pill > div > button {
                    border-radius: 999px !important;
                    background: rgba(255,255,255,0.07) !important;
                    border: 1px solid rgba(255,255,255,0.12) !important;
                  }
                  /* Active tile: SegGroup sets a cyan inline border
                     (rgba(33,158,188,...)). Re-assert the cyan gradient + glow so
                     the selected pill still stands out. */
                  .seg-pill > div > button[style*="rgb(33, 158, 188)"] {
                    background: linear-gradient(180deg, rgba(33,158,188,0.20), rgba(33,158,188,0.06)) !important;
                    border: 1px solid rgba(33,158,188,0.45) !important;
                    box-shadow: 0 0 14px rgba(33,158,188,0.25) !important;
                  }
                `}</style>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: HOME_THEME.green, marginBottom: 8 }}>
                  Message
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={7}
                  maxLength={5000}
                  style={{ ...homeInputStyle, width: "100%", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
                />
                <div style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.5, textAlign: "right", marginTop: 4 }}>
                  {message.length}/5000
                </div>
              </div>

              {error && (
                <div style={{ fontSize: 12, color: HOME_THEME.red, fontWeight: 600 }}>{error}</div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <DockButton
                  onClick={submit}
                  style={{
                    height: 38,
                    padding: "0 22px",
                    fontSize: 12,
                    color: HOME_THEME.cyan,
                    border: `1px solid ${HOME_THEME.cyan}59`,
                    background: "linear-gradient(180deg,rgba(33,158,188,.18),rgba(33,158,188,.05))",
                    opacity: submitting ? 0.6 : 1,
                    cursor: submitting ? "default" : "pointer",
                  }}
                >
                  {submitting ? "Sending…" : "Send feedback"}
                </DockButton>
              </div>
            </div>
          )}
        </Card>
    </PageShell>
  );
}
