import type { Metadata } from "next";
import LegalLayout from "@/components/layout/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy | Markaestro",
  description: "How Markaestro collects, uses, stores, and protects your personal information.",
};

export default function PrivacyPage() {
  return (
    <LegalLayout>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: February 28, 2026</p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-lg font-semibold text-foreground">1. Introduction</h2>
          <p className="mt-3">
            Markaestro (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our marketing automation platform (&quot;Service&quot;). Please read this policy carefully. By using the Service, you consent to the practices described herein.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">2. Information We Collect</h2>

          <h3 className="mt-4 font-medium text-foreground">2.1 Information You Provide</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>Account information:</strong> Name, email address, and password when you create an account.</li>
            <li><strong>Workspace data:</strong> Workspace names, team member invitations, and role assignments.</li>
            <li><strong>Marketing content:</strong> Posts, campaigns, email templates, product descriptions, brand voice settings, and brand identity assets you create within the Service.</li>
            <li><strong>Contact lists:</strong> Names, email addresses, tags, and metadata of contacts you import or create.</li>
            <li><strong>Integration credentials:</strong> OAuth tokens and API keys you provide to connect third-party platforms.</li>
          </ul>

          <h3 className="mt-4 font-medium text-foreground">2.2 Information Collected Automatically</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>Usage data:</strong> Pages visited, features used, actions performed, and timestamps.</li>
            <li><strong>Device information:</strong> Browser type, operating system, and device identifiers.</li>
            <li><strong>Log data:</strong> IP addresses, request URLs, and error logs for operational purposes.</li>
          </ul>

          <h3 className="mt-4 font-medium text-foreground">2.3 Information from Third Parties</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>OAuth providers:</strong> When you connect Meta, Google, or TikTok, we receive profile information, page lists, and account identifiers as authorized by you.</li>
            <li><strong>Analytics data:</strong> Engagement metrics, post performance, and audience insights from connected platforms.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">3. How We Use Your Information</h2>
          <div className="mt-3 space-y-2">
            <p>We use collected information to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Provide, operate, and maintain the Service.</li>
              <li>Publish content and manage campaigns on your behalf across connected platforms.</li>
              <li>Generate AI-powered content and images based on your brand voice, product data, and prompts.</li>
              <li>Send emails and notifications through connected email providers.</li>
              <li>Display analytics and performance metrics for your campaigns.</li>
              <li>Authenticate your identity and manage workspace access.</li>
              <li>Improve and develop new features for the Service.</li>
              <li>Respond to your support requests and communications.</li>
              <li>Comply with legal obligations.</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">4. How We Store and Protect Your Data</h2>

          <h3 className="mt-4 font-medium text-foreground">4.1 Infrastructure</h3>
          <p className="mt-2">
            The Service runs on Google Cloud Platform (GCP). Data is stored in Google Cloud Firestore and Google Cloud Storage, benefiting from Google&apos;s enterprise-grade security infrastructure including encryption at rest and in transit.
          </p>

          <h3 className="mt-4 font-medium text-foreground">4.2 Credential Security</h3>
          <p className="mt-2">
            Third-party integration tokens (OAuth access tokens, API keys) are encrypted using AES-256-GCM before storage. Encryption keys are managed via Google Cloud Secret Manager and are never stored in application code or configuration files. We do not store plaintext credentials.
          </p>

          <h3 className="mt-4 font-medium text-foreground">4.3 Authentication</h3>
          <p className="mt-2">
            User authentication is handled by Firebase Authentication. Passwords are never stored by our application; they are managed entirely by Firebase&apos;s secure authentication infrastructure.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">5. Data Sharing and Disclosure</h2>
          <div className="mt-3 space-y-2">
            <p>We do not sell your personal information. We may share your data in the following circumstances:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li><strong>Third-party platforms:</strong> When you publish content or create ad campaigns, your content is transmitted to the connected platform (Meta, TikTok, Google, etc.) as directed by you.</li>
              <li><strong>AI providers:</strong> Content prompts are sent to AI providers (Google Gemini, OpenAI) to generate text and images. These providers process data according to their own privacy policies.</li>
              <li><strong>Email providers:</strong> Contact information and email content are transmitted to your connected email service (e.g., Resend) for delivery.</li>
              <li><strong>Service providers:</strong> We use Google Cloud Platform for hosting and infrastructure. Data is processed in accordance with Google&apos;s data processing terms.</li>
              <li><strong>Legal requirements:</strong> We may disclose information if required by law, court order, or governmental request.</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">6. Data Retention</h2>
          <p className="mt-3">
            We retain your data for as long as your account is active or as needed to provide the Service. Marketing content, campaign data, and analytics are retained within your workspace until you delete them. OAuth state tokens are automatically deleted after 15 minutes. If you delete your account, we will remove your personal information within 30 days, except where retention is required by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">7. Your Rights</h2>
          <div className="mt-3 space-y-2">
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li><strong>Access</strong> the personal data we hold about you.</li>
              <li><strong>Correct</strong> inaccurate or incomplete information.</li>
              <li><strong>Delete</strong> your personal data (subject to legal retention requirements).</li>
              <li><strong>Export</strong> your data in a portable format.</li>
              <li><strong>Withdraw consent</strong> for data processing where consent is the legal basis.</li>
              <li><strong>Disconnect</strong> third-party integrations at any time from the Settings page.</li>
            </ul>
            <p>To exercise these rights, contact us at <a href="mailto:privacy@markaestro.com" className="underline hover:text-foreground">privacy@markaestro.com</a>.</p>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">8. Cookies and Tracking</h2>
          <p className="mt-3">
            The Service uses essential cookies for authentication and session management. We do not use third-party advertising trackers. Firebase Authentication may set cookies necessary for sign-in functionality.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">9. Children&apos;s Privacy</h2>
          <p className="mt-3">
            The Service is not directed to individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have collected data from a child under 18, we will take steps to delete that information.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">10. International Data Transfers</h2>
          <p className="mt-3">
            Your data may be processed and stored in the United States and other countries where our service providers operate. By using the Service, you consent to the transfer of your information to these jurisdictions, which may have different data protection laws than your country of residence.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">11. Changes to This Policy</h2>
          <p className="mt-3">
            We may update this Privacy Policy from time to time. We will notify you of material changes by posting a notice on the Service or sending an email. Your continued use of the Service after changes are posted constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">12. Contact Us</h2>
          <p className="mt-3">
            If you have questions or concerns about this Privacy Policy or our data practices, please contact us at <a href="mailto:privacy@markaestro.com" className="underline hover:text-foreground">privacy@markaestro.com</a> or visit our <a href="/contact" className="underline hover:text-foreground">contact page</a>.
          </p>
        </section>
      </div>
    </LegalLayout>
  );
}
