"use client";

/**
 * Consent page for connected agents (the OAuth authorization endpoint).
 *
 * An MCP client (Claude Code, claude.ai, Cursor, ...) sends the user here
 * after registering itself. The user picks the workspace and brand the agent
 * may act on, reviews the permissions, and clicks Allow. The server answers
 * with a redirect back to the agent carrying a single-use code; the agent
 * exchanges it for an API key bound to that brand. Nothing is ever pasted.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { apiFetch, apiPost } from "@/lib/api-client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { publicApiScopes, type PublicApiScope } from "@/lib/public-api/scopes";

type ClientInfo = { id: string; name: string; uri: string | null };
type Product = { id: string; name: string };

const SCOPE_LABEL_KEY: Record<PublicApiScope, string> = {
  "products.read": "productsRead",
  "media.write": "mediaWrite",
  "posts.read": "postsRead",
  "posts.write": "postsWrite",
  "posts.publish": "postsPublish",
  "evergreen.read": "evergreenRead",
  "evergreen.write": "evergreenWrite",
  "job_runs.read": "jobRunsRead",
  "webhooks.manage": "webhooksManage",
};

/** The parameters an OAuth 2.1 authorization request must carry. */
function readRequest(params: URLSearchParams) {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const method = params.get("code_challenge_method") ?? "";
  const responseType = params.get("response_type") ?? "";
  const state = params.get("state") ?? "";
  const scope = params.get("scope") ?? "";
  const valid =
    clientId.length > 0 &&
    redirectUri.length > 0 &&
    codeChallenge.length > 0 &&
    method === "S256" &&
    responseType === "code";
  return { clientId, redirectUri, codeChallenge, state, scope, valid };
}

function AuthorizeContent() {
  const t = useTranslations("auth.oauthConsent");
  const tScopes = useTranslations("settings.api.scopes");
  const params = useSearchParams();
  const request = useMemo(() => readRequest(params), [params]);
  const { workspaces, current, loading: workspacesLoading } = useWorkspace();

  const adminWorkspaces = useMemo(
    () => workspaces.filter((w) => w.role === "owner" || w.role === "admin"),
    [workspaces],
  );
  // Selections are stored only once the user changes them; until then they
  // derive from context (the open workspace, the first brand), so nothing
  // has to be synced into state from an effect.
  const [chosenWorkspaceId, setWorkspaceId] = useState<string | null>(null);
  const [chosenProductId, setProductId] = useState<string | null>(null);
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [scopes, setScopes] = useState<PublicApiScope[]>([]);
  const [granted, setGranted] = useState<Set<PublicApiScope>>(new Set());
  const [clientError, setClientError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // Default to the workspace the app already has open when it qualifies.
  const workspaceId = useMemo(() => {
    if (chosenWorkspaceId && adminWorkspaces.some((w) => w.id === chosenWorkspaceId)) return chosenWorkspaceId;
    const preferred = adminWorkspaces.find((w) => w.id === current?.id) ?? adminWorkspaces[0];
    return preferred?.id ?? "";
  }, [adminWorkspaces, chosenWorkspaceId, current?.id]);

  // Brands belong to a workspace; the query re-keys when the pick changes.
  const { data: productsData, loading: productsLoading } = useApiQuery<{ products: Product[] }>(
    workspaceId ? "/api/products" : null,
    { wsId: workspaceId },
  );
  const products = useMemo(() => productsData?.products ?? [], [productsData]);
  const productId = useMemo(() => {
    if (chosenProductId && products.some((p) => p.id === chosenProductId)) return chosenProductId;
    return products[0]?.id ?? "";
  }, [chosenProductId, products]);

  // Resolve who is asking, and that their redirect address is registered.
  useEffect(() => {
    if (!request.valid) return;
    let cancelled = false;
    (async () => {
      const search = new URLSearchParams({
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
      });
      if (request.scope) search.set("scope", request.scope);
      const res = await apiFetch<{ client?: ClientInfo; scopes?: PublicApiScope[]; error?: string }>(
        `/api/oauth/agent/client?${search.toString()}`,
      );
      if (cancelled) return;
      if (!res.ok || !res.data.client) {
        setClientError(res.data?.error === "OAUTH_INVALID_SCOPE" ? t("invalidScope") : t("unknownClient"));
        return;
      }
      setClient(res.data.client);
      const requested = res.data.scopes ?? [];
      setScopes(requested);
      setGranted(new Set(requested));
    })();
    return () => {
      cancelled = true;
    };
  }, [request, t]);

  function toggleScope(scope: PublicApiScope) {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function deny() {
    if (!request.redirectUri) return;
    try {
      const url = new URL(request.redirectUri);
      url.searchParams.set("error", "access_denied");
      if (request.state) url.searchParams.set("state", request.state);
      setRedirecting(true);
      window.location.assign(url.toString());
    } catch {
      setSubmitError(t("invalidRequest"));
    }
  }

  async function allow() {
    if (!client || !workspaceId || !productId || granted.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    const res = await apiPost<{ redirectTo?: string; error?: string }>(
      "/api/oauth/agent/consent",
      {
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: "S256",
        state: request.state || undefined,
        productId,
        scopes: publicApiScopes.filter((s) => granted.has(s)),
      },
      workspaceId,
    );
    setSubmitting(false);
    if (!res.ok || !res.data.redirectTo) {
      const code = res.data?.error;
      if (code === "SUBSCRIPTION_REQUIRED") setSubmitError(t("subscriptionRequired"));
      else if (code === "EMAIL_NOT_VERIFIED") setSubmitError(t("emailNotVerified"));
      else if (code === "FORBIDDEN" || code === "FORBIDDEN_WORKSPACE") setSubmitError(t("noAdminWorkspace"));
      else setSubmitError(t("errorGeneric"));
      return;
    }
    setRedirecting(true);
    window.location.assign(res.data.redirectTo);
  }

  const clientName = client?.name ?? t("genericClient");

  let body: React.ReactNode;
  if (!request.valid) {
    body = <p className="text-sm text-destructive">{t("invalidRequest")}</p>;
  } else if (clientError) {
    body = <p className="text-sm text-destructive">{clientError}</p>;
  } else if (redirecting) {
    body = <p className="text-sm text-muted-foreground">{t("redirecting", { client: clientName })}</p>;
  } else if (!workspacesLoading && adminWorkspaces.length === 0) {
    body = <p className="text-sm text-muted-foreground">{t("noAdminWorkspace")}</p>;
  } else {
    body = (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="agent-workspace">{t("workspaceLabel")}</Label>
          <select
            id="agent-workspace"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={workspaceId}
            onChange={(e) => {
              setWorkspaceId(e.target.value);
              setProductId(null);
            }}
            disabled={submitting}
          >
            {adminWorkspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-brand">{t("brandLabel")}</Label>
          {productsLoading ? (
            <p className="text-sm text-muted-foreground">{t("loadingBrands")}</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("noBrands")}{" "}
              <Link href="/products" className="text-primary hover:underline">{t("createBrand")}</Link>
            </p>
          ) : (
            <select
              id="agent-brand"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={submitting}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <p className="text-xs text-muted-foreground">{t("brandHint")}</p>
        </div>

        <div className="space-y-2">
          <Label>{t("scopesLabel")}</Label>
          <div className="space-y-2 rounded-md border border-border p-3">
            {scopes.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={granted.has(scope)}
                  onCheckedChange={() => toggleScope(scope)}
                  disabled={submitting}
                />
                <span>{tScopes(SCOPE_LABEL_KEY[scope])}</span>
                <span className="ms-auto font-mono text-xs text-muted-foreground">{scope}</span>
              </label>
            ))}
          </div>
        </div>

        {submitError && <p className="text-sm text-destructive">{submitError}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={deny} disabled={submitting}>
            {t("deny")}
          </Button>
          <Button
            onClick={allow}
            disabled={submitting || !client || !productId || granted.size === 0}
          >
            {submitting ? t("allowing") : t("allow")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-5 flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {t("title", { client: clientName })}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("subtitle", { client: clientName })}
              </p>
            </div>
          </div>
          {body}
        </div>
        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t("footer")}</span>
        </p>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AuthorizeContent />
    </Suspense>
  );
}
