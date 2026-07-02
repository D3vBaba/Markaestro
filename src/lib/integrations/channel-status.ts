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
