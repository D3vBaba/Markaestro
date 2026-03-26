"use client";

import { useState } from "react";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowRight, Clock, Mail, MessageSquare, Shield, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const contactChannels = [
  {
    icon: Mail,
    title: "General Inquiries",
    description: "Questions about Markaestro, pricing, or partnerships.",
    email: "hello@markaestro.com",
    response: "1-2 business days",
  },
  {
    icon: MessageSquare,
    title: "Technical Support",
    description: "Help with integrations, publishing issues, or account access.",
    email: "support@markaestro.com",
    response: "Under 24 hours",
  },
  {
    icon: Shield,
    title: "Privacy & Legal",
    description: "Data requests, compliance questions, or legal inquiries.",
    email: "legal@markaestro.com",
    response: "2-3 business days",
  },
];

const faqs = [
  {
    q: "How do I connect my social media accounts?",
    a: "Go to Settings > Integrations in your dashboard. Click 'Connect' next to any platform (Facebook, Instagram, TikTok, Google) and authorize via OAuth. The entire process takes under a minute.",
  },
  {
    q: "Is there a free tier?",
    a: "Yes. Markaestro offers a free plan that includes one workspace, basic content generation, and publishing to up to two channels. Upgrade anytime for unlimited channels and advanced AI features.",
  },
  {
    q: "What AI models power the content generation?",
    a: "Text content is generated using large language models fine-tuned on marketing copy. Images use Google's Gemini Imagen 3 as the primary engine, with OpenAI's DALL-E 3 as an automatic fallback for maximum reliability.",
  },
  {
    q: "Can I use Markaestro for multiple brands or clients?",
    a: "Absolutely. Workspaces let you isolate brands, clients, or business units. Each workspace has its own products, brand voice profiles, channel connections, and team members.",
  },
  {
    q: "How is my data protected?",
    a: "OAuth tokens are encrypted at rest. All API communication uses TLS. We follow principle of least privilege for data access. See our Privacy Policy for full details.",
  },
  {
    q: "Do you offer an API?",
    a: "Markaestro's API is available to all paid plans. It covers campaign management, content generation, publishing, and analytics. Documentation is available in your dashboard.",
  },
];

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mailto = `mailto:support@markaestro.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`From: ${name} (${email})\n\n${message}`)}`;
    window.location.href = mailto;
    setSent(true);
  }

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Contact</p>
            <h1 className="mt-4 text-4xl font-normal tracking-tight lg:text-6xl font-[family-name:var(--font-display)]">
              We&apos;d love to <span className="text-primary">hear from you</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Whether you have a question about features, need help with an integration, or want to explore a partnership — our team is here to help.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact Channels */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="grid gap-6 sm:grid-cols-3">
            {contactChannels.map((channel) => (
              <motion.div
                key={channel.title}
                className="rounded-2xl border border-border/40 bg-background p-8 transition-all duration-300 hover:translate-y-[-3px] hover:shadow-lg"
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, ease }}
              >
                <div className="rounded-xl bg-primary/5 p-3 w-fit">
                  <channel.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-5 text-sm font-semibold text-foreground">{channel.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{channel.description}</p>
                <a
                  href={`mailto:${channel.email}`}
                  className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {channel.email}
                </a>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {channel.response}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <section className="border-t">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="grid gap-16 lg:grid-cols-[1fr_1.3fr] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Send a Message</p>
              <h2 className="mt-4 text-2xl font-normal tracking-tight lg:text-3xl font-[family-name:var(--font-display)]">
                Get in touch directly
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Fill out the form and we&apos;ll get back to you as soon as possible. For urgent technical issues, include &ldquo;URGENT&rdquo; in the subject line.
              </p>

              <div className="mt-10 space-y-6">
                <div className="rounded-2xl border border-border/40 bg-muted/20 p-6">
                  <h3 className="text-sm font-semibold text-foreground">Office Hours</h3>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <p>Monday - Friday: 9:00 AM - 6:00 PM EST</p>
                    <p>Saturday - Sunday: Closed</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-border/40 bg-muted/20 p-6">
                  <h3 className="text-sm font-semibold text-foreground">Enterprise & Partnerships</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    For enterprise pricing, custom integrations, or partnership opportunities, reach us at{" "}
                    <a href="mailto:partnerships@markaestro.com" className="text-primary hover:underline">
                      partnerships@markaestro.com
                    </a>
                  </p>
                </div>
              </div>
            </div>

            <Card className="border border-border/40 shadow-sm rounded-2xl">
              <CardContent className="p-8">
                {sent ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="rounded-2xl bg-primary/5 p-4">
                      <Mail className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="mt-6 text-lg font-semibold">Message Ready</h3>
                    <p className="mt-3 max-w-sm text-sm text-muted-foreground leading-relaxed">
                      Your email client should have opened with the message pre-filled. If it didn&apos;t, email us directly at{" "}
                      <a href="mailto:support@markaestro.com" className="text-primary hover:underline">support@markaestro.com</a>.
                    </p>
                    <Button variant="outline" className="mt-8 rounded-xl" onClick={() => setSent(false)}>
                      Send Another Message
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                          id="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Your name"
                          required
                          className="h-11 rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@company.com"
                          required
                          className="h-11 rounded-xl"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="subject">Subject</Label>
                      <Input
                        id="subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="How can we help?"
                        required
                        className="h-11 rounded-xl"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="message">Message</Label>
                      <textarea
                        id="message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Tell us more about your question or issue..."
                        required
                        rows={6}
                        className="flex w-full rounded-xl border border-input bg-background px-4 py-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>

                    <Button type="submit" className="h-11 w-full rounded-xl">
                      Send Message <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>

                    <p className="text-center text-xs text-muted-foreground">
                      By sending a message, you agree to our{" "}
                      <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
                    </p>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-3xl px-6 py-24 lg:py-32">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">FAQ</p>
            <h2 className="mt-4 text-2xl font-normal tracking-tight lg:text-3xl font-[family-name:var(--font-display)]">
              Frequently asked questions
            </h2>
          </div>
          <div className="mt-12 space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border/40 bg-background overflow-hidden transition-all duration-200"
              >
                <button
                  className="flex w-full items-center justify-between p-6 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-sm font-medium text-foreground pr-4">{faq.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${openFaq === i ? "rotate-180" : ""}`}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-6 pt-0">
                    <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-primary text-white">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-normal tracking-tight lg:text-4xl font-[family-name:var(--font-display)]">
              Ready to get started?
            </h2>
            <p className="mt-5 text-white/70">
              Create your free account and start publishing in minutes. No credit card required.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" variant="secondary" className="h-13 px-10 text-sm rounded-2xl bg-white text-foreground hover:bg-white/90">
                  Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
