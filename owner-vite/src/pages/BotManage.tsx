import { useEffect, useState, type CSSProperties } from "react";
import { Card } from "../components/PageCard";
import { OWNER_THEME, rgba, homeInputStyle } from "../lib/theme";

/* ────────────────────────────────────────────────────────────────────────────
 * BOT · Manage — the Discord routing table, edited from the browser.
 *
 * THE MODEL, because the UI only makes sense once it is stated: a DISCORD is a
 * destination the composer offers. Inside it, each ASSET CLASS maps to its own
 * webhook, falling back to `Default`. That is the whole reason this page is not
 * a flat list of webhook URLs — one server takes everything in a single channel,
 * another (Bzila's) splits options / futures / notes / equity four ways, and
 * both have to be expressible without a code change.
 *
 * Fill in `Default` only  → everything lands in one channel.
 * Fill in the four        → each class goes to its own channel.
 * Fill in both            → the specific one wins, Default catches the rest.
 *
 * SECRETS ARE ONE-WAY. The server sends a MASK (webhook id + last four token
 * characters) and never the URL, so this page cannot leak a credential it does
 * not have. Leaving the URL box empty on save means "keep what is stored" —
 * that is what lets a label or a ping be edited without retyping a webhook.
 * ════════════════════════════════════════════════════════════════════════════ */

const CYAN = OWNER_THEME.cyan;
const GREEN = OWNER_THEME.green;

const ROUTE_ROWS = [
  { key: "default", label: "Default", hint: "catches every class with no channel of its own" },
  { key: "options", label: "Options", hint: "" },
  { key: "futures", label: "Futures", hint: "" },
  { key: "notes", label: "Notes", hint: "" },
  { key: "equity", label: "Equity", hint: "" },
] as const;

type RouteKey = (typeof ROUTE_ROWS)[number]["key"];
type RouteView = { masked: string; ping: string };
type DiscordRow = {
  id: string;
  label: string;
  enabled: boolean;
  sortIdx: number;
  /** Per-message identity override. Blank = use the webhook's own name/avatar. */
  username: string;
  avatarUrl: string;
  routes: Partial<Record<RouteKey, RouteView>>;
};

/** Local edits, keyed by discord id. Only what the user actually touched. */
type Draft = {
  label: string;
  enabled: boolean;
  username: string;
  avatarUrl: string;
  urls: Partial<Record<RouteKey, string>>;
  pings: Partial<Record<RouteKey, string>>;
  clear: Partial<Record<RouteKey, boolean>>;
};

/**
 * Discord resolves mentions by ID, never by name — "@Bzila Analysis" typed here
 * posts inert text and pings nobody. The server rejects an unusable ping on
 * save; this mirrors the same rule so the field says so while it is being
 * typed, which is where the mistake actually happens.
 */
function pingKind(v: string): "role" | "user" | "everyone" | null {
  const t = v.trim();
  if (/^<@&\d{15,25}>$/.test(t)) return "role";
  if (/^<@!?\d{15,25}>$/.test(t)) return "user";
  if (/^@(everyone|here)$/.test(t)) return "everyone";
  if (/^\d{15,25}$/.test(t)) return "role"; // bare id — the server wraps it as a role
  return null;
}

function pingProblem(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/^<@&\d{15,25}>$/.test(t) || /^<@!?\d{15,25}>$/.test(t)) return null;
  if (/^@(everyone|here)$/.test(t)) return null;
  if (/^\d{15,25}$/.test(t)) return null; // bare id — server wraps it as a role
  return "Discord needs the role ID, not the name — right-click the role → Copy Role ID, then use <@&ID>";
}

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: OWNER_THEME.text,
};

function btn(accent: string, disabled = false): CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    border: `1px solid ${rgba(accent, disabled ? 0.15 : 0.45)}`,
    background: disabled ? "rgba(255,255,255,0.03)" : `linear-gradient(180deg, ${rgba(accent, 0.24)}, ${rgba(accent, 0.06)})`,
    color: disabled ? OWNER_THEME.text : accent,
    opacity: disabled ? 0.6 : 1,
    transition: "all 0.15s",
  };
}

export default function BotManage({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<DiscordRow[]>([]);
  const [live, setLive] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});
  /** Save failures shown IN the card — a top-of-page banner is off-screen when
   *  you are looking at the fourth route row, which is where they get missed. */
  const [cardErr, setCardErr] = useState<Record<string, string>>({});

  function applyPayload(j: { discords?: DiscordRow[]; live?: boolean }) {
    setRows(Array.isArray(j?.discords) ? j.discords : []);
    setLive(j?.live !== false);
    setDrafts({});
    onChanged?.();
  }

  async function load() {
    try {
      const r = await fetch("/api/bot-alert/config", { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `Load failed (${r.status})`);
      applyPayload(j);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftFor = (d: DiscordRow): Draft =>
    drafts[d.id] ?? {
      label: d.label,
      enabled: d.enabled,
      username: d.username ?? "",
      avatarUrl: d.avatarUrl ?? "",
      urls: {},
      pings: {},
      clear: {},
    };

  const patch = (d: DiscordRow, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [d.id]: { ...draftFor(d), ...p } }));

  async function post(body: unknown, tag: string, cardId?: string) {
    setBusy(tag);
    setErr(null);
    try {
      const r = await fetch("/api/bot-alert/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `Failed (${r.status})`);
      applyPayload(j);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      // Server-side rejections land next to the fields too, for the same reason.
      if (cardId) setCardErr((prev) => ({ ...prev, [cardId]: msg }));
      else setErr(msg);
    } finally {
      setBusy(null);
    }
  }

  function save(d: DiscordRow) {
    const dr = draftFor(d);
    // A Discord saves as ONE unit, so a single bad ping row rejects the whole
    // card — including the three rows that were fine. That is how a corrected
    // Notes ping could sit in the box, look saved, and never reach the database
    // while Options still held a role NAME two rows up. The rule itself is
    // right (never store an unusable ping); what was wrong is that the refusal
    // was reported in a banner at the top of the page, nowhere near the field.
    // It now renders inside this card and names every offending row.
    const bad = ROUTE_ROWS
      .map((r) => ({ r, p: pingProblem(dr.pings[r.key] ?? d.routes[r.key]?.ping ?? "") }))
      .filter((x) => x.p);
    if (bad.length) {
      setCardErr((prev) => ({
        ...prev,
        [d.id]: `Nothing was saved — this Discord saves as one unit and ${bad
          .map((x) => x.r.label)
          .join(", ")} ${bad.length > 1 ? "hold role NAMES" : "holds a role NAME"}. Discord needs the ID.`,
      }));
      return;
    }
    setCardErr((prev) => ({ ...prev, [d.id]: "" }));
    // url: "" means KEEP (the client never had the secret); null means DELETE.
    const routes: Record<string, { url?: string | null; ping?: string } | null> = {};
    for (const row of ROUTE_ROWS) {
      const k = row.key;
      const url = dr.urls[k] ?? "";
      const ping = dr.pings[k];
      if (dr.clear[k]) { routes[k] = null; continue; }
      if (url.trim() || ping != null) routes[k] = { url: url.trim(), ping: ping ?? d.routes[k]?.ping ?? "" };
    }
    post(
      {
        action: "save",
        discord: {
          id: d.id,
          label: dr.label,
          enabled: dr.enabled,
          sortIdx: d.sortIdx,
          username: dr.username,
          avatarUrl: dr.avatarUrl,
          routes,
        },
      },
      `save:${d.id}`,
      d.id,
    );
  }

  function addDiscord() {
    const label = window.prompt("Name this Discord (e.g. Bzila Hangout)");
    if (!label?.trim()) return;
    post({ action: "save", discord: { label: label.trim(), enabled: true, sortIdx: rows.length + 1, routes: {} } }, "add");
  }

  function remove(d: DiscordRow) {
    if (!window.confirm(`Delete "${d.label}" and all its routes? The webhooks themselves stay alive in Discord.`)) return;
    post({ action: "delete", id: d.id }, `del:${d.id}`);
  }

  async function test(d: DiscordRow, cls: string, withPing = false) {
    const tag = `${d.id}:${cls}`;
    if (withPing && !window.confirm("This posts a test message that actually tags the role. Everyone in it gets a notification. Continue?")) return;
    setBusy(`test:${tag}`);
    setTestMsg((p) => ({ ...p, [tag]: "" }));
    try {
      const r = await fetch("/api/bot-alert/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: d.id, assetClass: cls === "default" ? "notes" : cls, withPing }),
      });
      const j = await r.json();
      // A 200 with a warning is the @unknown-role case: the post landed, the
      // tag did not. Reporting that as a plain "✓ posted" is what made this
      // take a deploy to notice in the first place.
      const warn = j?.warning || j?.result?.warning;
      setTestMsg((p) => ({
        ...p,
        [tag]: j?.ok ? (warn ? `⚠ ${warn}` : "✓ posted") : `✕ ${j?.result?.error || j?.error || "failed"}`,
      }));
    } catch (e) {
      setTestMsg((p) => ({ ...p, [tag]: `✕ ${String((e as Error)?.message || e)}` }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card variant="classic" padding={0}>
      <div
        style={{
          padding: "20px 24px",
          borderBottom: `1px solid ${OWNER_THEME.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: OWNER_THEME.text }}>Discords &amp; Webhooks</div>
          <div style={{ fontSize: 12, color: OWNER_THEME.text, marginTop: 3 }}>
            One row per server. Fill in <strong>Default</strong> alone to send everything to one channel, or map each
            class to its own.
          </div>
        </div>
        <button type="button" onClick={addDiscord} disabled={busy != null} style={btn(CYAN, busy != null)}>
          ＋ Add Discord
        </button>
      </div>

      {/* Env fallback is a REAL state, not a loading blip: the page works, but an
          edit made here would be overwritten by the env vars on next read. Say so
          rather than letting a save appear to succeed and then vanish. */}
      {loaded && !live && (
        <div
          style={{
            margin: "16px 24px 0",
            padding: "12px 14px",
            borderRadius: 10,
            fontSize: 12,
            border: `1px solid ${rgba(OWNER_THEME.gold, 0.4)}`,
            background: rgba(OWNER_THEME.gold, 0.1),
            color: OWNER_THEME.text,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>
            Reading destinations from <code>DISCORD_WEBHOOK_&lt;n&gt;_*</code> environment variables — nothing is stored
            yet, so edits here will not stick.
          </span>
          <button
            type="button"
            onClick={() => post({ action: "import-env" }, "import")}
            disabled={busy != null}
            style={btn(OWNER_THEME.gold, busy != null)}
          >
            Import them into the database
          </button>
        </div>
      )}

      {err && (
        <div
          style={{
            margin: "16px 24px 0",
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 12,
            border: `1px solid ${rgba(OWNER_THEME.red, 0.4)}`,
            background: rgba(OWNER_THEME.red, 0.1),
            color: OWNER_THEME.text,
          }}
        >
          {err}
        </div>
      )}

      {!loaded ? (
        <div style={{ padding: "56px 24px", textAlign: "center", fontSize: 13, color: OWNER_THEME.text }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "56px 24px", textAlign: "center", fontSize: 13, color: OWNER_THEME.text }}>
          No Discords configured yet. Add one, then paste a webhook URL into a row.
        </div>
      ) : (
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
          {rows.map((d) => {
            const dr = draftFor(d);
            const dirty = drafts[d.id] != null;
            return (
              <div
                key={d.id}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${cardErr[d.id] ? rgba(OWNER_THEME.red, 0.55) : dirty ? rgba(CYAN, 0.4) : OWNER_THEME.border}`,
                  background: OWNER_THEME.panelInset,
                  overflow: "hidden",
                }}
              >
                {/* ── Server header ─────────────────────────────────────── */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    borderBottom: `1px solid ${OWNER_THEME.border}`,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    value={dr.label}
                    onChange={(e) => patch(d, { label: e.target.value })}
                    style={{ ...homeInputStyle, flex: "1 1 220px", fontWeight: 700 }}
                  />
                  <button
                    type="button"
                    onClick={() => patch(d, { enabled: !dr.enabled })}
                    title={dr.enabled ? "Shown in the composer" : "Hidden from the composer"}
                    style={btn(dr.enabled ? GREEN : OWNER_THEME.red)}
                  >
                    {dr.enabled ? "● Enabled" : "○ Disabled"}
                  </button>
                  <button
                    type="button"
                    onClick={() => save(d)}
                    disabled={busy != null || !dirty}
                    style={btn(CYAN, busy != null || !dirty)}
                  >
                    {busy === `save:${d.id}` ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={() => remove(d)} disabled={busy != null} style={btn(OWNER_THEME.red, busy != null)}>
                    Delete
                  </button>
                </div>

                {cardErr[d.id] && (
                  <div
                    style={{
                      padding: "10px 14px",
                      fontSize: 12,
                      fontWeight: 700,
                      borderBottom: `1px solid ${OWNER_THEME.border}`,
                      background: rgba(OWNER_THEME.red, 0.12),
                      color: OWNER_THEME.text,
                    }}
                  >
                    {cardErr[d.id]}
                  </div>
                )}

                {/* ── Identity ──────────────────────────────────────────── */}
                {/* Blank is a real setting: it means "post under the webhook's
                    own name and picture", which is what Discord does when these
                    fields are absent. The preview is the honest check — if the
                    circle stays empty, Discord could not fetch the URL either. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    borderBottom: `1px solid ${OWNER_THEME.border}`,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      flex: "none",
                      overflow: "hidden",
                      border: `1px solid ${OWNER_THEME.border}`,
                      background: "rgba(255,255,255,0.04)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                    }}
                  >
                    {dr.avatarUrl ? (
                      <img
                        src={dr.avatarUrl}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                      />
                    ) : (
                      "🖼︎"
                    )}
                  </span>
                  <input
                    value={dr.username}
                    onChange={(e) => patch(d, { username: e.target.value })}
                    placeholder="Post as… (blank = the webhook's own name)"
                    style={{ ...homeInputStyle, flex: "1 1 200px", fontSize: 12 }}
                  />
                  <input
                    value={dr.avatarUrl}
                    onChange={(e) => patch(d, { avatarUrl: e.target.value })}
                    placeholder="Avatar — public https:// image URL"
                    spellCheck={false}
                    style={{ ...homeInputStyle, flex: "2 1 260px", fontSize: 12 }}
                  />
                  <span style={{ fontSize: 11, color: OWNER_THEME.text, flex: "1 1 100%" }}>
                    Discord <em>fetches</em> the avatar, so it has to be publicly reachable — a local path or a
                    login-protected URL silently falls back to the webhook's picture.
                  </span>
                </div>

                {/* ── Routes ────────────────────────────────────────────── */}
                <div style={{ padding: "6px 14px 14px" }}>
                  {ROUTE_ROWS.map((row) => {
                    const cur = d.routes[row.key];
                    const tag = `${d.id}:${row.key}`;
                    const cleared = !!dr.clear[row.key];
                    const pingVal = dr.pings[row.key] ?? cur?.ping ?? "";
                    const pingErr = pingProblem(pingVal);
                    // <@&ID> and <@ID> differ by one character and look identical
                    // at a glance, but one tags a role and the other tags a
                    // single person. Say which, rather than letting a missing "&"
                    // pass silently.
                    const kind = pingErr ? null : pingKind(pingVal);
                    return (
                      <div
                        key={row.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 0",
                          borderBottom: `1px solid ${OWNER_THEME.border}`,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ flex: "0 0 86px" }}>
                          <div style={labelStyle}>{row.label}</div>
                          {cur && !cleared ? (
                            <div style={{ fontSize: 10, color: GREEN, fontVariantNumeric: "tabular-nums" }}>{cur.masked}</div>
                          ) : (
                            <div style={{ fontSize: 10, color: OWNER_THEME.text, opacity: 0.6 }}>not set</div>
                          )}
                        </div>

                        <input
                          value={dr.urls[row.key] ?? ""}
                          onChange={(e) => patch(d, { urls: { ...dr.urls, [row.key]: e.target.value } })}
                          placeholder={cur ? "Paste a new webhook URL to replace it" : "Paste webhook URL"}
                          spellCheck={false}
                          autoComplete="off"
                          style={{ ...homeInputStyle, flex: "2 1 260px", minWidth: 200, fontSize: 12 }}
                        />

                        <input
                          value={pingVal}
                          onChange={(e) => patch(d, { pings: { ...dr.pings, [row.key]: e.target.value } })}
                          placeholder="Ping — <@&roleid>"
                          spellCheck={false}
                          style={{
                            ...homeInputStyle,
                            flex: "1 1 150px",
                            minWidth: 130,
                            fontSize: 12,
                            border: `1px solid ${pingErr ? rgba(OWNER_THEME.red, 0.6) : OWNER_THEME.border}`,
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => test(d, row.key)}
                          disabled={busy != null || !cur}
                          title={cur ? "Post a visible test message to this channel" : "Nothing mapped yet"}
                          style={btn(OWNER_THEME.lightBlue, busy != null || !cur)}
                        >
                          {busy === `test:${tag}` ? "…" : "Test"}
                        </button>

                        <button
                          type="button"
                          onClick={() => test(d, row.key, true)}
                          disabled={busy != null || !cur || !cur.ping}
                          title={cur?.ping ? "Test message that actually tags the role — it will notify people" : "No ping saved on this route"}
                          style={btn(OWNER_THEME.gold, busy != null || !cur || !cur.ping)}
                        >
                          🔔
                        </button>

                        {cur && (
                          <button
                            type="button"
                            onClick={() => patch(d, { clear: { ...dr.clear, [row.key]: !cleared } })}
                            title="Remove this route on save"
                            style={btn(OWNER_THEME.red)}
                          >
                            {cleared ? "Undo" : "✕"}
                          </button>
                        )}

                        {pingErr && (
                          <span style={{ fontSize: 11, color: OWNER_THEME.red, flex: "1 1 100%" }}>{pingErr}</span>
                        )}

                        {kind === "user" && (
                          <span style={{ fontSize: 11, color: OWNER_THEME.gold, flex: "1 1 100%" }}>
                            That is a USER mention — it tags one person. For a role it needs the <code>&amp;</code>:{" "}
                            <code>&lt;@&amp;{pingVal.replace(/\D/g, "")}&gt;</code>
                          </span>
                        )}
                        {kind === "role" && cur?.ping !== pingVal && (
                          <span style={{ fontSize: 11, color: CYAN, flex: "1 1 100%" }}>
                            Will tag a role — not saved yet, press Save.
                          </span>
                        )}

                        {testMsg[tag] && (
                          <span
                            style={{
                              fontSize: 11,
                              color: testMsg[tag].startsWith("✓")
                                ? GREEN
                                : testMsg[tag].startsWith("⚠")
                                  ? OWNER_THEME.gold
                                  : OWNER_THEME.red,
                              flex: "1 1 100%",
                            }}
                          >
                            {testMsg[tag]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 11, color: OWNER_THEME.text, marginTop: 10 }}>
                    Default {ROUTE_ROWS[0].hint}. A class with its own row wins over it. <strong>Test</strong> posts
                    silently; <strong>🔔</strong> posts a test that really tags the role.
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
