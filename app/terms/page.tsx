import type { Metadata } from "next";
import LegalShell from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Terms of Service — CB Edge",
  description: "Terms of Service governing use of the CB Edge dashboard.",
};

const LAST_UPDATED = "June 24, 2026";

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      subtitle="These Terms govern your access to and use of the CB Edge dashboard and related services. By creating an account or using the Service, you agree to these Terms."
      lastUpdated={LAST_UPDATED}
      currentPath="/terms"
    >
      <p className="lead">
        These Terms of Service (the &ldquo;Terms&rdquo;) form a binding agreement between you and CB Edge
        (&ldquo;CB Edge,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) governing your use of
        the website at cbedge.net, the CB Edge dashboard, and all related software, data, and services
        (collectively, the &ldquo;Service&rdquo;). Please also read our{" "}
        <a href="/risk-disclosure">Risk Disclosure</a>, <a href="/privacy">Privacy Policy</a>, and{" "}
        <a href="/disclaimer">Disclaimer</a>, which are incorporated into these Terms by reference.
      </p>

      <h2>1. Acceptance of these Terms</h2>
      <p>
        By accessing or using the Service, creating an account, or clicking to accept these Terms, you confirm
        that you have read, understood, and agree to be bound by these Terms and all documents incorporated by
        reference. If you do not agree, you may not access or use the Service. If you are using the Service on
        behalf of an entity, you represent that you have authority to bind that entity.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 years old (or the age of majority in your jurisdiction, if higher) and legally
        able to enter into a binding contract to use the Service. By using the Service you represent that you
        meet these requirements and that your use complies with all laws applicable to you.
      </p>

      <h2>3. The Service is informational only</h2>
      <p>
        CB Edge provides analytical and informational tools relating to options markets, including gamma
        exposure, dealer-positioning estimates, key levels, Confidence Scores, estimated moves, Greeks, and
        options-flow data. <strong>The Service does not provide financial, investment, tax, or legal advice,
        does not recommend any security or transaction, and is not a broker-dealer or investment adviser.</strong>{" "}
        All trading and investment decisions are yours alone and are made at your own risk. See the{" "}
        <a href="/risk-disclosure">Risk Disclosure</a> for important details.
      </p>

      <h2>4. Accounts and security</h2>
      <p>
        Access to the Service requires an account, which is created and authenticated through our third-party
        identity provider. You agree to provide accurate information, to keep your credentials confidential,
        and to be responsible for all activity under your account. Notify us promptly at{" "}
        <a href="mailto:support@cbedge.net">support@cbedge.net</a> of any unauthorized use. Accounts are
        personal to you; you may not share, resell, or transfer your access without our written consent.
      </p>

      <h2>5. Subscriptions, fees, and billing</h2>
      <p>
        Certain features of the Service are offered on a paid subscription basis. By subscribing, you authorize
        us (and our payment processor) to charge the applicable fees on a recurring basis until you cancel.
        Unless stated otherwise or required by law:
      </p>
      <ul>
        <li>Fees are quoted and charged in the currency shown at checkout and are exclusive of any applicable taxes;</li>
        <li>Subscriptions renew automatically at the end of each billing period unless canceled before renewal;</li>
        <li>You may cancel at any time, with the cancellation taking effect at the end of the current billing period;</li>
        <li>Fees already paid are non-refundable except where required by applicable law; and</li>
        <li>We may change our prices on a prospective basis with reasonable notice before your next renewal.</li>
      </ul>

      <h2>6. Acceptable use</h2>
      <p>You agree not to, and not to permit anyone else to:</p>
      <ul>
        <li>Copy, scrape, redistribute, resell, sublicense, or commercially exploit the Service or its data without our written permission;</li>
        <li>Reverse engineer, decompile, or attempt to extract source code, models, or proprietary methods, except to the extent this restriction is prohibited by law;</li>
        <li>Access the Service through automated means (bots, scrapers, crawlers) except via interfaces we expressly provide;</li>
        <li>Interfere with, disrupt, overload, or attempt to gain unauthorized access to the Service, its servers, or its data feeds;</li>
        <li>Use the Service to violate any law, exchange rule, market-data agreement, or the rights of any third party; or</li>
        <li>Remove or obscure any proprietary notices, or misrepresent your affiliation with CB Edge.</li>
      </ul>

      <h2>7. Intellectual property</h2>
      <p>
        The Service, including its software, design, text, graphics, logos, data compilations, models, and
        Confidence Score methodology, is owned by CB Edge or its licensors and is protected by intellectual
        property laws. Subject to these Terms, we grant you a limited, non-exclusive, non-transferable,
        revocable license to access and use the Service for your own personal, internal use. No other rights
        are granted. All trademarks and brand features are the property of their respective owners.
      </p>

      <h2>8. Third-party data and services</h2>
      <p>
        The Service depends on data and services from third parties, including market-data providers,
        brokerage feeds, authentication providers, hosting providers, and payment processors. We do not control
        and are not responsible for the accuracy, availability, or practices of those third parties. Your use
        of any third-party service may be subject to that party&rsquo;s own terms.
      </p>

      <h2>9. Disclaimer of warranties</h2>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT WARRANTIES OF ANY
        KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL
        WARRANTIES, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        ACCURACY, TITLE, AND NON-INFRINGEMENT. We do not warrant that the Service will be uninterrupted,
        timely, secure, error-free, or that any data, calculation, score, or level will be accurate, complete,
        or reliable.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, CB EDGE AND ITS OWNERS, OPERATORS, AFFILIATES, EMPLOYEES, AND
        DATA PROVIDERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR
        PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, TRADING LOSSES, LOSS OF DATA, OR LOSS OF GOODWILL,
        ARISING OUT OF OR RELATING TO YOUR USE OF (OR INABILITY TO USE) THE SERVICE OR ANY INFORMATION IT
        PROVIDES, WHETHER BASED IN CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY, OR ANY OTHER THEORY, EVEN IF
        ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
      </p>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THE
        SERVICE OR THESE TERMS WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US FOR THE SERVICE IN THE
        THREE (3) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (B) ONE HUNDRED U.S.
        DOLLARS ($100). Some jurisdictions do not allow certain limitations, so some of the above may not apply
        to you.
      </p>

      <h2>11. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless CB Edge and its owners, operators, affiliates, and
        data providers from and against any claims, liabilities, damages, losses, and expenses (including
        reasonable legal fees) arising out of or related to your use of the Service, your trading or investment
        decisions, your violation of these Terms, or your violation of any law or third-party right.
      </p>

      <h2>12. Suspension and termination</h2>
      <p>
        We may suspend or terminate your access to the Service at any time, with or without notice, if we
        believe you have violated these Terms or if we discontinue the Service. You may stop using the Service
        and cancel your subscription at any time. Sections that by their nature should survive termination
        (including intellectual property, disclaimers, limitation of liability, indemnification, and governing
        law) will survive.
      </p>

      <h2>13. Changes to the Service and these Terms</h2>
      <p>
        We may modify the Service or these Terms at any time. If we make material changes to these Terms, we
        will update the &ldquo;Last updated&rdquo; date above and, where appropriate, provide additional
        notice. Your continued use of the Service after changes become effective constitutes acceptance of the
        revised Terms.
      </p>

      <h2>14. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the State of [STATE], United States, without regard to its
        conflict-of-laws rules. Subject to any non-waivable rights you have under applicable law, you agree
        that any dispute arising out of or relating to these Terms or the Service will be resolved in the state
        or federal courts located in [COUNTY/STATE], and you consent to their jurisdiction and venue. (Replace
        the bracketed placeholders with your actual jurisdiction, and consider whether arbitration or a class
        action waiver is appropriate for your business — consult an attorney.)
      </p>

      <h2>15. Miscellaneous</h2>
      <p>
        These Terms, together with the documents incorporated by reference, are the entire agreement between
        you and CB Edge regarding the Service. If any provision is held unenforceable, the remaining provisions
        will remain in effect. Our failure to enforce any right is not a waiver. You may not assign these Terms
        without our consent; we may assign them in connection with a merger, acquisition, or sale of assets.
      </p>

      <h2>16. Contact</h2>
      <p>
        Questions about these Terms can be sent to{" "}
        <a href="mailto:support@cbedge.net">support@cbedge.net</a>.
      </p>
    </LegalShell>
  );
}
