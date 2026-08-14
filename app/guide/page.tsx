"use client";

/**
 * /guide — the site guide.
 *
 * One page that explains what GEX and DEX measure, the levels the platform
 * derives from them, how the two gamma regimes change what trade is right, and
 * what every route in the app is for. Linked from the account menu
 * (components/shared/UserMenu.tsx) rather than the toolbar: it is read once and
 * referred back to, not opened every session.
 *
 * Content is static — no fetches, no sockets.
 *
 * THEME. Every panel is a <Card> on the shared dashboard surface. No left
 * accent bars, no per-card accent color: the card treatment is the one in
 * components/shared/PageCard.tsx and nothing here re-styles it.
 *
 * Two documented color exceptions, both deliberate and both single-sourced at
 * the top of this file:
 *   TITLE — every heading on the page (#fb7185). A product decision, not a
 *           theme token; declared once so it cannot drift per section.
 *   LINK  — LIGHT_BLUE from the theme, for the page cross-links.
 * Body copy is HOME_THEME.text (white) throughout — no dimmed gray.
 *
 * Every page name in the copy is a real link to that page (PageLink), so the
 * guide doubles as navigation.
 */

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { HOME_THEME as HT, LIGHT_BLUE, LEVEL_COLORS } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

// rgba helper — matches the convention used across themed pages.
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** Heading color for this page — see the header note. One constant, everywhere. */
const TITLE = "#fb7185";
/** Cross-link color — the theme's light blue. */
const LINK = LIGHT_BLUE;

// ── text primitives ──────────────────────────────────────────────────────────

const body: CSSProperties = { fontSize: 15, lineHeight: 1.6, color: HT.text, margin: "0 0 10px" };

function P({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <p style={{ ...body, ...style }}>{children}</p>;
}

function Strong({ children }: { children: ReactNode }) {
  return <span style={{ color: HT.text, fontWeight: 700 }}>{children}</span>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        fontSize: 13,
        background: rgba(HT.text, 0.06),
        border: `1px solid ${HT.border}`,
        padding: "1px 6px",
        borderRadius: 6,
        color: LINK,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </code>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
      {items.map((it, i) => (
        <li key={i} style={{ ...body, margin: "0 0 7px" }}>
          {it}
        </li>
      ))}
    </ul>
  );
}

/**
 * Cross-link to another page in the app. next/link, not <a>: inside the Vite
 * SPA (basename "/app") href="/flow" resolves to /app/flow, which is the route.
 */
function PageLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      href={to}
      style={{
        color: LINK,
        fontWeight: 650,
        textDecoration: "underline",
        textDecorationColor: rgba(LINK, 0.4),
        textUnderlineOffset: 3,
      }}
    >
      {children}
    </Link>
  );
}

// ── headings ─────────────────────────────────────────────────────────────────

/** Card <title> content — bigger than the shared card header, and TITLE-colored. */
function CardTitle({ children, size = 19 }: { children: ReactNode; size?: number }) {
  return <span style={{ color: TITLE, fontSize: size, letterSpacing: "0.08em" }}>{children}</span>;
}

/** Heading inside a card (block titles, section splits). */
function Head({ children, size = 21 }: { children: ReactNode; size?: number }) {
  return (
    <div style={{ fontSize: size, fontWeight: 750, color: TITLE, margin: "0 0 8px", letterSpacing: "-0.01em" }}>
      {children}
    </div>
  );
}

/** Uppercase micro-heading used inside cards. */
function SubHead({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 14,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: TITLE,
        margin: "20px 0 8px",
      }}
    >
      {children}
    </div>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        fontSize: 13.5,
        background: rgba(HT.bg, 0.55),
        border: `1px solid ${HT.border}`,
        borderRadius: 10,
        padding: "11px 14px",
        margin: "10px 0",
        color: HT.green,
        overflowX: "auto",
      }}
    >
      {children}
    </div>
  );
}

function Callout({ tone = "cyan", children }: { tone?: "cyan" | "orange"; children: ReactNode }) {
  const c = tone === "orange" ? HT.orange : HT.cyan;
  return (
    <div
      style={{
        borderRadius: 14,
        padding: "15px 18px",
        fontSize: 15,
        lineHeight: 1.6,
        background: rgba(c, 0.07),
        border: `1px solid ${rgba(c, 0.28)}`,
        color: HT.text,
        marginTop: 16,
      }}
    >
      {children}
    </div>
  );
}

function Accented({ tone, children }: { tone: string; children: ReactNode }) {
  return <span style={{ color: tone, fontWeight: 700 }}>{children}</span>;
}

const grid = (min: number): CSSProperties => ({
  display: "grid",
  gap: 16,
  gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
});

// ── level ladder ─────────────────────────────────────────────────────────────

function Rung({ color, name, children }: { color: string; name: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 13px",
        borderRadius: 10,
        background: rgba(color, 0.07),
        border: `1px solid ${rgba(color, 0.25)}`,
        flexWrap: "wrap",
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flex: "none" }} />
      <span style={{ fontWeight: 750, color, minWidth: 112, fontSize: 15 }}>{name}</span>
      <span style={{ fontSize: 15, color: HT.text, flex: 1, minWidth: 240 }}>{children}</span>
    </div>
  );
}

// ── page directory row ───────────────────────────────────────────────────────

function PageRow({
  icon,
  name,
  route,
  what,
  use,
}: {
  icon: string;
  name: string;
  route: string;
  what: ReactNode;
  use: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 14,
        padding: "16px 0",
        borderBottom: `1px solid ${rgba(HT.text, 0.06)}`,
      }}
    >
      <Link
        href={route}
        aria-label={`Open ${name}`}
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          display: "grid",
          placeItems: "center",
          fontSize: 18,
          textDecoration: "none",
          background: rgba(HT.cyan, 0.1),
          border: `1px solid ${rgba(HT.cyan, 0.24)}`,
        }}
      >
        {icon}
      </Link>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <Link href={route} style={{ fontSize: 19, fontWeight: 750, color: TITLE, textDecoration: "none" }}>
            {name}
          </Link>
          <Link
            href={route}
            style={{
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              fontSize: 12,
              fontWeight: 600,
              color: LINK,
              background: rgba(LINK, 0.09),
              border: `1px solid ${rgba(LINK, 0.2)}`,
              padding: "1px 7px",
              borderRadius: 6,
              textDecoration: "none",
            }}
          >
            {route}
          </Link>
        </div>
        <P style={{ margin: "5px 0 0" }}>{what}</P>
        <div style={{ marginTop: 6, fontSize: 14, color: HT.green }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 7 }}>
            Use it for
          </span>
          {use}
        </div>
      </div>
    </div>
  );
}

// ── pills (each one navigates to the view it names) ──────────────────────────

function Pill({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      href={to}
      style={{
        fontSize: 13.5,
        padding: "5px 11px",
        borderRadius: 999,
        background: rgba(HT.text, 0.045),
        border: `1px solid ${HT.border}`,
        color: HT.text,
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      {children}
    </Link>
  );
}

function Pills({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 7, margin: "10px 0 4px" }}>{children}</div>;
}

// ── playbook card ────────────────────────────────────────────────────────────

function Play({ title, rows }: { title: ReactNode; rows: [string, ReactNode][] }) {
  return (
    <Card variant="classic" padding={18} title={<CardTitle size={17}>{title}</CardTitle>}>
      <dl style={{ margin: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: HT.text,
                opacity: 0.75,
                marginTop: 10,
              }}
            >
              {k}
            </dt>
            <dd style={{ margin: "3px 0 0", fontSize: 14.5, lineHeight: 1.55, color: HT.text }}>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// ── regime table ─────────────────────────────────────────────────────────────

const REGIME_ROWS: [string, ReactNode, ReactNode][] = [
  ["Dealer hedging",
    <>Sells rallies, buys dips — <Accented tone={HT.green}>dampens</Accented> the move</>,
    <>Buys rallies, sells dips — <Accented tone={HT.red}>amplifies</Accented> the move</>],
  ["Tape feels", "Sticky, mean-reverting, rotational", "Slippery, trending, air pockets"],
  ["Realised vol", "Compresses through the day", "Expands, especially after 14:00 ET"],
  ["Levels", "Walls hold. Fade the edges.", "Walls break. Trade the break."],
  ["Right trade",
    "Range fades, iron condors, credit spreads, mean reversion to CB",
    "Breakout continuation, debit spreads, long premium, trail don't target"],
  ["Wrong trade", "Chasing breakouts that immediately fail", "Fading the extreme “because it's stretched”"],
  ["Stop discipline", "Tight — reversion should work fast", "Wide or structural — noise is bigger than you think"],
];

// ═════════════════════════════════════════════════════════════════════════════

export default function GuidePage() {
  return (
    <PageShell>
      {/* Hero carries the page's <h1>; same card surface as everything below. */}
      <Card>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: HT.cyan }}>
          CB Edge · Site guide
        </div>
        <h1 style={{ margin: "8px 0 10px", fontSize: "clamp(26px, 3.6vw, 38px)", lineHeight: 1.1, fontWeight: 800, color: TITLE }}>
          The whole site, end to end
        </h1>
        <P style={{ maxWidth: "70ch", fontSize: 16, marginBottom: 0 }}>
          What GEX and DEX actually measure, the levels the platform derives from them, how to trade
          around those levels, and what every page in the app is for. Every page name below is a link —
          click it to go there.
        </P>
      </Card>

      {/* ── 1. concepts ── */}
      <Card title={<CardTitle>① The two numbers everything is built on</CardTitle>}>
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: TITLE }}>
            GEX — Gamma Exposure
          </div>
          <Head>How hard dealers have to trade to stay hedged</Head>
          <P>
            Gamma is the rate of change of an option&apos;s delta. Market makers who sold you the option
            hedge that delta in the underlying — so as price moves, their hedge has to move too. GEX is
            the dollar size of that forced hedging, strike by strike.
          </P>
          <Formula>GEX(strike) = Γ × OI × 100 × spot² × 0.01 &nbsp;→&nbsp; $ of delta dealers must buy/sell per 1% move</Formula>
          <Bullets
            items={[
              <>
                <Strong>Sign is a convention.</Strong> The book series (<Code>net_gex</Code>,{" "}
                <Code>net_vol_gex</Code>) assume dealers are long calls / short puts — call strikes come
                out positive, put strikes negative. Positive isn&apos;t &ldquo;bullish&rdquo;; it means{" "}
                <i>stabilising</i> at that strike.
              </>,
              <>
                <Strong>Big |GEX| = a magnet.</Strong> Large open interest at a strike means large hedging
                flow concentrated there, which pins price to it — especially into expiry.
              </>,
              <>
                <Strong>OI GEX vs Volume GEX.</Strong> OI GEX is yesterday&apos;s book (the standing
                structure). Volume GEX is what has traded <i>today</i> — it moves first and tells you where
                the book is being rebuilt.
              </>,
              <>
                <Strong>Flow GEX</Strong> (on <PageLink to="/strike-history">Strike History</PageLink>) is
                the only genuinely dealer-signed series in the app — it reads classified tape rather than
                assuming a side.
              </>,
            ]}
          />
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: TITLE }}>
            DEX — Delta Exposure
          </div>
          <Head>Which way dealers are already leaning</Head>
          <P>
            Delta is directional exposure. DEX aggregates the dealer&apos;s net delta across the chain —
            the position they are <i>already</i> carrying, before the next tick.
          </P>
          <Formula>DEX(strike) = Δ × OI × 100 × spot &nbsp;→&nbsp; $ of directional exposure on the book</Formula>
          <Bullets
            items={[
              <>
                <Strong>GEX tells you how price behaves; DEX tells you which way the pressure points.</Strong>{" "}
                GEX is about the shape of the path (sticky vs slippery). DEX is about the lean.
              </>,
              <>
                <Strong>Heavily negative dealer delta</Strong> means dealers must buy into strength to stay
                flat — supportive drift. Heavily positive means they sell into rallies — capping drift.
              </>,
              <>
                <Strong>DEX rebuilds fastest at the front.</Strong> 0DTE delta decays to 0 or 1 through the
                day, so the lean flips hard into the close far more often than GEX does.
              </>,
              <>
                <Strong>Charm and vanna</Strong> are the second-order cousins: charm is delta decaying with
                time (the classic afternoon drift), vanna is delta changing with volatility (the drift you
                get when VIX bleeds down on an up day).
              </>,
            ]}
          />
        </div>

        <Callout>
          <Strong>The one-sentence version:</Strong> GEX says whether the tape will chop or trend; DEX says
          which direction the hedging drift wants to go. You want both agreeing before you size up.
        </Callout>
      </Card>

      {/* ── 2. levels ── */}
      <Card title={<CardTitle>② The levels the platform derives</CardTitle>}>
        <P>
          Every level on the site comes out of the same strike ladder. These four names appear on{" "}
          <PageLink to="/home">Home</PageLink>, <PageLink to="/mult-greek">Multi Greek</PageLink>,{" "}
          <PageLink to="/levels">Levels</PageLink>, <PageLink to="/scanner">Scanner</PageLink> and the{" "}
          <PageLink to="/level-log">Level Log</PageLink> — same definition everywhere.
        </P>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "14px 0 4px" }}>
          <Rung color={LEVEL_COLORS.cw} name="Call Wall">
            Highest <Strong>+GEX</Strong> strike. The ceiling — dealers sell into it. Above spot.
          </Rung>
          <Rung color={LEVEL_COLORS.cb} name="Core Bullseye">
            Highest <Strong>|GEX|</Strong> strike overall. The magnet / pin. Price gravitates here.
          </Rung>
          <Rung color={LEVEL_COLORS.pw} name="Put Wall">
            Most <Strong>−GEX</Strong> strike. The floor — dealers buy into it. Below spot.
          </Rung>
          <Rung color={HT.orange} name="GEX Flip">
            Where cumulative GEX crosses zero. Above it = stabilising regime; below = accelerating.
          </Rung>
        </div>

        <div style={{ ...grid(300), marginTop: 8 }}>
          <div>
            <SubHead>Reading them together</SubHead>
            <Bullets
              items={[
                <><Strong>Wall to wall</Strong> is the expected range while the book holds. Most sessions live inside it.</>,
                <><Strong>CB near spot</Strong> = pin risk. CB far from spot = the market has somewhere to go.</>,
                <><Strong>Walls that move</Strong> matter more than walls that sit. A call wall rolling up through the day is the book giving permission to trend.</>,
                <><Strong>Flip below spot</Strong> and the tape is well-behaved. <Strong>Flip above spot</Strong> and every move gets amplified.</>,
              ]}
            />
          </div>
          <div>
            <SubHead>Where each one lives</SubHead>
            <Bullets
              items={[
                <><PageLink to="/home">Home</PageLink> — the GEX chart with all four marked on the ladder.</>,
                <><PageLink to="/mult-greek">Multi Greek</PageLink> — CB / CW / PW for four tickers side by side.</>,
                <><PageLink to="/levels">Levels</PageLink> — the same three numbers across the whole roster at once.</>,
                <><PageLink to="/level-log">Level Log</PageLink> — what those levels <i>were</i> at each 15-min capture, and how spot behaved when it reached one.</>,
              ]}
            />
          </div>
        </div>
      </Card>

      {/* ── 3. regimes ── */}
      <Card title={<CardTitle>③ The two regimes — this is the whole edge</CardTitle>}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15, minWidth: 620 }}>
            <thead>
              <tr>
                {["", "Positive gamma (spot above flip)", "Negative gamma (spot below flip)"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: TITLE,
                      padding: "0 12px 9px 0",
                      borderBottom: `1px solid ${HT.border}`,
                    }}
                  >
                    {h || " "}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REGIME_ROWS.map(([label, pos, neg]) => (
                <tr key={label}>
                  {[label, pos, neg].map((cell, i) => (
                    <td
                      key={i}
                      style={{
                        padding: "11px 12px 11px 0",
                        borderBottom: `1px solid ${rgba(HT.text, 0.05)}`,
                        verticalAlign: "top",
                        color: HT.text,
                        fontWeight: i === 0 ? 700 : 400,
                        whiteSpace: i === 0 ? "nowrap" : "normal",
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout tone="orange">
          <Strong>Regime first, direction second.</Strong> The most common way to lose with this data is to
          have the right level and the wrong regime. Check where spot sits vs the flip <i>before</i> you
          decide whether a level is a fade or a trigger.
        </Callout>
      </Card>

      {/* ── 4. playbook ── */}
      <Card title={<CardTitle>④ How to actually trade it</CardTitle>}>
        <div style={grid(330)}>
          <Play
            title="1 · Wall fade (positive gamma)"
            rows={[
              ["Setup", <>Spot <Strong>above the flip</Strong>, approaching the call wall or put wall with no fresh catalyst.</>],
              ["Trigger", <>First rejection candle at the wall on <PageLink to="/es-candles">ES Candles</PageLink>; GEX at that strike still growing (<PageLink to="/scanner?tab=gexchangetop">GEX Δ Top</PageLink>).</>],
              ["Target", "Core Bullseye. That's the magnet, and it's where the hedging wants price."],
              ["Invalidation", <>Close through the wall, or the wall <Strong>moves</Strong> — if the level rolls, the thesis rolled with it.</>],
            ]}
          />
          <Play
            title="2 · Flip break (regime change)"
            rows={[
              ["Setup", <>Spot pressing the <Strong>GEX flip</Strong> from above, into the afternoon.</>],
              ["Trigger", <>Sustained trade below flip — not a wick. Confirm on the <PageLink to="/home">Home</PageLink> GEX chart that cumulative GEX is genuinely negative below.</>],
              ["Why it works", "Crossing the flip changes who's on the other side of you: hedging goes from cushioning the move to feeding it."],
              ["Management", "Trail. Don't use the put wall as a hard target — in negative gamma, walls are speed bumps, not floors."],
            ]}
          />
          <Play
            title="3 · Pin trade (into expiry)"
            rows={[
              ["Setup", <>0–1 DTE, spot within ~0.3% of the Core Bullseye, positive gamma, no macro print on the <PageLink to="/economic-calendar">Economic Calendar</PageLink>.</>],
              ["Trigger", "Two failed pushes away from CB. Sell the wings, or fade the extremes back to CB."],
              ["Kill switch", "Any tier-1 econ release, or the CB relocating to a different strike. Both end the pin."],
            ]}
          />
          <Play
            title="4 · Far-OTM flag follow"
            rows={[
              ["Setup", <>On <PageLink to="/scanner?tab=watch">Watch This</PageLink>: a ticker&apos;s dominant GEX strike sits <Strong>&gt;15% away from spot</Strong> inside 30 DTE — someone is positioned for a move the tape hasn&apos;t made yet.</>],
              ["Read", <>Strike above spot → the OTM <Strong>call</Strong> is the contract in question. Below spot → the <Strong>put</Strong>. Tracked results shows how the contract and the underlying actually performed from the flag date.</>],
              ["Trade", <>It&apos;s a lead, not a signal. Pair with a catalyst (earnings on the <PageLink to="/economic-calendar">Economic Calendar</PageLink>, unusual flow on <PageLink to="/flow">Flow</PageLink>) before acting.</>],
              ["Reality check", "Most far-OTM flags expire untouched. Size like a lottery ticket, not a thesis."],
            ]}
          />
          <Play
            title="5 · EM band discipline"
            rows={[
              ["Setup", <><PageLink to="/em">Est. Moves</PageLink> gives the option-implied daily range for the ticker.</>],
              ["Use", "Inside the band and in positive gamma → fade the edges. Outside the band early → the day is trending; stop fading it."],
              ["Sizing", "Let the band, not a fixed dollar stop, set the width of your risk. A 1.8% EM day and a 0.6% EM day are not the same trade."],
            ]}
          />
          <Play
            title="6 · Flow confirmation (never lead with it)"
            rows={[
              ["Setup", <><PageLink to="/flow">Flow</PageLink>: cumulative net call vs net put premium for the active ticker.</>],
              ["Use", "Net premium drifting the same way as your GEX read = conviction. Drifting against it = wait."],
              ["Trap", "A single large print is not flow. Read the cumulative line; one sweep is noise until the drift follows."],
            ]}
          />
        </div>
        <Callout tone="orange">
          <Strong>A workable morning routine:</Strong> <PageLink to="/home">Home</PageLink> (regime +
          levels) → <PageLink to="/levels">Levels</PageLink> or{" "}
          <PageLink to="/mult-greek">Multi Greek</PageLink> (is this ticker special or is the whole tape
          doing it) → <PageLink to="/economic-calendar">Economic Calendar</PageLink> (what can break the
          structure) → <PageLink to="/em">Est. Moves</PageLink> (how wide is today) →{" "}
          <PageLink to="/es-candles">ES Candles</PageLink> for execution →{" "}
          <PageLink to="/trading">Journal</PageLink> it.
        </Callout>
      </Card>

      {/* ── 5. pages ── */}
      <Card title={<CardTitle>⑤ Every page, and what it&apos;s for</CardTitle>}>
        <SubHead>Core dashboard</SubHead>
        <PageRow
          icon="🏠" name="Home" route="/home"
          what="The main GEX chart with the strike ladder, Core Bullseye / call wall / put wall / flip marked, plus docked panels: gauges, GEX pulse, whale orders, net premium, greeks and the econ calendar. Strike hover and detail popups drill into any single strike."
          use="the first read of the day: regime, levels, and whether anything is unusual."
        />
        <PageRow
          icon="🧮" name="Multi Greek" route="/mult-greek"
          what="Four tickers side by side (SPX, SPY, QQQ + one you pick), each with a full price-scaled greek ladder and its CB / CW / PW marked. Double-click a header to blow that ticker's real option chain up full screen."
          use="confirming a level across correlated names before trusting it."
        />
        <PageRow
          icon="🧱" name="Levels" route="/levels"
          what="The entire scanner universe on one board — one cell per ticker showing its Core Bullseye, the move vs that core, and where spot sits between the walls. Pin up to four as full ladders."
          use="finding which names are pinned, which are stretched, and where the outliers are."
        />
        <PageRow
          icon="📊" name="Traders Dashboard" route="/traders-dashboard"
          what="The daily operating page: schedule, tasks, futures quotes, movers, the market overview write-up with drivers, sector sunburst, and quick links."
          use="the pre-open orientation — context, not execution."
        />
        <PageRow
          icon="⛓️" name="Options Chain" route="/options-chain"
          what="Full chain with per-strike greeks, colour-scaled metric cells, expiry selection (0DTE / 1DTE / weekly / monthly), OI vs volume basis switching, and chain replay."
          use="verifying what's actually at a strike before you trade the level."
        />
        <PageRow
          icon="↔️" name="Est. Moves" route="/em"
          what="Option-implied expected move per ticker, with historical EM stats, win rate on the band, and recent recommendations."
          use="sizing, and deciding whether today is a fade day or a trend day."
        />
        <PageRow
          icon="🕯️" name="ES Candles" route="/es-candles"
          what="One to three synchronised candle charts under one toolbar, with overlays, bubbles, TPO, volume profile and VSA. The greek / level rails ride the right edge."
          use="execution — this is where the level becomes an entry."
        />
        <PageRow
          icon="🌊" name="Flow" route="/flow"
          what="Per-ticker cumulative net premium (net call vs net put) plus the raw flow tape, filterable by side, type, premium size, expiry and moneyness. Click a print to open the contract drawer."
          use="confirming or vetoing a directional read."
        />
        <PageRow
          icon="📈" name="Analysis" route="/analytics"
          what="Strategy-builder surface: ticker lookup card, AMT / initial-balance logic, econ panel and composite reads pulled together in one place."
          use="building and sanity-checking a repeatable setup."
        />
        <PageRow
          icon="🎯" name="ICT" route="/ict"
          what="Live ICT detection over the 5-min ES feed — fair value gaps, order blocks, BSL/SSL liquidity pools, BOS / CHOCH / MSS structure events, kill zones, Silver Bullet, macros, and the premium/discount + OTE dealing range — with a glossary beside the live reads."
          use="timing an entry inside a level you already like."
        />
        <PageRow
          icon="🔍" name="Scanner" route="/scanner"
          what="Nine tabs of cross-market scanning plus three sibling pages — broken down in section ⑥."
          use="finding the trade rather than managing one."
        />
        <PageRow
          icon="⚗️" name="Test Lab" route="/test"
          what="Seven experimental tabs — squeeze, GEX levels, dealer gamma, GEX map, flow inventory, premium diff and seasonality."
          use="research. Nothing here is a finished signal."
        />
        <PageRow
          icon="📓" name="Journal" route="/trading"
          what="Per-day journaling backed by the database and scoped to your account: net P&L, trade count, notes, and the equity / stat charts built off them."
          use="the only part of this that actually compounds."
        />

        <SubHead>Supporting pages</SubHead>
        <PageRow
          icon="🗓️" name="Economic Calendar" route="/economic-calendar"
          what="Macro releases with impact tiers, forecast / previous / actual, plus earnings grouped by date."
          use="knowing what can invalidate a structural trade before you take it."
        />
        <PageRow
          icon="🧾" name="Level Log" route="/level-log"
          what="Walls and CORE levels captured at 09:29 ET and every 15 minutes to the close, written only when they change. Every time spot traded into a live level it is classified four slots later: reject / break / broke and consolidated / new wall / pin."
          use={<>the honest answer to &ldquo;do these levels actually hold?&rdquo; on this ticker.</>}
        />
        <PageRow
          icon="🕘" name="Strike History" route="/strike-history"
          what="One strike, over time: net GEX, volume-weighted net GEX, Flow GEX (the dealer-signed series), and IV skew vs the at-the-money strike. RTH / ETH windowing recomputes every derived stat."
          use="seeing whether a wall is being built or unwound."
        />
        <PageRow
          icon="⏪" name="Replay" route="/replay"
          what="Step back through a recorded session's chain and levels."
          use="reviewing a setup at the speed it actually happened."
        />
        <PageRow
          icon="📐" name="Fails" route="/fails"
          what="Reference-level failure scanning with live initial balance for ES and NQ, AMT computation and trigger detection."
          use="failed-breakout setups off the session's reference levels."
        />
        <PageRow
          icon="🎚️" name="Confidence Score" route="/confidence-score"
          what="Composite score combining proximity to level, GEX magnitude, gamma regime, distance to flip, DEX bias, time-of-day weight, GEX rank and historical rejection rate at that level."
          use="a second opinion when you're on the fence — same inputs, weighted consistently."
        />
      </Card>

      {/* ── 6. scanner / test lab ── */}
      <div style={grid(340)}>
        <Card title={<CardTitle>🔍 Scanner</CardTitle>}>
          <P>
            Nine inline tabs in three clusters, plus three sibling routes. Every pill below opens that
            view on <PageLink to="/scanner">Scanner</PageLink>.
          </P>
          <SubHead>Gamma</SubHead>
          <Pills>
            <Pill to="/scanner?tab=gex"><Strong>GEX Scanner</Strong> — biggest GEX names now</Pill>
            <Pill to="/scanner?tab=gexchangetop"><Strong>GEX Δ Top</Strong> — biggest change in GEX</Pill>
            <Pill to="/scanner?tab=gexpct"><Strong>GEX%</Strong> — GEX relative to size</Pill>
            <Pill to="/scanner?tab=strike"><Strong>Strike Query</Strong> — ask about one strike</Pill>
          </Pills>
          <SubHead>Structure</SubHead>
          <Pills>
            <Pill to="/scanner?tab=tpo"><Strong>TPO Structures</Strong></Pill>
            <Pill to="/scanner?tab=ibstats"><Strong>IB Stats</Strong></Pill>
            <Pill to="/scanner?tab=marketquality"><Strong>Market Quality</Strong></Pill>
            <Pill to="/scanner?tab=statprompter"><Strong>Stat Prompter</Strong></Pill>
          </Pills>
          <SubHead>Tracking</SubHead>
          <Pills>
            <Pill to="/scanner?tab=watch"><Strong>Watch This</Strong> — far-OTM CB flags (&gt;15% away, ≤30 DTE)</Pill>
          </Pills>
          <SubHead>Sibling routes</SubHead>
          <Pills>
            <Pill to="/level-log"><Strong>Level Log</Strong> ↗</Pill>
            <Pill to="/strike-history"><Strong>Strike History</Strong> ↗</Pill>
            <Pill to="/replay"><Strong>Replay</Strong> ↗</Pill>
          </Pills>
        </Card>

        <Card title={<CardTitle>⚗️ Test Lab</CardTitle>}>
          <P>
            Seven tabs in three clusters on <PageLink to="/test">Test Lab</PageLink>. Research surface —
            treat outputs as hypotheses.
          </P>
          <SubHead>Gamma</SubHead>
          <Pills>
            <Pill to="/test?tab=squeeze">🌀 <Strong>Squeeze</Strong></Pill>
            <Pill to="/test?tab=gexlevels">📏 <Strong>GEX Levels</Strong></Pill>
            <Pill to="/test?tab=dealergamma">🎚️ <Strong>Dealer Gamma</Strong></Pill>
            <Pill to="/test?tab=gexmap">🗺️ <Strong>GEX Map</Strong></Pill>
          </Pills>
          <SubHead>Tape (what dollars changed hands)</SubHead>
          <Pills>
            <Pill to="/test?tab=flow">🌊 <Strong>Flow Inventory</Strong></Pill>
            <Pill to="/test?tab=premdiff">⚖️ <Strong>Prem Diff</Strong> — ATM premium traded</Pill>
          </Pills>
          <SubHead>Calendar</SubHead>
          <Pills>
            <Pill to="/test?tab=seasonality">📅 <Strong>Seasonality</Strong> — nothing here updates intraday</Pill>
          </Pills>
          <P style={{ marginTop: 14, marginBottom: 0, fontSize: 14 }}>
            The distinction that matters: the gamma tabs read the <Strong>book</Strong> (what&apos;s
            listed), the tape tabs read the <Strong>prints</Strong> (what traded). When they disagree, the
            tape is usually earlier and the book is usually bigger.
          </P>
        </Card>
      </div>

      {/* ── 7. phone ── */}
      <Card title={<CardTitle>⑦ The phone build</CardTitle>}>
        <P>
          Six purpose-built views at <Code>/app/m/*</Code> — not restyled desktop pages. A phone on a
          matching desktop route is redirected automatically; long-press the tab bar to opt out for the
          session. Desktop browsers are never redirected away, so these can be opened on a laptop too.
        </P>
        <Pills>
          <Pill to="/m/gex"><Strong>GEX</Strong> — gamma exposure chart</Pill>
          <Pill to="/m/heatmap"><Strong>Heat</Strong> — GEX heatmap</Pill>
          <Pill to="/m/es"><Strong>ES</Strong> — ES candles</Pill>
          <Pill to="/m/chain"><Strong>Chain</Strong> — option chain</Pill>
          <Pill to="/m/em"><Strong>EM</Strong> — estimated moves</Pill>
          <Pill to="/m/econ"><Strong>Cal</Strong> — economic calendar</Pill>
        </Pills>
        <P style={{ marginTop: 12, marginBottom: 0, fontSize: 14 }}>
          Data is shared, not copied — the phone views ride the same socket and the same endpoints the
          desktop uses, so a number can&apos;t disagree between the two surfaces.
        </P>
      </Card>

      {/* ── 8. rules ── */}
      <Card title={<CardTitle>⑧ Rules of the road</CardTitle>}>
        <div style={grid(300)}>
          <div>
            <SubHead>What this data is good at</SubHead>
            <Bullets
              items={[
                <><Strong>Where</Strong> price is likely to stall, pin, or accelerate.</>,
                <><Strong>How</Strong> the tape will behave — chop vs trend — which is a sizing and stop decision.</>,
                <><Strong>When</Strong> the structure changes: walls moving, flip crossing, GEX rebuilding.</>,
              ]}
            />
          </div>
          <div>
            <SubHead>What it is not</SubHead>
            <Bullets
              items={[
                "Not a direction signal on its own. GEX is positioning, not intent.",
                "Not valid through a catalyst. A CPI print rewrites the book in minutes.",
                <>Not a substitute for a stop. Walls fail — the <PageLink to="/level-log">Level Log</PageLink> exists to show you how often.</>,
                <>Not real-time truth about dealer positioning. The book series assume a hedging convention; only Flow GEX on <PageLink to="/strike-history">Strike History</PageLink> reads classified tape.</>,
              ]}
            />
          </div>
        </div>
        <Callout tone="orange">
          <Strong>Three habits that separate the people who make money with this from the people who
          don&apos;t:</Strong> check the regime before the level; never take a structural trade over a
          scheduled release without halving size; and log the trade — the{" "}
          <PageLink to="/trading">Journal</PageLink> page is the only one that tells you whether any of
          the rest of it is working for <i>you</i>.
        </Callout>
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${HT.border}`, fontSize: 13.5, lineHeight: 1.7, color: HT.text }}>
          <Strong>Not investment advice.</Strong> Options carry substantial risk, including the total loss
          of premium paid. Everything above describes what the platform measures and how the levels are
          conventionally read — it is not a recommendation to enter any position, and nothing here accounts
          for your account size, risk tolerance or objectives. See the Risk Disclosure and Disclaimer pages.
        </div>
      </Card>
    </PageShell>
  );
}
