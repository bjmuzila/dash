import type { Metadata } from "next";
import LegalShell from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Risk Disclosure — CB Edge",
  description: "Risk disclosure and trading disclaimer for the CB Edge dashboard.",
};

const LAST_UPDATED = "June 24, 2026";

export default function RiskDisclosurePage() {
  return (
    <LegalShell
      title="Risk Disclosure & Trading Disclaimer"
      subtitle="Please read this disclosure carefully before using CB Edge. By accessing the Service you confirm that you understand and accept the risks described below."
      lastUpdated={LAST_UPDATED}
      currentPath="/risk-disclosure"
    >
      <p className="lead">
        CB Edge (&ldquo;CB Edge,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; the &ldquo;Service&rdquo;) is an
        informational and analytical software tool. It is <strong>not</strong> a broker-dealer, investment
        adviser, futures commission merchant, or financial institution, and nothing on the Service is, or
        should be construed as, financial, investment, tax, legal, or other professional advice.
      </p>

      <div className="callout">
        <strong>Trading is risky.</strong> Trading and investing in stocks, options, futures, and other
        financial instruments involves a substantial risk of loss and is not suitable for every investor. You
        can lose some or all of your invested capital, and in certain instruments (such as futures and
        leveraged or short options positions) you may lose more than your initial investment. Only risk
        capital you can afford to lose should ever be used for trading.
      </div>

      <h2>1. Not financial, investment, or trading advice</h2>
      <p>
        All content provided through the Service — including gamma exposure (GEX) profiles, dealer-positioning
        estimates, key levels, &ldquo;Confidence Scores,&rdquo; estimated moves, Greeks, options-flow data,
        charts, indicators, alerts, written commentary, and any other output — is provided for general
        informational and educational purposes only. It is impersonal, does not take into account your
        individual financial situation, objectives, risk tolerance, or needs, and does not constitute a
        recommendation, solicitation, or offer to buy or sell any security, option, futures contract, or other
        financial instrument.
      </p>
      <p>
        You are solely responsible for your own trading and investment decisions. You should not treat any
        output of the Service as a substitute for the exercise of your own judgment or for consultation with a
        licensed financial professional. <strong>You should consult a licensed broker, financial adviser, or
        other qualified professional before making any trading or investment decision.</strong>
      </p>

      <h2>2. No guarantee of accuracy, completeness, or timeliness</h2>
      <p>
        The Service relies on data obtained from third-party providers, brokerage feeds, and public sources.
        Such data may be delayed, inaccurate, incomplete, interrupted, or subject to revision. Calculations
        such as GEX, dealer-positioning estimates, flip levels, Confidence Scores, and estimated moves are
        derived using models and assumptions that may be wrong, may change without notice, and may not reflect
        actual market conditions or actual dealer positioning. We do not guarantee — and expressly disclaim any
        warranty as to — the accuracy, completeness, reliability, timeliness, or fitness for any purpose of any
        information provided through the Service. You should independently verify any information before
        relying on it.
      </p>

      <h2>3. Past performance and forward-looking information</h2>
      <p>
        Any historical data, backtests, examples, hypothetical results, or references to past market behavior
        are provided for illustration only. <strong>Past performance is not indicative of, and is no guarantee
        of, future results.</strong> Markets are inherently uncertain, and no model, score, or level can
        predict future price movement. Any forward-looking statements, projections, or estimated moves are
        based on assumptions that may not materialize, and actual outcomes may differ materially.
      </p>

      <h2>4. Options, 0DTE, and leveraged instruments</h2>
      <p>
        The Service is oriented toward index options and short-dated (including 0DTE) strategies, which carry
        heightened risk. Options can expire worthless, lose value rapidly due to time decay and volatility
        changes, and may be exercised or assigned in ways that produce significant losses. Short-dated and
        leveraged positions can move against you faster than you can react. Before trading options you should
        read the Options Clearing Corporation publication{" "}
        <a href="https://www.theocc.com/company-information/documents-and-archives/options-disclosure-document" target="_blank" rel="noopener noreferrer">
          &ldquo;Characteristics and Risks of Standardized Options&rdquo;
        </a>{" "}
        and ensure you fully understand the instruments you intend to trade.
      </p>

      <h2>5. Hypothetical and simulated results</h2>
      <p>
        Where the Service displays hypothetical, simulated, or model-derived outcomes (including Confidence
        Scores and historical analogs), such results have inherent limitations. Unlike an actual performance
        record, simulated results do not represent actual trading and may not reflect the impact of factors
        such as liquidity, slippage, fees, or the emotional and practical realities of live trading. No
        representation is made that any account will or is likely to achieve results similar to those shown.
      </p>

      <h2>6. Your responsibility</h2>
      <p>By using the Service, you acknowledge and agree that:</p>
      <ul>
        <li>You are solely responsible for evaluating the merits and risks of any transaction you enter into;</li>
        <li>You will not hold CB Edge responsible for any trading or investment decision you make;</li>
        <li>You understand that any use of the information provided is entirely at your own risk;</li>
        <li>You have the financial ability and experience to bear the risks of trading the instruments you trade; and</li>
        <li>You will comply with all applicable laws and the rules of your broker and any exchange you trade on.</li>
      </ul>

      <h2>7. No fiduciary relationship</h2>
      <p>
        Your use of the Service does not create any advisory, fiduciary, or other special relationship between
        you and CB Edge. We do not manage accounts, place trades, or hold customer funds, and we do not receive
        compensation based on any specific trade you make.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, CB Edge and its owners, operators, affiliates, and data
        providers will not be liable for any loss or damage — including any trading losses, lost profits, or
        any direct, indirect, incidental, consequential, special, or punitive damages — arising out of or
        relating to your use of, or reliance on, the Service or any information it provides. This limitation is
        described further in our{" "}
        <a href="/terms">Terms of Service</a> and{" "}
        <a href="/disclaimer">Disclaimer</a>, which you should also read.
      </p>

      <p style={{ marginTop: 26, fontSize: 12.5, color: "#8B94A7" }}>
        If you do not understand or do not agree to this Risk Disclosure, do not use the Service. If you have
        questions, contact us at <a href="mailto:support@cbedge.net">support@cbedge.net</a> before proceeding.
      </p>
    </LegalShell>
  );
}
