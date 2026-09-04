"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiPost } from "@/lib/api-client";
import { userFacingError } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { DraftButton, INSET, KindBadge, Section, TYPE, TrustBadge } from "./shared";
import type { ExperimentDraft, PostRow } from "./types";

const STRATEGIST_TOOLS = [
  "audience_performance", "audience_alignment", "top_posts", "pillar_performance",
  "hook_performance", "timing_performance", "drift", "learnings", "campaigns",
  "platform_comparisons", "experiments",
] as const;

type AskResult = { answer: string; tool: string; evidenceIds?: string[]; limitations: string[] };

/**
 * One question, one approved data tool, an answer that names its evidence.
 * Lives on Overview because it is the fastest way into the brand's memory.
 */
export function AskMarkaestro({ productId, posts, onTest }: { productId: string; posts: PostRow[]; onTest?: (draft: ExperimentDraft) => void }) {
  const t = useTranslations("intelligence.ask");
  const tActions = useTranslations("intelligence.askActions");
  const [asked, setAsked] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);
  const examples = t.raw("examples") as string[];

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setResult(null);
    setAsked(trimmed);
    try {
      const response = await apiPost<AskResult>(
        "/api/intelligence/strategist",
        { productId, question: trimmed },
        undefined,
        { timeoutMs: 90_000 },
      );
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("failed"), {
          REQUEST_TIMEOUT: t("timeout"),
          QUOTA_EXCEEDED: t("quota"),
          FEATURE_NOT_AVAILABLE: t("unavailable"),
        }));
        return;
      }
      setResult(response.data);
    } catch {
      toast.error(t("failed"));
    } finally {
      setAsking(false);
    }
  }

  const toolLabel = result && (STRATEGIST_TOOLS as readonly string[]).includes(result.tool)
    ? t(`tools.${result.tool as (typeof STRATEGIST_TOOLS)[number]}`)
    : result?.tool || "";
  const byId = new Map(posts.map((post) => [post.id, post]));
  const cited = (result?.evidenceIds || []).map((id) => byId.get(id)).filter((post): post is PostRow => Boolean(post));
  const uncited = (result?.evidenceIds?.length || 0) - cited.length;

  return (
    <Section trust="recommended" title={t("title")} subtitle={t("subtitle")} help="ask">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("placeholder")}
          rows={2}
          aria-label={t("title")}
          className="min-h-[2.5rem] flex-1 rounded-xl text-[13px]"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(question);
            }
          }}
        />
        <Button className="h-10 sm:h-auto sm:self-stretch" type="submit" disabled={!question.trim() || asking}>
          <MessageSquareText className="size-3.5" aria-hidden="true" />
          {asking ? t("asking") : t("submit")}
        </Button>
      </form>
      {!result && !asking && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setQuestion(example);
                void ask(example);
              }}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-mk-ink-80 transition-colors hover:bg-muted"
            >
              {example}
            </button>
          ))}
        </div>
      )}
      {result && (
        <div className={cn("mt-4 p-4", INSET)}>
          <div className="flex flex-wrap items-center gap-2">
            <TrustBadge kind="generated" />
            <span className={TYPE.meta}>{t("tool", { tool: toolLabel })}</span>
          </div>
          <p className={cn("mt-2 whitespace-pre-wrap", TYPE.body)}>{result.answer}</p>
          {(cited.length > 0 || uncited > 0) && (
            <div className="mt-3">
              <p className={TYPE.meta}>{t("evidence")}</p>
              <ul className="mt-1.5 space-y-1">
                {cited.slice(0, 5).map((post) => (
                  <li key={post.id} className="flex items-center gap-2 text-xs text-mk-ink-80">
                    <KindBadge tone="slate">{post.platform}</KindBadge>
                    <span className="truncate">{post.content || t("mediaOnly")}</span>
                  </li>
                ))}
                {uncited > 0 && <li className={TYPE.hint}>{t("otherRecords", { count: uncited })}</li>}
              </ul>
            </div>
          )}
          {result.limitations.map((item) => (
            <p key={item} className={cn("mt-2", TYPE.hint)}>{item}</p>
          ))}
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {cited[0] && (
              <DraftButton productId={productId} source={{ type: "post", id: cited[0].id }} platform={cited[0].platform} label={tActions("draft")} variant="outline" />
            )}
            {onTest && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onTest({ id: `ask:${Date.now()}`, name: asked.slice(0, 120), hypothesis: result.answer.split(/(?<=[.!?])\s/)[0]?.slice(0, 500) || asked, platform: cited[0]?.platform ?? null })}
              >
                <FlaskConical className="size-3.5" aria-hidden="true" />
                {tActions("test")}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setResult(null); setQuestion(""); }}>
              {tActions("followUp")}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
