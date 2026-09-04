"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import NextLink from "next/link";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

type ContactChannel = { title: string; description: string; email: string; response: string };
type Faq = { q: string; a: string };

export default function ContactPage() {
  const t = useTranslations("contact");
  const contactChannels = t.raw("channels") as ContactChannel[];
  const faqs = t.raw("faqs") as Faq[];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setSendFailed(false);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message }),
      });
      if (!res.ok) throw new Error(`contact ${res.status}`);
      setSent(true);
      setName(""); setEmail(""); setSubject(""); setMessage("");
    } catch {
      // Delivery failed: hand the message to the visitor's mail client instead.
      setSendFailed(true);
      const mailto = `mailto:${t("form.supportEmail")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`From: ${name} (${email})\n\n${message}`)}`;
      window.location.href = mailto;
    } finally {
      setSending(false);
    }
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
            <p className="mk-eyebrow">{t("hero.eyebrow")}</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] leading-[1.05] lg:text-6xl">
              {t("hero.titleLead")} <span className="text-primary">{t("hero.titleHighlight")}</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              {t("hero.subtitle")}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact Channels */}
      <section
        className="border-t bg-card border-border"
      >
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="grid gap-6 sm:grid-cols-3">
            {contactChannels.map((channel) => (
              <motion.div
                key={channel.title}
                className="rounded-xl border bg-card p-6 transition-colors"
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, ease }}
              >
                <h3 className="text-sm font-semibold text-foreground">{channel.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{channel.description}</p>
                <a
                  href={`mailto:${channel.email}`}
                  className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {channel.email}
                </a>
                <div className="mt-3 text-xs text-muted-foreground">
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
              <p className="mk-eyebrow">{t("form.eyebrow")}</p>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-3xl">
                {t("form.title")}
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                {t("form.description")}
              </p>

              <div className="mt-10 space-y-6">
                <div
                  className="rounded-xl p-5"
                  style={{
                    background: "var(--mk-surface)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
                  <h3 className="text-sm font-semibold text-foreground">{t("form.officeHoursTitle")}</h3>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <p>{t("form.officeHoursWeekday")}</p>
                    <p>{t("form.officeHoursWeekend")}</p>
                  </div>
                </div>
                <div
                  className="rounded-xl p-5"
                  style={{
                    background: "var(--mk-surface)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
                  <h3 className="text-sm font-semibold text-foreground">{t("form.enterpriseTitle")}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {t("form.enterpriseDescription")}{" "}
                    <a href={`mailto:${t("form.enterpriseEmail")}`} className="text-primary hover:underline">
                      {t("form.enterpriseEmail")}
                    </a>
                  </p>
                </div>
              </div>
            </div>

            <Card className="border rounded-xl">
              <CardContent className="p-8">
                {sent ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <h3 className="text-lg font-semibold">{t("form.sentTitle")}</h3>
                    <p className="mt-3 max-w-sm text-sm text-muted-foreground leading-relaxed">
                      {t("form.sentDescription")}{" "}
                      <a href={`mailto:${t("form.supportEmail")}`} className="text-primary hover:underline">{t("form.supportEmail")}</a>.
                    </p>
                    <Button variant="outline" className="mt-8 rounded-xl" onClick={() => setSent(false)}>
                      {t("form.sendAnother")}
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    {sendFailed && (
                      <p className="text-sm text-destructive">{t("form.sendFailed")}</p>
                    )}
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="name">{t("form.nameLabel")}</Label>
                        <Input
                          id="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder={t("form.namePlaceholder")}
                          required
                          className="h-11 rounded-lg text-[13.5px]"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">{t("form.emailLabel")}</Label>
                        <Input
                          id="email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder={t("form.emailPlaceholder")}
                          required
                          className="h-11 rounded-lg text-[13.5px]"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="subject">{t("form.subjectLabel")}</Label>
                      <Input
                        id="subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={t("form.subjectPlaceholder")}
                        required
                        className="h-11 rounded-lg text-[13.5px]"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="message">{t("form.messageLabel")}</Label>
                      <textarea
                        id="message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={t("form.messagePlaceholder")}
                        required
                        rows={6}
                        className="flex w-full rounded-xl border border-input bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>

                    <Button type="submit" disabled={sending} className="h-11 w-full rounded-lg">
                      {sending ? t("form.sending") : t("form.submit")}
                    </Button>

                    <p className="text-center text-xs text-muted-foreground">
                      {t("form.privacyNotice")}{" "}
                      <Link href="/privacy" className="text-primary hover:underline">{t("form.privacyLink")}</Link>.
                    </p>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section
        className="border-t bg-background border-border"
      >
        <div className="mx-auto max-w-3xl px-6 py-24 lg:py-32">
          <div className="text-center">
            <p className="mk-eyebrow">{t("faqEyebrow")}</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-3xl">
              {t("faqTitle")}
            </h2>
          </div>
          <div className="mt-12 space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="rounded-xl border bg-card overflow-hidden"
              >
                <button
                  className="flex w-full items-center justify-between p-6 text-start"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-sm font-medium text-foreground pe-4">{faq.q}</span>
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
      <section
        className="border-t bg-foreground border-border"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              className="text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
              style={{ color: "var(--mk-paper)", letterSpacing: "-0.03em" }}
            >
              {t("cta.title")}
            </h2>
            <p
              className="mt-4 text-[14px] sm:text-[15px]"
              style={{
                color: "color-mix(in oklch, var(--mk-paper) 70%, transparent)",
              }}
            >
              {t("cta.subtitle")}
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <NextLink href="/onboarding">
                <Button
                  size="lg"
                  className="h-11 px-7 rounded-lg text-[13.5px] bg-card text-foreground"
                >
                  {t("cta.button")}
                </Button>
              </NextLink>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
