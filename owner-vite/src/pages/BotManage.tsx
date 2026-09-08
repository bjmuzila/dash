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
  routes: Partial<Record<RouteKey, RouteView>>;
};

/** Local edits, keyed by discord id. Only what the user actually touched. */
type Draft = {
  label: string;
  enabled: boolean;
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
    drafts[d.id] ?? { label: d.label, enabled: d.enabled, urls: {}, pings: {}, clear: {} };

  const patch = (d: DiscordRow, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [d.id]: { ...draftFor(d), ...p } }));

  async function post(body: unknown, tag: string) {
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
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  function save(d: DiscordRow) {
    const dr = draftFor(d);
    // url: "" means KEEP (the client never had the secret); null means DELETE.
    const routes: Record<string, { url?: string | null; ping?: string } | null> = {};
    for (const row of ROUTE_ROWS) {
      const k = row.key;
      const url = dr.urls[k] ?? "";
      const ping = dr.pings[k];
      if (dr.clear[k]) { routes[k] = null; continue; }
      if (url.trim() || ping != null) routes[k] = { url: url.trim(), ping: ping ?? d.routes[k]?.ping ?? "" };
    }
    post({ action: "save", discord: { id: d.id, label: dr.label, enabled: dr.enabled, sortIdx: d.sortIdx, routes } }, `save:${d.id}`);
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
      setTestMsg((p) => ({ ...p, [tag]: j?.ok ? "✓ posted" : `✕ ${j?.result?.error || j?.error || "failed"}` }));
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
                  border: `1px solid ${dirty ? rgba(CYAN, 0.4) : OWNER_THEME.border}`,
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

                {/* ── Routes ────────────────────────────────────────────── */}
                <div style={{ padding: "6px 14px 14px" }}>
                  {ROUTE_ROWS.map((row) => {
                    const cur = d.routes[row.key];
                    const tag = `${d.id}:${row.key}`;
                    const cleared = !!dr.clear[row.key];
                    const pingVal = dr.pings[row.key] ?? cur?.ping ?? "";
                    const pingErr = pingProblem(pingVal);
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

                        {testMsg[tag] && (
                          <span
                            style={{
                              fontSize: 11,
                              color: testMsg[tag].startsWith("✓") ? GREEN : OWNER_THEME.red,
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
