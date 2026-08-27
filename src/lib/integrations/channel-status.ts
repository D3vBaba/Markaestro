/**
 * Single source of truth for a product channel's connection status.
 *
 * The Settings page and the product detail sheet both render "linked /
 * not linked" badges; they used to compute it independently and could disagree
 * (e.g. a leftover workspace-level Meta connection read as connected in the
 * sheet but disconnected in Settings). Both now call this so they can never
 * drift apart.
 */

export type ChannelStatusEntry = {
  provider: string;
  scope?: "workspace" | "product";
  status?: string;
  /** Every account/Page/board linked for this provider on this product. */
  accounts?: Array<{ destinationId?: string | null; label?: string | null; enabled?: boolean }>;
  pageId?: string | null;
  pageName?: string | null;
  pageSelectionRequired?: boolean | null;
  username?: string | null;
  boardId?: string | null;
  boardName?: string | null;
  boardSelectionRequired?: boolean | null;
  linkedinDestinationUrn?: string | null;
  linkedinDestinationName?: string | null;
  linkedinDestinationType?: "profile" | "page" | null;
  linkedinDestinationSelectionRequired?: boolean | null;
};

export type ChannelStatus = {
  /**
   * connected   = ready to publish.
   * needs-page  = Meta is linked but no Facebook Page is chosen yet.
   * disconnected = nothing usable for this product.
   */
  state: "connected" | "needs-page" | "disconnected";
  label?: string;
};

/** Color of the connection dots on a brand card. */
export type ConnectionChipTone = "ready" | "warning" | "offline";

const DESTINATION_PROVIDERS = new Set(["meta", "pinterest", "linkedin"]);

type ChannelAccount = NonNullable<ChannelStatusEntry["accounts"]>[number];

type ConnectionIdentity = {
  status?: string;
  accountKey?: string | null;
  destinationId?: string | null;
};

function readyDestinations(entry: ChannelStatusEntry): ChannelAccount[] {
  return (entry.accounts ?? []).filter(
    (account) => Boolean(account.destinationId) && account.enabled !== false,
  );
}

function connectedLabel(
  provider: string,
  entry: ChannelStatusEntry,
  ready: ChannelAccount[],
): string | undefined {
  if (ready.length > 1) return `${ready.length} accounts linked`;
  const accountLabel = ready[0]?.label;
  switch (provider) {
    case "meta":
      return accountLabel || entry.pageName || "Facebook Page";
    case "pinterest":
      return accountLabel || entry.boardName || "Pinterest board";
    case "linkedin":
      return accountLabel || entry.linkedinDestinationName || "LinkedIn destination";
    default:
      return entry.username ? `@${entry.username}` : accountLabel || undefined;
  }
}

/**
 * Resolve the canonical status for a provider's connection on a product.
 *
 * Every social channel is linked per product, so only product-scoped
 * connections count — a workspace-scoped leftover from the old shared model is
 * treated as not connected on every surface.
 */
export function resolveChannelStatus(
  provider: string,
  entry: ChannelStatusEntry | undefined,
): ChannelStatus {
  if (!entry) return { state: "disconnected" };
  // Per-product model: workspace-scoped leftovers never count as linked.
  if (entry.scope === "workspace") return { state: "disconnected" };

  // Linked destinations are the source of truth. A leftover pending-grant
  // document (no pageId, pageSelectionRequired) used to win when only one
  // Page was linked, painting healthy brands yellow. Any ready destination
  // means the channel is connected, including a single Facebook Page.
  const ready = readyDestinations(entry);
  const treatReadyAsConnected =
    DESTINATION_PROVIDERS.has(provider) || entry.status === "connected";
  if (ready.length > 0 && treatReadyAsConnected) {
    return {
      state: "connected",
      label: connectedLabel(provider, entry, ready),
    };
  }

  if (provider === "meta") {
    // Facebook is only usable once a Page is chosen. Connected-without-a-page
    // (single-page auto-select pending, or multi-page selection required) is a
    // distinct "needs-page" state, not a green check.
    if (entry.status === "connected" && entry.pageId && !entry.pageSelectionRequired) {
      return { state: "connected", label: entry.pageName || "Facebook Page" };
    }
    if (entry.status === "connected" || entry.pageSelectionRequired) {
      return { state: "needs-page" };
    }
    return { state: "disconnected" };
  }

  if (provider === "pinterest") {
    if (entry.status === "connected" && entry.boardId && !entry.boardSelectionRequired) {
      return { state: "connected", label: entry.boardName || "Pinterest board" };
    }
    if (entry.status === "connected" || entry.boardSelectionRequired) {
      return { state: "needs-page" };
    }
    return { state: "disconnected" };
  }

  if (provider === "linkedin") {
    if (entry.status === "connected" && entry.linkedinDestinationUrn && !entry.linkedinDestinationSelectionRequired) {
      return { state: "connected", label: entry.linkedinDestinationName || "LinkedIn destination" };
    }
    if (entry.status === "connected" || entry.linkedinDestinationSelectionRequired) {
      return { state: "needs-page" };
    }
    return { state: "disconnected" };
  }

  if (entry.status === "connected") {
    return {
      state: "connected",
      label: entry.username ? `@${entry.username}` : undefined,
    };
  }
  return { state: "disconnected" };
}

function isConnectedDestination(item: ConnectionIdentity): boolean {
  return item.status === "connected" && Boolean(item.accountKey || item.destinationId);
}

/**
 * Prefer a connected destination over a leftover credential / "pick a page"
 * document so aggregated channel status cannot be represented by the grant.
 */
export function pickRepresentativeConnection<T extends ConnectionIdentity>(
  group: T[],
): T | undefined {
  if (group.length === 0) return undefined;
  return (
    group.find(isConnectedDestination)
    || group.find((item) => item.status === "connected")
    || group[0]
  );
}

/**
 * Brand-card indicator color. Healthy linked channels are green; a missing
 * Page/board/target or a refresh error is amber; anything else is red.
 */
export function resolveConnectionChipTone(
  provider: string,
  entry: (ChannelStatusEntry & { lastRefreshError?: string | null }) | undefined,
): ConnectionChipTone {
  const { state } = resolveChannelStatus(provider, entry);
  if (state === "needs-page" || entry?.lastRefreshError) return "warning";
  if (state === "connected") return "ready";
  return "offline";
}
