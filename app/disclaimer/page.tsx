import type { Metadata } from "next";
import LegalShell from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Disclaimer — CB Edge",
  description: "General disclaimer and no-liability notice for the CB Edge dashboard.",
};

const LAST_UPDATED = "June 24, 2026";

export default function DisclaimerPage() {
  return (
    <LegalShell
      title="Disclaimer"
      subtitle="A summary of the most important limitations on CB Edge. This notice supplements, and does not replace, our Terms of Service and Risk Disclosure."
      lastUpdated={LAST_UPDATED}
      currentPath="/disclaimer"
    >
      <div className="callout">
        <strong>In short:</strong> CB Edge is an informational software tool, not financial advice. Trading is
        risky and you can lose money. Everything you do with the information is your own decision and your own
        responsibility. We make no guarantees and accept no liability for your trading results.
      </div>

      <h2>1. Informational use only</h2>
      <p>
        All information, data, calculations, scores, levels, charts, and commentary provided through CB Edge
        (the &ldquo;Service&rdquo;) are for general informational and educational purposes only. Nothing on the
        Service constitutes financial, investment, tax, legal, or other professional advice, and nothing should
        be interpreted as a recommendation, solicitation, or offer to buy or sell any security, option, futures
        contract, or other financial instrument. See our full{" "}
        <a href="/risk-disclosure">Risk Disclosure</a> for details.
      </p>

      <h2>2. Not a financial professional</h2>
      <p>
        CB Edge is not a registered broker-dealer, investment adviser, futures commission merchant, or
        financial institution, and does not act as a fiduciary to you. We do not manage money, place trades, or
        hold customer funds. You should consult a licensed financial professional before making any trading or
        investment decision.
      </p>

      <h2>3. No guarantees</h2>
      <p>
        We do not guarantee the accuracy, completeness, timeliness, or usefulness of any information provided
        through the Service. Data may be delayed, incomplete, or wrong, and models and assumptions may change
        without notice. Any examples, historical data, or estimated moves are illustrative only, and{" "}
        <strong>past performance is not a guarantee of future results.</strong>
      </p>

      <h2>4. Your decisions, your risk</h2>
      <p>
        You are solely responsible for your own trading and investment decisions and for evaluating the risks
        of any transaction. Any reliance you place on the Service is strictly at your own risk. You agree that
        CB Edge is not responsible for any decision you make or any outcome that results from using the Service.
      </p>

      <h2>5. No liability</h2>
      <p>
        To the maximum extent permitted by law, CB Edge and its owners, operators, affiliates, and data
        providers will not be liable for any trading losses, lost profits, or any direct, indirect, incidental,
        consequential, special, or punitive damages arising out of or relating to your use of, or reliance on,
        the Service or any information it provides. Additional terms, including the disclaimer of warranties and
        the limitation of liability, are set out in our <a href="/terms">Terms of Service</a>.
      </p>

      <h2>6. External links and third-party content</h2>
      <p>
        The Service may reference or link to third-party data, websites, or content. We do not control and are
        not responsible for the accuracy or practices of any third party, and a reference does not imply
        endorsement.
      </p>

      <h2>7. Contact</h2>
      <p>
        Questions about this Disclaimer can be sent to{" "}
        <a href="mailto:support@cbedge.net">support@cbedge.net</a>.
      </p>
    </LegalShell>
  );
}
