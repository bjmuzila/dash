import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { OWNER_THEME as T, ownerRgba, homePanelStyle } from "../lib/theme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CAMPAIGN LINKS — the short kind.
 *
 * This used to be a four-field UTM builder that emitted 90-character URLs. That
 * was the wrong shape for the job: nobody wants to paste
 * `?utm_source=x&utm_medium=social&utm_campaign=post` into an X post or a
 * YouTube description. An ugly link gets shortened by someone else's service or
 * retyped without the tags, and either way the attribution is gone.
 *
 * So the tags moved server-side (app/[source]/[action]/route.ts) and this became
 * a list of ready-made links to copy: `cbedge.net/x/click`. The redirect adds
 * the tags on the way through, so the arrival looks identical to a hand-tagged
 * one on the Acquisition panel.
 *
 * The panel is a LIST, not a form, because the standard placements are the
 * answer nine times out of ten and a form makes you re-derive them every time.
 * The one-off row at the bottom covers the tenth.
 *
 * ─── ONE-OFFS GET THE BARE FORM TOO ─────────────────────────────────────────
 *
 * That row used to emit `cbedge.net/podcast/click`, because the bare
 * one-segment form answers only for an allowlist and a link that 404s is worse
 * than four ugly characters. The allowlist is now something you can add to
 * from here: "Create" POSTs the name to /api/owner/short-links, which writes a
 * short_links row, and `cbedge.net/podcast` starts resolving within seconds —
 * no deploy. So the verb is gone from every link this panel produces.
 *
 * The guard is still a guard. A name that is already a page on the site
 * (`pricing`, `scanner`, `owner`) is refused by the API, and a name nobody
 * created still 404s — which is what keeps `/pricng` a 404 instead of a ghost
 * referral. Created links are listed below the row so the set stays visible;
 * deleting one retires it on the next click.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** One row of /api/page-visits — only what the "already used" hints read. */
export interface CampaignSeedRow {
  utmSource?: string | null;
  utmCampaign?: string | null;
  isEntry?: boolean | null;
}

const SITE = "cbedge.net";

/** The placements worth having a permanent link for. Mirrors PLACEMENTS in
 *  lib/shortLinks.ts — a link here with no row there still works, it just
 *  reports as a referral instead of social/email.
 *
 *  THE BARE FORM. A known source needs no verb: `cbedge.net/x` is the same link
 *  as `/x/click`, and that is the one to paste in a post. The profile rows keep
 *  their `/profile` suffix on purpose — a bio link trickles forever from people
 *  who looked you up, a post link spikes with what you wrote, and one number for
 *  both hides both. */
const STANDARD: { path: string; label: string; note: string; tags: string }[] = [
  { path: "x", label: "X post", note: "in a tweet — the short one", tags: "x · social · post" },
  { path: "x/profile", label: "X profile", note: "the link in your bio", tags: "x · social · profile" },
  { path: "youtube", label: "YouTube", note: "video description", tags: "youtube · social · video" },
  { path: "youtube/profile", label: "YouTube channel", note: "the About link", tags: "youtube · social · channel" },
  { path: "tiktok", label: "TikTok", note: "bio or caption", tags: "tiktok · social · video" },
  { path: "email", label: "Email", note: "pasted into a message by hand", tags: "email · email · link" },
  { path: "newsletter", label: "Newsletter", note: "pasted into the letter by hand", tags: "newsletter · email · link" },
];

/** Built-in sources the bare `/x` form already answers for — mirrors
 *  BARE_SOURCE_LIST in lib/shortLinks.ts. Typing one of these in the one-off
 *  row needs no "Create": the link already works. */
const BARE_SOURCES = new Set([
  "discord", "email", "newsletter", "reddit", "stocktwits", "tiktok", "x", "youtube",
]);

/** One created short link, as /api/owner/short-links returns it. */
interface ShortLink {
  slug: string;
  campaign: string;
  medium: string;
  dest: string;
}

/** Where the link lands. "/" needs no ?to=, which is what keeps it short. */
const DESTINATIONS: { path: string; label: string }[] = [
  { path: "/", label: "Landing" },
  { path: "/pricing", label: "Pricing" },
  { path: "/sign-up", label: "Sign up" },
  { path: "/whats-new", label: "What's New" },
];

/** Same rules as campaignSlug() in lib/emails/utm.ts — keep the three identical. */
function slug(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: T.text,
  opacity: 1,
};

const monoStyle: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const inputStyle: CSSProperties = {
  background: ownerRgba(T.text, 0.04),
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  fontSize: 14,
  padding: "7px 10px",
  fontFamily: "inherit",
  minWidth: 0,
  width: "100%",
};

function Chip({ on, label, title, onClick }: { on?: boolean; label: string; title?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "4px 11px", fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: "pointer",
        whiteSpace: "nowrap",
        color: on ? T.cyan : T.text,
        background: on ? ownerRgba(T.cyan, 0.13) : ownerRgba(T.text, 0.04),
        border: `1px solid ${on ? ownerRgba(T.cyan, 0.35) : T.border}`,
      }}
    >
      {label}
    </button>
  );
}

export default function CampaignLinkBuilder({ rows }: { rows: CampaignSeedRow[] }) {
  const [dest, setDest] = useState("/");
  const [campaign, setCampaign] = useState("");
  const [oneOffSource, setOneOffSource] = useState("");
  const [oneOffCampaign, setOneOffCampaign] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [created, setCreated] = useState<ShortLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadCreated = useCallback(() => {
    fetch("/api/owner/short-links", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (Array.isArray(j?.links)) setCreated(j.links as ShortLink[]); })
      .catch(() => { /* panel still works; the row just can't say what exists */ });
  }, []);

  useEffect(loadCreated, [loadCreated]);

  /**
   * Build one short link. Query params are added ONLY when they differ from the
   * redirect's own defaults, which is the whole reason these links stay short:
   * the common case — landing page, standard campaign — is a bare path.
   */
  const build = (path: string, camp: string, to: string): string => {
    const qs: string[] = [];
    const c = slug(camp);
    if (c) qs.push(`c=${encodeURIComponent(c)}`);
    if (to && to !== "/") qs.push(`to=${encodeURIComponent(to)}`);
    return `${SITE}/${path}${qs.length ? `?${qs.join("&")}` : ""}`;
  };

  const copy = (url: string) => {
    try {
      void navigator.clipboard.writeText(`https://${url}`);
      setCopied(url);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked — the text is on screen and selectable */
    }
  };

  // Campaign names already in the log, so a second platform for the same push
  // reuses the exact string instead of inventing a near-miss spelling.
  const seenCampaigns = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.isEntry || !r.utmCampaign) continue;
      m.set(r.utmCampaign, (m.get(r.utmCampaign) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  }, [rows]);

  const Row = ({ url, label, note, tags }: { url: string; label: string; note: string; tags: string }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 1fr) minmax(0, 2fr) auto",
        gap: 10,
        alignItems: "center",
        padding: "9px 0",
        borderTop: `1px solid ${T.border}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, color: T.text }}>{label}</div>
        <div style={{ fontSize: 11, color: T.textSecondary, opacity: 1 }}>{note}</div>
      </div>
      <div
        title={`arrives tagged: ${tags}`}
        style={{
          ...monoStyle, fontSize: 13, color: T.cyan,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {url}
      </div>
      <button
        onClick={() => copy(url)}
        style={{
          padding: "5px 14px", fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: "pointer",
          whiteSpace: "nowrap",
          color: copied === url ? T.green : T.text,
          background: ownerRgba(copied === url ? T.green : T.text, 0.08),
          border: `1px solid ${copied === url ? ownerRgba(T.green, 0.4) : T.border}`,
        }}
      >
        {copied === url ? "Copied" : "Copy"}
      </button>
    </div>
  );

  // Every link this panel produces is now the bare form. A name that isn't a
  // built-in source has to EXIST before that URL resolves, which is what the
  // Create button does — see the block comment at the top.
  const oneOffSlug = slug(oneOffSource);
  const oneOffUrl = build(oneOffSlug || "somewhere", oneOffCampaign || campaign, dest);
  const createdSlugs = useMemo(() => new Set(created.map((l) => l.slug)), [created]);
  const oneOffLive = !!oneOffSlug && (BARE_SOURCES.has(oneOffSlug) || createdSlugs.has(oneOffSlug));

  /** Create the name, then copy. Copy alone would hand you a link that 404s. */
  const createAndCopy = async () => {
    if (!oneOffSlug || busy) return;
    if (oneOffLive) { copy(oneOffUrl); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/owner/short-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: oneOffSlug,
          campaign: slug(oneOffCampaign || campaign) || "link",
          dest,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setErr(j?.error || "Could not create that link."); return; }
      loadCreated();
      copy(oneOffUrl);
    } catch {
      setErr("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const removeCreated = async (s: string) => {
    setErr(null);
    try {
      const r = await fetch(`/api/owner/short-links?slug=${encodeURIComponent(s)}`, { method: "DELETE" });
      if (!r.ok) { setErr("Could not delete that link."); return; }
      setCreated((prev) => prev.filter((l) => l.slug !== s));
    } catch {
      setErr("Could not reach the server.");
    }
  };

  return (
    <div style={{ ...homePanelStyle, padding: 18, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ ...labelStyle, opacity: 1 }}>Campaign links</span>
        <span style={{ fontSize: 11, color: T.textSecondary, opacity: 1 }}>
          Copy and paste. The redirect adds the tracking tags. Broadcast emails tag themselves at send time.
        </span>
      </div>

      {/* Two controls, shared by every row below. Both are optional — leaving
          them alone is what produces the shortest possible link. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
        <div>
          <div style={{ ...labelStyle, marginBottom: 6 }}>Lands on</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DESTINATIONS.map((d) => (
              <Chip key={d.path} on={d.path === dest} label={d.label} title={d.path} onClick={() => setDest(d.path)} />
            ))}
          </div>
        </div>
        <div>
          <div style={{ ...labelStyle, marginBottom: 6 }}>
            Name this push <span style={{ opacity: 1, textTransform: "none", letterSpacing: 0 }}>— optional</span>
          </div>
          <input
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder="e.g. gex-thread — leave blank for the default"
            maxLength={60}
            style={inputStyle}
          />
          {seenCampaigns.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: T.textSecondary, opacity: 1 }}>reuse:</span>
              {seenCampaigns.map((c) => (
                <Chip key={c} label={c} onClick={() => setCampaign(c)} title="Same push on another platform — reuse the exact name" />
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        {STANDARD.map((s) => (
          <Row
            key={s.path}
            url={build(s.path, campaign, dest)}
            label={s.label}
            note={s.note}
            tags={s.tags}
          />
        ))}
      </div>

      {/* One-off. "Create" registers the name so the bare URL resolves; after
          that it is an ordinary short link and reports as a referral. */}
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>Somewhere else</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 10, alignItems: "center" }}>
          <input
            value={oneOffSource}
            onChange={(e) => setOneOffSource(e.target.value)}
            placeholder="where — e.g. hackernews, podcast"
            maxLength={40}
            style={inputStyle}
          />
          <input
            value={oneOffCampaign}
            onChange={(e) => setOneOffCampaign(e.target.value)}
            placeholder="name — optional"
            maxLength={60}
            style={inputStyle}
          />
          <button
            onClick={() => void createAndCopy()}
            disabled={!oneOffSlug || busy}
            title={oneOffLive ? "This link already works" : "Registers the name, then copies the link"}
            style={{
              padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 7,
              cursor: oneOffSlug && !busy ? "pointer" : "default",
              whiteSpace: "nowrap",
              opacity: oneOffSlug && !busy ? 1 : 0.4,
              color: copied === oneOffUrl ? T.green : T.cyan,
              background: ownerRgba(copied === oneOffUrl ? T.green : T.cyan, 0.13),
              border: `1px solid ${ownerRgba(copied === oneOffUrl ? T.green : T.cyan, 0.35)}`,
            }}
          >
            {copied === oneOffUrl ? "Copied" : busy ? "Creating…" : oneOffLive ? "Copy" : "Create & copy"}
          </button>
        </div>
        <div style={{ ...monoStyle, fontSize: 12, color: T.cyan, opacity: oneOffSlug ? 1 : 0.35, marginTop: 8, wordBreak: "break-all" }}>
          {oneOffUrl}
          {oneOffSlug && !oneOffLive && (
            <span style={{ fontFamily: "inherit", color: T.textSecondary, marginLeft: 8 }}>
              — not created yet
            </span>
          )}
        </div>
        {err && (
          <div style={{ fontSize: 12, color: T.red, marginTop: 7 }}>{err}</div>
        )}

        {/* The set of names that currently resolve. Visible on purpose: a
            short link you forgot you made is a campaign you can't read. */}
        {created.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Created links</div>
            {created.map((l) => {
              const url = build(l.slug, l.campaign === "link" ? "" : l.campaign, l.dest);
              return (
                <div
                  key={l.slug}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "7px 0",
                    borderTop: `1px solid ${T.border}`,
                  }}
                >
                  <div
                    title={`arrives tagged: ${l.slug} · ${l.medium} · ${l.campaign}`}
                    style={{
                      ...monoStyle, fontSize: 13, color: T.cyan,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {url}
                  </div>
                  <button
                    onClick={() => copy(url)}
                    style={{
                      padding: "4px 12px", fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: "pointer",
                      color: copied === url ? T.green : T.text,
                      background: ownerRgba(copied === url ? T.green : T.text, 0.08),
                      border: `1px solid ${copied === url ? ownerRgba(T.green, 0.4) : T.border}`,
                    }}
                  >
                    {copied === url ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => void removeCreated(l.slug)}
                    title="Retire this link — it 404s from the next click"
                    style={{
                      padding: "4px 10px", fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: "pointer",
                      color: T.textSecondary,
                      background: ownerRgba(T.text, 0.04),
                      border: `1px solid ${T.border}`,
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: T.textSecondary, opacity: 1, lineHeight: 1.6 }}>
        Every link 302s through <span style={monoStyle}>middleware.ts</span> /{" "}
        <span style={monoStyle}>app/[source]/route.ts</span>, which attaches{" "}
        <span style={monoStyle}>utm_source</span> / <span style={monoStyle}>utm_medium</span> /
        {" "}<span style={monoStyle}>utm_campaign</span> and forwards. Reuse the same push name across
        platforms or one campaign becomes several rows that can't be compared.
        <br />
        A name under <b>Somewhere else</b> has to be created before it resolves — that is what keeps a
        typo like <span style={monoStyle}>cbedge.net/pricng</span> a 404 instead of a ghost referral. A
        name the site already uses (<span style={monoStyle}>pricing</span>,{" "}
        <span style={monoStyle}>scanner</span>, …) is refused.
        <br />
        <span style={monoStyle}>cbedge.net/x</span> and <span style={monoStyle}>cbedge.net/x/click</span>{" "}
        are the same link — the older two-segment form still works, so anything already posted keeps
        counting under the same campaign.
      </div>
    </div>
  );
}
