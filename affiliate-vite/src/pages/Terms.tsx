import { Link } from "react-router-dom";
import Shell from "../components/Shell";
import { Card } from "../components/ui";
import { THEME, TYPE, RATE_PCT, orangeButtonStyle } from "../lib/theme";

/**
 * /terms — the affiliate program agreement.
 *
 * THIS EXISTS BECAUSE THE APPLY FORM ASKS PEOPLE TO ACCEPT IT. A checkbox that
 * says "I accept the terms" next to nothing is worse than no checkbox: it is an
 * agreement to an empty set, and the first dispute about a reversed commission
 * has nothing to point at.
 *
 * EVERY CLAUSE HERE MATCHES WHAT THE CODE ACTUALLY DOES. That is the rule for
 * editing this file. Attribution, the hold window, the payout cadence and the
 * code-change grace period are all implemented in server-v2/_lib-affiliate.cjs
 * and are stated here with the same numbers. If one of them changes, both move
 * together — terms that describe a program that isn't running are a liability,
 * not a protection. In particular:
 *
 *   - There is deliberately NO minimum payout threshold, because the payout
 *     builder has no such rule. Do not add one here without adding it there.
 *   - Refund reversal is described as something WE apply, because it is: the
 *     owner enters it from the Payouts tab (/api/aff/owner/adjust). It is not
 *     automatic, and pretending otherwise would misdescribe the ledger.
 *
 * NOT LEGAL ADVICE. This is a plain-English draft written to match the system.
 * Have a lawyer read it before treating it as an enforceable contract — the
 * financial-promotion clauses especially, since the product is trading data.
 */

const UPDATED = "21 August 2026";

type Section = { h: string; body: (string | string[])[] };

const SECTIONS: Section[] = [
  {
    h: "1 · The agreement",
    body: [
      "These terms govern your participation in the CB Edge affiliate program. By submitting an application you agree to them. If you are approved, they continue to apply for as long as you hold an active code.",
      "We may update these terms. Material changes will be emailed to the address on your affiliate account at least 14 days before they take effect. Continuing to promote CB Edge after that means you accept the updated terms; if you don't, tell us and we'll close your account and pay out anything already cleared.",
    ],
  },
  {
    h: "2 · Eligibility and approval",
    body: [
      "Applications are reviewed by hand and approval is at our discretion. We may decline an application without giving a reason.",
      "You must be at least 18 and legally able to enter a contract where you live. You are responsible for complying with the laws that apply to you, including any rules on promoting financial products in your country.",
      "You do not need to be a CB Edge subscriber. Your affiliate account is separate from any subscription you may hold.",
    ],
  },
  {
    h: "3 · Your code and your link",
    body: [
      "On approval we issue you a referral code and a link. They identify you and nobody else. Don't share them with another affiliate, and don't operate more than one affiliate account without asking us first.",
      "You can request a different code from your dashboard. Code changes are approved by hand. When one is approved your previous code keeps crediting you for 30 days, so links and posts already published don't stop working.",
      "We may reclaim a code that is reserved, misleading, or that implies you are CB Edge or speak for it.",
    ],
  },
  {
    h: "4 · How a sale is attributed to you",
    body: [
      "A sale is yours if either of the following is true at checkout:",
      [
        "The customer entered your code at checkout, or",
        "The customer clicked your link within the last 60 days and had not previously clicked another affiliate's link more recently.",
      ],
      "A code entered at checkout always takes priority over a click. If a customer clicked your link but typed someone else's code, the sale belongs to the code.",
      "Attribution depends on the customer's browser accepting a cookie and completing checkout on the same device. We can't credit a sale we can't see, and we don't add referrals by hand on request.",
    ],
  },
  {
    h: "5 · What you earn",
    body: [
      `You earn ${RATE_PCT}% of the amount a referred customer actually pays us — not list price — on their first invoice and on every renewal invoice after it, for as long as that subscription stays active.`,
      "The rate is fixed at the moment a customer subscribes and stays with that subscription. If your rate is changed later it applies to new subscriptions, not to ones already attributed to you.",
      "Commission is calculated on amounts collected, after any discount the customer used and excluding tax. A $0 invoice — a free trial, or a period fully covered by credit — earns $0.",
      "There is no cap on what you can earn and no minimum you must reach to be paid.",
    ],
  },
  {
    h: "6 · Holding, refunds and reversals",
    body: [
      "Every commission is held for 30 days after the invoice that generated it. This is the refund and chargeback window. Held commission is visible on your dashboard but is not payable yet.",
      "If a referred customer refunds or charges back, we reverse the matching commission. A reversal is applied against commission still held or not yet paid. We do not claw back money that has already been paid to you.",
      "After 30 days commission clears, joins that month's payout total, and is payable.",
    ],
  },
  {
    h: "7 · Getting paid",
    body: [
      "Payout periods are calendar months. Once a month closes and its commission has cleared the holding window, we review and release it.",
      "You choose Stripe, PayPal or Zelle in your dashboard, and you are responsible for the details you enter there. We pay to the details on file at the time of payment; a payment sent to an address or number you gave us incorrectly cannot be recovered. Zelle requires a US bank account.",
      "Payments are in US dollars. Any fee your provider charges to receive money is yours. If a payment fails or is returned, we'll contact you and hold the amount until you give us working details.",
      "You are an independent contractor, not an employee, agent or partner. You are responsible for your own taxes, and we may need tax information from you before paying — for US persons this can include a W-9 and a 1099 once earnings reach the IRS reporting threshold.",
    ],
  },
  {
    h: "8 · How you may promote CB Edge",
    body: [
      "You may promote CB Edge through your own content, community, newsletter, video, or social channels. What you may not do:",
      [
        "Bid on “CB Edge”, “cbedge”, or misspellings and variants of them in paid search, or use them in paid ad display URLs.",
        "Run ads or pages designed to look like they are operated by CB Edge, or use our name, logo or branding in a way that suggests you are us or speak for us.",
        "Use your own code, or arrange for someone to use it on your behalf, to buy your own subscription.",
        "Post your code to coupon, cashback, deal-aggregation or “free download” sites.",
        "Send unsolicited email, DMs or messages, or promote CB Edge anywhere you don't have permission to post.",
        "Register domains, social handles, or app listings containing our brand name.",
        "Use cookie stuffing, forced clicks, iframes, redirects, browser extensions, or anything else that sets attribution without a deliberate click.",
        "Buy, incentivise or automate signups, or pay people to use your code.",
      ],
      "We reverse commission from any sale that came from the above, and repeated breaches end the relationship.",
    ],
  },
  {
    h: "9 · Claims about trading — read this one",
    body: [
      "CB Edge is market data and analysis software. It is not investment advice, it does not manage anyone's money, and it does not predict outcomes. Your promotion has to say the same thing.",
      "You may not:",
      [
        "Promise, guarantee or imply any profit, return, win rate or income from using CB Edge.",
        "Present a P&L, account screenshot or trade result as something CB Edge produced or as a typical outcome.",
        "Describe CB Edge as investment advice, a signal service, or a substitute for professional advice.",
        "Suggest trading is low-risk, or omit that most people who trade options lose money.",
      ],
      "You must disclose that you earn a commission, clearly and near your link — not buried in a bio or a footer. In the US this is required by the FTC's endorsement guidelines. “#ad”, “affiliate link”, or a plain sentence saying you're paid if someone subscribes all work.",
      "This clause is the one we enforce hardest. A single post promising returns is grounds for immediate removal from the program.",
    ],
  },
  {
    h: "10 · Pausing, closing and termination",
    body: [
      "You can leave at any time by emailing us. We'll pay out anything already cleared on the next payout run.",
      "We may pause your code — it stops attributing new sales while everything already earned stays yours — or close your account entirely. We'll tell you why unless doing so would compromise an investigation.",
      "If we close your account for a breach of section 8 or 9, unpaid commission from the sales involved is forfeit. Commission from unaffected sales is still paid.",
      "We may end the program itself with 30 days' notice, and will pay everything cleared and owed at that point.",
    ],
  },
  {
    h: "11 · Everything else",
    body: [
      "We grant you a limited, revocable, non-exclusive licence to use our name and the marketing assets in your dashboard, solely to promote CB Edge under these terms. It ends when your participation does.",
      "Nothing here creates an employment relationship, partnership, joint venture or agency. You have no authority to make commitments on our behalf.",
      "We provide the program as-is. To the extent the law allows, our total liability to you is limited to the commission owed to you at the time a claim arises.",
      "You are responsible for the content you publish and for any claim arising from it.",
    ],
  },
  {
    h: "12 · Contact",
    body: [
      "Questions about these terms, your account, or a commission you think is wrong: affiliates@cbedge.net. Include your code and, if it's about a specific payment, the period it covers.",
    ],
  },
];

export default function Terms() {
  return (
    <Shell>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.02em" }}>Affiliate program terms</h1>
        <p style={{ margin: "10px 0 0", fontSize: TYPE.body, color: THEME.dim }}>
          Last updated {UPDATED}. These are the terms you accept when you apply.
        </p>
      </div>

      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 style={{
                margin: "0 0 10px", fontSize: 13, fontWeight: 700,
                letterSpacing: "0.10em", textTransform: "uppercase", color: THEME.cyan,
              }}>{s.h}</h2>
              {s.body.map((b, i) =>
                Array.isArray(b) ? (
                  <ul key={i} style={{ margin: "0 0 12px", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 7 }}>
                    {b.map((li) => (
                      <li key={li} style={{ fontSize: 13.5, lineHeight: 1.65, color: THEME.text }}>{li}</li>
                    ))}
                  </ul>
                ) : (
                  <p key={i} style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.7, color: THEME.text }}>{b}</p>
                )
              )}
            </section>
          ))}
        </div>
      </Card>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Link to="/apply" style={{ ...orangeButtonStyle, display: "inline-block", padding: "12px 22px", fontSize: 11, borderRadius: 8 }}>
          Apply for a code →
        </Link>
        <span style={{ fontSize: TYPE.label, color: THEME.dim }}>
          Also see the <a href="https://cbedge.net/terms" style={{ color: THEME.cyan }}>CB Edge site terms</a>,{" "}
          <a href="https://cbedge.net/risk-disclosure" style={{ color: THEME.cyan }}>risk disclosure</a> and{" "}
          <a href="https://cbedge.net/privacy" style={{ color: THEME.cyan }}>privacy policy</a>.
        </span>
      </div>
    </Shell>
  );
}
