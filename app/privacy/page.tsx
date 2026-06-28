import type { Metadata } from "next";
import LegalShell from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy — CB Edge",
  description: "How CB Edge collects, uses, and protects your information.",
};

const LAST_UPDATED = "June 28, 2026";

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      subtitle="This Privacy Policy explains what information CB Edge collects, how we use it, and the choices you have."
      lastUpdated={LAST_UPDATED}
      currentPath="/privacy"
    >
      <p className="lead">
        This Privacy Policy describes how CB Edge (&ldquo;CB Edge,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;)
        collects, uses, and shares information about you when you use the website at cbedge.net and the CB Edge
        dashboard (the &ldquo;Service&rdquo;). By using the Service, you agree to the practices described here.
      </p>

      <h2>1. Information we collect</h2>
      <h3>Information you provide</h3>
      <ul>
        <li>
          <strong>Account information.</strong> When you sign up, our authentication provider (Clerk) collects
          information such as your name, email address, and login credentials. We receive a unique user
          identifier and basic profile details from that provider.
        </li>
        <li>
          <strong>Waitlist information.</strong> If you join our waitlist, we collect the email address you
          submit, the source of the signup, the referring web page, and your browser&rsquo;s user-agent string.
          Waitlist signups are stored in our database and also recorded in a Google Sheet that we use to manage
          the list.
        </li>
        <li>
          <strong>Payment information.</strong> If you purchase a subscription, our third-party payment
          processor (Stripe) collects and processes your payment details, including your name and billing
          information. We do not store full card numbers on our own servers; we retain a customer identifier
          and subscription status to manage your access.
        </li>
        <li>
          <strong>Communications.</strong> If you contact us, we keep the messages and contact details you
          provide.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Usage and device data.</strong> When you visit the Service, we automatically collect and log
          your IP address, browser type, the pages you view, features you use, and timestamps. We record this
          page-activity data for visitors and signed-in users alike, in order to operate, secure, and improve
          the Service. For signed-in users, this activity is associated with your account identifier.
        </li>
        <li>
          <strong>Cookies and similar technologies.</strong> We and our providers use cookies and similar
          technologies for authentication, session management, security, and basic analytics. You can control
          cookies through your browser settings, though some features may not work without them.
        </li>
        <li>
          <strong>Local storage.</strong> The dashboard stores certain preferences (such as pinned pages,
          notes, and layout choices) locally in your browser. This data stays on your device unless you
          explicitly sync it.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li>Provide, operate, maintain, and secure the Service and your account;</li>
        <li>Authenticate you and prevent fraud, abuse, and unauthorized access;</li>
        <li>Process subscriptions, billing, and related transactions;</li>
        <li>Respond to your requests and provide customer support;</li>
        <li>Understand how the Service is used so we can improve features and performance;</li>
        <li>Send you service-related communications and, where permitted, product updates; and</li>
        <li>Comply with legal obligations and enforce our <a href="/terms">Terms of Service</a>.</li>
      </ul>

      <h2>3. How we share information</h2>
      <p>We do not sell your personal information. We share information only as follows:</p>
      <ul>
        <li>
          <strong>Service providers.</strong> With vendors who perform services on our behalf — including
          authentication (Clerk), payment processing (Stripe), hosting and database infrastructure, content
          delivery and network security (Cloudflare), and waitlist management (Google Sheets) — under
          obligations to protect your information and use it only to provide those services.
        </li>
        <li>
          <strong>Legal and safety.</strong> When we believe disclosure is necessary to comply with the law,
          enforce our agreements, or protect the rights, property, or safety of CB Edge, our users, or others.
        </li>
        <li>
          <strong>Business transfers.</strong> In connection with a merger, acquisition, financing, or sale of
          assets, your information may be transferred as part of that transaction.
        </li>
        <li>
          <strong>With your consent.</strong> In other cases where you direct or permit us to share your
          information.
        </li>
      </ul>

      <h2>4. Data retention</h2>
      <p>
        We retain personal information for as long as your account is active or as needed to provide the
        Service, comply with our legal obligations, resolve disputes, and enforce our agreements. When
        information is no longer needed, we take reasonable steps to delete or de-identify it.
      </p>

      <h2>5. Security</h2>
      <p>
        We use reasonable technical and organizational measures designed to protect your information. However,
        no method of transmission or storage is completely secure, and we cannot guarantee absolute security.
        You are responsible for keeping your login credentials confidential.
      </p>

      <h2>6. Your choices and rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, delete, or restrict the use of
        your personal information, or to object to certain processing or request portability. You can also
        update certain account details through your account settings, and you can unsubscribe from
        non-essential emails using the link in those messages. To exercise any of these rights, contact us at{" "}
        <a href="mailto:support@cbedge.net">support@cbedge.net</a>. We will respond consistent with applicable
        law and may need to verify your identity first.
      </p>

      <h2>7. California privacy rights (CCPA/CPRA)</h2>
      <p>
        If you are a California resident, the California Consumer Privacy Act, as amended, gives you the
        following rights regarding your personal information:
      </p>
      <ul>
        <li>
          <strong>Right to know.</strong> You may request the categories and specific pieces of personal
          information we have collected about you, the sources, the business purpose for collecting it, and the
          categories of third parties with whom we share it.
        </li>
        <li>
          <strong>Right to delete.</strong> You may request that we delete the personal information we hold
          about you, subject to certain legal exceptions.
        </li>
        <li>
          <strong>Right to correct.</strong> You may request that we correct inaccurate personal information.
        </li>
        <li>
          <strong>Right to opt out of sale or sharing.</strong> We do not sell your personal information and we
          do not share it for cross-context behavioral advertising. There is therefore nothing to opt out of in
          this respect.
        </li>
        <li>
          <strong>Right to non-discrimination.</strong> We will not discriminate against you for exercising any
          of these rights.
        </li>
      </ul>
      <p>
        The categories of personal information we collect are described in Section 1 and include identifiers
        (such as name, email address, IP address, and account identifier), commercial information (subscription
        and payment-related data processed by our payment provider), and internet activity information (such as
        pages viewed and usage data). To exercise any of these rights, contact us at{" "}
        <a href="mailto:support@cbedge.net">support@cbedge.net</a>. We may need to verify your identity before
        responding, and you may use an authorized agent where permitted by law.
      </p>

      <h2>8. European Economic Area, UK, and Switzerland rights (GDPR)</h2>
      <p>
        If you are located in the European Economic Area, the United Kingdom, or Switzerland, you have the
        following rights under the General Data Protection Regulation and equivalent laws: to access your
        personal data; to have inaccurate data corrected; to have your data erased; to restrict or object to
        certain processing; to data portability; and, where we rely on consent, to withdraw that consent at any
        time without affecting prior processing.
      </p>
      <p>
        We process your personal data on the following legal bases: <strong>performance of a contract</strong>{" "}
        (to provide the Service and your account and to process subscriptions); <strong>legitimate
        interests</strong> (to secure the Service, prevent fraud and abuse, and understand and improve how the
        Service is used); <strong>consent</strong> (for non-essential communications and any optional cookies);
        and <strong>compliance with legal obligations</strong>. To exercise your rights, contact us at{" "}
        <a href="mailto:support@cbedge.net">support@cbedge.net</a>. You also have the right to lodge a complaint
        with your local data-protection supervisory authority. Because we operate in the United States, your
        data may be transferred outside your country as described in Section 10.
      </p>

      <h2>9. Children&rsquo;s privacy</h2>
      <p>
        The Service is not directed to, and we do not knowingly collect personal information from, anyone under
        18. If you believe a minor has provided us information, please contact us so we can delete it.
      </p>

      <h2>10. International users</h2>
      <p>
        We operate in the United States, and your information may be processed and stored in the United States
        or other countries where our service providers operate. These countries may have data-protection laws
        different from those in your country. By using the Service, you understand that your information may be
        transferred to and processed in these locations.
      </p>

      <h2>11. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will revise the &ldquo;Last updated&rdquo; date
        above and, for material changes, provide additional notice where appropriate. Your continued use of the
        Service after changes take effect constitutes acceptance of the updated Policy.
      </p>

      <h2>12. Contact us</h2>
      <p>
        If you have questions about this Privacy Policy or our data practices, contact us at{" "}
        <a href="mailto:support@cbedge.net">support@cbedge.net</a>.
      </p>
    </LegalShell>
  );
}
