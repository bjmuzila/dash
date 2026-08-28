"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell, Card } from "@/components/shared/PageCard";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { useAuth } from "@/components/auth/AuthProvider";

type Entry = { date: string; items: string[] };
type Hidden = { date: string; item: string; hiddenAt: string };

// The changelog is written in markdown and bullets routinely use **bold** to
// call out a feature name. Nothing was interpreting it, so the site literally
// printed the asterisks ("Added a new **GEX Map**"). Handle the one construct
// the changelog actually uses; everything else stays plain text.
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} style={{ fontWeight: 700, color: HOME_THEME.text }}>
        {part.slice(2, -2)}
      </strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

export default function WhatsNewClient({
  entries,
  hidden = [],
}: {
  entries: Entry[];
  hidden?: Hidden[];
}) {
  const router = useRouter();
  const [localEntries, setLocalEntries] = useState(entries);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  // Re-sync when the server sends fresh data (e.g. after router.refresh()
  // following a restore) - without this, useState would pin the first render's
  // list forever and a restored bullet would never come back on screen.
  useEffect(() => {
    setLocalEntries(entries);
  }, [entries]);

  // Same owner check as components/shared/NavMenu.tsx: compare the signed-in
  // user's id against the build-time-baked owner id. UI-only - the actual
  // hide/restore is re-checked server-side in app/api/whats-new/route.ts.
  const { user } = useAuth();
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  const isOwner = !!ownerId && user?.id === ownerId;

  // Hide a bullet. Optimistic, but a failure now restores ONLY this bullet at
  // its original position and says why. The old code reset the whole list from
  // the original props and swallowed the error, which is what made a failed
  // hide look like "I clicked the X and it just came back".
  const hideItem = async (date: string, item: string, index: number) => {
    const key = `${date}|${item}`;
    setError(null);
    setBusy(key);
    setLocalEntries((prev) =>
      prev.map((e) => (e.date === date ? { ...e, items: e.items.filter((it) => it !== item) } : e))
    );
    try {
      const res = await fetch("/api/whats-new", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, item }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `${res.status} ${res.statusText}`);
      }
      router.refresh(); // pick up the new hidden list for the panel below
    } catch (err: any) {
      console.error("[whats-new] hide failed, restoring that item", err);
      setLocalEntries((prev) =>
        prev.map((e) => {
          if (e.date !== date || e.items.includes(item)) return e;
          const items = [...e.items];
          items.splice(Math.min(index, items.length), 0, item);
          return { ...e, items };
        })
      );
      setError(`Couldn't hide that update: ${err?.message || err}`);
    } finally {
      setBusy(null);
    }
  };

  const restoreItem = async (date: string, item: string) => {
    const key = `${date}|${item}`;
    setError(null);
    setBusy(key);
    try {
      const res = await fetch("/api/whats-new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, item }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (err: any) {
      console.error("[whats-new] restore failed", err);
      setError(`Couldn't restore that update: ${err?.message || err}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageShell maxWidth={860}>
      {/* Header row. The Updates/Coming Soon tab group used to sit on the right;
          the Coming Soon list was removed, so there is only one view and no tab
          bar — this page IS the changelog. */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <div style={{
            display: "inline-block",
            fontSize: 12,
            color: LIGHT_BLUE,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            fontWeight: 800,
            marginBottom: 10,
            background: `rgba(126,211,252,0.10)`,
            border: `1px solid rgba(126,211,252,0.30)`,
            borderRadius: 6,
            padding: "3px 10px",
          }}>
            Product Updates
          </div>
          <h1 style={{ fontSize: 38, lineHeight: 1.1, margin: "0 0 8px", fontWeight: 800, letterSpacing: "-0.02em", color: HOME_THEME.text }}>
            What&apos;s New
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: HOME_THEME.muted + "99" }}>
            The latest improvements to the dashboard.
          </p>
        </div>
      </div>

      {/* Error banner - a failed hide used to be completely silent */}
      {error && (
        <div style={{
          margin: "12px 0 4px",
          padding: "10px 14px",
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.5,
          color: HOME_THEME.orange,
          background: "rgba(251,133,1,0.08)",
          border: "1px solid rgba(251,133,1,0.30)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "transparent",
              border: "none",
              color: HOME_THEME.orange,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {localEntries.length === 0 && (
        <div style={{ fontSize: 14, color: HOME_THEME.muted + "99" }}>No updates yet.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {localEntries.map((entry, i) => (
          <Card key={entry.date || i} accent="cyan" padding="20px 24px">
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.04em", color: LIGHT_BLUE, marginBottom: 14 }}>
              {entry.date}
            </div>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              {entry.items.map((item, j) => (
                <li key={j} style={{ fontSize: 14, lineHeight: 1.65, color: HOME_THEME.text, display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: LIGHT_BLUE, marginTop: 3, flexShrink: 0 }}>▸</span>
                  <span style={{ flex: 1 }}>{renderInline(item)}</span>
                  {isOwner && (
                    <button
                      onClick={() => hideItem(entry.date, item, j)}
                      disabled={busy === `${entry.date}|${item}`}
                      title="Hide this update from the public page (owner only, reversible)"
                      style={{
                        flexShrink: 0,
                        width: 18,
                        height: 18,
                        marginTop: 1,
                        borderRadius: 5,
                        border: `1px solid ${HOME_THEME.border}`,
                        background: "transparent",
                        color: HOME_THEME.muted + "cc",
                        cursor: busy === `${entry.date}|${item}` ? "wait" : "pointer",
                        opacity: busy === `${entry.date}|${item}` ? 0.4 : 1,
                        fontSize: 12,
                        lineHeight: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {/* Owner-only: what's currently hidden, with one-click restore. An
          accidental X is now recoverable from the page itself. */}
      {isOwner && hidden.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button
            onClick={() => setShowHidden((v) => !v)}
            style={{
              background: "transparent",
              border: `1px solid ${HOME_THEME.border}`,
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 700,
              color: HOME_THEME.muted + "cc",
              cursor: "pointer",
            }}
          >
            {showHidden ? "Hide" : "Show"} hidden updates ({hidden.length})
          </button>

          {showHidden && (
            <Card accent="cyan" variant="classic" padding="16px 20px" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: HOME_THEME.muted + "99", marginBottom: 12 }}>
                Hidden from the public page. CUSTOMER_CHANGELOG.md still has them - restoring
                puts them straight back.
              </div>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {hidden.map((h, i) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.6, color: HOME_THEME.muted + "cc", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ flexShrink: 0, color: LIGHT_BLUE, fontWeight: 700, minWidth: 120 }}>{h.date}</span>
                    <span style={{ flex: 1 }}>{renderInline(h.item)}</span>
                    <button
                      onClick={() => restoreItem(h.date, h.item)}
                      disabled={busy === `${h.date}|${h.item}`}
                      style={{
                        flexShrink: 0,
                        borderRadius: 6,
                        border: `1px solid ${LIGHT_BLUE}55`,
                        background: "rgba(126,211,252,0.10)",
                        color: LIGHT_BLUE,
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "3px 10px",
                        cursor: busy === `${h.date}|${h.item}` ? "wait" : "pointer",
                      }}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </PageShell>
  );
}
