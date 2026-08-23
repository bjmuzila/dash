import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { OWNER_THEME as T, ownerRgba, homePanelStyle } from "../lib/theme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ACQUISITION — where the traffic came from.
 *
 * Reads the columns added to page_visits in 2026-07 (see lib/visitorAttribution.ts):
 * channel / referrerHost / utm* on ENTRY rows only, and browser/os/deviceType on
 * every row.
 *
 * THE ONE THING TO KNOW ABOUT THESE NUMBERS:
 * a "session" here is a row with isEntry — the first beacon of a browser session,
 * the only row that carries attribution. A "pageview" is any row. So sessions and
 * pageviews are counted off different denominators ON PURPOSE, and every
 * acquisition breakdown below is sessions, never pageviews. Mixing them is the
 * easiest way to make this page lie.
 *
 * Bots (isBot) are excluded from every human-facing number and reported
 * separately, because Googlebot and Discord's link preview would otherwise be a
 * large share of a small site's traffic.
 *
 * COLOR: every bar is one hue (theme cyan). These are nominal categories in a
 * ranked list — the bar length already encodes the magnitude and the row label
 * already encodes identity, so a second hue per row would be decoration that also
 * fails CVD checks. (Verified: the four theme hues as a categorical set FAIL the
 * lightness-band and chroma-floor checks against this panel; a single cyan PASSES
 * all five.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Input ────────────────────────────────────────────────────────────────────

/** One row of /api/page-visits. Every field optional — old rows predate all of them. */
export interface AcquisitionRow {
  isEntry?: boolean | null;
  channel?: string | null;
  referrerHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  isBot?: boolean | null;
  createdAt?: string | null;
  // ── Outcome fields, read only by the campaign table ──────────────────────
  // A campaign's session count says a link was clicked. These say whether the
  // click became anything: who the visitor turned out to be, when that account
  // was created, and whether it pays.
  userId?: string | null;
  ip?: string | null;
  userCreatedAt?: string | null;
  isSubscriber?: boolean | null;
  isOwner?: boolean | null;
}

type WindowKey = "24h" | "7d" | "30d" | "all";
const WINDOWS: { key: WindowKey; label: string; hours: number | null }[] = [
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7d", hours: 24 * 7 },
  { key: "30d", label: "30d", hours: 24 * 30 },
  { key: "all", label: "All", hours: null },
];

/** Campaign row grid: name + magnitude bar | sessions | signups | paid | conv.
 *  Mirrors the column rhythm of the "Pages being visited" card so the two
 *  ranked lists on the Overview tab read as one thing. */
const CAMPAIGN_COLS = "minmax(0,1fr) 72px 68px 56px 56px";

// ── Small pieces ─────────────────────────────────────────────────────────────

const num = (n: number) => n.toLocaleString();
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "0%");

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: T.text,
  opacity: 0.75,
};

const monoStyle: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ ...monoStyle, fontSize: 26, fontWeight: 700, color: T.text, lineHeight: 1.1 }}>{value}</span>
      <span style={{ fontSize: 12, color: T.textSecondary, opacity: 0.6 }}>{label}</span>
      {hint && <span style={{ fontSize: 11, color: T.textSecondary, opacity: 0.4 }}>{hint}</span>}
    </div>
  );
}

/**
 * One ranked bar. Thin (8px), 4px rounded ends anchored to the left baseline,
 * recessive track, value direct-labelled on the right — six rows is few enough
 * that a label per row reads as a table, not as noise.
 */
function Bar({ name, value, total, max }: { name: string; value: number; total: number; max: number }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div
      title={`${name} — ${num(value)} (${pct(value, total)})`}
      style={{ display: "flex", flexDirection: "column", gap: 5 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span
          style={{
            fontSize: 13, color: T.text, opacity: 0.9,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span style={{ ...monoStyle, fontSize: 13, color: T.text, flexShrink: 0 }}>
          {num(value)}
          <span style={{ color: T.textSecondary, opacity: 0.45, marginLeft: 6 }}>{pct(value, total)}</span>
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: ownerRgba(T.text, 0.05), overflow: "hidden" }}>
        <div style={{ width: `${w}%`, height: "100%", borderRadius: 4, background: T.cyan }} />
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div style={{ ...homePanelStyle, padding: 18, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={labelStyle}>{title}</span>
        {subtitle && <span style={{ fontSize: 11, color: T.textSecondary, opacity: 0.45 }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: T.textSecondary, opacity: 0.45, padding: "10px 0", lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

/** Count into a map, skipping null/blank keys. */
function tally<T2>(rows: T2[], key: (r: T2) => string | null | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Keep the top N and fold the rest into "Other" — never grow the category count. */
function topN(pairs: [string, number][], n: number): [string, number][] {
  if (pairs.length <= n) return pairs;
  const head = pairs.slice(0, n);
  const rest = pairs.slice(n).reduce((s, [, v]) => s + v, 0);
  return rest > 0 ? [...head, ["Other", rest] as [string, number]] : head;
}

/**
 * A ranked bar list. The percentage denominator is the SUM OF THIS LIST, not the
 * session or pageview count — rows logged before this feature shipped carry no
 * channel, referrer or user agent, and dividing by the full count would print a
 * set of shares that quietly add up to 76% with nothing explaining the gap.
 * Percentages here always total 100% of the rows that actually have the field.
 */
function BarList({ pairs }: { pairs: [string, number][] }) {
  const sum = pairs.reduce((s, [, v]) => s + v, 0);
  const max = pairs[0]?.[1] ?? 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {pairs.map(([name, v]) => (
        <Bar key={name} name={name} value={v} total={sum} max={max} />
      ))}
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function AcquisitionPanel({ rows }: { rows: AcquisitionRow[] }) {
  const [win, setWin] = useState<WindowKey>("7d");

  const view = useMemo(() => {
    const hours = WINDOWS.find((w) => w.key === win)?.hours ?? null;
    const cutoff = hours == null ? null : Date.now() - hours * 3600_000;

    const inWindow = rows.filter((r) => {
      if (cutoff == null) return true;
      const t = r.createdAt ? Date.parse(r.createdAt) : NaN;
      // Undated rows can't be placed in a window — drop them rather than let
      // them inflate whichever range happens to be selected.
      return Number.isFinite(t) && t >= cutoff;
    });

    const bots = inWindow.filter((r) => r.isBot);
    const human = inWindow.filter((r) => !r.isBot);
    // Attribution lives only on entry rows. Everything below this line is
    // sessions; `human.length` is the only pageview number on the panel.
    const sessions = human.filter((r) => r.isEntry);

    const channels = topN(tally(sessions, (r) => r.channel), 7);
    const referrers = topN(tally(sessions, (r) => r.referrerHost), 7);
    const devices = tally(human, (r) => r.deviceType);
    const browsers = topN(tally(human, (r) => r.browser), 5);

    // Grouped on source+medium+campaign. Joined with an escaped NUL, NOT a
    // space or a dash — campaign names contain both, and splitting on either
    // would shred them back into the wrong columns.
    const SEP = "\u0000";

    // ── Who each visitor turned out to be ────────────────────────────────────
    // Built over ALL rows, not just the window: someone can arrive from a
    // campaign on Monday and register on Thursday, and a window-scoped index
    // would report that campaign as having produced nothing.
    //
    // The key is the account when we have one and the IP when we don't, which
    // is the only join available — the arrival is anonymous by definition, so
    // there is no user id on it to match. That makes these numbers ATTRIBUTED,
    // not audited: a shared office IP can credit a campaign with a signup that
    // came from the desk next door, and a phone that changes networks between
    // arriving and registering breaks the link the other way. Directionally
    // right, not billable. The footnote under the table says so.
    const identity = new Map<string, { registeredAt: number | null; paid: boolean }>();
    for (const r of rows) {
      if (r.isBot) continue;
      const key = r.userId ? `u:${r.userId}` : r.ip ? `ip:${r.ip}` : "";
      if (!key) continue;
      const prev = identity.get(key) ?? { registeredAt: null, paid: false };
      const created = r.userCreatedAt ? Date.parse(r.userCreatedAt) : NaN;
      if (r.userId && Number.isFinite(created)) {
        prev.registeredAt = prev.registeredAt == null ? created : Math.min(prev.registeredAt, created);
      }
      if (r.isSubscriber) prev.paid = true;
      identity.set(key, prev);
    }

    // Per campaign: unique arrivals, and the earliest arrival time of each, so
    // "registered AFTER clicking" can be told from "was already a customer".
    type CampAgg = { arrivals: Map<string, number> };
    const campAgg = new Map<string, CampAgg>();
    for (const r of sessions) {
      if (!r.utmSource) continue;
      // Owner clicking his own link is not a campaign result.
      if (r.isOwner) continue;
      const k = [r.utmSource, r.utmMedium ?? "", r.utmCampaign ?? ""].join(SEP);
      let agg = campAgg.get(k);
      if (!agg) { agg = { arrivals: new Map() }; campAgg.set(k, agg); }
      const who = r.userId ? `u:${r.userId}` : r.ip ? `ip:${r.ip}` : `anon:${r.createdAt ?? Math.random()}`;
      const t = r.createdAt ? Date.parse(r.createdAt) : NaN;
      const at = Number.isFinite(t) ? t : 0;
      const cur = agg.arrivals.get(who);
      if (cur == null || at < cur) agg.arrivals.set(who, at);
    }

    // A minute of slack: the beacon, the sign-up POST and the row's clock are
    // three different moments, and an account created 900ms "before" the
    // arrival that produced it is a rounding artefact, not a pre-existing user.
    const GRACE_MS = 60_000;
    const campaigns = [...campAgg.entries()]
      .map(([k, agg]) => {
        const [source, medium, campaign] = k.split(SEP);
        let signups = 0;
        let paid = 0;
        for (const [who, arrivedAt] of agg.arrivals) {
          const id = identity.get(who);
          if (!id || id.registeredAt == null) continue;
          if (id.registeredAt < arrivedAt - GRACE_MS) continue; // already had an account
          signups++;
          if (id.paid) paid++;
        }
        return { source, medium, campaign, sessions: agg.arrivals.size, signups, paid };
      })
      // Sorted by SESSIONS — the clicks the link actually got. That has to be
      // the sort now that the campaign list draws a magnitude bar off sessions:
      // a ranked bar list sorted on a column other than the one the bars encode
      // reads as broken. Paid and signups stay as the columns beside it and
      // break ties, so "which push earned customers" is still one glance away.
      .sort((a, b) => b.sessions - a.sessions || b.paid - a.paid || b.signups - a.signups)
      .slice(0, 12);

    return {
      pageviews: human.length,
      botLoads: bots.length,
      sessionCount: sessions.length,
      topChannel: channels[0]?.[0] ?? null,
      channels, referrers, devices, browsers, campaigns,
      // Attribution only exists on rows logged after the feature shipped. If
      // there are rows but no entries at all, say so instead of showing zeros
      // that read like "nobody visited".
      hasAnyEntry: inWindow.some((r) => r.isEntry),
      hasAnyRow: inWindow.length > 0,
    };
  }, [rows, win]);

  const s = view.sessionCount;
  // Bars are scaled to the top campaign's sessions — the list is sorted by that
  // same number, so row 0 is the maximum.
  const campaignMax = view.campaigns[0]?.sessions ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Filters — one row, above the charts. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={labelStyle}>Acquisition</span>
        <div style={{ display: "flex", gap: 6 }}>
          {WINDOWS.map((w) => {
            const on = w.key === win;
            return (
              <button
                key={w.key}
                onClick={() => setWin(w.key)}
                style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 8,
                  cursor: "pointer",
                  color: on ? T.cyan : T.text,
                  background: on ? ownerRgba(T.cyan, 0.12) : ownerRgba(T.text, 0.04),
                  border: `1px solid ${on ? ownerRgba(T.cyan, 0.3) : T.border}`,
                }}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI row. */}
      <div
        style={{
          ...homePanelStyle,
          padding: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 18,
        }}
      >
        <Stat label="sessions" value={num(s)} hint="first beacon of a visit" />
        <Stat label="pageviews" value={num(view.pageviews)} hint="every load, humans only" />
        <Stat
          label="pages / session"
          value={s > 0 ? (view.pageviews / s).toFixed(1) : "—"}
        />
        <Stat label="top channel" value={view.topChannel ?? "—"} />
        <Stat label="bot loads" value={num(view.botLoads)} hint="excluded above" />
      </div>

      {!view.hasAnyRow ? (
        <Section title="No visits in this window">
          <Empty>Nothing logged in the last {WINDOWS.find((w) => w.key === win)?.label}. Try a wider range.</Empty>
        </Section>
      ) : !view.hasAnyEntry ? (
        <Section title="Waiting for the first tracked session">
          <Empty>
            {num(view.pageviews)} loads logged, but none carry attribution yet. Entry rows only start
            appearing after the referrer/UTM build is deployed — every row logged before that has
            <b style={{ color: T.cyan }}> is_entry = false</b> and no channel. Device and browser
            below will fill in at the same time.
          </Empty>
        </Section>
      ) : null}

      {/* Two ranked bar lists, side by side on wide screens. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        <Section title="Sessions by channel" subtitle="how people arrived">
          {view.channels.length === 0 ? (
            <Empty>No attributed sessions yet.</Empty>
          ) : (
            <BarList pairs={view.channels} />
          )}
        </Section>

        <Section title="Top referrers" subtitle="external sites only — self-referrals are dropped">
          {view.referrers.length === 0 ? (
            <Empty>
              No external referrers yet. Direct traffic (typed URL, bookmark, an app that strips the
              referrer) never has one, so this staying empty is a real answer, not a bug.
            </Empty>
          ) : (
            <BarList pairs={view.referrers} />
          )}
        </Section>
      </div>

      {/* Campaigns — a ranked bar list, same shape as "Pages being visited":
          name on the left with a magnitude bar under it, counts right-aligned.
          The bar encodes SESSIONS (the clicks the link got), which is also the
          sort — a bar list ranked on a column other than the one it draws reads
          as broken. Signups / Paid / Conv. stay as columns beside it, so "which
          push earned customers" is still one glance away even though "which
          push got clicked" is what the shape now shows. */}
      <Section
        title="Campaigns"
        subtitle="tagged links (utm_*) and inferred ad clicks — ranked by sessions"
      >
        {view.campaigns.length === 0 ? (
          <Empty>
            No tagged traffic in this window. Add <code style={{ color: T.cyan }}>?utm_source=…&amp;utm_medium=…&amp;utm_campaign=…</code>{" "}
            to links you post and they'll show up here; bare <code style={{ color: T.cyan }}>gclid</code> /{" "}
            <code style={{ color: T.cyan }}>fbclid</code> clicks are picked up automatically.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 460 }}>
              {/* Header row */}
              <div style={{
                display: "grid", gridTemplateColumns: CAMPAIGN_COLS, gap: 8,
                fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                color: T.textSecondary, opacity: 0.5,
                paddingBottom: 6, borderBottom: `1px solid ${T.border}`,
              }}>
                <span>Campaign</span>
                <span style={{ textAlign: "right" }} title="Unique arrivals from this campaign — one per person, not per click.">Sessions</span>
                <span style={{ textAlign: "right" }} title="Arrivals whose account was created at or after the click.">Signups</span>
                <span style={{ textAlign: "right" }} title="Of those signups, the ones now on an active or trialing subscription.">Paid</span>
                <span style={{ textAlign: "right" }} title="Signups ÷ sessions.">Conv.</span>
              </div>

              {view.campaigns.map((c) => {
                const w = campaignMax > 0 ? Math.max(2, (c.sessions / campaignMax) * 100) : 0;
                const detail = [c.medium, c.campaign].filter(Boolean).join(" · ");
                return (
                  <div
                    key={`${c.source}|${c.medium}|${c.campaign}`}
                    title={`${c.source}${detail ? ` — ${detail}` : ""}\n${num(c.sessions)} sessions · ${num(c.signups)} signups · ${num(c.paid)} paying`}
                    style={{
                      display: "grid", gridTemplateColumns: CAMPAIGN_COLS, gap: 8,
                      alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.source}
                        </span>
                        <span style={{ fontSize: 12, ...monoStyle, color: T.textSecondary, opacity: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {detail || "—"}
                        </span>
                      </div>
                      <div style={{ height: 5, background: ownerRgba(T.text, 0.05), borderRadius: 3, overflow: "hidden", marginTop: 5 }}>
                        <div style={{ height: "100%", width: `${w}%`, background: T.cyan, borderRadius: 3 }} />
                      </div>
                    </div>

                    <span style={{ ...monoStyle, fontSize: 13, textAlign: "right", color: T.text }}>{num(c.sessions)}</span>
                    <span style={{ ...monoStyle, fontSize: 13, textAlign: "right", color: c.signups ? T.text : T.textSecondary, opacity: c.signups ? 1 : 0.35 }}>{num(c.signups)}</span>
                    <span style={{ ...monoStyle, fontSize: 13, textAlign: "right", color: c.paid ? T.gold : T.textSecondary, opacity: c.paid ? 1 : 0.35, fontWeight: c.paid ? 700 : 400 }}>{num(c.paid)}</span>
                    <span style={{ ...monoStyle, fontSize: 13, textAlign: "right", color: T.textSecondary, opacity: 0.6 }}>{pct(c.signups, c.sessions)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* Device + browser — counted over pageviews, not sessions, because the UA
          is on every row and there's no reason to throw that resolution away. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        <Section title="Device" subtitle="share of loads with a user agent">
          {view.devices.length === 0 ? (
            <Empty>No device data yet.</Empty>
          ) : (
            <BarList pairs={view.devices} />
          )}
        </Section>

        <Section title="Browser" subtitle="share of loads with a user agent">
          {view.browsers.length === 0 ? (
            <Empty>No browser data yet.</Empty>
          ) : (
            <BarList pairs={view.browsers} />
          )}
        </Section>
      </div>

      <div style={{ fontSize: 12, color: T.textSecondary, opacity: 0.45, lineHeight: 1.6 }}>
        Sessions are entry rows — one per browser session, the only rows carrying a referrer, so a
        visitor who reads six pages counts once here and six times under pageviews. Bots are excluded
        everywhere except the bot counter.
        <br />
        <b style={{ color: T.text, opacity: 0.7 }}>Signups and Paid are attributed, not audited.</b>{" "}
        An arrival is anonymous by definition, so the only way to connect it to the account that
        appears later is the account id where we have one and the IP where we don't. A shared office
        or campus IP can credit the wrong campaign; a phone that switches networks between clicking
        and registering loses the link entirely. Read them as direction, not as billing. Both are
        also bounded by how far back the fetched visit log reaches — a signup whose click has been
        pruned counts for nobody.
      </div>
    </div>
  );
}
