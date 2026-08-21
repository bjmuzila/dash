import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { OWNER_THEME as T, ownerRgba, homePanelStyle } from "../lib/theme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CAMPAIGN LINK BUILDER — the paste-a-link-somewhere half of attribution.
 *
 * Email is tagged automatically at send time (lib/emails/utm.ts). Everything
 * else — an X post, a YouTube description, a Discord announcement — is a link
 * typed by hand, and hand-typed UTM strings are where campaign reporting
 * usually dies: `youtube` one week, `YouTube` the next, `yt` the week after,
 * and now one push is three rows that can't be compared.
 *
 * So this does two things. It builds the URL, and it shows what has ALREADY
 * been used — sources and campaigns pulled live out of the visit log — as
 * clickable chips. Reusing an existing string is one click; inventing a fourth
 * spelling takes deliberate typing. That asymmetry is the whole point of the
 * component.
 *
 * Nothing here is stored. The URL is derived from the fields on every render;
 * the only side effect in the file is the clipboard write.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** One row of /api/page-visits — only the fields this panel reads. */
export interface CampaignSeedRow {
  utmSource?: string | null;
  utmCampaign?: string | null;
  isEntry?: boolean | null;
}

const SITE = "https://cbedge.net";

/**
 * Presets are the platforms actually posted to, each carrying the medium that
 * platform's traffic should bucket into. Medium is what the Acquisition panel
 * groups by, so getting it wrong (say `social` on a paid ad) silently moves a
 * campaign into the wrong column — pairing it with the source removes the
 * chance to mismatch them by hand.
 */
const SOURCE_PRESETS: { source: string; medium: string; label: string }[] = [
  { source: "x", medium: "social", label: "X" },
  { source: "youtube", medium: "social", label: "YouTube" },
  { source: "discord", medium: "social", label: "Discord" },
  { source: "reddit", medium: "social", label: "Reddit" },
  { source: "stocktwits", medium: "social", label: "StockTwits" },
  { source: "newsletter", medium: "email", label: "Newsletter" },
  { source: "email", medium: "email", label: "Email" },
];

const MEDIUMS = ["social", "email", "referral", "cpc"];

/** Where the link points. Public pages only — a gated path bounces to /pricing. */
const DESTINATIONS: { path: string; label: string }[] = [
  { path: "/", label: "Landing" },
  { path: "/pricing", label: "Pricing" },
  { path: "/sign-up", label: "Sign up" },
  { path: "/docs", label: "Docs" },
  { path: "/whats-new", label: "What's New" },
  { path: "/about-me", label: "About" },
];

/** Same rules as campaignSlug() in lib/emails/utm.ts — keep the two identical. */
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
  opacity: 0.5,
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  background: ownerRgba(T.text, 0.04),
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  fontSize: 14,
  padding: "7px 10px",
  fontFamily: "inherit",
  width: "100%",
  minWidth: 0,
};

function Chip({
  on, label, title, onClick,
}: { on?: boolean; label: string; title?: string; onClick: () => void }) {
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
  const [path, setPath] = useState("/");
  const [source, setSource] = useState("x");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // What's already live. Ranked by use so the string you reach for most is
  // leftmost; capped because this is a memory aid, not a report.
  const seen = useMemo(() => {
    const sources = new Map<string, number>();
    const campaigns = new Map<string, number>();
    for (const r of rows) {
      if (!r.isEntry) continue; // attribution only exists on entry rows
      if (r.utmSource) sources.set(r.utmSource, (sources.get(r.utmSource) ?? 0) + 1);
      if (r.utmCampaign) campaigns.set(r.utmCampaign, (campaigns.get(r.utmCampaign) ?? 0) + 1);
    }
    const rank = (m: Map<string, number>, n: number) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
    return { sources: rank(sources, 8), campaigns: rank(campaigns, 8) };
  }, [rows]);

  const campaignSlugged = slug(campaign);
  const url = useMemo(() => {
    const p = path.startsWith("/") ? path : `/${path}`;
    const qs = [
      `utm_source=${encodeURIComponent(slug(source) || "direct")}`,
      `utm_medium=${encodeURIComponent(slug(medium) || "referral")}`,
      campaignSlugged ? `utm_campaign=${encodeURIComponent(campaignSlugged)}` : "",
    ].filter(Boolean).join("&");
    return `${SITE}${p === "/" ? "/" : p}?${qs}`;
  }, [path, source, medium, campaignSlugged]);

  const copy = () => {
    try {
      void navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked — the URL is on screen and selectable anyway */
    }
  };

  const ready = campaignSlugged.length > 0;

  return (
    <div style={{ ...homePanelStyle, padding: 18, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ ...labelStyle, marginBottom: 0, opacity: 0.75 }}>Campaign link builder</span>
        <span style={{ fontSize: 11, color: T.textSecondary, opacity: 0.45 }}>
          For links you paste by hand. Emails tag themselves at send time.
        </span>
      </div>

      {/* Destination */}
      <div>
        <div style={labelStyle}>Send them to</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {DESTINATIONS.map((d) => (
            <Chip key={d.path} on={d.path === path} label={d.label} title={d.path} onClick={() => setPath(d.path)} />
          ))}
        </div>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/"
          style={inputStyle}
        />
      </div>

      {/* Source + medium. Picking a preset sets both, because the pairing is
          the part that's easy to get wrong. */}
      <div>
        <div style={labelStyle}>Where you're posting it</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {SOURCE_PRESETS.map((s) => (
            <Chip
              key={s.source}
              on={s.source === source}
              label={s.label}
              title={`utm_source=${s.source} · utm_medium=${s.medium}`}
              onClick={() => { setSource(s.source); setMedium(s.medium); }}
            />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="utm_source" style={inputStyle} />
          <select
            value={MEDIUMS.includes(medium) ? medium : "referral"}
            onChange={(e) => setMedium(e.target.value)}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {MEDIUMS.map((m) => <option key={m} value={m} style={{ background: T.panel }}>{m}</option>)}
          </select>
        </div>
        {seen.sources.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: T.textSecondary, opacity: 0.4 }}>already used:</span>
            {seen.sources.map((s) => (
              <Chip key={s} label={s} onClick={() => setSource(s)} title="Reuse this exact spelling" />
            ))}
          </div>
        )}
      </div>

      {/* Campaign */}
      <div>
        <div style={labelStyle}>Which push this is</div>
        <input
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          placeholder="e.g. gex-thread, annual-promo, aug-launch"
          maxLength={60}
          style={inputStyle}
        />
        {campaign.trim() && campaignSlugged !== campaign.trim() && (
          <div style={{ fontSize: 11, color: T.textSecondary, opacity: 0.45, marginTop: 5 }}>
            sent as <b style={{ color: T.cyan }}>{campaignSlugged}</b> — lowercase and hyphenated so it can't
            split into two rows.
          </div>
        )}
        {seen.campaigns.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: T.textSecondary, opacity: 0.4 }}>already used:</span>
            {seen.campaigns.map((c) => (
              <Chip key={c} label={c} onClick={() => setCampaign(c)} title="Same push, another platform — reuse it" />
            ))}
          </div>
        )}
      </div>

      {/* Result */}
      <div>
        <div style={labelStyle}>Link</div>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              ...inputStyle,
              flex: 1,
              fontFamily: "var(--font-mono), monospace",
              fontSize: 12,
              opacity: ready ? 1 : 0.55,
            }}
          />
          <button
            onClick={copy}
            style={{
              padding: "7px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: "pointer",
              whiteSpace: "nowrap",
              color: T.cyan,
              background: ownerRgba(T.cyan, 0.13),
              border: `1px solid ${ownerRgba(T.cyan, 0.35)}`,
            }}
          >
            {copied === url ? "Copied" : "Copy"}
          </button>
        </div>
        {!ready && (
          <div style={{ fontSize: 11, color: T.orange, opacity: 0.8, marginTop: 6 }}>
            Name the push above — without utm_campaign the click still counts as {slug(source) || "this source"},
            but it can't be told apart from every other link you've posted there.
          </div>
        )}
      </div>
    </div>
  );
}
