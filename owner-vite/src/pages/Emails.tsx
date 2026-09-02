import { useEffect, useState } from "react";
import { useRefreshButton } from "../hooks/useRefreshButton";
import { OWNER_THEME as HOME_THEME, homeInputStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { DockButton, type SegOption } from "../components/DockToolbar";

type Audience = "all" | "subscribers" | "not_paying" | "waitlist" | "old_emails" | "old_emails2" | "custom";

// Order matches the requested send priority: All users now includes every
// address on file (signed-up + waitlist + both legacy lists, deduped), with
// the legacy lists sent LAST within that combined send. The standalone
// old_emails / old_emails2 options below stay available for a targeted send
// to just the legacy addresses.
const AUDIENCE_OPTIONS: SegOption[] = [
  { value: "all", label: "👥 All users" },
  { value: "subscribers", label: "💳 Subscribers" },
  { value: "not_paying", label: "🚫 Not paying" },
  { value: "waitlist", label: "📋 Waitlist" },
  { value: "old_emails", label: "📇 Old emails" },
  { value: "old_emails2", label: "📇 Old emails 2" },
  { value: "custom", label: "✏️ Custom" },
];

// Audiences are MULTI-SELECT: tick Subscribers + Waitlist + Old emails and the
// send goes to the union. "All users" and "Custom" are each a whole answer on
// their own — All is already the superset, Custom is a hand-typed list — so
// picking either clears the rest, and picking anything else clears them.
const EXCLUSIVE: Audience[] = ["all", "custom"];

// The order the union is built in, mirroring AUDIENCE_PRIORITY in
// app/api/admin/send-email/route.ts. Live accounts first, legacy CSVs last:
// someone on two lists is kept under the more current one. The two must stay
// identical or the count shown here won't match what the server sends.
const UNION_ORDER: Audience[] = ["subscribers", "not_paying", "waitlist", "old_emails", "old_emails2"];

/** Drop repeats from a selection while keeping UNION_ORDER-independent order. */
function dedupeAudiences(list: Audience[]): Audience[] {
  return Array.from(new Set(list));
}

/** Case-insensitive de-dupe keeping first spelling + first-seen order. */
function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = (raw ?? "").trim();
    const key = email.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * Preview-only mirror of campaignSlug() in lib/emails/utm.ts. The SERVER slug is
 * the one that ships — this exists so the composer can show what the link will
 * say before you press send, and the two must be kept identical.
 */
function slugPreview(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

interface Counts { all: number; subscribers: number; notPaying: number; waitlist: number; oldEmails: number; oldEmails2: number }
interface Lists { all: string[]; subscribers: string[]; notPaying: string[]; waitlist: string[]; oldEmails: string[]; oldEmails2: string[] }
interface SendRecord {
  id: number;
  subject: string;
  audience: string;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

export default function Emails() {
  const [audiences, setAudiences] = useState<Audience[]>(["subscribers"]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Campaign tagging. `campaign` blank = the server slugs the subject line, so
  // a send is never untagged; typing here overrides it. See lib/emails/utm.ts.
  const [utmSource, setUtmSource] = useState<"email" | "newsletter">("email");
  const [campaign, setCampaign] = useState("");

  const [counts, setCounts] = useState<Counts | null>(null);
  const [lists, setLists] = useState<Lists | null>(null);
  const [showList, setShowList] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [from, setFrom] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [sending, setSending] = useState(false);
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);
  const [presets, setPresets] = useState<Array<{ id: string; label: string }>>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SendRecord[]>([]);

  async function loadHistory(throwOnError = false) {
    try {
      const res = await fetch("/api/admin/send-email?history=1");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHistory(j.history ?? []);
    } catch (e) { if (throwOnError) throw e; /* else history is optional */ }
  }

  const { trigger: historyRefresh, label: historyRefreshLabel, style: historyRefreshStyle } =
    useRefreshButton(() => loadHistory(true));

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
      // The template id is a better campaign name than its subject line —
      // stable across re-sends and already the name you call it by.
      setCampaign(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Template load failed");
    } finally {
      setLoadingPreset(null);
    }
  }

  // Preselect the audience from ?audience= (e.g. the admin page's "Email these →"
  // deep-links to ?audience=not_paying).
  // Accepts a comma-separated list (?audience=subscribers,waitlist) as well as
  // a single value, so a deep-link can preselect a multi-audience send.
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("audience");
    if (!a) return;
    const VALID: string[] = ["all", "subscribers", "not_paying", "waitlist", "old_emails", "old_emails2", "custom"];
    const wanted = a.split(",").map((s) => s.trim()).filter((s) => VALID.includes(s)) as Audience[];
    if (!wanted.length) return;
    const exclusive = wanted.find((w) => EXCLUSIVE.includes(w));
    setAudiences(exclusive ? [exclusive] : dedupeAudiences(wanted));
  }, []);

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
      if (alive) loadHistory();
    })();
    return () => { alive = false; };
  }, []);

  const isCustom = audiences.includes("custom");

  // Tick / untick an audience. The two exclusive ones replace the selection;
  // everything else toggles within the multi-select group. The selection can
  // never go empty — unticking the last one is a no-op rather than a send to
  // nobody.
  function toggleAudience(v: Audience) {
    setAudiences((prev) => {
      if (EXCLUSIVE.includes(v)) return [v];
      const base = prev.filter((a) => !EXCLUSIVE.includes(a));
      if (base.includes(v)) return base.length > 1 ? base.filter((a) => a !== v) : base;
      return [...base, v];
    });
  }

  // Resolve the email array for ONE audience.
  function listFor(a: Audience): string[] {
    if (!lists) return [];
    return a === "all" ? lists.all
      : a === "waitlist" ? lists.waitlist
      : a === "not_paying" ? lists.notPaying
      : a === "old_emails" ? lists.oldEmails
      : a === "old_emails2" ? lists.oldEmails2
      : lists.subscribers;
  }

  // The actual send list: every selected audience concatenated in UNION_ORDER,
  // then deduped — so an address on Subscribers AND Old emails 2 appears once.
  const unionList: string[] = (() => {
    if (!lists || isCustom) return [];
    if (audiences.includes("all")) return lists.all;
    const merged: string[] = [];
    for (const a of UNION_ORDER) if (audiences.includes(a)) merged.push(...listFor(a));
    return dedupeEmails(merged);
  })();

  // Sum of the selected lists BEFORE de-duping — the gap between this and
  // unionList.length is how many double-sends the merge just prevented.
  const rawCount = isCustom || audiences.includes("all")
    ? 0
    : UNION_ORDER.reduce((n, a) => (audiences.includes(a) ? n + listFor(a).length : n), 0);

  const recipientCount = isCustom
    ? dedupeEmails(customTo.split(/[\s,;]+/).filter(Boolean)).length
    : unionList.length;

  const duplicatesRemoved = Math.max(0, rawCount - unionList.length);

  // Copy the resolved union into the editable Custom box so specific recipients
  // can be removed before sending. The send then goes only to what's left.
  function editList() {
    if (unionList.length === 0) return;
    setCustomTo(unionList.join(", "));
    setAudiences(["custom"]);
    setShowList(false);
  }

  async function send() {
    const subj = subject.trim();
    const html = body.trim();
    if (!subj) { setError("Subject is required."); return; }
    if (!html) { setError("Message body is required."); return; }
    if (isCustom && recipientCount === 0) {
      setError("Add at least one recipient email."); return;
    }

    setSending(true);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        subject: subj, html,
        // `audiences` is the field the server reads; `audience` is sent too so
        // nothing downstream that still expects a scalar breaks.
        audiences,
        audience: audiences.join("+"),
        utmSource,
        // Blank is meaningful: the server falls back to a slug of the subject.
        utmCampaign: campaign.trim(),
      };
      if (isCustom) {
        payload.to = dedupeEmails(customTo.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean));
      }
      const res = await fetch("/api/admin/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Send failed (${res.status})`);
      const failNote = j.failedCount ? ` (${j.failedCount} failed)` : "";
      const failDetail = Array.isArray(j.failed) && j.failed.length
        ? " — " + j.failed.slice(0, 3).map((f: { error?: string }) => f.error || "unknown error").join("; ")
        : "";
      const camp = j.campaign ? ` · tagged ${j.campaign}` : "";
      const dupeNote = j.duplicateCount ? ` · ${j.duplicateCount} duplicate${j.duplicateCount === 1 ? "" : "s"} merged` : "";
      setResult(`Sent to ${j.sentCount} recipient${j.sentCount === 1 ? "" : "s"}${failNote}${dupeNote}${camp}.${failDetail}`);
      setSubject("");
      setBody("");
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  const label = (t: string) => (
    <div style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: HOME_THEME.green, marginBottom: 8 }}>
      {t}
    </div>
  );

  return (
    <PageShell maxWidth={680} align="center">
      <Card accent="cyan">
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="https://cbedge.net/cb-edge-logo.png" alt="CB Edge" style={{ height: 22, width: "auto", display: "block" }} />
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.02em" }}>📧 Email Broadcast</div>
          </div>
          <div style={{ fontSize: 14, color: HOME_THEME.green, marginTop: 4 }}>
            Send an announcement to your users. Recipients are hidden via BCC.
          </div>
        </div>

        {configured === false && (
          <div style={{ fontSize: 14, color: HOME_THEME.red, fontWeight: 600, marginBottom: 16,
                        padding: "10px 12px", borderRadius: 10, border: `1px solid ${HOME_THEME.red}55`,
                        background: `${HOME_THEME.red}14` }}>
            RESEND_API_KEY is not set on the server. Add it to .env.local and the VPS Docker env before sending.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {presets.length > 0 && (
            <div>
              {label("Templates")}
              <div style={{ fontSize: 14, color: HOME_THEME.muted, opacity: 0.7, marginTop: -4, marginBottom: 8 }}>
                Newest first · click a template to load it into the composer below.
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  maxHeight: 280,
                  overflowY: "auto",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${HOME_THEME.border}`,
                  background: "rgba(0,0,0,0.25)",
                }}
              >
                {presets.map((p) => {
                  const active = loadingPreset === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => loadPreset(p.id)}
                      style={{
                        textAlign: "left",
                        cursor: active ? "default" : "pointer",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.08)"}`,
                        background: active ? "rgba(33,158,188,0.10)" : "rgba(255,255,255,0.03)",
                        color: HOME_THEME.text,
                        fontSize: 14,
                        opacity: active ? 0.7 : 1,
                      }}
                    >
                      {active ? "Loading…" : `📨 ${p.label}`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            {label("Audience")}
            <div style={{ fontSize: 14, color: HOME_THEME.muted, opacity: 0.7, marginTop: -4, marginBottom: 8 }}>
              Tick as many as you like — anyone on two lists is sent one email, not two.
              “All users” and “Custom” each replace the selection.
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                width: "100%",
                maxHeight: 180,
                overflowY: "auto",
                padding: 8,
                background: "rgba(0,0,0,0.22)",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.04)",
                boxSizing: "border-box",
              }}
            >
              {AUDIENCE_OPTIONS.map((o) => {
                const value = o.value as Audience;
                const on = audiences.includes(value);
                const size = value === "all" ? counts?.all
                  : value === "subscribers" ? counts?.subscribers
                  : value === "not_paying" ? counts?.notPaying
                  : value === "waitlist" ? counts?.waitlist
                  : value === "old_emails" ? counts?.oldEmails
                  : value === "old_emails2" ? counts?.oldEmails2
                  : undefined;
                return (
                  <button
                    key={o.value}
                    onClick={() => toggleAudience(value)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      textAlign: "left",
                      padding: "8px 12px",
                      borderRadius: 9,
                      fontSize: 14,
                      fontWeight: on ? 700 : 500,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      color: on ? "#FFFFFF" : HOME_THEME.muted,
                      background: on ? HOME_THEME.cyan : "rgba(255,255,255,0.04)",
                      border: `1px solid ${on ? HOME_THEME.cyan : "rgba(255,255,255,0.08)"}`,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 16,
                        height: 16,
                        flex: "0 0 16px",
                        borderRadius: EXCLUSIVE.includes(value) ? 999 : 5,
                        border: `1px solid ${on ? "#FFFFFF" : "rgba(255,255,255,0.28)"}`,
                        background: on ? "#FFFFFF" : "transparent",
                        color: HOME_THEME.cyan,
                        fontSize: 11,
                        fontWeight: 900,
                        lineHeight: "14px",
                        textAlign: "center",
                      }}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span style={{ flex: 1 }}>{o.label}</span>
                    {size != null && (
                      <span style={{ fontSize: 12, fontWeight: 600, opacity: on ? 0.85 : 0.55 }}>{size}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 14, color: HOME_THEME.muted, marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>
                {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
                {duplicatesRemoved > 0 && (
                  <span style={{ color: HOME_THEME.green }}>
                    {" "}· {duplicatesRemoved} duplicate{duplicatesRemoved === 1 ? "" : "s"} merged
                  </span>
                )}
                {from ? ` · from ${from}` : ""}
              </span>
              {!isCustom && lists && recipientCount > 0 && (
                <>
                  <button
                    onClick={() => setShowList((s) => !s)}
                    style={{ background: "none", border: "none", color: HOME_THEME.cyan, fontSize: 14, cursor: "pointer", padding: 0, textDecoration: "underline" }}
                  >
                    {showList ? "Hide list" : "View list"}
                  </button>
                  <button
                    onClick={editList}
                    style={{ background: "none", border: "none", color: HOME_THEME.cyan, fontSize: 14, cursor: "pointer", padding: 0, textDecoration: "underline" }}
                  >
                    Edit list
                  </button>
                </>
              )}
            </div>

            {showList && !isCustom && lists && (
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", padding: "10px 12px", borderRadius: 10, border: `1px solid ${HOME_THEME.border}`, background: "rgba(0,0,0,0.25)" }}>
                {unionList.map((email) => (
                  <div key={email} style={{ fontSize: 14, color: HOME_THEME.green, lineHeight: 1.7, fontFamily: "var(--font-mono)" }}>
                    {email}
                  </div>
                ))}
              </div>
            )}
          </div>

          {isCustom && (
            <div>
              {label("Recipients")}
              <div style={{ fontSize: 14, color: HOME_THEME.muted, opacity: 0.75, marginBottom: 6 }}>
                Delete any address to remove them from this send. Separate with commas, spaces, or new lines.
              </div>
              <textarea
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                placeholder="email@example.com, another@example.com"
                rows={6}
                style={{ ...homeInputStyle, fontSize: 14, width: "100%", resize: "vertical", fontFamily: "inherit" }}
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
              style={{ ...homeInputStyle, fontSize: 14, width: "100%", fontFamily: "inherit" }}
            />
          </div>

          {/* Campaign — what the clicks report as on the owner Acquisition
              panel. Every cbedge.net link in the body is tagged at send time
              (lib/emails/utm.ts); the unsubscribe link never is. */}
          <div>
            {label("Campaign")}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {(["email", "newsletter"] as const).map((s) => {
                const on = s === utmSource;
                return (
                  <button
                    key={s}
                    onClick={() => setUtmSource(s)}
                    title={s === "newsletter"
                      ? "Reports as utm_source=newsletter — keeps the letter separate from one-off blasts."
                      : "Reports as utm_source=email — one-off broadcasts."}
                    style={{
                      padding: "6px 14px", fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: "pointer",
                      color: on ? HOME_THEME.cyan : HOME_THEME.text,
                      background: on ? `${HOME_THEME.cyan}22` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${on ? `${HOME_THEME.cyan}55` : HOME_THEME.border}`,
                    }}
                  >
                    {s === "email" ? "Broadcast" : "Newsletter"}
                  </button>
                );
              })}
              <input
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder="campaign name (blank = from subject)"
                maxLength={60}
                style={{ ...homeInputStyle, fontSize: 14, flex: 1, minWidth: 200, fontFamily: "inherit" }}
              />
            </div>
            <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.5, marginTop: 6, fontFamily: "monospace", wordBreak: "break-all" }}>
              ?utm_source={utmSource}&amp;utm_medium=email&amp;utm_campaign=
              {slugPreview(campaign.trim() || subject) || "broadcast"}
            </div>
          </div>

          <div>
            {label("Message (HTML allowed)")}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="<p>Hello…</p>"
              rows={10}
              maxLength={50000}
              style={{ ...homeInputStyle, fontSize: 14, width: "100%", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
            />
            {body.trim() && (
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() => setShowPreview((s) => !s)}
                  style={{ background: "none", border: "none", color: HOME_THEME.cyan, fontSize: 14, cursor: "pointer", padding: 0, textDecoration: "underline" }}
                >
                  {showPreview ? "Hide preview" : "Show rendered preview"}
                </button>
                {showPreview && (
                  <iframe
                    title="Email preview"
                    srcDoc={body}
                    sandbox=""
                    style={{ width: "100%", height: 600, marginTop: 8, border: `1px solid ${HOME_THEME.border}`, borderRadius: 10, background: "#05060A" }}
                  />
                )}
              </div>
            )}
          </div>

          {error && <div style={{ fontSize: 14, color: HOME_THEME.red, fontWeight: 600 }}>{error}</div>}
          {result && <div style={{ fontSize: 14, color: HOME_THEME.green, fontWeight: 600 }}>✅ {result}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <DockButton
              onClick={send}
              style={{
                height: 38,
                padding: "0 22px",
                fontSize: 14,
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

      <Card accent="cyan" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.02em" }}>📜 Sent history</div>
          <button
            onClick={historyRefresh}
            style={{ background: "none", border: "none", color: (historyRefreshStyle.color as string) ?? HOME_THEME.cyan, fontSize: 14, cursor: "pointer", textDecoration: "underline", padding: 0 }}
          >
            {historyRefreshLabel}
          </button>
        </div>

        {history.length === 0 ? (
          <div style={{ fontSize: 14, color: HOME_THEME.muted, opacity: 0.6 }}>No emails sent yet.</div>
        ) : (
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {history.map((h) => (
              <div
                key={h.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: `1px solid ${HOME_THEME.border}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {h.subject}
                  </div>
                  <div style={{ fontSize: 14, color: HOME_THEME.green, marginTop: 2 }}>
                    {new Date(h.created_at).toLocaleString()} · {h.audience}
                  </div>
                </div>
                <div style={{ fontSize: 14, whiteSpace: "nowrap", textAlign: "right" }}>
                  <span style={{ color: HOME_THEME.cyan, fontWeight: 700 }}>{h.sent_count} sent</span>
                  {h.failed_count > 0 && (
                    <span style={{ color: HOME_THEME.red, marginLeft: 8 }}>{h.failed_count} failed</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ textAlign: "center", padding: "18px 0 4px", fontSize: 14, color: HOME_THEME.muted, opacity: 0.6 }}>
        CB Edge · <a href="https://cbedge.net" target="_blank" rel="noreferrer" style={{ color: HOME_THEME.muted }}>cbedge.net</a>
      </div>
    </PageShell>
  );
}
