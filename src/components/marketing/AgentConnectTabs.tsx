"use client";

/**
 * The client picker on /developers/agents.
 *
 * A user arrives knowing which agent they use, not which transport or auth
 * flow it speaks. Each tab answers the same four questions for one client:
 * what you need first, how to add the server, where the sign-in happens, and
 * how to tell it worked. The commands and config come from
 * `@/lib/agent-connect/clients`; the prose comes from the page copy so the
 * two cannot drift apart.
 *
 * Deep-linkable: `?client=cursor` or `#connect-cursor` opens that tab, so
 * llms.txt, the skill, and support replies can point at one client. Both are
 * read in the browser only (no useSearchParams): the page is prerendered,
 * and a search-param hook would swap this whole picker for a Suspense
 * fallback in the static HTML. Every panel is force-mounted (inactive ones
 * carry `hidden`), so all ten clients' steps and snippets are in the HTML a
 * crawler or an LLM reads.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CopyBlock from "@/components/marketing/CopyBlock";
import {
  AGENT_CLIENTS,
  API_KEY_SETTINGS_PATH,
  isAgentClientId,
  type AgentClient,
  type AgentClientId,
  type SnippetKind,
} from "@/lib/agent-connect/clients";

type ClientCopy = {
  label: string;
  summary: string;
  before: string[];
  add: string[];
  signIn: string[];
  /** Per-snippet captions keyed by snippet id; optional. */
  captions?: Record<string, string>;
};

const DEFAULT_CLIENT: AgentClientId = "claude-code";
const HASH_PREFIX = "#connect-";

/**
 * The URL is only readable in the browser. useSyncExternalStore renders the
 * server snapshot (nothing) during hydration and re-renders once the client
 * value is known, so a ?client=cursor or #connect-cursor link opens the right
 * tab without a hydration mismatch or a setState-in-effect.
 */
function subscribeLocation(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function readLocationClient(): AgentClientId | null {
  const fromQuery = new URLSearchParams(window.location.search).get("client");
  if (isAgentClientId(fromQuery)) return fromQuery;
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const id = hash.slice(HASH_PREFIX.length);
  return isAgentClientId(id) ? id : null;
}

const noLocation = () => null;

const SNIPPET_KIND_KEY: Record<SnippetKind, string> = {
  bash: "bash",
  json: "json",
  yaml: "yaml",
  toml: "toml",
  text: "text",
};

export default function AgentConnectTabs() {
  const t = useTranslations("developersAgents.connect");
  const fromLocation = useSyncExternalStore(subscribeLocation, readLocationClient, noLocation);

  // The user's explicit pick wins over the URL; a new deep link (popstate,
  // hashchange) clears it so the link wins again. Adjusting state during
  // render keeps that to one pass.
  const [chosen, setChosen] = useState<AgentClientId | null>(null);
  const [syncedLocation, setSyncedLocation] = useState(fromLocation);
  if (fromLocation !== syncedLocation) {
    setSyncedLocation(fromLocation);
    setChosen(null);
  }
  const active: AgentClientId = chosen ?? fromLocation ?? DEFAULT_CLIENT;

  const select = useCallback((value: string) => {
    if (!isAgentClientId(value)) return;
    setChosen(value);
    try {
      // replaceState does not fire hashchange, which is what we want: the
      // pick already drives the tab, and the URL just becomes shareable.
      window.history.replaceState(null, "", `${HASH_PREFIX}${value}`);
    } catch {
      // History access can be blocked in embedded contexts; the tab still switches.
    }
  }, []);

  const copy = useMemo(() => {
    const out = {} as Record<AgentClientId, ClientCopy>;
    for (const client of AGENT_CLIENTS) out[client.id] = t.raw(`clients.${client.id}`) as ClientCopy;
    return out;
  }, [t]);

  return (
    <div className="relative mt-14">
      {AGENT_CLIENTS.map((client) => (
        <span key={client.id} id={`connect-${client.id}`} className="absolute -top-24" aria-hidden />
      ))}
      <p className="mk-eyebrow">{t("eyebrow")}</p>
      <h3 className="mt-3 text-xl font-semibold tracking-[-0.02em] lg:text-2xl">{t("title")}</h3>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("intro")}</p>
      <Tabs value={active} onValueChange={select} className="mt-8 gap-6">
        <TabsList variant="line" aria-label={t("tabsLabel")}>
          {AGENT_CLIENTS.map((client) => (
            <TabsTrigger key={client.id} value={client.id} className="text-[13px]">
              {copy[client.id].label}
            </TabsTrigger>
          ))}
        </TabsList>
        {AGENT_CLIENTS.map((client) => (
          // forceMount keeps every panel in the HTML for crawlers; Radix then
          // leaves visibility to us, hence the explicit hidden.
          <TabsContent key={client.id} value={client.id} forceMount hidden={active !== client.id}>
            <ClientPanel client={client} copy={copy[client.id]} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function ClientPanel({ client, copy }: { client: AgentClient; copy: ClientCopy }) {
  const t = useTranslations("developersAgents.connect");
  const usesOAuth = client.auth !== "key";
  const usesKey = client.auth !== "oauth";

  return (
    <div className="rounded-xl border p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h3 className="text-lg font-semibold tracking-[-0.02em]">{copy.label}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{copy.summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={client.auth === "key" ? "outline" : "accent"}>{t(`path.${client.auth}`)}</Badge>
          {client.docsUrl && (
            <a
              href={client.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("docsLink", { client: copy.label })}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="space-y-6">
          <Step number="01" title={t("blocks.before")}>
            <ul className="m-0 list-disc space-y-1.5 ps-5">
              <li>{t("common.adminRequired")}</li>
              {copy.before.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Step>

          <Step number="03" title={usesOAuth ? t("blocks.signIn") : t("blocks.key")}>
            <ol className="m-0 list-decimal space-y-1.5 ps-5">
              {copy.signIn.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            {usesKey && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {/* /settings is an (app) route outside the [locale] segment, hence a plain anchor. */}
                <a href={API_KEY_SETTINGS_PATH}>
                  <Button variant={usesOAuth ? "outline" : "default"} size="sm" className="rounded-lg text-[13px]">
                    {t("common.createKey")}
                  </Button>
                </a>
                {usesOAuth && <span className="text-xs text-muted-foreground">{t("common.preferSignIn")}</span>}
              </div>
            )}
          </Step>

          <Step number="04" title={t("blocks.verify")}>
            <ul className="m-0 list-disc space-y-1.5 ps-5">
              <li>{t("common.verifyTool")}</li>
              <li>{t("common.verifySettings")}</li>
            </ul>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/settings?tab=api" className="mt-3 inline-block text-[13px] text-mk-accent underline-offset-4 hover:underline">
              {t("common.openSettings")}
            </a>
          </Step>
        </div>

        <Step number="02" title={t("blocks.add")}>
          <ol className="m-0 list-decimal space-y-1.5 ps-5">
            {copy.add.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          {client.deeplink && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a href={client.deeplink}>
                <Button className="rounded-lg h-9 text-[13px]">{t("common.oneClick", { client: copy.label })}</Button>
              </a>
              <span className="text-xs text-muted-foreground">{t("common.oneClickHint")}</span>
            </div>
          )}
          <div className="mt-4 space-y-4">
            {client.snippets.map((snippet) => (
              <div key={snippet.id}>
                {copy.captions?.[snippet.id] && (
                  <p className="mb-2 text-[13px] leading-relaxed text-muted-foreground">{copy.captions[snippet.id]}</p>
                )}
                <CopyBlock code={snippet.code} label={t(`snippetKinds.${SNIPPET_KIND_KEY[snippet.kind]}`)} />
              </div>
            ))}
          </div>
        </Step>
      </div>
    </div>
  );
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] font-semibold text-mk-accent">{number}</span>
        <p className="m-0 text-sm font-medium">{title}</p>
      </div>
      <div className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
