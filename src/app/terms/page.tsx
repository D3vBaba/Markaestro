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
      <p className="mt-2 text-sm text-muted-foreground">Last updated: March 10, 2026</p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-lg font-semibold text-foreground">1. Agreement to Terms</h2>
          <p className="mt-3">
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of Markaestro&apos;s website, application, APIs, and related services (collectively, the &quot;Services&quot;). By accessing or using the Services, you agree to be bound by these Terms. If you do not agree, do not use the Services.
          </p>
          <p className="mt-2">
            If you use the Services on behalf of a company, organization, or other legal entity, you represent that you have authority to bind that entity, and &quot;you&quot; includes that entity.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">2. Description of Service</h2>
          <p className="mt-3">
            Markaestro is a marketing automation platform for managing products, brand voice settings, content generation, social publishing, email campaigns, ad campaigns, automations, contact management, and analytics. The Services may integrate with third-party platforms including TikTok, Meta, Google, X, Resend, Firebase, and other services made available by Markaestro from time to time.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">3. Eligibility and Accounts</h2>
          <div className="mt-3 space-y-2">
            <p>You must be at least 18 years old and capable of forming a binding contract to use the Services. You agree to provide accurate, current, and complete information and to keep it updated.</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>You are responsible for safeguarding your account credentials and any authentication methods tied to your account.</li>
              <li>You are responsible for all activity occurring under your account and within your workspace, whether or not authorized by you, unless caused by our breach of these Terms or applicable law.</li>
              <li>You must notify us promptly if you suspect unauthorized access, credential compromise, or other account misuse.</li>
            </ul>
            <p>Accounts registered through bots, deceptive identities, or unauthorized automated methods are prohibited.</p>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">4. Workspaces and Team Access</h2>
          <p className="mt-3">
            Markaestro is organized around workspaces. Workspace owners and administrators may add or remove members and assign roles. The workspace owner is responsible for authorizing access, maintaining lawful instructions, and ensuring that all workspace users comply with these Terms. Deleting or removing a user does not automatically remove content, logs, or records previously created in the workspace.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">5. Customer Data and Compliance Responsibilities</h2>
          <div className="mt-3 space-y-2">
            <p>You retain responsibility for the legality, accuracy, and use of any data or content you submit to Markaestro, including contact lists, campaign materials, brand assets, prompts, uploaded media, ad targeting information, and messages sent through the Services.</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>You must have all rights, permissions, licenses, and legal bases necessary to upload, process, publish, or send that data or content.</li>
              <li>You are responsible for complying with applicable privacy, anti-spam, consumer protection, advertising, and platform-specific rules, including consent, notice, unsubscribe, and suppression obligations.</li>
              <li>You must not use Markaestro to process special category or other highly regulated data unless we expressly agree in writing to support that use.</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">6. Acceptable Use</h2>
          <div className="mt-3 space-y-2">
            <p>You may not use the Services to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>violate any law, regulation, court order, or third-party right;</li>
              <li>send spam, unlawful marketing, phishing, or deceptive or manipulative content;</li>
              <li>publish or distribute infringing, defamatory, obscene, fraudulent, hateful, or otherwise unlawful material;</li>
              <li>attempt to gain unauthorized access to any account, workspace, system, or network;</li>
              <li>reverse engineer, scrape, or abuse the Services except as permitted by applicable law;</li>
              <li>interfere with the operation, integrity, or security of the Services;</li>
              <li>circumvent rate limits, quotas, access restrictions, or security controls; or</li>
              <li>use the Services in a way that causes Markaestro or its providers to violate platform terms or contractual obligations.</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">7. Third-Party Services and Integrations</h2>
          <p className="mt-3">
            Markaestro may connect to third-party platforms, ad networks, AI providers, and messaging or analytics tools. By connecting a third-party service, you authorize Markaestro to access, store, refresh, and use credentials and related data as needed to provide the requested functionality within the permissions you grant.
          </p>
          <p className="mt-2">
            You remain responsible for complying with the third party&apos;s terms, policies, technical requirements, publishing rules, and account restrictions. Markaestro is not responsible for API changes, service outages, account suspensions, content moderation decisions, rejected ads, revoked tokens, or third-party platform actions.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">8. AI Features and Outputs</h2>
          <p className="mt-3">
            Markaestro may provide AI-generated copy, images, recommendations, summaries, and performance insights. AI output is generated statistically and may be inaccurate, incomplete, biased, infringing, or unsuitable for your intended use. You are solely responsible for reviewing, editing, validating, and approving all AI-assisted outputs before sending, publishing, launching, or otherwise relying on them.
          </p>
          <p className="mt-2">
            Markaestro does not guarantee exclusivity, originality, or legal clearance of AI-generated content, and AI outputs may resemble content generated for other users.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">9. Uploads and Public Content</h2>
          <p className="mt-3">
            Some files or generated assets uploaded through Markaestro may be stored using publicly reachable cloud URLs so they can be used in ads, social posts, or creative workflows. You must not upload any file or content unless you are authorized to make it available in that way. You acknowledge that content published through third-party platforms may become public and subject to those platforms&apos; terms and visibility settings.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">10. Intellectual Property and Licenses</h2>
          <p className="mt-3">
            As between the parties, you retain ownership of your content, customer data, uploaded assets, and workspace materials. You grant Markaestro a non-exclusive, worldwide, limited license to host, store, copy, transform, display, transmit, and otherwise process that content only as necessary to operate, secure, improve, and provide the Services to you.
          </p>
          <p className="mt-2">
            Markaestro and its licensors retain all rights, title, and interest in the Services, including software, interfaces, documentation, branding, and related intellectual property. No rights are granted except as expressly stated in these Terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">11. Feedback</h2>
          <p className="mt-3">
            If you provide ideas, suggestions, feedback, or improvement requests, you grant Markaestro a perpetual, irrevocable, worldwide, sublicensable, royalty-free right to use them without restriction or compensation to you.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">12. Privacy</h2>
          <p className="mt-3">
            Your use of the Services is also subject to our <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>, which explains how we collect, use, and disclose information. Where we process customer data on your behalf, you instruct us to do so in accordance with these Terms, the applicable product settings, and your lawful use of the Services.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">13. Service Changes, Beta Features, and Availability</h2>
          <p className="mt-3">
            We may add, change, suspend, or remove features at any time. Some features may be labeled beta, preview, experimental, or similar. Those features are provided on an as-available basis and may contain bugs, incomplete functionality, or changing requirements. We do not guarantee that any feature, integration, or provider connection will remain available or operate without interruption.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">14. Suspension and Termination</h2>
          <p className="mt-3">
            You may stop using the Services at any time. We may suspend or terminate your access, remove content, disable integrations, or take other protective action if we reasonably believe you have violated these Terms, created legal or security risk, failed to comply with platform obligations, or used the Services in a way that could harm Markaestro, its users, or third parties.
          </p>
          <p className="mt-2">
            Upon termination, your right to use the Services ends immediately, but sections that by their nature should survive will survive, including those relating to intellectual property, disclaimers, limitations of liability, indemnification, and dispute terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">15. Disclaimers</h2>
          <p className="mt-3">
            To the maximum extent permitted by law, the Services are provided &quot;as is&quot; and &quot;as available.&quot; Markaestro disclaims all warranties, whether express, implied, statutory, or otherwise, including warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, reliability, availability, or that the Services will be uninterrupted, secure, error-free, or meet your expectations.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">16. Limitation of Liability</h2>
          <p className="mt-3">
            To the maximum extent permitted by law, Markaestro and its affiliates, officers, employees, contractors, and licensors will not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for any loss of profits, revenues, goodwill, use, or data, even if advised of the possibility of such damages.
          </p>
          <p className="mt-2">
            To the maximum extent permitted by law, Markaestro&apos;s total aggregate liability arising out of or relating to the Services or these Terms will not exceed the greater of the amount you paid us for the Services in the 12 months before the event giving rise to the claim or one hundred U.S. dollars (US$100).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">17. Indemnification</h2>
          <p className="mt-3">
            You will defend, indemnify, and hold harmless Markaestro and its affiliates, officers, employees, contractors, and licensors from and against any claims, liabilities, damages, judgments, losses, costs, and expenses, including reasonable legal fees, arising out of or related to your content, your data, your use of the Services, your use of third-party integrations, or your violation of these Terms or applicable law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">18. Governing Law</h2>
          <p className="mt-3">
            These Terms are governed by the laws of the State of Delaware, United States, without regard to conflict of laws principles, except to the extent non-waivable law in your jurisdiction requires otherwise.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">19. Changes to These Terms</h2>
          <p className="mt-3">
            We may update these Terms from time to time. If we make material changes, we will post the updated version and may provide additional notice. Your continued use of the Services after the effective date of revised Terms constitutes acceptance of the revised Terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">20. Contact</h2>
          <p className="mt-3">
            If you have questions about these Terms, contact us through <a href="/contact" className="underline hover:text-foreground">our contact page</a> or email <a href="mailto:legal@markaestro.com" className="underline hover:text-foreground">legal@markaestro.com</a>.
          </p>
        </section>
      </div>
    </LegalLayout>
  );
}
