import type { Metadata } from "next";
import LegalShell from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy — CB Edge",
  description: "How CB Edge collects, uses, and protects your information.",
};

const LAST_UPDATED = "June 24, 2026";

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
          <strong>Account information.</strong> When you sign up, our authentication provider collects
          information such as your name, email address, and login credentials. We receive a unique user
          identifier and basic profile details from that provider.
        </li>
        <li>
          <strong>Waitlist information.</strong> If you join our waitlist, we collect the email address you
          submit and the source of the signup.
        </li>
        <li>
          <strong>Payment information.</strong> If you purchase a subscription, our third-party payment
          processor collects and processes your payment details. We do not store full card numbers on our own
          servers.
        </li>
        <li>
          <strong>Communications.</strong> If you contact us, we keep the messages and contact details you
          provide.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Usage and device data.</strong> We may collect log and device information such as IP
          address, browser type, pages viewed, features used, and timestamps, in order to operate, secure, and
          improve the Service.
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
          authentication, hosting, database, analytics, email, and payment processing — under obligations to
          protect your information and use it only to provide those services.
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

      <h2>7. Children&rsquo;s privacy</h2>
      <p>
        The Service is not directed to, and we do not knowingly collect personal information from, anyone under
        18. If you believe a minor has provided us information, please contact us so we can delete it.
      </p>

      <h2>8. International users</h2>
      <p>
        We operate in the United States, and your information may be processed and stored in the United States
        or other countries where our service providers operate. These countries may have data-protection laws
        different from those in your country. By using the Service, you understand that your information may be
        transferred to and processed in these locations.
      </p>

      <h2>9. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will revise the &ldquo;Last updated&rdquo; date
        above and, for material changes, provide additional notice where appropriate. Your continued use of the
        Service after changes take effect constitutes acceptance of the updated Policy.
      </p>

      <h2>10. Contact us</h2>
      <p>
        If you have questions about this Privacy Policy or our data practices, contact us at{" "}
        <a href="mailto:support@cbedge.net">support@cbedge.net</a>.
      </p>
    </LegalShell>
  );
}
