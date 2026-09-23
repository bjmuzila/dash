import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { PageShell, Card } from "../components/PageCard";
import {
  OWNER_THEME,
  TYPE,
  ownerRgba,
  ownerStatusPill,
  homeInputStyle,
  homeButtonStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";

/**
 * /owner/client-sites — password-protected client demo sites on sites.cbedge.net.
 *
 * Create a site, upload its page (one self-contained .html file), and add /
 * change / remove its logins. Every site has its own logins; a password for
 * one site opens nothing else.
 *
 * Backend: /api/client-sites (server-v2/client-sites.js, owner-only). It writes
 * /opt/demo-sites-data/<slug>/index.html and /opt/demo-sites-auth/<slug>.htpasswd
 * on the VPS, which the demo-sites nginx serves generically — changes are live
 * on the next refresh, with no deploy.
 *
 * Passwords are stored as bcrypt hashes and cannot be read back. The page shows
 * a password once, right after it is set, in a ready-to-send message.
 */

type Site = {
  slug: string;
  label: string;
  url: string;
  users: string[];
  hasLoginFile: boolean;
  index: { bytes: number; mtime: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ApiResult = {
  ok: boolean;
  configured?: boolean;
  error?: string;
  message?: string;
  sites?: Site[];
};

/** What to show after a password is set: the one time it is visible. */
type Share = { slug: string; label: string; url: string; username: string; password: string };

const T = OWNER_THEME;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_HTML_BYTES = 20 * 1024 * 1024;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** 14 chars from an alphabet with no look-alikes (no 0/O, 1/l/I). */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10)}`;
}

function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function fmtWhen(ms: number | string | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) + " ET";
}

function shareMessage(s: Share): string {
  return [
    `Hi! Here's a private preview of your new website:`,
    s.url,
    ``,
    `When it asks you to sign in:`,
    `Username: ${s.username}`,
    `Password: ${s.password}`,
    ``,
    `Let me know what you think!`,
  ].join("\n");
}

async function api(body?: Record<string, unknown>): Promise<ApiResult> {
  const r = await fetch("/api/client-sites", {
    method: body ? "POST" : "GET",
    credentials: "include",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let j: ApiResult;
  try { j = (await r.json()) as ApiResult; }
  catch { throw new Error(`HTTP ${r.status}`); }
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function readHtmlFile(file: File): Promise<string> {
  if (file.size > MAX_HTML_BYTES) throw new Error("That file is over 20 MB.");
  if (!/\.html?$/i.test(file.name)) throw new Error("Pick an .html file.");
  return file.text();
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

// ── small styled pieces ──────────────────────────────────────────────────────

const labelStyle: CSSProperties = {
  fontSize: TYPE.label,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: T.green,
};

const inputStyle: CSSProperties = { ...homeInputStyle, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

const smallBtn: CSSProperties = { ...homeSecondaryButtonStyle, padding: "6px 10px", fontSize: TYPE.label };

const dangerBtn: CSSProperties = {
  ...homeSecondaryButtonStyle,
  padding: "6px 10px",
  fontSize: TYPE.label,
  color: T.red,
  border: `1px solid ${ownerRgba(T.red, 0.35)}`,
  background: ownerRgba(T.red, 0.08),
};

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      {children}
      {hint != null && <span style={{ fontSize: TYPE.label, color: T.cyan }}>{hint}</span>}
    </label>
  );
}

function Notice({ kind, children, onClose }: { kind: "ok" | "err"; children: ReactNode; onClose?: () => void }) {
  const c = kind === "ok" ? T.green : T.red;
  return (
    <div
      role={kind === "err" ? "alert" : "status"}
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        border: `1px solid ${ownerRgba(c, 0.35)}`,
        background: ownerRgba(c, 0.1),
        color: c,
        fontSize: TYPE.body,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        justifyContent: "space-between",
      }}
    >
      <span style={{ whiteSpace: "pre-wrap" }}>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" style={{ ...smallBtn, padding: "2px 8px" }}>
          ✕
        </button>
      )}
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "any password"}
        autoComplete="new-password"
        spellCheck={false}
        style={{ ...inputStyle, fontFamily: "'SFMono-Regular', Consolas, Menlo, monospace" }}
      />
      <button type="button" onClick={() => onChange(generatePassword())} style={{ ...smallBtn, whiteSpace: "nowrap" }}>
        Generate
      </button>
    </div>
  );
}

function ShareBox({ share, onClose }: { share: Share; onClose: () => void }) {
  const [copied, setCopied] = useState<"" | "msg" | "pw">("");
  const msg = shareMessage(share);
  const copy = async (what: "msg" | "pw") => {
    if (await copyText(what === "msg" ? msg : share.password)) {
      setCopied(what);
      setTimeout(() => setCopied(""), 1600);
    }
  };
  return (
    <div
      style={{
        border: `1px solid ${ownerRgba(T.gold, 0.4)}`,
        background: ownerRgba(T.gold, 0.07),
        borderRadius: 14,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ ...labelStyle, color: T.gold }}>Send this to {share.label}</span>
        <span style={{ fontSize: TYPE.label, color: T.gold }}>
          The password is only shown now — copy it before closing.
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 12,
          borderRadius: 10,
          background: T.panelInset,
          border: `1px solid ${T.border}`,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: TYPE.body,
          lineHeight: 1.55,
          color: T.text,
          fontFamily: "inherit",
        }}
      >
        {msg}
      </pre>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => void copy("msg")} style={homeButtonStyle}>
          {copied === "msg" ? "Copied ✓" : "Copy message"}
        </button>
        <button type="button" onClick={() => void copy("pw")} style={homeSecondaryButtonStyle}>
          {copied === "pw" ? "Copied ✓" : "Copy password only"}
        </button>
        <button type="button" onClick={onClose} style={{ ...homeSecondaryButtonStyle, marginLeft: "auto" }}>
          Done
        </button>
      </div>
      <span style={{ fontSize: TYPE.label, color: T.cyan }}>
        Tip: text the password and email the link, so one message on its own can’t open the site.
      </span>
    </div>
  );
}

// ── new site ─────────────────────────────────────────────────────────────────

function NewSiteCard({
  existing,
  busy,
  run,
}: {
  existing: Set<string>;
  busy: boolean;
  run: (body: Record<string, unknown>, share?: Omit<Share, "url">) => Promise<boolean>;
}) {
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [username, setUsername] = useState("");
  const [userTouched, setUserTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const effSlug = slugTouched ? slug : slugify(label);
  const effUser = userTouched ? username : effSlug;
  const slugOk = SLUG_RE.test(effSlug);
  const taken = existing.has(effSlug);

  const submit = async () => {
    setErr(null);
    if (!label.trim()) return setErr("Give the site a name.");
    if (!slugOk) return setErr("Web address: lowercase letters, numbers and dashes only.");
    if (taken) return setErr(`sites.cbedge.net/${effSlug}/ is already used.`);
    if (!password) return setErr("Enter a password.");
    let html: string | undefined;
    if (file) {
      try { html = await readHtmlFile(file); }
      catch (e) { return setErr(e instanceof Error ? e.message : String(e)); }
    }
    const ok = await run(
      { action: "create", slug: effSlug, label: label.trim(), username: effUser, password, html },
      { slug: effSlug, label: label.trim(), username: effUser, password },
    );
    if (ok) {
      setLabel(""); setSlug(""); setSlugTouched(false);
      setUsername(""); setUserTouched(false);
      setPassword("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card title="New site" subtitle="Creates sites.cbedge.net/<name>/ with its own login. Live immediately.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <Field label="Client / business name">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="PLM Photography" style={inputStyle} />
        </Field>
        <Field
          label="Web address"
          hint={
            effSlug
              ? <>sites.cbedge.net/<b style={{ color: taken || !slugOk ? T.red : T.text }}>{effSlug}</b>/{taken ? " — already used" : ""}</>
              : "lowercase letters, numbers, dashes"
          }
        >
          <input
            value={effSlug}
            onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
            placeholder="plm"
            spellCheck={false}
            style={inputStyle}
          />
        </Field>
        <Field label="Username">
          <input
            value={effUser}
            onChange={(e) => { setUserTouched(true); setUsername(e.target.value); }}
            placeholder="plm"
            autoComplete="off"
            spellCheck={false}
            style={inputStyle}
          />
        </Field>
        <Field label="Password">
          <PasswordInput value={password} onChange={setPassword} />
        </Field>
        <Field label="Page (optional)" hint={file ? `${file.name} · ${fmtBytes(file.size)}` : "One self-contained .html file. You can add it later."}>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,text/html"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ ...inputStyle, padding: 8 }}
          />
        </Field>
      </div>
      {err && <div style={{ marginTop: 12 }}><Notice kind="err">{err}</Notice></div>}
      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={() => void submit()} disabled={busy} style={{ ...homeButtonStyle, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Working…" : "Create site"}
        </button>
      </div>
    </Card>
  );
}

// ── one site ─────────────────────────────────────────────────────────────────

function SiteCard({
  site,
  busy,
  run,
}: {
  site: Site;
  busy: boolean;
  run: (body: Record<string, unknown>, share?: Omit<Share, "url">) => Promise<boolean>;
}) {
  const [editingUser, setEditingUser] = useState<string | null>(null); // username being reset, or "" for a new login
  const [newUser, setNewUser] = useState("");
  const [pw, setPw] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(site.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLabel(site.label); }, [site.label]);

  const live = site.hasLoginFile && site.index != null && site.users.length > 0;
  const status = !site.hasLoginFile
    ? { ok: false, text: "No login file — hidden (404)" }
    : site.users.length === 0
      ? { ok: false, text: "No logins — nobody can open it" }
      : site.index == null
        ? { ok: false, text: "No page uploaded yet" }
        : { ok: true, text: "Live" };

  const startEdit = (u: string) => { setErr(null); setEditingUser(u); setNewUser(""); setPw(""); };

  const savePassword = async () => {
    setErr(null);
    const username = editingUser === "" ? newUser.trim() : (editingUser as string);
    if (!username) return setErr("Enter a username.");
    if (!pw) return setErr("Enter a password.");
    const ok = await run(
      { action: "set-user", slug: site.slug, username, password: pw },
      { slug: site.slug, label: site.label, username, password: pw },
    );
    if (ok) { setEditingUser(null); setPw(""); setNewUser(""); }
  };

  const upload = async (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    let html: string;
    try { html = await readHtmlFile(f); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); return; }
    finally { if (fileRef.current) fileRef.current.value = ""; }
    await run({ action: "upload", slug: site.slug, html });
  };

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* header */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            {renaming ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, width: 260 }} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => { if (await run({ action: "rename", slug: site.slug, label })) setRenaming(false); }}
                  style={smallBtn}
                >
                  Save
                </button>
                <button type="button" onClick={() => { setRenaming(false); setLabel(site.label); }} style={smallBtn}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: TYPE.title, fontWeight: 800, color: T.text }}>{site.label}</span>
                <button type="button" onClick={() => setRenaming(true)} style={{ ...smallBtn, padding: "2px 8px", fontSize: TYPE.micro }}>
                  Rename
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <a href={site.url} target="_blank" rel="noreferrer" style={{ color: T.lightBlue, fontSize: TYPE.body, wordBreak: "break-all" }}>
                {site.url}
              </a>
              <button
                type="button"
                onClick={async () => { if (await copyText(site.url)) { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } }}
                style={{ ...smallBtn, padding: "2px 8px", fontSize: TYPE.micro }}
              >
                {linkCopied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
          </div>
          <span style={ownerStatusPill(status.ok)}>{live ? "● " : ""}{status.text}</span>
        </div>

        {/* page */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: 12, borderRadius: 12, background: T.panelInset, border: `1px solid ${T.border}` }}>
          <span style={labelStyle}>Page</span>
          <span style={{ fontSize: TYPE.body, color: T.text }}>
            {site.index ? `index.html · ${fmtBytes(site.index.bytes)} · updated ${fmtWhen(site.index.mtime)}` : "Nothing uploaded yet"}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,text/html"
            style={{ display: "none" }}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={{ ...smallBtn, marginLeft: "auto" }}>
            {site.index ? "Replace page…" : "Upload page…"}
          </button>
        </div>

        {/* logins */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={labelStyle}>Logins for this site only</span>
          {site.users.length === 0 && (
            <span style={{ fontSize: TYPE.body, color: T.cyan }}>No logins yet — add one so the client can get in.</span>
          )}
          {site.users.map((u) => (
            <div key={u} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: TYPE.body, fontWeight: 700, color: T.text, minWidth: 120 }}>{u}</span>
                <span style={{ fontSize: TYPE.label, color: T.cyan }}>password hidden</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button type="button" disabled={busy} onClick={() => startEdit(u)} style={smallBtn}>Change password</button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run({ action: "remove-user", slug: site.slug, username: u })}
                    style={dangerBtn}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {editingUser === u && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div style={{ flex: "1 1 280px" }}>
                    <Field label={`New password for ${u}`}><PasswordInput value={pw} onChange={setPw} /></Field>
                  </div>
                  <button type="button" disabled={busy} onClick={() => void savePassword()} style={homeButtonStyle}>Save</button>
                  <button type="button" onClick={() => setEditingUser(null)} style={homeSecondaryButtonStyle}>Cancel</button>
                </div>
              )}
            </div>
          ))}
          {editingUser === "" ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 4 }}>
              <div style={{ flex: "1 1 160px" }}>
                <Field label="Username">
                  <input value={newUser} onChange={(e) => setNewUser(e.target.value)} autoComplete="off" spellCheck={false} style={inputStyle} />
                </Field>
              </div>
              <div style={{ flex: "2 1 280px" }}>
                <Field label="Password"><PasswordInput value={pw} onChange={setPw} /></Field>
              </div>
              <button type="button" disabled={busy} onClick={() => void savePassword()} style={homeButtonStyle}>Add login</button>
              <button type="button" onClick={() => setEditingUser(null)} style={homeSecondaryButtonStyle}>Cancel</button>
            </div>
          ) : (
            <div>
              <button type="button" disabled={busy} onClick={() => startEdit("")} style={smallBtn}>+ Add login</button>
            </div>
          )}
        </div>

        {err && <Notice kind="err" onClose={() => setErr(null)}>{err}</Notice>}

        {/* danger */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
          <span style={{ fontSize: TYPE.label, color: T.cyan }}>
            Created {fmtWhen(site.createdAt)} · changed {fmtWhen(site.updatedAt)}
          </span>
          {!confirmDelete ? (
            <button type="button" onClick={() => { setConfirmDelete(true); setConfirmText(""); }} style={{ ...dangerBtn, marginLeft: "auto" }}>
              Delete site…
            </button>
          ) : (
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: TYPE.label, color: T.red }}>Deletes the page and every login. Type <b>{site.slug}</b>:</span>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} spellCheck={false} style={{ ...inputStyle, width: 140, padding: "6px 10px" }} />
              <button
                type="button"
                disabled={busy || confirmText !== site.slug}
                onClick={() => void run({ action: "delete-site", slug: site.slug, confirm: confirmText })}
                style={{ ...dangerBtn, opacity: confirmText === site.slug ? 1 : 0.5 }}
              >
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} style={smallBtn}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function ClientSites() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [share, setShare] = useState<Share | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await fetch("/api/client-sites", { credentials: "include", cache: "no-store" });
      const j = (await r.json()) as ApiResult;
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setConfigured(j.configured !== false);
      setSites(j.sites ?? []);
      if (j.configured === false && j.error) setLoadErr(j.error);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Runs one action; on success refreshes the list and (for passwords) opens the share box. */
  const run = useCallback(async (body: Record<string, unknown>, shareInfo?: Omit<Share, "url">): Promise<boolean> => {
    setBusy(true);
    setActionErr(null);
    setMessage(null);
    try {
      const j = await api(body);
      if (j.sites) setSites(j.sites);
      setMessage(j.message || "Saved.");
      if (shareInfo) {
        const url = j.sites?.find((s) => s.slug === shareInfo.slug)?.url ?? `https://sites.cbedge.net/${shareInfo.slug}/`;
        setShare({ ...shareInfo, url });
      }
      return true;
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const existing = new Set((sites ?? []).map((s) => s.slug));

  return (
    <PageShell maxWidth={1000}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ ...labelStyle, letterSpacing: "0.18em" }}>sites.cbedge.net</span>
        <h1 style={{ margin: 0, fontSize: TYPE.display, fontWeight: 800, color: T.text }}>Client Sites</h1>
        <p style={{ margin: 0, fontSize: TYPE.body, color: T.green }}>
          Private website previews for clients. Each site has its own logins — a password for one site opens nothing else.
          Changes are live on the next refresh.
        </p>
      </div>

      {!configured && (
        <Notice kind="err">
          {`The server can't reach the site folders yet${loadErr ? `: ${loadErr}` : "."}\n\nOn the VPS, run:\n  sudo mkdir -p /opt/demo-sites-data /opt/demo-sites-auth\n  cd /opt/dashboard && docker compose up -d dashboard demo-sites`}
        </Notice>
      )}
      {configured && loadErr && <Notice kind="err" onClose={() => setLoadErr(null)}>{`Couldn't load sites: ${loadErr}`}</Notice>}
      {actionErr && <Notice kind="err" onClose={() => setActionErr(null)}>{actionErr}</Notice>}
      {message && !actionErr && <Notice kind="ok" onClose={() => setMessage(null)}>{message}</Notice>}
      {share && <ShareBox share={share} onClose={() => setShare(null)} />}

      {configured && <NewSiteCard existing={existing} busy={busy} run={run} />}

      {sites == null && !loadErr && <span style={{ fontSize: TYPE.body, color: T.cyan }}>Loading…</span>}
      {sites != null && sites.length === 0 && configured && (
        <span style={{ fontSize: TYPE.body, color: T.cyan }}>No sites yet.</span>
      )}
      {(sites ?? []).map((s) => (
        <SiteCard key={s.slug} site={s} busy={busy} run={run} />
      ))}
    </PageShell>
  );
}
