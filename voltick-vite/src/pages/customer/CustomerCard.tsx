/**
 * Customer card · the dossier, as a page rather than a modal.
 *
 * One person, one screen, no tabs: who they are on the left, what they have
 * paid in the middle, what they actually used on the right, and the page feed
 * underneath. Pick a name from the roster at the top and the card redraws.
 *
 * Every record is synthetic (see customerData.ts). Nothing here calls the
 * backend. The field names match what the owner console already holds, so the
 * same layout can be pointed at /api/admin/customer/:id later without moving.
 *
 * Color notes, because rule 1 is a defect when broken:
 *   · The reserved data colors (VOLT, FLIP, REVERSAL, SURGE, COIL) are the
 *     board's vocabulary and mean levels on a chart. A customer's plan is not a
 *     level, so none of them appear here. Chrome takes ACCENT and SKY.
 *   · GOOD and BAD carry P&L meaning on a trading screen and never appear as UI
 *     chrome. This is an internal admin surface with no P&L on it, and the two
 *     things they mark, money arriving and money stopping, are the closest thing
 *     this page has to a sign. They are used for that and nothing else: not for
 *     hover, not for focus, not for a toast.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ACCENT,
  ACCENT_SOFT,
  ACCENT_TEXT,
  BAD,
  ELEV,
  GOOD,
  LINE,
  MONO,
  PANEL,
  PAPER,
  PAPER_DISPLAY,
  PAPER_QUIET,
  R_MD,
  R_PILL,
  R_SM,
  SKY,
  W_BOLD,
  W_DATA,
  W_MED,
  cardStyle,
  rgba,
} from "../../theme";
import { PageShell } from "../../components/PageCard";
import { CUSTOMERS, dur } from "./customerData";
import type { Customer, FeedEvent, SubState } from "./customerData";

type Range = "today" | "7d" | "30d" | "all";

const RANGES: { key: Range; label: string; days: number }[] = [
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "all", label: "All", days: 9999 },
];

/** What each subscription state is called, and the color that carries it. */
const STATE: Record<SubState, { label: string; color: string }> = {
  cancelling: { label: "Cancelling", color: BAD },
  active: { label: "Active", color: GOOD },
  past_due: { label: "Past due", color: BAD },
  trial: { label: "Trial", color: SKY },
};

export default function CustomerCard() {
  const [id, setId] = useState(CUSTOMERS[0].id);
  const [range, setRange] = useState<Range>("today");
  const c = useMemo(() => CUSTOMERS.find((x) => x.id === id) ?? CUSTOMERS[0], [id]);

  return (
    <PageShell
      title="Customer card"
      lede={
        <>
          One customer, one screen. Identity, money and usage sit side by side and the page feed runs
          underneath, so the question "what did this person do before they cancelled" is answered by
          scrolling rather than by opening four tabs. Pick a name below. Every record is synthetic.
        </>
      }
    >
      <Roster selected={c.id} onPick={setId} />
      <div style={{ height: 22 }} />
      <Dossier c={c} range={range} onRange={setRange} />
    </PageShell>
  );
}

/* ── Roster ───────────────────────────────────────────────────────────────── */

/**
 * The list the card is opened FROM. On the real console this is Subscriptions,
 * Customer Activity, Signups and the map, all of which carry names, and a click
 * on a name anywhere lands here.
 */
function Roster({ selected, onPick }: { selected: string; onPick: (id: string) => void }) {
  return (
    <section>
      <div style={{ ...labelRow, marginBottom: 9 }}>Roster · click a name</div>
      <div
        style={{
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
        }}
      >
        {CUSTOMERS.map((p) => {
          const on = p.id === selected;
          const st = STATE[p.state];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
                padding: "9px 11px",
                borderRadius: R_MD,
                cursor: "pointer",
                background: on ? ACCENT_SOFT : PANEL,
                border: `1px solid ${on ? rgba(ACCENT, 0.5) : LINE}`,
                color: PAPER,
                font: "inherit",
              }}
            >
              <Avatar initials={p.initials} size={28} />
              <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: W_MED, color: PAPER, whiteSpace: "nowrap" }}>
                  {p.name}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: st.color,
                  }}
                >
                  {st.label} · {p.plan}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── The card ─────────────────────────────────────────────────────────────── */

function Dossier({
  c,
  range,
  onRange,
}: {
  c: Customer;
  range: Range;
  onRange: (r: Range) => void;
}) {
  const st = STATE[c.state];

  return (
    <article style={{ ...cardStyle, padding: 18, display: "grid", gap: 16 }}>
      {/* Header: who, what state, and the three things you reach for first. */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Avatar initials={c.initials} size={44} />

        <div style={{ display: "grid", gap: 8, minWidth: 240, flex: "1 1 340px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 21, fontWeight: W_BOLD, color: PAPER_DISPLAY }}>{c.name}</h2>
            <span style={{ fontFamily: MONO, fontSize: 12, color: PAPER_QUIET }}>{c.email}</span>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Pill color={st.color}>
              {st.label} · {c.stateNote}
            </Pill>
            <Pill color={ACCENT_TEXT}>
              {c.plan} · {c.price}
            </Pill>
            {c.coupon && <Pill color={SKY}>Coupon {c.coupon}</Pill>}
            {c.discord && <Pill color={PAPER_QUIET}>Discord {c.discord}</Pill>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          <Action>Email</Action>
          <Action>Reset password</Action>
          <Action>Stripe ↗</Action>
        </div>
      </header>

      {/* Identity · Money · Usage. Three panels, one row on a wide screen. */}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
        }}
      >
        <Panel title="Identity">
          <Field label="Location">
            {c.location}
            <Sub>{c.ip}</Sub>
          </Field>
          <Field label="Member since">
            {c.memberSince} <Sub inline>({c.memberFor})</Sub>
          </Field>
          <Field label="Last login">
            {c.lastLogin} <Sub inline>· {c.logins} logins</Sub>
          </Field>
          <Field label="Came from">{c.cameFrom}</Field>
          <Field label="Device">{c.device}</Field>
          <Field label="Email pref">
            <span
              style={{
                display: "inline-block",
                padding: "2px 9px",
                borderRadius: R_PILL,
                fontFamily: MONO,
                fontSize: 11,
                border: `1px solid ${rgba(c.emailPref === "subscribed" ? GOOD : PAPER_QUIET, 0.45)}`,
                background: rgba(c.emailPref === "subscribed" ? GOOD : PAPER_QUIET, 0.1),
                color: c.emailPref === "subscribed" ? GOOD : PAPER_QUIET,
              }}
            >
              {c.emailPref}
            </span>
          </Field>
        </Panel>

        <Panel title="Money">
          <Field label="Total spent">
            <span style={{ fontFamily: MONO, fontSize: 19, fontWeight: W_DATA, color: PAPER }}>
              {c.totalSpent}
            </span>
          </Field>
          <Field label="Plan">{c.planLine}</Field>
          <Field label="Coupon">{c.couponLine}</Field>
          <Field label="Renews">{c.renews}</Field>
          {c.reason && (
            <Field label="Reason">
              <span style={{ color: BAD }}>{c.reason}</span>
            </Field>
          )}
          <Field label="Failed pays">
            <span
              style={{
                fontFamily: MONO,
                fontWeight: W_DATA,
                color: c.failedPays > 0 ? BAD : PAPER,
              }}
            >
              {c.failedPays}
            </span>
          </Field>
        </Panel>

        <Panel title="Usage · 30d">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Stat label="Loads" value={String(c.loads)} />
            <Stat label="Sessions" value={String(c.sessions)} />
            <Stat label="Time ≈" value={c.timeLabel} />
            <Stat label="Pages" value={String(c.pagesSeen)} />
          </div>
          <p style={{ margin: 0, fontSize: 13, color: PAPER_QUIET, lineHeight: 1.65 }}>
            Most viewed <Strong>{c.mostViewed}</Strong>. Tickers added <Strong>{c.tickers}</Strong>.
            Feedback <Strong>{c.feedback}</Strong>.
          </p>
        </Panel>
      </div>

      {/* The feed, and where the time actually went. */}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
        }}
      >
        <Panel
          title="Page feed · time per page"
          right={
            <div style={{ display: "flex", gap: 4 }}>
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => onRange(r.key)}
                  style={{
                    padding: "3px 10px",
                    borderRadius: R_SM,
                    cursor: "pointer",
                    font: "inherit",
                    fontFamily: MONO,
                    fontSize: 11,
                    border: `1px solid ${range === r.key ? rgba(ACCENT, 0.55) : LINE}`,
                    background: range === r.key ? ACCENT_SOFT : "transparent",
                    color: range === r.key ? ACCENT_TEXT : PAPER_QUIET,
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          }
        >
          <Feed c={c} range={range} />
        </Panel>

        <Panel title="Pages · share of time (30d)">
          <Shares c={c} />
          <p style={{ margin: "12px 0 0", fontSize: 12, color: PAPER_QUIET, lineHeight: 1.6 }}>
            Time is the gap to the next page load, capped at 30 minutes per session. It is a lower bound:
            a tab left open counts once, not forever.
          </p>
        </Panel>
      </div>
    </article>
  );
}

/* ── Feed ─────────────────────────────────────────────────────────────────── */

function Feed({ c, range }: { c: Customer; range: Range }) {
  const days = RANGES.find((r) => r.key === range)?.days ?? 0;
  const earlier = c.earlier.slice(0, days);
  const empty = c.today.length === 0 && earlier.length === 0;

  if (empty) {
    return (
      <div style={{ fontSize: 13, color: PAPER_QUIET, padding: "10px 0" }}>
        No page loads in this window.
      </div>
    );
  }

  return (
    <div style={{ display: "grid" }}>
      {c.today.length === 0 ? (
        <div style={{ fontSize: 13, color: PAPER_QUIET, padding: "6px 0 10px" }}>
          Nothing today. The last visit was {c.lastLogin}.
        </div>
      ) : (
        c.today.map((e, i) => <Row key={`${e.at}-${i}`} e={e} />)
      )}

      {earlier.map((d) => (
        <div
          key={d.day}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 2px",
            borderTop: `1px solid ${LINE}`,
            fontSize: 13,
            color: PAPER_QUIET,
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 12, color: PAPER, minWidth: 92 }}>{d.day}</span>
          <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
            {d.loads} loads · {d.pages} pages
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: MONO,
              fontVariantNumeric: "tabular-nums",
              color: PAPER,
            }}
          >
            {dur(d.seconds)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Row({ e }: { e: FeedEvent }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 2px",
        borderTop: `1px solid ${LINE}`,
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 12, color: PAPER_QUIET, minWidth: 44 }}>{e.at}</span>
      <Tag kind={e.kind} />
      <span style={{ fontSize: 13, color: PAPER, whiteSpace: "nowrap" }}>{e.label}</span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: PAPER_QUIET }}>{e.path}</span>
      {e.flag && (
        <span
          style={{
            padding: "2px 8px",
            borderRadius: R_PILL,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.05em",
            border: `1px solid ${rgba(BAD, 0.45)}`,
            background: rgba(BAD, 0.1),
            color: BAD,
            whiteSpace: "nowrap",
          }}
        >
          {e.flag}
        </span>
      )}
      <span
        style={{
          marginLeft: "auto",
          fontFamily: MONO,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          color: PAPER,
        }}
      >
        {dur(e.seconds)}
      </span>
    </div>
  );
}

/** APP is behind the login, PUB is the marketing site. Two words, one glance. */
function Tag({ kind }: { kind: "APP" | "PUB" }) {
  const color = kind === "APP" ? ACCENT_TEXT : SKY;
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: R_SM,
        fontFamily: MONO,
        fontSize: 9.5,
        fontWeight: W_MED,
        letterSpacing: "0.09em",
        border: `1px solid ${rgba(color, 0.4)}`,
        background: rgba(color, 0.1),
        color,
      }}
    >
      {kind}
    </span>
  );
}

/* ── Share of time ────────────────────────────────────────────────────────── */

/**
 * Rank carries the weight, not hue: one accent, stepped down in opacity as the
 * bars get shorter. A second color here would read as a second meaning.
 */
function Shares({ c }: { c: Customer }) {
  const max = Math.max(...c.pages.map((p) => p.seconds), 1);
  return (
    <div style={{ display: "grid", gap: 11 }}>
      {c.pages.map((p, i) => (
        <div key={p.label}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 5 }}>
            <span style={{ fontSize: 13, color: PAPER }}>{p.label}</span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: MONO,
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                color: PAPER_QUIET,
              }}
            >
              {dur(p.seconds)}
            </span>
          </div>
          <div style={{ height: 5, borderRadius: R_PILL, background: rgba(PAPER, 0.07) }}>
            <div
              style={{
                height: "100%",
                width: `${Math.max(3, (p.seconds / max) * 100)}%`,
                borderRadius: R_PILL,
                background: rgba(ACCENT, Math.max(0.35, 1 - i * 0.15)),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Small parts ──────────────────────────────────────────────────────────── */

const labelRow: CSSProperties = {
  fontFamily: MONO,
  fontSize: 10.5,
  fontWeight: W_MED,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: PAPER_QUIET,
};

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: PANEL,
        border: `1px solid ${LINE}`,
        borderRadius: R_MD,
        padding: 15,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <span style={labelRow}>{title}</span>
        {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(96px, 34%) 1fr",
        gap: 12,
        alignItems: "start",
        padding: "6px 0",
      }}
    >
      <span style={labelRow}>{label}</span>
      <span style={{ fontSize: 13, color: PAPER, lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

/** Quiet second line. Size and position carry it, not a grey. */
function Sub({ children, inline }: { children: ReactNode; inline?: boolean }) {
  return (
    <span
      style={{
        display: inline ? "inline" : "block",
        marginTop: inline ? 0 : 2,
        fontFamily: MONO,
        fontSize: 11.5,
        color: PAPER_QUIET,
      }}
    >
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: ELEV,
        border: `1px solid ${LINE}`,
        borderRadius: R_SM,
        padding: "9px 11px",
      }}
    >
      <div style={labelRow}>{label}</div>
      <div
        style={{
          marginTop: 4,
          fontFamily: MONO,
          fontSize: 20,
          fontWeight: W_DATA,
          fontVariantNumeric: "tabular-nums",
          color: PAPER,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <span style={{ color: PAPER, fontWeight: W_MED }}>{children}</span>;
}

function Pill({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "5px 11px",
        borderRadius: R_PILL,
        border: `1px solid ${rgba(color, 0.45)}`,
        background: rgba(color, 0.1),
        fontFamily: MONO,
        fontSize: 11,
        fontWeight: W_MED,
        letterSpacing: "0.04em",
        color,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * The header buttons are inert on purpose. This is a sandbox: a live "Reset
 * password" here would mail a real token to a synthetic address.
 */
function Action({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      title="Inert in the sandbox"
      style={{
        padding: "8px 13px",
        borderRadius: R_MD,
        border: `1px solid ${LINE}`,
        background: ELEV,
        color: PAPER,
        font: "inherit",
        fontSize: 13,
        fontWeight: W_MED,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Avatar({ initials, size = 44 }: { initials: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: R_PILL,
        background: rgba(ACCENT, 0.16),
        border: `1px solid ${rgba(ACCENT, 0.45)}`,
        fontFamily: MONO,
        fontSize: size * 0.34,
        fontWeight: W_BOLD,
        letterSpacing: "0.03em",
        color: ACCENT_TEXT,
      }}
    >
      {initials}
    </span>
  );
}
