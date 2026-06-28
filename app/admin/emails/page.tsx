"use client";

import { useEffect, useState } from "react";
import { HOME_THEME, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { SegGroup, DockButton, type SegOption } from "@/components/shared/DockToolbar";

type Audience = "all" | "subscribers" | "custom";

const AUDIENCE_OPTIONS: SegOption[] = [
  { value: "all", label: "👥 All users" },
  { value: "subscribers", label: "💳 Subscribers" },
  { value: "custom", label: "✏️ Custom" },
];

interface Counts { all: number; subscribers: number }
interface Lists { all: string[]; subscribers: string[] }

export default function AdminEmailsPage() {
  const [audience, setAudience] = useState<Audience>("subscribers");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [counts, setCounts] = useState<Counts | null>(null);
  const [lists, setLists] = useState<Lists | null>(null);
  const [showList, setShowList] = useState(false);
  const [from, setFrom] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [sending, setSending] = useState(false);
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);
  const [presets, setPresets] = useState<Array<{ id: string; label: string }>>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load a server-rendered template into the composer.
  async function loadPreset(id: string) {
    setLoadingPreset(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/email-templates?id=${encodeURIComponent(id)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to load template (${res.status})`);
      setSubject(j.template?.subject ?? "");
      setBody(j.template?.html ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Template load failed");
    } finally {
      setLoadingPreset(null);
    }
  }

  // Load recipient counts + Resend config status on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/send-email");
        if (!res.ok) throw new Error(`Failed to load recipients (${res.status})`);
        const j = await res.json();
        if (!alive) return;
        setCounts(j.counts ?? null);
        setLists(j.recipients ?? null);
        setFrom(j.from ?? "");
        setConfigured(!!j.configured);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Load failed");
      }
      try {
        const tr = await fetch("/api/admin/email-templates");
        const tj = await tr.json().catch(() => ({}));
        if (alive && tr.ok) setPresets(tj.templates ?? []);
      } catch { /* presets are optional */ }
    })();
    return () => { alive = false; };
  }, []);

  const recipientCount =
    audience === "all" ? counts?.all ?? 0
    : audience === "subscribers" ? counts?.subscribers ?? 0
    : customTo.split(/[\s,;]+/).filter(Boolean).length;

  async function send() {
    const subj = subject.trim();
    const html = body.trim();
    if (!subj) { setError("Subject is required."); return; }
    if (!html) { setError("Message body is required."); return; }
    if (audience === "custom" && recipientCount === 0) {
      setError("Add at least one recipient email."); return;
    }

    setSending(true);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> = { subject: subj, html, audience };
      if (audience === "custom") {
        payload.to = customTo.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
      }
      const res = await fetch("/api/admin/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Send failed (${res.status})`);
      const failNote = j.failedCount ? ` (${j.failedCount} failed)` : "";
      setResult(`Sent to ${j.sentCount} recipient${j.sentCount === 1 ? "" : "s"}${failNote}.`);
      setSubject("");
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  const label = (t: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: HOME_THEME.green, marginBottom: 8 }}>
      {t}
    </div>
  );

  return (
    <PageShell maxWidth={680} align="center">
      <Card accent="cyan">
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.02em" }}>📧 Email Broadcast</div>
          <div style={{ fontSize: 12, color: HOME_THEME.green, marginTop: 4 }}>
            Send an announcement to your users. Recipients are hidden via BCC.
          </div>
        </div>

        {configured === false && (
          <div style={{ fontSize: 12, color: HOME_THEME.red, fontWeight: 600, marginBottom: 16,
                        padding: "10px 12px", borderRadius: 10, border: `1px solid ${HOME_THEME.red}55`,
                        background: `${HOME_THEME.red}14` }}>
            RESEND_API_KEY is not set on the server. Add it to .env.local and the VPS Docker env before sending.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {presets.length > 0 && (
            <div>
              {label("Templates")}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {presets.map((p) => (
                  <DockButton
                    key={p.id}
                    onClick={() => loadPreset(p.id)}
                    style={{ height: 32, padding: "0 14px", fontSize: 11, opacity: loadingPreset === p.id ? 0.6 : 1 }}
                  >
                    {loadingPreset === p.id ? "Loading…" : `📨 ${p.label}`}
                  </DockButton>
                ))}
              </div>
            </div>
          )}

          <div>
            {label("Audience")}
            <SegGroup
              options={AUDIENCE_OPTIONS}
              active={audience}
              onChange={(v) => setAudience(v as Audience)}
            />
            <div style={{ fontSize: 11, color: HOME_THEME.muted, marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span>
                {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
                {from ? ` · from ${from}` : ""}
              </span>
              {audience !== "custom" && lists && recipientCount > 0 && (
                <button
                  onClick={() => setShowList((s) => !s)}
                  style={{ background: "none", border: "none", color: HOME_THEME.cyan, fontSize: 11, cursor: "pointer", padding: 0, textDecoration: "underline" }}
                >
                  {showList ? "Hide list" : "View list"}
                </button>
              )}
            </div>

            {showList && audience !== "custom" && lists && (
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", padding: "10px 12px", borderRadius: 10, border: `1px solid ${HOME_THEME.border}`, background: "rgba(0,0,0,0.25)" }}>
                {(audience === "all" ? lists.all : lists.subscribers).map((email) => (
                  <div key={email} style={{ fontSize: 12, color: HOME_THEME.green, lineHeight: 1.7, fontFamily: "monospace" }}>
                    {email}
                  </div>
                ))}
              </div>
            )}
          </div>

          {audience === "custom" && (
            <div>
              {label("Recipients")}
              <textarea
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                placeholder="email@example.com, another@example.com"
                rows={3}
                style={{ ...homeInputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }}
              />
            </div>
          )}

          <div>
            {label("Subject")}
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line"
              maxLength={200}
              style={{ ...homeInputStyle, width: "100%", fontFamily: "inherit" }}
            />
          </div>

          <div>
            {label("Message (HTML allowed)")}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="<p>Hello…</p>"
              rows={10}
              maxLength={50000}
              style={{ ...homeInputStyle, width: "100%", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
            />
          </div>

          {error && <div style={{ fontSize: 12, color: HOME_THEME.red, fontWeight: 600 }}>{error}</div>}
          {result && <div style={{ fontSize: 12, color: HOME_THEME.green, fontWeight: 600 }}>✅ {result}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <DockButton
              onClick={send}
              style={{
                height: 38,
                padding: "0 22px",
                fontSize: 12,
                color: HOME_THEME.cyan,
                border: `1px solid ${HOME_THEME.cyan}59`,
                background: "linear-gradient(180deg,rgba(33,158,188,.18),rgba(33,158,188,.05))",
                opacity: sending ? 0.6 : 1,
                cursor: sending ? "default" : "pointer",
              }}
            >
              {sending ? "Sending…" : `Send to ${recipientCount}`}
            </DockButton>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
