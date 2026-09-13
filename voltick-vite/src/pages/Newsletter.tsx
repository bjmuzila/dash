/**
 * The Weekly Edge, rendered in the Voltick system.
 *
 * The content is last week's CB Edge letter. Nothing about the words changed
 * except the punctuation: the email uses em-dashes, and this system does not,
 * so they are middle dots, commas and colons here.
 *
 * What DID change is every color decision. The email paints its own palette
 * (cyan eyebrows, a green tile, a red tile, amber accents) and those hexes do
 * not exist here. The mapping, once, so it is not re-argued per section:
 *
 *   email cyan eyebrow  -> ACCENT_TEXT   the accent, when it has to be text
 *   email green         -> GOOD          data only, never chrome
 *   email red           -> BAD           data only, never chrome
 *   email amber         -> VOLT          a level's reserved color, so it is
 *                                        spent on the score table and nowhere
 *                                        decorative
 *   email greys         -> PAPER_QUIET   the one quiet token. There is no grey.
 *
 * Numbers are the letter's own and are frozen at Sep 11. When this becomes a
 * live surface it reads them from the API; today it is the letter, on theme.
 */
import type { ReactNode } from "react";
import {
  ACCENT,
  ACCENT_TEXT,
  BAD,
  GOOD,
  LINE,
  MONO,
  PAPER,
  PAPER_DISPLAY,
  PAPER_QUIET,
  R_LG,
  R_MD,
  R_PILL,
  VOLT,
  W_BOLD,
  W_DATA,
  W_MED,
  rgba,
} from "../theme";
import { Card, Hairline, PageShell } from "../components/PageCard";

export default function Newsletter() {
  return (
    <PageShell
      title="The Weekly Edge"
      maxWidth={860}
      lede={
        <>
          Week of Sep 14 to 18. Last week's recap, this week's catalysts, and where CB Edge called it
          right. This is the letter that goes out on Sunday, drawn in the Voltick system rather than in
          the email's own palette.
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <Deck>
          Core CPI ran hot, the 10-year is knocking on 5%, and crude is back over $100, into a Fed
          decision and a quarterly expiration.
        </Deck>

        {/* ── Last week ─────────────────────────────────────────────────── */}
        <Section
          eyebrow="Last week recap"
          headline="Core CPI came in hot, and the 10-year went looking for 5%"
        >
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              marginBottom: 16,
            }}
          >
            <Stat label="S&P 500" value="-0.8%" color={BAD} tint={BAD} />
            <Stat label="Nasdaq" value="-0.7%" color={BAD} tint={BAD} />
            <Stat label="Dow" value="-1.6%" color={BAD} tint={BAD} />
          </div>

          <P>
            Four sessions, and Friday was the only green one. The S&P finished the week -0.8%, the
            Nasdaq -0.7%, the Dow -1.6%, with Friday's bounce snapping a four-day losing streak. August
            CPI itself was fine: +0.4% on the month, 3.4% year over year, both in line.{" "}
            <Strong>Core was the problem: +0.3% against +0.2% expected.</Strong> That is the number the
            Fed actually reacts to, and odds of a hike at this week's meeting went to roughly 90%.
          </P>
          <P>
            The bond market did the moving. The 10-year pushed toward 5%, Germany's went through 3.51%
            and Japan's hit 2.985%, its highest since 1996. The consumer is not enjoying it either:
            preliminary Michigan sentiment came in at 47.8 against 51.0 expected. The bright spot was
            Oracle, where cloud revenue grew 62% year over year and dragged the rest of the
            AI-infrastructure complex up with it. Energy did the other half of the damage, more on that
            below.
          </P>
        </Section>

        {/* ── This week ─────────────────────────────────────────────────── */}
        <Section
          eyebrow="This week ahead"
          headline="The Fed decides Wednesday at 2:00, and Friday is quarterly expiration"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Day day="Mon 9/14" tickers={["PLAY"]}>
              Nothing on the calendar. The tape spends the day positioning into Wednesday.
            </Day>
            <Day day="Tue 9/15" tickers={["TCOM"]}>
              <Strong>Empire State Manufacturing</Strong> at 8:30, and the{" "}
              <Strong>FOMC's two-day meeting begins</Strong>. Trip.com reports after the close.
            </Day>
            <Day day="Wed 9/16" tickers={["GIS", "LEN"]}>
              <Strong>August retail sales</Strong> plus import and export prices at 8:30. Then the whole
              week: the <Strong>FOMC statement and the dot plot at 2:00</Strong>, and{" "}
              <Strong>Chair Warsh's press conference at 2:30</Strong>. General Mills before the bell,
              Lennar after it: a homebuilder reporting into 7%+ mortgage rates, hours after the Fed
              speaks.
            </Day>
            <Day day="Thu 9/17" tickers={["FDX", "DRI", "CCL"]}>
              <Strong>Jobless claims</Strong>, housing starts and building permits at 8:30, pending home
              sales at 10:00. The first full session to trade the decision rather than anticipate it.
              Darden and Carnival before the bell, <Strong>FedEx</Strong> after the close.
            </Day>
            <Day day="Fri 9/18">
              Industrial production at 9:15 and Leading Indicators at 10:00, and{" "}
              <Strong>quarterly expiration</Strong>. Quad witching, the biggest gamma roll of the
              quarter.
            </Day>
          </div>
        </Section>

        {/* ── The AI trade ──────────────────────────────────────────────── */}
        <Section
          eyebrow="The AI trade"
          headline="Three CEOs who compete on this just agreed to slow it down"
        >
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              marginBottom: 16,
            }}
          >
            <Quote who="Dario Amodei" where="Anthropic">
              We must slow the pace at which we improve the capabilities of AI models.
            </Quote>
            <Quote who="Sam Altman" where="OpenAI">
              I agree with Dario that we need to pace the frontier.
            </Quote>
            <Quote who="Elon Musk" where="xAI">
              Dario is right.
            </Quote>
          </div>

          <P>
            Amodei's warning on Friday was that AI agents could "take over the entire internet" inside
            six to twelve months. Altman and Musk agreed the same afternoon. Nothing proposed is binding.
          </P>
          <P>
            <Strong>What it means for the tape:</Strong> the AI-capex complex is what has carried this
            market. It is most of why the Nasdaq held up through August, and it is why Oracle moved the
            whole group last week. That complex now has its own founders arguing publicly for a slower
            build, landing in the same four-day week as a Fed decision and a quarterly expiration.
          </P>
          <P>
            Not everyone read it as altruism. Chamath Palihapitiya argued the essay conveniently
            concentrates power with Anthropic, and the administration has shown no appetite for slowing
            anything down.
          </P>
        </Section>

        {/* ── Oil ───────────────────────────────────────────────────────── */}
        <Section eyebrow="Oil and the war situation" headline="Crude is back over $100">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "16px 18px",
              borderRadius: R_MD,
              border: `1px solid ${rgba(VOLT, 0.35)}`,
              background: rgba(VOLT, 0.07),
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 30,
                fontWeight: W_DATA,
                fontVariantNumeric: "tabular-nums",
                color: VOLT,
                lineHeight: 1.1,
              }}
            >
              $100.05
            </div>
            <div style={{ fontSize: 13, color: PAPER_QUIET }}>
              WTI, Sep 11 · roughly +8% on the week · refiners at 52-week highs
            </div>
          </div>

          <P>
            WTI closed the week at $100.05, up about 8% and back over the hundred handle after
            recovering from Thursday's dip. Refiners pushed to 52-week highs on it. Two weeks ago this
            letter had crude at $83 and the war premium draining away; it is now $100 with the premium
            fully back on, which is a useful reminder of how fast that particular read can go stale.
          </P>
          <P>
            The part that matters for Wednesday: this is the same energy complex doing most of the
            lifting inside the CPI print the Fed is about to respond to. Crude at $100 alongside core
            running +0.3% is the hawkish argument delivered in two numbers, and it is why the dot plot is
            the thing to watch rather than the hike itself.
          </P>
        </Section>

        {/* ── The scorecard ─────────────────────────────────────────────── */}
        <Section eyebrow="CB Edge · this week's results" headline="The dashboard called it, here is the scorecard">
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              marginBottom: 16,
            }}
          >
            <Stat label="Core" value="75%" color={PAPER} note="≤5 pts · 12:00 CB · 3 of 4 sessions" />
            <Stat
              label="Estimated move"
              value="70.0%"
              color={PAPER}
              note="Core Board · 14-6 · 20 of 22 scored"
            />
          </div>

          <ScoreTable />

          <P>
            A ✓ means the Core read landed within 5 points of where SPX actually printed. Over the four
            sessions of Sep 8 to 11 that was <Strong>7 of 12</Strong>: 3 of 4 at 12:00, 2 of 4 at both
            9:45 and 10:30. That is the weakest week since this letter started printing the table, and
            the rows show where it went. Friday's CPI open put both morning windows 24.5 points out, and
            Tuesday's 9:45 missed by 21.7. The two middle sessions went 5 of 6 between them. One more
            worth flagging: Tuesday's 12:00 landed 5.0 points away and scored as a miss. The test is
            strict, not rounded, and it stays that way in a bad week as well as a good one.
          </P>
          <P>
            Estimated move on the Core Board: <Strong>14 wins against 6 losses</Strong> across the 22
            names, 70.0%. A win is price staying inside the band, so the number tracks how far the tape
            actually travelled versus what implied vol said it would. One clarification, because it
            matters for anyone keeping score: last week's letter quoted 71.7% on the full 404-ticker
            universe, and this week's 70.0% is the 22-name Core Board. Similar figures, different
            measurements, not a flat week.
          </P>

          <Hairline style={{ margin: "22px 0 18px" }} />

          <SubHead
            title="Core migration · five sessions, Sep 4 to Sep 11"
            note="Four sessions of the walls stepping down, then Friday's CPI gap"
          />
          <img
            src="https://cbedge.net/core-migration-2026-09-11.png"
            alt="SPX core migration over five sessions to 2026-09-11: put wall, call wall, CORE and spot"
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              border: `1px solid ${LINE}`,
              borderRadius: R_MD,
              marginBottom: 22,
            }}
          />

          <SubHead title="Core Wall auto buy · Wednesday Sep 9" note="In to peak is the intraday high, not an exit" />
          <AutoBuyTable />

          <P>
            All three windows took the same put on Wednesday. The 10:30 fill at <Strong>$3.45</Strong>{" "}
            was the best of them and produced the biggest move; the 12:00 paid $6.25 for the same
            contract two hours later and got the least out of it. Same read, three fills, three very
            different outcomes.
          </P>

          <Hairline style={{ margin: "22px 0 18px" }} />

          <SubHead title="What the flow scanner caught" note="One flag, with its timestamp" />
          <FlowCard />

          <P>
            Flagged <Strong>Sep 8 at 10:15 AM</Strong> with AMD at 493.51: a 520 call 5.4% out of the
            money on the very next day's expiry, graded A+ on 1.8M in premium. The scanner's claim is the
            flag and the timestamp, both of which are on the card. One contract is not a track record,
            and options can and do go to zero.
          </P>
        </Section>

        {/* ── Access ────────────────────────────────────────────────────── */}
        <Slot
          label="Sale card"
          note="The paid-access block. Price, what a member gets, one call to action. Held empty until the merged offer is settled."
        />

        {/* ── Affiliate ─────────────────────────────────────────────────── */}
        <Slot
          label="Affiliate program"
          note="The referral block. Rate, how a sale attributes, how it pays out. Held empty until the program's terms are settled across both products."
        />

        <div
          style={{
            paddingTop: 14,
            borderTop: `1px solid ${LINE}`,
            fontSize: 13,
            color: PAPER_QUIET,
          }}
        >
          The CB Edge team
        </div>
      </div>
    </PageShell>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

const eyebrowStyle = {
  fontFamily: MONO,
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: ACCENT_TEXT,
} as const;

/**
 * A block that is not written yet. Dashed rather than solid, because a solid
 * border is the system's way of saying "separate object, finished". Nothing
 * inside is styled as content, so it can never be mistaken for a real section
 * in a screenshot.
 */
function Slot({ label, note }: { label: string; note: string }) {
  return (
    <div
      style={{
        padding: "26px 22px",
        borderRadius: R_LG,
        border: `1px dashed ${rgba(ACCENT, 0.4)}`,
        background: rgba(ACCENT, 0.04),
      }}
    >
      <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Placeholder</div>
      <div style={{ fontSize: 17, fontWeight: W_BOLD, color: PAPER_DISPLAY, letterSpacing: "-0.005em" }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.6, color: PAPER_QUIET, maxWidth: 520 }}>
        {note}
      </div>
    </div>
  );
}

function Deck({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 16,
        lineHeight: 1.6,
        color: PAPER,
        paddingLeft: 14,
        boxShadow: `inset 2px 0 0 ${ACCENT}`,
      }}
    >
      {children}
    </div>
  );
}

function Section({
  eyebrow,
  headline,
  children,
}: {
  eyebrow: string;
  headline: string;
  children: ReactNode;
}) {
  return (
    <Card padding={22}>
      <div style={{ ...eyebrowStyle, marginBottom: 8 }}>{eyebrow}</div>
      <h2
        style={{
          margin: "0 0 14px",
          fontSize: 20,
          lineHeight: 1.3,
          fontWeight: W_BOLD,
          letterSpacing: "-0.008em",
          color: PAPER_DISPLAY,
        }}
      >
        {headline}
      </h2>
      {children}
    </Card>
  );
}

function SubHead({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 15, fontWeight: W_MED, color: PAPER }}>{title}</div>
      {note && <div style={{ marginTop: 3, fontSize: 12.5, color: PAPER_QUIET }}>{note}</div>}
    </div>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: "0 0 12px", fontSize: 14.5, lineHeight: 1.65, color: PAPER }}>{children}</p>;
}

function Strong({ children }: { children: ReactNode }) {
  return <strong style={{ fontWeight: W_MED, color: PAPER }}>{children}</strong>;
}

function Stat({
  label,
  value,
  color,
  tint = ACCENT,
  note,
}: {
  label: string;
  value: string;
  /** The number's color. A data hex here, or PAPER when it carries no sign. */
  color: string;
  /** The 7% wash behind the tile. Volt Blue unless the number itself is data. */
  tint?: string;
  note?: string;
}) {
  return (
    <div
      style={{
        padding: "13px 15px",
        borderRadius: R_MD,
        border: `1px solid ${LINE}`,
        background: rgba(tint, 0.07),
      }}
    >
      <div style={{ fontSize: 12, color: PAPER_QUIET }}>{label}</div>
      <div
        style={{
          marginTop: 3,
          fontFamily: MONO,
          fontSize: 22,
          fontWeight: W_DATA,
          fontVariantNumeric: "tabular-nums",
          color: color,
          lineHeight: 1.15,
        }}
      >
        {value}
      </div>
      {note && (
        <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 10.5, color: PAPER_QUIET }}>{note}</div>
      )}
    </div>
  );
}

function Day({
  day,
  tickers,
  children,
}: {
  day: string;
  tickers?: string[];
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 10,
        gridTemplateColumns: "84px 1fr",
        alignItems: "start",
        padding: "12px 14px",
        borderRadius: R_MD,
        border: `1px solid ${LINE}`,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: ACCENT_TEXT,
          paddingTop: 2,
        }}
      >
        {day}
      </div>
      <div>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: PAPER }}>{children}</div>
        {tickers && tickers.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {tickers.map((t) => (
              <span
                key={t}
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: PAPER,
                  border: `1px solid ${LINE}`,
                  borderRadius: R_PILL,
                  padding: "2px 9px",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Quote({ who, where, children }: { who: string; where: string; children: ReactNode }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: R_MD,
        border: `1px solid ${LINE}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 14, lineHeight: 1.55, color: PAPER }}>"{children}"</div>
      <div style={{ marginTop: "auto", fontSize: 12, color: PAPER_QUIET }}>
        <span style={{ color: PAPER, fontWeight: W_MED }}>{who}</span> · {where}
      </div>
    </div>
  );
}

/* The four sessions of Sep 8 to 11, three CB windows each. A hit is within 5
   points, and the test is strict rather than rounded, so 5.0 away is a miss. */
const CB_ROWS: { date: string; cells: { strike: number; away: number; hit: boolean }[] }[] = [
  {
    date: "09-11",
    cells: [
      { strike: 7700, away: 24.5, hit: false },
      { strike: 7700, away: 24.5, hit: false },
      { strike: 7680, away: 4.5, hit: true },
    ],
  },
  {
    date: "09-10",
    cells: [
      { strike: 7590, away: 0.1, hit: true },
      { strike: 7620, away: 10.3, hit: false },
      { strike: 7590, away: 0.1, hit: true },
    ],
  },
  {
    date: "09-09",
    cells: [
      { strike: 7630, away: 0.4, hit: true },
      { strike: 7630, away: 0.4, hit: true },
      { strike: 7630, away: 0.4, hit: true },
    ],
  },
  {
    date: "09-08",
    cells: [
      { strike: 7650, away: 21.7, hit: false },
      { strike: 7675, away: 3.3, hit: true },
      { strike: 7700, away: 5.0, hit: false },
    ],
  },
];

function ScoreTable() {
  return (
    <div className="vk-xscroll" style={{ marginBottom: 14 }}>
      <table
        style={{
          width: "100%",
          minWidth: 480,
          borderCollapse: "collapse",
          fontFamily: MONO,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>9:45 CB</Th>
            <Th>10:30 CB</Th>
            <Th>12:00 CB</Th>
          </tr>
        </thead>
        <tbody>
          {CB_ROWS.map((row) => (
            <tr key={row.date}>
              <Td>{row.date}</Td>
              {row.cells.map((c, i) => (
                <Td key={i}>
                  <span style={{ color: PAPER }}>{c.strike}</span>{" "}
                  <span style={{ color: c.hit ? GOOD : BAD }}>
                    {c.away} {c.hit ? "✓" : "✗"}
                  </span>
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AUTO_BUY = [
  { cb: "9:45", contract: "7630P", inp: "$4.95", peak: "$11.55", gain: "+133%", at: "11:27 AM" },
  { cb: "10:30", contract: "7630P", inp: "$3.45", peak: "$13.70", gain: "+297%", at: "11:25 AM" },
  { cb: "12:00", contract: "7630P", inp: "$6.25", peak: "$9.45", gain: "+51%", at: "12:20 PM" },
];

function AutoBuyTable() {
  return (
    <div className="vk-xscroll" style={{ marginBottom: 14 }}>
      <table
        style={{
          width: "100%",
          minWidth: 480,
          borderCollapse: "collapse",
          fontFamily: MONO,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <thead>
          <tr>
            <Th>CB</Th>
            <Th>Contract</Th>
            <Th>In to peak</Th>
            <Th>At peak</Th>
          </tr>
        </thead>
        <tbody>
          {AUTO_BUY.map((r) => (
            <tr key={r.cb}>
              <Td>{r.cb} · 09-09</Td>
              <Td>{r.contract}</Td>
              <Td>
                {r.inp} <span style={{ color: PAPER_QUIET }}>→</span> {r.peak}
              </Td>
              <Td>
                <span style={{ color: GOOD }}>{r.gain}</span>{" "}
                <span style={{ color: PAPER_QUIET }}>{r.at}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        borderBottom: `1px solid ${LINE}`,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: PAPER_QUIET,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return (
    <td
      style={{
        padding: "9px 10px",
        borderBottom: `1px solid ${LINE}`,
        color: PAPER,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

function FlowCard() {
  return (
    <div
      style={{
        padding: "15px 17px",
        borderRadius: R_LG,
        border: `1px solid ${rgba(VOLT, 0.35)}`,
        background: rgba(VOLT, 0.06),
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: W_BOLD, color: PAPER_DISPLAY }}>AMD</span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 13,
            fontWeight: 700,
            color: VOLT,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          520C
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: PAPER }}>1.8M premium</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: PAPER_QUIET }}>
          2026-09-09 · spot 493.51
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {["OTM 5.4%", "+406% vs open", "score 8", "★ very strong"].map((t) => (
          <span
            key={t}
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: VOLT,
              border: `1px solid ${rgba(VOLT, 0.45)}`,
              borderRadius: R_PILL,
              padding: "2px 9px",
              whiteSpace: "nowrap",
            }}
          >
            {t}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11, color: PAPER_QUIET }}>
        captured Sep 8 · 10:15 AM ET
      </div>
    </div>
  );
}
