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
 * Content is static — no fetches, no sockets. The page is deliberately plain
 * React + the shared theme so it stays cheap to keep current when a route is
 * added or renamed.
 *
 * THEME. PageShell + Card + HOME_THEME / LIGHT_BLUE / LEVEL_COLORS only. The
 * one local helper is rgba(), the same converter every themed page carries, so
 * tints stay derived from the theme tokens instead of being written out as
 * literals.
 */

import type { CSSProperties, ReactNode } from "react";
import { HOME_THEME as HT, LIGHT_BLUE, LEVEL_COLORS } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

// rgba helper — matches the convention used across themed pages.
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

const DIM = rgba(HT.text, 0.62);
const DIMMER = rgba(HT.text, 0.42);

// ── small shared bits ────────────────────────────────────────────────────────

const body: CSSProperties = { fontSize: 15, lineHeight: 1.6, color: DIM, margin: "0 0 10px" };

function P({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <p style={{ ...body, ...style }}>{children}</p>;
}

function Strong({ children }: { children: ReactNode }) {
  return <span style={{ color: HT.text, fontWeight: 650 }}>{children}</span>;
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
        color: LIGHT_BLUE,
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

/** Uppercase micro-heading used inside cards. */
function SubHead({ children, color = HT.green }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color,
        margin: "18px 0 8px",
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
        color: rgba(HT.text, 0.85),
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
      <span style={{ fontWeight: 700, color, minWidth: 112, fontSize: 15 }}>{name}</span>
      <span style={{ fontSize: 15, color: DIM, flex: 1, minWidth: 240 }}>{children}</span>
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
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          display: "grid",
          placeItems: "center",
          fontSize: 18,
          background: rgba(HT.cyan, 0.1),
          border: `1px solid ${rgba(HT.cyan, 0.24)}`,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 750, color: HT.text }}>{name}</span>
          <span
            style={{
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              fontSize: 12,
              fontWeight: 600,
              color: LIGHT_BLUE,
              background: rgba(LIGHT_BLUE, 0.09),
              border: `1px solid ${rgba(LIGHT_BLUE, 0.2)}`,
              padding: "1px 7px",
              borderRadius: 6,
            }}
          >
            {route}
          </span>
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

function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 13.5,
        padding: "5px 11px",
        borderRadius: 999,
        background: rgba(HT.text, 0.045),
        border: `1px solid ${HT.border}`,
        color: DIM,
      }}
    >
      {children}
    </span>
  );
}

function Pills({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 7, margin: "10px 0 4px" }}>{children}</div>;
}

// ── playbook card ────────────────────────────────────────────────────────────

function Play({ tone, title, rows }: { tone: string; title: string; rows: [string, ReactNode][] }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${HT.border}`,
        borderLeft: `3px solid ${tone}`,
        padding: "16px 18px",
        background: rgba(HT.text, 0.022),
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 750, color: HT.text, marginBottom: 8 }}>{title}</div>
      <dl style={{ margin: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: DIMMER,
                marginTop: 10,
              }}
            >
              {k}
            </dt>
            <dd style={{ margin: "3px 0 0", fontSize: 14.5, lineHeight: 1.55, color: DIM }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
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
      {/* Hero is a plain div, not a <Card>: it wants the stronger panel fill and
          a cyan wash rather than the shared card surface, and it carries the
          page's <h1>. Everything below it is a real <Card>. */}
      <div
        style={{
          borderRadius: 20,
          border: `1px solid ${HT.border}`,
          padding: "clamp(20px, 3vw, 32px)",
          background: `radial-gradient(circle at 50% 0%, ${rgba(HT.cyan, 0.1)} 0%, transparent 60%), ${HT.panelBgStrong}`,
          backdropFilter: "blur(16px)",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: HT.cyan }}>
          CB Edge · Site guide
        </div>
        <h1 style={{ margin: "8px 0 10px", fontSize: "clamp(24px, 3.4vw, 36px)", lineHeight: 1.1, fontWeight: 800, color: HT.text }}>
          The whole site, <span style={{ color: HT.cyan }}>end to end</span>
        </h1>
        <P style={{ maxWidth: "70ch", fontSize: 16, marginBottom: 0 }}>
          What GEX and DEX actually measure, the levels the platform derives from them, how to trade
          around those levels, and what every page in the app is for.
        </P>
      </div>

      {/* ── 1. concepts ── */}
      <Card title="① The two numbers everything is built on">
        <div style={{ borderLeft: `3px solid ${HT.cyan}`, paddingLeft: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HT.cyan }}>
            GEX — Gamma Exposure
          </div>
          <div style={{ fontSize: 19, fontWeight: 750, color: HT.text, margin: "4px 0 8px" }}>
            How hard dealers have to trade to stay hedged
          </div>
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
                <Strong>Flow GEX</Strong> (Strike History) is the only genuinely dealer-signed series in
                the app — it reads classified tape rather than assuming a side.
              </>,
            ]}
          />
        </div>

        <div style={{ borderLeft: `3px solid ${HT.orange}`, paddingLeft: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HT.orange }}>
            DEX — Delta Exposure
          </div>
          <div style={{ fontSize: 19, fontWeight: 750, color: HT.text, margin: "4px 0 8px" }}>
            Which way dealers are already leaning
          </div>
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
      <Card title="② The levels the platform derives">
        <P>
          Every level on the site comes out of the same strike ladder. These four names appear on Home,
          Multi Greek, Levels, Scanner and the Level Log — same definition everywhere.
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

        <div style={{ ...grid(300), marginTop: 18 }}>
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
                <><Strong>Home</Strong> — the GEX chart with all four marked on the ladder.</>,
                <><Strong>Multi Greek</Strong> — CB / CW / PW for four tickers side by side.</>,
                <><Strong>Levels</Strong> — the same three numbers across the whole roster at once.</>,
                <><Strong>Level Log</Strong> — what those levels <i>were</i> at each 15-min capture, and how spot behaved when it reached one.</>,
              ]}
            />
          </div>
        </div>
      </Card>

      {/* ── 3. regimes ── */}
      <Card title="③ The two regimes — this is the whole edge">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15, minWidth: 620 }}>
            <thead>
              <tr>
                {["", "Positive gamma (spot above flip)", "Negative gamma (spot below flip)"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: DIMMER,
                      padding: "0 12px 9px 0",
                      borderBottom: `1px solid ${HT.border}`,
                    }}
                  >
                    {h || " "}
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
                        color: i === 0 ? HT.text : DIM,
                        fontWeight: i === 0 ? 650 : 400,
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
      <Card title="④ How to actually trade it">
        <div style={grid(330)}>
          <Play
            tone={HT.cyan}
            title="1 · Wall fade (positive gamma)"
            rows={[
              ["Setup", <>Spot <Strong>above the flip</Strong>, approaching the call wall or put wall with no fresh catalyst.</>],
              ["Trigger", <>First rejection candle at the wall on <Strong>ES Candles</Strong>; GEX at that strike still growing (Scanner → GEX Δ Top).</>],
              ["Target", "Core Bullseye. That's the magnet, and it's where the hedging wants price."],
              ["Invalidation", <>Close through the wall, or the wall <Strong>moves</Strong> — if the level rolls, the thesis rolled with it.</>],
            ]}
          />
          <Play
            tone={HT.green}
            title="2 · Flip break (regime change)"
            rows={[
              ["Setup", <>Spot pressing the <Strong>GEX flip</Strong> from above, into the afternoon.</>],
              ["Trigger", "Sustained trade below flip — not a wick. Confirm on the Home GEX chart that cumulative GEX is genuinely negative below."],
              ["Why it works", "Crossing the flip changes who's on the other side of you: hedging goes from cushioning the move to feeding it."],
              ["Management", "Trail. Don't use the put wall as a hard target — in negative gamma, walls are speed bumps, not floors."],
            ]}
          />
          <Play
            tone={HT.cyan}
            title="3 · Pin trade (into expiry)"
            rows={[
              ["Setup", <>0–1 DTE, spot within ~0.3% of the Core Bullseye, positive gamma, no macro print on the <Strong>Economic Calendar</Strong>.</>],
              ["Trigger", "Two failed pushes away from CB. Sell the wings, or fade the extremes back to CB."],
              ["Kill switch", "Any tier-1 econ release, or the CB relocating to a different strike. Both end the pin."],
            ]}
          />
          <Play
            tone={HT.orange}
            title="4 · Far-OTM flag follow (Scanner → Watch This)"
            rows={[
              ["Setup", <>A ticker&apos;s dominant GEX strike sits <Strong>&gt;15% away from spot</Strong> inside 30 DTE — someone is positioned for a move the tape hasn&apos;t made yet.</>],
              ["Read", <>Strike above spot → the OTM <Strong>call</Strong> is the contract in question. Below spot → the <Strong>put</Strong>. Tracked results shows how the contract and the underlying actually performed from the flag date.</>],
              ["Trade", <>It&apos;s a lead, not a signal. Pair with a catalyst (earnings on the calendar, unusual flow on <Strong>Flow</Strong>) before acting.</>],
              ["Reality check", "Most far-OTM flags expire untouched. Size like a lottery ticket, not a thesis."],
            ]}
          />
          <Play
            tone={HT.cyan}
            title="5 · EM band discipline"
            rows={[
              ["Setup", <><Strong>Est. Moves</Strong> gives the option-implied daily range for the ticker.</>],
              ["Use", "Inside the band and in positive gamma → fade the edges. Outside the band early → the day is trending; stop fading it."],
              ["Sizing", "Let the band, not a fixed dollar stop, set the width of your risk. A 1.8% EM day and a 0.6% EM day are not the same trade."],
            ]}
          />
          <Play
            tone={HT.red}
            title="6 · Flow confirmation (never lead with it)"
            rows={[
              ["Setup", <><Strong>Flow</Strong> page: cumulative net call vs net put premium for the active ticker.</>],
              ["Use", "Net premium drifting the same way as your GEX read = conviction. Drifting against it = wait."],
              ["Trap", "A single large print is not flow. Read the cumulative line; one sweep is noise until the drift follows."],
            ]}
          />
        </div>
        <Callout tone="orange">
          <Strong>A workable morning routine:</Strong> Home (regime + levels) → Levels or Multi Greek (is
          this ticker special or is the whole tape doing it) → Economic Calendar (what can break the
          structure) → Est. Moves (how wide is today) → ES Candles for execution → Journal it.
        </Callout>
      </Card>

      {/* ── 5. pages ── */}
      <Card title="⑤ Every page, and what it's for">
        <SubHead color={LIGHT_BLUE}>Core dashboard</SubHead>
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

        <SubHead color={LIGHT_BLUE}>Supporting pages</SubHead>
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
        <Card title="🔍 Scanner · /scanner">
          <P>Nine inline tabs in three clusters, plus three sibling routes.</P>
          <SubHead>Gamma</SubHead>
          <Pills>
            <Pill><Strong>GEX Scanner</Strong> — biggest GEX names now</Pill>
            <Pill><Strong>GEX Δ Top</Strong> — biggest change in GEX</Pill>
            <Pill><Strong>GEX%</Strong> — GEX relative to size</Pill>
            <Pill><Strong>Strike Query</Strong> — ask about one strike</Pill>
          </Pills>
          <SubHead>Structure</SubHead>
          <Pills>
            <Pill><Strong>TPO Structures</Strong></Pill>
            <Pill><Strong>IB Stats</Strong></Pill>
            <Pill><Strong>Market Quality</Strong></Pill>
            <Pill><Strong>Stat Prompter</Strong></Pill>
          </Pills>
          <SubHead>Tracking</SubHead>
          <Pills>
            <Pill><Strong>Watch This</Strong> — far-OTM CB flags (&gt;15% away, ≤30 DTE) with tracked outcomes</Pill>
          </Pills>
          <SubHead>Sibling routes</SubHead>
          <Pills>
            <Pill><Strong>Level Log</Strong> ↗</Pill>
            <Pill><Strong>Strike History</Strong> ↗</Pill>
            <Pill><Strong>Replay</Strong> ↗</Pill>
          </Pills>
        </Card>

        <Card title="⚗️ Test Lab · /test">
          <P>Seven tabs in three clusters. Research surface — treat outputs as hypotheses.</P>
          <SubHead>Gamma</SubHead>
          <Pills>
            <Pill>🌀 <Strong>Squeeze</Strong></Pill>
            <Pill>📏 <Strong>GEX Levels</Strong></Pill>
            <Pill>🎚️ <Strong>Dealer Gamma</Strong></Pill>
            <Pill>🗺️ <Strong>GEX Map</Strong></Pill>
          </Pills>
          <SubHead>Tape (what dollars changed hands)</SubHead>
          <Pills>
            <Pill>🌊 <Strong>Flow Inventory</Strong></Pill>
            <Pill>⚖️ <Strong>Prem Diff</Strong> — ATM premium traded, calls vs puts</Pill>
          </Pills>
          <SubHead>Calendar</SubHead>
          <Pills>
            <Pill>📅 <Strong>Seasonality</Strong> — nothing here updates intraday</Pill>
          </Pills>
          <P style={{ marginTop: 14, marginBottom: 0, fontSize: 14 }}>
            The distinction that matters: the gamma tabs read the <Strong>book</Strong> (what&apos;s
            listed), the tape tabs read the <Strong>prints</Strong> (what traded). When they disagree, the
            tape is usually earlier and the book is usually bigger.
          </P>
        </Card>
      </div>

      {/* ── 7. phone ── */}
      <Card title="⑦ The phone build">
        <P>
          Six purpose-built views at <Code>/app/m/*</Code> — not restyled desktop pages. A phone on a
          matching desktop route is redirected automatically; long-press the tab bar to opt out for the
          session. Desktop browsers are never redirected away, so these can be tested on a laptop.
        </P>
        <Pills>
          <Pill><Strong>GEX</Strong> — gamma exposure chart</Pill>
          <Pill><Strong>Heat</Strong> — GEX heatmap</Pill>
          <Pill><Strong>ES</Strong> — ES candles</Pill>
          <Pill><Strong>Chain</Strong> — option chain</Pill>
          <Pill><Strong>EM</Strong> — estimated moves</Pill>
          <Pill><Strong>Cal</Strong> — economic calendar</Pill>
        </Pills>
        <P style={{ marginTop: 12, marginBottom: 0, fontSize: 14 }}>
          Data is shared, not copied — the phone views ride the same socket and the same endpoints the
          desktop uses, so a number can&apos;t disagree between the two surfaces.
        </P>
      </Card>

      {/* ── 8. rules ── */}
      <Card title="⑧ Rules of the road">
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
                "Not a substitute for a stop. Walls fail — the Level Log exists to show you how often.",
                "Not real-time truth about dealer positioning. The book series assume a hedging convention; only Flow GEX reads classified tape.",
              ]}
            />
          </div>
        </div>
        <Callout tone="orange">
          <Strong>Three habits that separate the people who make money with this from the people who
          don&apos;t:</Strong> check the regime before the level; never take a structural trade over a
          scheduled release without halving size; and log the trade — the Journal page is the only one
          that tells you whether any of the rest of it is working for <i>you</i>.
        </Callout>
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${HT.border}`, fontSize: 13, lineHeight: 1.7, color: DIMMER }}>
          <Strong>Not investment advice.</Strong> Options carry substantial risk, including the total loss
          of premium paid. Everything above describes what the platform measures and how the levels are
          conventionally read — it is not a recommendation to enter any position, and nothing here accounts
          for your account size, risk tolerance or objectives. See the Risk Disclosure and Disclaimer pages.
        </div>
      </Card>
    </PageShell>
  );
}
