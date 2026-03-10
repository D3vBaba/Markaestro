"use client";

import { useState } from "react";
import LegalLayout from "@/components/layout/LegalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Mail, MessageSquare, Shield } from "lucide-react";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mailto = `mailto:support@markaestro.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`From: ${name} (${email})\n\n${message}`)}`;
    window.location.href = mailto;
    setSent(true);
  }

  return (
    <LegalLayout>
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Contact Us</h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            Have a question, need support, or want to share feedback? We&apos;d love to hear from you. Reach out using the form or any of the channels below.
          </p>

          <div className="mt-10 space-y-6">
            <div className="flex items-start gap-3">
              <div className="rounded-md border p-2">
                <Mail className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">General Inquiries</p>
                <a href="mailto:hello@markaestro.com" className="text-sm text-muted-foreground hover:text-foreground transition">
                  hello@markaestro.com
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="rounded-md border p-2">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Technical Support</p>
                <a href="mailto:support@markaestro.com" className="text-sm text-muted-foreground hover:text-foreground transition">
                  support@markaestro.com
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="rounded-md border p-2">
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Privacy &amp; Legal</p>
                <a href="mailto:legal@markaestro.com" className="text-sm text-muted-foreground hover:text-foreground transition">
                  legal@markaestro.com
                </a>
              </div>
            </div>
          </div>

          <div className="mt-10 rounded-md border bg-muted/30 p-4">
            <p className="text-xs font-medium text-foreground">Response Times</p>
            <p className="mt-1 text-xs text-muted-foreground">
              We typically respond to inquiries within 1-2 business days. For urgent technical issues, please include &quot;URGENT&quot; in the subject line.
            </p>
          </div>
        </div>

        <Card className="border shadow-sm">
          <CardContent className="p-6">
            {sent ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-md border p-3">
                  <Mail className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">Message Ready</h3>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Your email client should have opened with the message pre-filled. If it didn&apos;t, you can email us directly at <a href="mailto:support@markaestro.com" className="underline">support@markaestro.com</a>.
                </p>
                <Button variant="outline" className="mt-6" onClick={() => setSent(false)}>
                  Send Another Message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      required
                      className="h-10"
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
                      className="h-10"
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
                    className="h-10"
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
                    rows={5}
                    className="flex w-full border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <Button type="submit" className="h-10 w-full">
                  Send Message
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  By sending a message, you agree to our{" "}
                  <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>.
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </LegalLayout>
  );
}
