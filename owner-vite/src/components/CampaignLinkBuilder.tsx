import { useMemo, useState } from "react";
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
 * The one-off row at the bottom covers the tenth — and it needs no server
 * change, because an unrecognised source falls through to utm_medium=referral.
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

/** Sources the bare `/x` form answers for — mirrors BARE_SOURCE_LIST in
 *  lib/shortLinks.ts. The one-off row below checks it so it never offers a
 *  short link that 404s: an unknown source is only valid with a verb. */
const BARE_SOURCES = new Set([
  "discord", "email", "newsletter", "reddit", "stocktwits", "tiktok", "x", "youtube",
]);

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

  // A known source gets the bare form; anything else keeps the verb, because
  // the one-segment route only answers for the allowlist and a link that 404s
  // is worse than a link with four extra characters.
  const oneOffSlug = slug(oneOffSource);
  const oneOffPath = oneOffSlug
    ? (BARE_SOURCES.has(oneOffSlug) ? oneOffSlug : `${oneOffSlug}/click`)
    : "somewhere/click";
  const oneOffUrl = build(oneOffPath, oneOffCampaign || campaign, dest);

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

      {/* One-off. No server change needed: an unknown source is accepted and
          reported as a referral under whatever name you type. */}
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
            onClick={() => copy(oneOffUrl)}
            disabled={!slug(oneOffSource)}
            style={{
              padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 7,
              cursor: slug(oneOffSource) ? "pointer" : "default",
              whiteSpace: "nowrap",
              opacity: slug(oneOffSource) ? 1 : 0.4,
              color: copied === oneOffUrl ? T.green : T.cyan,
              background: ownerRgba(copied === oneOffUrl ? T.green : T.cyan, 0.13),
              border: `1px solid ${ownerRgba(copied === oneOffUrl ? T.green : T.cyan, 0.35)}`,
            }}
          >
            {copied === oneOffUrl ? "Copied" : "Copy"}
          </button>
        </div>
        <div style={{ ...monoStyle, fontSize: 12, color: T.cyan, opacity: slug(oneOffSource) ? 1 : 0.35, marginTop: 8, wordBreak: "break-all" }}>
          {oneOffUrl}
        </div>
      </div>

      <div style={{ fontSize: 11, color: T.textSecondary, opacity: 1, lineHeight: 1.6 }}>
        Every link 302s through <span style={monoStyle}>app/[source]/route.ts</span> (bare) or{" "}
        <span style={monoStyle}>app/[source]/[action]/route.ts</span> (with a verb), which attaches{" "}
        <span style={monoStyle}>utm_source</span> / <span style={monoStyle}>utm_medium</span> /
        {" "}<span style={monoStyle}>utm_campaign</span> and forwards. Reuse the same push name across
        platforms or one campaign becomes several rows that can't be compared.
        <br />
        <span style={monoStyle}>cbedge.net/x</span> and <span style={monoStyle}>cbedge.net/x/click</span>{" "}
        are the same link — the older two-segment form still works, so anything already posted keeps
        counting under the same campaign.
      </div>
    </div>
  );
}
