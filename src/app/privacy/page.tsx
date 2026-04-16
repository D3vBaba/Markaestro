"use client";

import MarketingLayout from "@/components/layout/MarketingLayout";

export default function PrivacyPage() {
  return (
    <MarketingLayout>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: March 10, 2026</p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-lg font-semibold text-foreground">1. Scope and Roles</h2>
          <p className="mt-3">
            This Privacy Policy explains how Markaestro (&quot;Markaestro&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, discloses, and protects personal information when you access our marketing automation platform, website, applications, APIs, and related services (collectively, the &quot;Services&quot;).
          </p>
          <p className="mt-2">
            Markaestro processes different categories of data in different roles. For account, billing, security, support, and website administration data, we generally act as the controller or business. For contact lists, campaign data, brand assets, uploaded media, analytics events, and similar data submitted by a workspace, we generally act as a processor or service provider on behalf of that workspace. If you are an end customer or contact contained in a Markaestro customer workspace, you should direct privacy requests to that workspace first.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">2. Information We Collect</h2>

          <h3 className="mt-4 font-medium text-foreground">2.1 Information you provide directly</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>Account and identity data:</strong> email address, authentication identifiers, display name, and credentials handled through Firebase Authentication.</li>
            <li><strong>Workspace and team data:</strong> workspace name, membership records, user roles, and invite or access-management information.</li>
            <li><strong>Product and brand data:</strong> product names, descriptions, URLs, pricing tiers, categories, brand voice settings, sample voice text, target audience descriptions, keywords, avoid-word lists, logos, and brand color settings.</li>
            <li><strong>Campaign and publishing data:</strong> campaigns, posts, ad creatives, captions, scheduled times, media URLs, target audience settings, call-to-action text, and related workflow configuration.</li>
            <li><strong>Contact and CRM data:</strong> names, email addresses, status, lifecycle stage, source, tags, notes, product associations, and unsubscribe state for contacts you create, import, sync, or manage.</li>
            <li><strong>Automation and job configuration:</strong> automation steps, triggers, job schedules, job payloads, and related execution settings.</li>
            <li><strong>Support and communications data:</strong> information you send to us through email or contact forms, including message contents and any attachments you provide.</li>
          </ul>

          <h3 className="mt-4 font-medium text-foreground">2.2 Information from connected services and integrations</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>OAuth and integration data:</strong> access tokens, refresh tokens, token expiry data, provider account identifiers, usernames, open IDs, page or account selections, and provider-specific metadata needed to maintain a connection.</li>
            <li><strong>Social and analytics data:</strong> page lists, account profile information, post status, follower or profile metrics, engagement metrics, and related reporting data retrieved from providers such as TikTok, Meta, and similar services you connect.</li>
          </ul>

          <h3 className="mt-4 font-medium text-foreground">2.3 Information collected automatically</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>Usage and activity data:</strong> pages visited, features used, actions taken, timestamps, and workspace-scoped activity events.</li>
            <li><strong>Technical data:</strong> IP address, browser type, device information, operating system, request metadata, and approximate location derived from network information.</li>
            <li><strong>Diagnostics and logs:</strong> API error details, request IDs, security events, audit trails, background job run data, and telemetry captured for reliability and abuse prevention, including diagnostic processing through Sentry.</li>
            <li><strong>Cookie and local storage data:</strong> essential session, authentication, and preference information used to operate the Services.</li>
          </ul>

          <h3 className="mt-4 font-medium text-foreground">2.4 Files and uploads</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>Media uploads:</strong> logos, screenshots, images, videos, and other files you upload for publishing, brand identity, or AI-assisted generation.</li>
            <li><strong>Publicly accessible asset URLs:</strong> certain uploaded or generated assets may be stored using direct public cloud URLs so they can be rendered in social posts, landing assets, or generated creative workflows. You should only upload files you are authorized to publish or share in this manner.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">3. How We Use Information</h2>
          <div className="mt-3 space-y-2">
            <p>We use personal information and customer data to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>provide, secure, maintain, troubleshoot, and improve the Services;</li>
              <li>authenticate users and enforce workspace access controls;</li>
              <li>store and manage campaigns, products, brand settings, posts, and ad configurations;</li>
              <li>publish or schedule content and create or synchronize campaigns with connected third-party services when directed by you;</li>
              <li>generate text, images, insights, and recommendations using AI providers based on your prompts, brand inputs, and workspace content;</li>
              <li>calculate and display dashboards, analytics, attribution, and performance summaries;</li>
              <li>detect fraud, abuse, security incidents, and unauthorized access;</li>
              <li>respond to support inquiries, legal requests, and enforcement matters; and</li>
              <li>comply with legal obligations and protect our rights, users, and platform.</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">4. Legal Bases for Processing</h2>
          <p className="mt-3">
            Where required by law, we rely on one or more of the following legal bases: performance of a contract, legitimate interests, consent, and compliance with legal obligations. For example, we process account data to provide the Services under contract, use logs and security telemetry for legitimate interests in operating a secure platform, and may rely on consent where required for certain communications or integration permissions.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">5. Cookies and Similar Technologies</h2>
          <p className="mt-3">
            We use essential cookies, tokens, and similar storage technologies to keep you signed in, preserve session integrity, remember preferences, and secure the Services. We may also use technical telemetry and diagnostic tools to monitor application errors and performance. We do not sell personal information or use cross-context behavioral advertising cookies through the authenticated application experience.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">6. How We Share Information</h2>
          <div className="mt-3 space-y-2">
            <p>We do not sell personal information. We share information only as needed for the purposes described above, including with:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li><strong>Infrastructure providers:</strong> Google Cloud and Firebase for hosting, authentication, database, and storage services.</li>
              <li><strong>Error monitoring and diagnostics providers:</strong> providers such as Sentry to capture operational and security-related errors.</li>
              <li><strong>AI providers:</strong> providers such as OpenAI and Google when you use AI-assisted text, image, insight, or strategy features.</li>
              <li><strong>Connected integration providers:</strong> TikTok, Meta, Google, and other services you authorize us to connect to or use on your behalf.</li>
              <li><strong>Other workspace users:</strong> your data may be visible to authorized members of your workspace based on role and permissions.</li>
              <li><strong>Professional advisers and authorities:</strong> when reasonably necessary to enforce our terms, investigate misuse, respond to legal process, or protect rights, safety, and security.</li>
              <li><strong>Corporate transaction counterparties:</strong> in connection with a merger, acquisition, financing, restructuring, sale of assets, or similar event, subject to appropriate confidentiality protections.</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">7. AI and Automated Processing</h2>
          <p className="mt-3">
            Markaestro offers AI-assisted features that may use prompts, product descriptions, brand voice instructions, campaign content, analytics summaries, uploaded screenshots, logos, and related workspace data to generate marketing copy, images, recommendations, and performance insights. These outputs are generated automatically and may be inaccurate, incomplete, or unsuitable for your use case. You are responsible for reviewing AI-generated outputs before publication, launch, or sending.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">8. Storage, Security, and Integrity</h2>

          <h3 className="mt-4 font-medium text-foreground">8.1 Infrastructure</h3>
          <p className="mt-2">
            Markaestro runs on Google Cloud and Firebase infrastructure, including Firestore, Authentication, and Cloud Storage. We use reasonable administrative, technical, and organizational measures designed to protect personal information against unauthorized access, loss, misuse, or alteration.
          </p>

          <h3 className="mt-4 font-medium text-foreground">8.2 Secret handling</h3>
          <p className="mt-2">
            We encrypt sensitive integration secrets such as OAuth access tokens and API keys before storage using authenticated encryption. Passwords for email-password authentication are managed by Firebase Authentication rather than stored directly by our application.
          </p>

          <h3 className="mt-4 font-medium text-foreground">8.3 Important limitations</h3>
          <p className="mt-2">
            No internet or storage environment is completely secure. In addition, certain uploaded or generated assets may be intentionally stored at publicly reachable URLs to support publishing and creative workflows. You should not upload highly sensitive personal information, government IDs, payment card data, protected health information, or other regulated data unless we explicitly support that use in writing.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">9. International Transfers</h2>
          <p className="mt-3">
            We and our service providers may process information in the United States and other countries that may have different data protection laws from your jurisdiction. Where required, we use appropriate transfer mechanisms and safeguards for international transfers.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">10. Data Retention</h2>
          <div className="mt-3 space-y-2">
            <p>We retain information for as long as reasonably necessary to provide the Services, comply with legal obligations, resolve disputes, and enforce agreements. Retention periods vary by data type, for example:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>account and workspace records are retained while your account or workspace remains active;</li>
              <li>integration secrets are retained until disconnected, overwritten, or deleted;</li>
              <li>content, contacts, posts, products, campaigns, analytics records, and event logs remain in the workspace until deleted or until the workspace is removed, subject to backup and legal retention cycles;</li>
              <li>short-lived OAuth state and related temporary authorization data may expire and be deleted automatically after a short period;</li>
              <li>support, abuse-prevention, and legal records may be retained longer where needed for legitimate business purposes or legal compliance.</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">11. Your Privacy Rights</h2>
          <div className="mt-3 space-y-2">
            <p>Depending on your jurisdiction, you may have rights to access, correct, delete, restrict, object to, or export your personal information, and to withdraw consent where consent is the basis for processing. You may also have the right not to receive discriminatory treatment for exercising your rights.</p>
            <ul className="list-disc space-y-1 pl-6">
              <li><strong>EEA, UK, and similar regions:</strong> you may have rights to object, restrict processing, request portability, or lodge a complaint with your local supervisory authority.</li>
              <li><strong>California and similar U.S. state laws:</strong> you may have rights to know, access, delete, and correct personal information, and to limit certain sensitive data uses where applicable. Markaestro does not sell personal information or share it for cross-context behavioral advertising as those terms are defined under applicable state law.</li>
              <li><strong>Customer-end contacts:</strong> if your information is held in a Markaestro customer workspace, we may need to direct your request to that customer because that customer determines the purposes and means of processing that data.</li>
            </ul>
            <p>To exercise rights regarding data we control, contact us at <a href="mailto:legal@markaestro.com" className="underline hover:text-foreground">legal@markaestro.com</a>. We may need to verify your identity before fulfilling a request.</p>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">12. Your Responsibilities When You Use Markaestro</h2>
          <p className="mt-3">
            If you upload contact information, campaign content, or third-party platform data into Markaestro, you are responsible for ensuring you have an appropriate legal basis to do so and for honoring applicable privacy, anti-spam, advertising, and consumer protection laws. This includes obtaining any required consents and honoring unsubscribe or suppression requests.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">13. Children&apos;s Privacy</h2>
          <p className="mt-3">
            The Services are not directed to children, and you may not use them if you are under 18. We do not knowingly collect personal information from children. If you believe a child has provided us personal information, contact us and we will investigate and take appropriate action.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">14. Changes to This Policy</h2>
          <p className="mt-3">
            We may update this Privacy Policy from time to time. If we make material changes, we will post the updated version here and may provide additional notice through the Services or by email where appropriate. Your continued use of the Services after the effective date of the updated policy means the updated policy will apply to your future use.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">15. Contact Us</h2>
          <p className="mt-3">
            If you have questions about this Privacy Policy or Markaestro&apos;s privacy practices, contact us at <a href="mailto:legal@markaestro.com" className="underline hover:text-foreground">legal@markaestro.com</a> or through our <a href="/contact" className="underline hover:text-foreground">contact page</a>.
          </p>
        </section>
      </div>
      </div>
    </MarketingLayout>
  );
}
