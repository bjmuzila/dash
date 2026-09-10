import { useEffect, useState, type CSSProperties } from "react";
import { Card } from "../components/PageCard";
import { OWNER_THEME, rgba, homeInputStyle } from "../lib/theme";

/* ────────────────────────────────────────────────────────────────────────────
 * BOT · Scheduled — the posts this server sends on its own.
 *
 * Manage (the tab next door) answers "where does an alert I compose go".
 * This one answers "what goes out without me". One card per job, and a job is
 * something the SERVER knows how to post — the list comes from JOB_DEFS in
 * server-v2/scheduled-posts-store.js, not from anything typed here, so a job
 * can never be invented in the browser and then not exist.
 *
 * TWO KINDS OF DESTINATION, and a channel beats a webhook when both are set:
 *   BOT CHANNEL — one credential (DISCORD_BOT_TOKEN) reaching any channel the
 *     bot can see. Pick it from the dropdown; no per-channel setup. A bot post
 *     CANNOT carry a per-message name or avatar, so the identity fields below
 *     are inert on this path — that is Discord's rule, not ours.
 *   WEBHOOK — bound to one channel forever, but it can wear any name/avatar.
 *
 * SECRETS ARE ONE-WAY, same contract as Manage. The server sends a MASK
 * (webhook id + last four token characters), never the URL. Leaving the webhook
 * box EMPTY on save means "keep what is stored" — that is what lets the time or
 * the message be edited without retyping a credential this page was never
 * given. Typing a single "-" clears it back to the server's env fallback.
 *
 * CARDS ARE COLLAPSED BY DEFAULT — this list only grows, and a page of
 * fully-expanded forms is one nobody can scan. The header row alone answers
 * "is it on, when does it go, did it work last time"; the form is one click
 * away. A card with unsaved edits is force-opened regardless of its collapsed
 * state, so a draft can never be hidden behind a chevron and forgotten.
 *
 * "Post now" is NOT a dry run. It runs the real job against the real webhook
 * and the message lands in the channel. It exists because the alternative for
 * checking a change is waiting until tomorrow morning.
 * ════════════════════════════════════════════════════════════════════════════ */

const CYAN = OWNER_THEME.cyan;
const GREEN = OWNER_THEME.green;
const RED = OWNER_THEME.red;

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

type Job = {
  id: string;
  label: string;
  hint?: string;
  enabled: boolean;
  postAt: string;
  days: string;
  username: string;
  avatarUrl: string;
  message: string;
  postEmpty: boolean;
  channelId: string;
  webhookMask: string;
  hasWebhook: boolean;
  webhookFromEnv: boolean;
  /** Which path a post would actually take — resolved by the server. */
  dest: "bot" | "webhook" | "none";
  lastRunAt: string | null;
  lastStatus: string;
  lastError: string;
};

/** Local edits, keyed by job id. Only what was actually touched. */
type Draft = Partial<Job> & { webhookUrl?: string };

type Channel = { id: string; name: string; category: string };

const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: OWNER_THEME.text,
  opacity: 0.6,
  marginBottom: 6,
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " ET";
}

/** "Mon–Fri" / "Weekends" / "Mon, Wed, Fri" — the collapsed row's whole story. */
function fmtDays(days: string): string {
  const on = String(days || "").split(",").filter(Boolean);
  if (on.length === 0) return "never";
  if (on.length === 7) return "Every day";
  const key = on.join(",");
  if (key === "mon,tue,wed,thu,fri") return "Mon–Fri";
  if (key === "sat,sun") return "Weekends";
  return DAYS.filter((d) => on.includes(d.key)).map((d) => d.label).join(", ");
}

export default function BotScheduled() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [live, setLive] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** Which cards are expanded. Absent = collapsed, which is the default. */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /** Guild channels for the bot dropdown, fetched once. */
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelErr, setChannelErr] = useState<string>("");
  /** Failures shown IN the card — a banner at the top of the page gets missed. */
  const [cardMsg, setCardMsg] = useState<Record<string, { kind: "ok" | "err"; text: string }>>({});

  const clearMsg = (id: string) =>
    setCardMsg((prev) => {
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });

  function applyPayload(j: { jobs?: Job[]; live?: boolean }) {
    setJobs(Array.isArray(j?.jobs) ? j.jobs : []);
    setLive(j?.live !== false);
    setDrafts({});
  }

  async function load() {
    try {
      const r = await fetch("/api/scheduled-posts", { cache: "no-store" });
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

  async function loadChannels() {
    try {
      const r = await fetch("/api/discord-bot/channels", { cache: "no-store" });
      const j = await r.json();
      setChannels(Array.isArray(j?.channels) ? j.channels : []);
      // Not an error banner — a missing token only matters if you pick Bot.
      setChannelErr(j?.ok ? "" : String(j?.error || "Bot channels unavailable"));
    } catch (e) {
      setChannelErr(String((e as Error)?.message || e));
    }
  }

  useEffect(() => {
    load();
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftFor = (job: Job): Draft => drafts[job.id] ?? {};
  const val = <K extends keyof Job>(job: Job, key: K): Job[K] => {
    const d = draftFor(job) as Record<string, unknown>;
    return (d[key as string] === undefined ? job[key] : d[key as string]) as Job[K];
  };
  const patch = (job: Job, p: Draft) =>
    setDrafts((prev) => ({ ...prev, [job.id]: { ...(prev[job.id] ?? {}), ...p } }));

  const dirty = (job: Job) => Object.keys(drafts[job.id] ?? {}).length > 0;

  async function save(job: Job) {
    setBusy(`save:${job.id}`);
    clearMsg(job.id);
    try {
      const d = draftFor(job);
      const r = await fetch("/api/scheduled-posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: job.id,
          enabled: val(job, "enabled"),
          postAt: val(job, "postAt"),
          days: val(job, "days"),
          username: val(job, "username"),
          avatarUrl: val(job, "avatarUrl"),
          message: val(job, "message"),
          postEmpty: val(job, "postEmpty"),
          // Absent/blank = keep what is stored. Never send the mask back.
          webhookUrl: (d.webhookUrl ?? "").trim(),
          // "-" clears; the segmented control below sends it when Webhook is
          // chosen, which is what makes the channel-wins precedence switchable.
          channelId: String(val(job, "channelId") ?? "").trim() || "-",
        }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `Save failed (${r.status})`);
      applyPayload(j);
      setCardMsg((p) => ({ ...p, [job.id]: { kind: "ok", text: "Saved" } }));
    } catch (e) {
      setCardMsg((p) => ({ ...p, [job.id]: { kind: "err", text: String((e as Error)?.message || e) } }));
    } finally {
      setBusy(null);
    }
  }

  async function runNow(job: Job) {
    setBusy(`run:${job.id}`);
    clearMsg(job.id);
    try {
      const r = await fetch("/api/scheduled-posts/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: job.id }),
      });
      const j = await r.json();
      if (j?.jobs) applyPayload(j);
      if (!j?.ok) throw new Error(j?.result?.error || j?.error || `Run failed (${r.status})`);
      setCardMsg((p) => ({ ...p, [job.id]: { kind: "ok", text: "Posted — check the channel" } }));
    } catch (e) {
      setCardMsg((p) => ({ ...p, [job.id]: { kind: "err", text: String((e as Error)?.message || e) } }));
    } finally {
      setBusy(null);
    }
  }

  function toggleDay(job: Job, key: string) {
    const set = new Set(String(val(job, "days") || "").split(",").filter(Boolean));
    if (set.has(key)) set.delete(key); else set.add(key);
    patch(job, { days: DAYS.filter((d) => set.has(d.key)).map((d) => d.key).join(",") });
  }

  if (!loaded) {
    return (
      <Card variant="classic">
        <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: OWNER_THEME.text }}>
          Loading scheduled posts…
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {err && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, fontSize: 12,
          border: `1px solid ${rgba(RED, 0.4)}`, background: rgba(RED, 0.12), color: RED,
        }}>
          {err}
        </div>
      )}

      {!live && (
        // Same warning Manage shows: the page is looking at defaults + env, so
        // an edit would go nowhere. Better said out loud than discovered later.
        <div style={{
          padding: "10px 14px", borderRadius: 10, fontSize: 12,
          border: `1px solid ${rgba(OWNER_THEME.orange, 0.4)}`,
          background: rgba(OWNER_THEME.orange, 0.12), color: OWNER_THEME.orange,
        }}>
          Settings table unreachable — showing defaults and the server's env fallbacks. Saving will not stick.
        </div>
      )}

      {jobs.map((job) => {
        const enabled = val(job, "enabled");
        const days = String(val(job, "days") || "");
        const msg = cardMsg[job.id];
        const savingThis = busy === `save:${job.id}`;
        const runningThis = busy === `run:${job.id}`;

        const isDirty = dirty(job);
        // A dirty card is force-opened: unsaved edits must never sit hidden
        // behind a chevron where the next Save looks like it did nothing.
        const expanded = (open[job.id] ?? false) || isDirty;
        const failed = job.lastStatus === "error";

        return (
          <Card key={job.id} variant="classic" padding={0}>
            {/* ── Header row — the whole card when collapsed ───────────────── */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOpen((p) => ({ ...p, [job.id]: !expanded }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((p) => ({ ...p, [job.id]: !expanded }));
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 20px",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <span style={{
                flexShrink: 0, fontSize: 11, color: OWNER_THEME.text, opacity: 0.6,
                transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s",
              }}>
                ▶
              </span>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: OWNER_THEME.text }}>{job.label}</span>
                  {isDirty && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: OWNER_THEME.orange, letterSpacing: "0.08em" }}>
                      UNSAVED
                    </span>
                  )}
                </div>
                {/* The one line that has to answer "when does this go out" and
                    "did it work" without opening anything. */}
                <div style={{
                  fontSize: 11, marginTop: 4, opacity: 0.6, color: OWNER_THEME.text,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {enabled ? `${val(job, "postAt")} ET · ${fmtDays(days)}` : "Not scheduled"}
                  {job.dest === "bot" ? " · bot" : job.dest === "webhook" ? " · webhook" : " · no destination"}
                  {" · last run "}
                  <span style={{ color: failed ? RED : "inherit", opacity: failed ? 1 : 0.9 }}>
                    {fmtWhen(job.lastRunAt)}{job.lastStatus ? ` (${job.lastStatus})` : ""}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); patch(job, { enabled: !enabled }); }}
                style={{
                  flexShrink: 0,
                  padding: "7px 16px",
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  cursor: "pointer",
                  border: `1px solid ${enabled ? rgba(GREEN, 0.45) : OWNER_THEME.border}`,
                  background: enabled ? rgba(GREEN, 0.16) : "transparent",
                  color: enabled ? GREEN : OWNER_THEME.text,
                }}
              >
                {enabled ? "ON" : "OFF"}
              </button>
            </div>

            {expanded && (
            <div style={{ padding: "4px 20px 20px", borderTop: `1px solid ${OWNER_THEME.border}` }}>
            {job.hint && (
              <div style={{ fontSize: 12, color: OWNER_THEME.text, opacity: 0.65, marginTop: 14 }}>{job.hint}</div>
            )}
            {job.lastError && (
              <div style={{ fontSize: 11, color: RED, opacity: 0.9, marginTop: 8 }}>{job.lastError}</div>
            )}

            {/* ── When ─────────────────────────────────────────────────────── */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 20 }}>
              <div>
                <div style={labelStyle}>Post at (ET)</div>
                <input
                  type="time"
                  value={String(val(job, "postAt") || "")}
                  onChange={(e) => patch(job, { postAt: e.target.value })}
                  style={{ ...homeInputStyle, width: 130 }}
                />
              </div>

              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={labelStyle}>Days</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {DAYS.map((d) => {
                    const on = days.split(",").includes(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => toggleDay(job, d.key)}
                        style={{
                          padding: "9px 12px",
                          borderRadius: 9,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          border: `1px solid ${on ? rgba(CYAN, 0.4) : OWNER_THEME.border}`,
                          background: on ? rgba(CYAN, 0.16) : "transparent",
                          color: on ? CYAN : OWNER_THEME.text,
                        }}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Where ────────────────────────────────────────────────────── */}
            <div style={{ marginTop: 18 }}>
              <div style={labelStyle}>Destination</div>

              {/* Bot vs webhook. Picking Bot sets a channel id; picking Webhook
                  clears it, because a channel always beats a webhook on the
                  server and a stale channel would silently win. */}
              <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 11, border: `1px solid ${OWNER_THEME.border}`, background: OWNER_THEME.panelInset }}>
                {([
                  { id: "bot" as const, label: "Bot channel" },
                  { id: "webhook" as const, label: "Webhook" },
                ]).map((m) => {
                  const active = (val(job, "channelId") ? "bot" : "webhook") === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        patch(job, m.id === "bot"
                          ? { channelId: job.channelId || channels[0]?.id || "" }
                          : { channelId: "" })}
                      style={{
                        padding: "7px 16px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
                        border: `1px solid ${active ? rgba(CYAN, 0.3) : "transparent"}`,
                        background: active ? rgba(CYAN, 0.16) : "transparent",
                        color: active ? CYAN : OWNER_THEME.text,
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {val(job, "channelId") ? (
                <div style={{ marginTop: 10 }}>
                  <select
                    value={String(val(job, "channelId"))}
                    onChange={(e) => patch(job, { channelId: e.target.value })}
                    style={{ ...homeInputStyle, width: "100%" }}
                  >
                    {/* A channel saved before the bot lost access would vanish
                        from the list and silently reset the select — keep it
                        visible as an explicit "unknown" row instead. */}
                    {!channels.some((c) => c.id === val(job, "channelId")) && (
                      <option value={String(val(job, "channelId"))}>
                        {String(val(job, "channelId"))} (not in the bot’s channel list)
                      </option>
                    )}
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.category ? `${c.category} / #${c.name}` : `#${c.name}`}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: OWNER_THEME.text, opacity: 0.55, marginTop: 5 }}>
                    Posts as the bot — one token, any channel it can see. The name and avatar come from the Discord
                    application itself, so the two identity fields below do nothing on this path.
                  </div>
                  {channelErr && (
                    <div style={{ fontSize: 11, color: OWNER_THEME.orange, marginTop: 5 }}>{channelErr}</div>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <input
                    type="text"
                    value={draftFor(job).webhookUrl ?? ""}
                    onChange={(e) => patch(job, { webhookUrl: e.target.value })}
                    placeholder={
                      job.hasWebhook
                        ? `${job.webhookMask}${job.webhookFromEnv ? " (from server env)" : ""} — leave blank to keep`
                        : "https://discord.com/api/webhooks/…"
                    }
                    spellCheck={false}
                    style={{ ...homeInputStyle, width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                  />
                  <div style={{ fontSize: 11, color: OWNER_THEME.text, opacity: 0.55, marginTop: 5 }}>
                    Paste a webhook to change the channel. Blank keeps what is stored; a single “-” clears it back to the
                    server env. The URL is never sent back to this page — only the mask above.
                  </div>
                </div>
              )}
            </div>

            {/* ── What ─────────────────────────────────────────────────────── */}
            <div style={{ marginTop: 18 }}>
              <div style={labelStyle}>Message</div>
              <input
                type="text"
                value={String(val(job, "message") || "")}
                onChange={(e) => patch(job, { message: e.target.value })}
                style={{ ...homeInputStyle, width: "100%" }}
              />
              <div style={{ fontSize: 11, color: OWNER_THEME.text, opacity: 0.55, marginTop: 5 }}>
                <code>{"{date}"}</code> and <code>{"{time}"}</code> are filled in when it posts. Discord markdown works.
              </div>
            </div>

            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 18 }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={labelStyle}>Posts as (webhook only)</div>
                <input
                  type="text"
                  value={String(val(job, "username") || "")}
                  onChange={(e) => patch(job, { username: e.target.value })}
                  style={{ ...homeInputStyle, width: "100%" }}
                />
              </div>
              <div style={{ flex: 2, minWidth: 260 }}>
                <div style={labelStyle}>Avatar URL (webhook only)</div>
                <input
                  type="text"
                  value={String(val(job, "avatarUrl") || "")}
                  onChange={(e) => patch(job, { avatarUrl: e.target.value })}
                  spellCheck={false}
                  style={{ ...homeInputStyle, width: "100%", fontSize: 12 }}
                />
              </div>
            </div>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 16, cursor: "pointer", fontSize: 12, color: OWNER_THEME.text }}>
              <input
                type="checkbox"
                checked={!!val(job, "postEmpty")}
                onChange={(e) => patch(job, { postEmpty: e.target.checked })}
              />
              Post even on a day with nothing on it
            </label>

            {/* ── Actions ──────────────────────────────────────────────────── */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => save(job)}
                disabled={!dirty(job) || savingThis}
                style={{
                  padding: "10px 22px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: !dirty(job) || savingThis ? "default" : "pointer",
                  opacity: !dirty(job) || savingThis ? 0.45 : 1,
                  border: `1px solid ${rgba(CYAN, 0.4)}`,
                  background: `linear-gradient(180deg, ${rgba(CYAN, 0.18)}, ${rgba(CYAN, 0.05)})`,
                  color: CYAN,
                }}
              >
                {savingThis ? "Saving…" : "Save"}
              </button>

              {dirty(job) && (
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => ({ ...prev, [job.id]: {} }))}
                  style={{
                    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
                    border: `1px solid ${OWNER_THEME.border}`, background: "transparent", color: OWNER_THEME.text,
                  }}
                >
                  Discard
                </button>
              )}

              <div style={{ flex: 1 }} />

              <button
                type="button"
                onClick={() => runNow(job)}
                disabled={runningThis || job.dest === "none"}
                title={job.dest === "none" ? "No destination configured" : "Posts for real, right now"}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: runningThis || job.dest === "none" ? "default" : "pointer",
                  opacity: runningThis || job.dest === "none" ? 0.45 : 1,
                  border: `1px solid ${rgba(GREEN, 0.4)}`,
                  background: rgba(GREEN, 0.12),
                  color: GREEN,
                }}
              >
                {runningThis ? "Posting…" : "Post now"}
              </button>
            </div>

            {dirty(job) && (
              <div style={{ fontSize: 11, color: OWNER_THEME.orange, marginTop: 8 }}>
                Unsaved changes — “Post now” uses what is saved, not what is on screen.
              </div>
            )}

            {msg && (
              <div style={{
                marginTop: 12, padding: "9px 12px", borderRadius: 9, fontSize: 12,
                border: `1px solid ${rgba(msg.kind === "ok" ? GREEN : RED, 0.4)}`,
                background: rgba(msg.kind === "ok" ? GREEN : RED, 0.12),
                color: msg.kind === "ok" ? GREEN : RED,
              }}>
                {msg.text}
              </div>
            )}
            </div>
            )}
          </Card>
        );
      })}

      {jobs.length === 0 && (
        <Card variant="classic">
          <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: OWNER_THEME.text }}>
            No scheduled posts are registered on the server.
          </div>
        </Card>
      )}
    </div>
  );
}
