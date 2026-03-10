import type { Metadata } from "next";
import LegalLayout from "@/components/layout/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Service | Markaestro",
  description: "Terms and conditions governing your use of the Markaestro marketing automation platform.",
};

export default function TermsPage() {
  return (
    <LegalLayout>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: February 28, 2026</p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-lg font-semibold text-foreground">1. Agreement to Terms</h2>
          <p className="mt-3">
            By accessing or using the Markaestro platform (&quot;Service&quot;), operated by Markaestro (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not access or use the Service.
          </p>
          <p className="mt-2">
            These terms apply to all visitors, users, and others who access or use the Service, including workspace owners, administrators, and team members.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">2. Description of Service</h2>
          <p className="mt-3">
            Markaestro is a marketing automation platform that provides tools for managing social media publishing, email campaigns, advertising campaigns, AI-powered content generation, contact management, and analytics. The Service integrates with third-party platforms including but not limited to Meta (Facebook and Instagram), TikTok, X (Twitter), Google Ads, and email service providers.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">3. Account Registration</h2>
          <div className="mt-3 space-y-2">
            <p>To use the Service, you must create an account by providing accurate and complete information. You are responsible for:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Maintaining the confidentiality of your account credentials.</li>
              <li>All activities that occur under your account.</li>
              <li>Notifying us immediately of any unauthorized use of your account.</li>
            </ul>
            <p>You must be at least 18 years old to create an account. Accounts created by automated methods are not permitted.</p>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">4. Workspaces and Team Access</h2>
          <p className="mt-3">
            The Service is organized around workspaces. Workspace owners may invite team members with varying roles (owner, admin, member). Owners are responsible for managing access and ensuring all team members comply with these terms. Removal of a team member does not delete content they created within the workspace.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">5. Acceptable Use</h2>
          <div className="mt-3 space-y-2">
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Violate any applicable law, regulation, or third-party rights.</li>
              <li>Send spam, unsolicited messages, or engage in deceptive marketing practices.</li>
              <li>Publish or distribute content that is unlawful, defamatory, obscene, or infringing.</li>
              <li>Attempt to gain unauthorized access to any part of the Service or its related systems.</li>
              <li>Interfere with or disrupt the integrity or performance of the Service.</li>
              <li>Use AI-generated content in a manner that violates the terms of the underlying AI providers.</li>
              <li>Circumvent any rate limits, usage quotas, or security measures.</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">6. Third-Party Integrations</h2>
          <p className="mt-3">
            The Service allows you to connect third-party accounts (Meta, TikTok, Google, etc.) via OAuth or API credentials. By connecting these accounts, you authorize Markaestro to act on your behalf within the scope of the permissions you grant. You remain solely responsible for compliance with each third-party platform&apos;s terms of service and advertising policies.
          </p>
          <p className="mt-2">
            We are not responsible for changes to third-party APIs, service disruptions, or content rejection by third-party platforms. Integration tokens are stored using AES-256-GCM encryption and are never exposed in plaintext.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">7. AI-Generated Content</h2>
          <p className="mt-3">
            The Service provides AI-powered content and image generation features. Content generated by AI is provided as a starting point and may require review and editing. You are solely responsible for reviewing, approving, and publishing all content created through the Service. We make no warranties regarding the accuracy, originality, or suitability of AI-generated content.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">8. Intellectual Property</h2>
          <p className="mt-3">
            You retain ownership of all content you create or upload to the Service. By using the Service, you grant us a limited license to process, store, and transmit your content solely for the purpose of providing the Service. We claim no ownership over your marketing content, brand assets, or campaign data.
          </p>
          <p className="mt-2">
            The Markaestro name, logo, and Service design are our intellectual property and may not be used without written permission.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">9. Data and Privacy</h2>
          <p className="mt-3">
            Your use of the Service is also governed by our <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>, which describes how we collect, use, and protect your information. By using the Service, you consent to our data practices as described in the Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">10. Service Availability and Modifications</h2>
          <p className="mt-3">
            We strive to maintain high availability but do not guarantee uninterrupted access. We may modify, suspend, or discontinue any part of the Service at any time with reasonable notice. We reserve the right to update these terms; continued use after changes constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">11. Limitation of Liability</h2>
          <p className="mt-3">
            To the maximum extent permitted by law, Markaestro shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or business opportunities, arising from your use of the Service. Our total liability for any claim arising from the Service shall not exceed the amount you paid us in the twelve months preceding the claim.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">12. Termination</h2>
          <p className="mt-3">
            You may terminate your account at any time by contacting us. We may suspend or terminate your access if you violate these terms or engage in activity that is harmful to the Service or other users. Upon termination, your right to use the Service ceases immediately. We may retain certain data as required by law or for legitimate business purposes.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">13. Governing Law</h2>
          <p className="mt-3">
            These terms shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law provisions.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">14. Contact</h2>
          <p className="mt-3">
            If you have questions about these terms, please contact us at <a href="/contact" className="underline hover:text-foreground">our contact page</a> or email us at <a href="mailto:legal@markaestro.com" className="underline hover:text-foreground">legal@markaestro.com</a>.
          </p>
        </section>
      </div>
    </LegalLayout>
  );
}
