import { fetchWithRetry, type FetchRetryOptions } from '@/lib/fetch-retry';

const GRAPH_API = 'https://graph.facebook.com/v22.0';
const INSTAGRAM_GRAPH_API = 'https://graph.instagram.com/v25.0';

// ── X-App-Usage tracking ───────────────────────────────────────────

type AppUsage = {
  callCount: number;
  totalCpuTime: number;
  totalTime: number;
};

let lastAppUsage: AppUsage | null = null;

/**
 * Parse the X-App-Usage header returned by every Graph API response.
 * Values are percentages (0-100) of the rate limit window consumed.
 */
function parseAppUsage(response: Response): AppUsage | null {
  const header = response.headers.get('x-app-usage');
  if (!header) return null;
  try {
    const parsed = JSON.parse(header);
    return {
      callCount: parsed.call_count ?? 0,
      totalCpuTime: parsed.total_cputime ?? 0,
      totalTime: parsed.total_time ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Returns true when the app is approaching Meta's rate limit.
 * Meta recommends backing off when any usage metric exceeds 80%.
 */
export function isAppUsageThrottled(): boolean {
  if (!lastAppUsage) return false;
  return (
    lastAppUsage.callCount > 80 ||
    lastAppUsage.totalCpuTime > 80 ||
    lastAppUsage.totalTime > 80
  );
}

export function getAppUsage(): AppUsage | null {
  return lastAppUsage;
}

// ── Graph API fetch wrapper ────────────────────────────────────────

/**
 * Fetch from Meta's Graph API, tracking X-App-Usage headers automatically.
 * Throws if the app is already throttled (>80% of rate limit consumed).
 */
export async function graphApiFetch(
  url: string,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  if (isAppUsageThrottled()) {
    const usage = lastAppUsage!;
    throw new Error(
      `Meta API rate limit approaching (call_count=${usage.callCount}%, cpu_time=${usage.totalCpuTime}%, total_time=${usage.totalTime}%). ` +
      'Backing off to avoid account restriction.',
    );
  }

  const response = await fetchWithRetry(url, init, options);

  const usage = parseAppUsage(response);
  if (usage) {
    lastAppUsage = usage;
    if (usage.callCount > 70 || usage.totalCpuTime > 70 || usage.totalTime > 70) {
      console.warn(
        `[meta-graph-api] High API usage: call_count=${usage.callCount}%, cpu_time=${usage.totalCpuTime}%, total_time=${usage.totalTime}%`,
      );
    }
  }

  return response;
}

// ── Instagram publishing quota ─────────────────────────────────────

export type IgPublishingQuota = {
  quotaUsage: number;
  quotaTotal: number;
  remaining: number;
};

/**
 * Check the Instagram content_publishing_limit for an account.
 * Works with both the Facebook Graph API (Meta login) and the Instagram Graph API (Instagram login).
 */
export async function checkIgPublishingQuota(
  accessToken: string,
  igAccountId: string,
  graphApi: 'facebook' | 'instagram' = 'facebook',
): Promise<IgPublishingQuota> {
  const base = graphApi === 'instagram' ? INSTAGRAM_GRAPH_API : GRAPH_API;
  const fields = 'quota_usage,config{quota_total,quota_duration}';

  const url = graphApi === 'instagram'
    ? `${base}/${igAccountId}/content_publishing_limit?${new URLSearchParams({ fields, access_token: accessToken })}`
    : `${base}/${igAccountId}/content_publishing_limit?fields=${fields}`;

  const headers: Record<string, string> = {};
  if (graphApi !== 'instagram') {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetchWithRetry(url, { headers }, { maxRetries: 1 });

  if (!res.ok) {
    // If the endpoint isn't available, return a permissive default
    // so publishing isn't blocked on older/limited API versions.
    console.warn(`[meta-graph-api] content_publishing_limit check failed (${res.status}) — allowing publish`);
    return { quotaUsage: 0, quotaTotal: 50, remaining: 50 };
  }

  const data = await res.json();
  const entry = Array.isArray(data.data) ? data.data[0] : data;
  const quotaUsage = entry?.quota_usage ?? 0;
  const quotaTotal = entry?.config?.quota_total ?? 50;

  return {
    quotaUsage,
    quotaTotal,
    remaining: Math.max(0, quotaTotal - quotaUsage),
  };
}

// ── Page Publishing Authorization check ────────────────────────────

/**
 * Check if a Facebook Page has the tasks required for publishing.
 * A page missing MANAGE or CREATE_CONTENT tasks may require Page Publishing Authorization.
 */
export async function checkPagePublishingAccess(
  accessToken: string,
  pageId: string,
): Promise<{ canPublish: boolean; error?: string }> {
  const url = `${GRAPH_API}/${pageId}?fields=id,name,tasks`;
  const res = await fetchWithRetry(
    url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err.error?.message || `HTTP ${res.status}`;

    // Error code 190 = invalid/expired token, 10 = permission denied
    if (err.error?.code === 190 || err.error?.code === 10) {
      return { canPublish: false, error: `Facebook access error: ${message}` };
    }

    // If we can't determine PPA status, let the publish attempt proceed
    // so it fails with a more specific error from the actual publish call.
    console.warn(`[meta-graph-api] PPA check inconclusive (${res.status}): ${message}`);
    return { canPublish: true };
  }

  const data = await res.json();
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];

  // Pages that require PPA but haven't completed it will be missing
  // MANAGE and CREATE_CONTENT from their tasks list.
  if (tasks.length > 0 && !tasks.includes('MANAGE') && !tasks.includes('CREATE_CONTENT')) {
    return {
      canPublish: false,
      error: 'This Facebook Page requires Page Publishing Authorization (PPA) before Markaestro can post to it. Complete PPA in Meta Business Suite.',
    };
  }

  return { canPublish: true };
}
