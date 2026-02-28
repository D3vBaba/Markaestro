"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/app/PageHeader";
import { Sparkles, Copy, Loader2 } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { toast } from "sonner";

type ContentType = "email_subject" | "email_body" | "social_post" | "ad_copy" | "full_campaign";

const contentTypes: { value: ContentType; label: string; description: string }[] = [
  { value: "email_subject", label: "Email Subject Lines", description: "Generate 5 compelling subject lines" },
  { value: "email_body", label: "Email Body", description: "Full email content with HTML" },
  { value: "social_post", label: "Social Post", description: "Platform-optimized social content" },
  { value: "ad_copy", label: "Ad Copy", description: "Headline, primary text, description" },
  { value: "full_campaign", label: "Full Campaign", description: "Multi-channel campaign brief" },
];

export default function ContentStudioPage() {
  const [contentType, setContentType] = useState<ContentType>("email_subject");
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [channel, setChannel] = useState("email");
  const [tone, setTone] = useState("professional");
  const [additionalContext, setAdditionalContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState("");

  const handleGenerate = async () => {
    if (!productName) {
      toast.error("Enter a product name");
      return;
    }
    setGenerating(true);
    setResult("");
    try {
      const res = await apiPost<{ content: string }>("/api/ai/generate", {
        type: contentType,
        productName,
        productDescription,
        targetAudience,
        channel,
        tone,
        additionalContext,
      });
      if (res.ok) {
        setResult(res.data.content);
        toast.success("Content generated");
      } else {
        const errData = res.data as unknown as { error?: string };
        toast.error(errData.error || "Generation failed — check ANTHROPIC_API_KEY env var");
      }
    } catch {
      toast.error("Failed to generate content");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    toast.success("Copied to clipboard");
  };

  return (
    <AppShell>
      <PageHeader
        title="Content Studio"
        subtitle="AI-powered marketing content generation."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Content Type</CardTitle>
              <CardDescription>What kind of content do you need?</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {contentTypes.map((ct) => (
                  <button
                    key={ct.value}
                    onClick={() => setContentType(ct.value)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      contentType === ct.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <p className="text-sm font-medium">{ct.label}</p>
                    <p className="text-xs text-muted-foreground">{ct.description}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Tell the AI about your product and audience.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Product Name</label>
                <Input placeholder="DripCheckr" value={productName} onChange={(e) => setProductName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Product Description</label>
                <Textarea placeholder="AI-powered drip campaign analytics..." value={productDescription} onChange={(e) => setProductDescription(e.target.value)} rows={2} />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Target Audience</label>
                <Input placeholder="SaaS founders, marketing teams" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Channel</label>
                  <select value={channel} onChange={(e) => setChannel(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="email">Email</option>
                    <option value="x">X (Twitter)</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Tone</label>
                  <select value={tone} onChange={(e) => setTone(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="urgent">Urgent</option>
                    <option value="friendly">Friendly</option>
                    <option value="bold">Bold</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Additional Context (optional)</label>
                <Textarea placeholder="Any specific requirements, offers, or constraints..." value={additionalContext} onChange={(e) => setAdditionalContext(e.target.value)} rows={2} />
              </div>
              <Button onClick={handleGenerate} disabled={generating} className="w-full">
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" /> Generate Content
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm h-fit sticky top-20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Generated Content</CardTitle>
                <CardDescription>AI-generated marketing content powered by Claude.</CardDescription>
              </div>
              {result && (
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  <Copy className="mr-2 h-3 w-3" /> Copy
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded-lg border overflow-auto max-h-[600px]">
                  {result}
                </pre>
              </div>
            ) : (
              <div className="text-center py-16 text-muted-foreground">
                <Sparkles className="h-10 w-10 mx-auto mb-4 opacity-50" />
                <p className="text-sm">Generated content will appear here.</p>
                <p className="text-xs mt-1">Fill in the details and click Generate.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
