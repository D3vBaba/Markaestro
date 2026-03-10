/**
 * Fetch wrapper with exponential backoff retry for transient failures.
 * Retries on: network errors, 429 (rate limited), 500+, and connection timeouts.
 * Does NOT retry on: 400, 401, 403, 404 (client errors are permanent).
 */

export type FetchRetryOptions = {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in ms (default: 1000) */
  baseDelayMs?: number;
  /** Maximum backoff delay in ms (default: 10000) */
  maxDelayMs?: number;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
};

const DEFAULT_OPTIONS: Required<FetchRetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10_000,
  timeoutMs: 30_000,
};

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function getBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  // Exponential backoff with jitter: base * 2^attempt + random jitter
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

/**
 * Fetch with automatic retries on transient failures.
 * Respects Retry-After headers from 429 responses.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Don't retry client errors (except 429)
      if (response.ok || !isRetryableStatus(response.status)) {
        return response;
      }

      // Retryable status — check if we have attempts left
      if (attempt < opts.maxRetries) {
        // Respect Retry-After header if present
        const retryAfter = response.headers.get('Retry-After');
        let delayMs: number;
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          delayMs = isNaN(seconds) ? opts.baseDelayMs : seconds * 1000;
        } else {
          delayMs = getBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
        }

        console.warn(
          `[fetchWithRetry] ${response.status} from ${url}, retrying in ${Math.round(delayMs)}ms (attempt ${attempt + 1}/${opts.maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // No retries left — return the error response as-is
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // AbortError = timeout, TypeError = network error — both retryable
      if (attempt < opts.maxRetries) {
        const delayMs = getBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
        console.warn(
          `[fetchWithRetry] ${lastError.message} from ${url}, retrying in ${Math.round(delayMs)}ms (attempt ${attempt + 1}/${opts.maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
    }
  }

  throw lastError || new Error(`fetchWithRetry: all ${opts.maxRetries} retries exhausted for ${url}`);
}
