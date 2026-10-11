/**
 * Minimal HTTP helper for outbound provider calls.
 * Global `fetch` (Node 18+) + AbortController timeout + optional retries.
 */

export interface FetchJsonOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  /** Number of retry attempts on network/5xx errors (default 1). */
  retries?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly body?: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const {
    timeoutMs = 6000,
    headers = {},
    method = 'GET',
    body,
    retries = 1,
    fetchImpl = globalThis.fetch,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: { accept: 'application/json', ...headers },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await safeText(response);
        // Do not retry client errors (4xx) other than 429.
        if (response.status < 500 && response.status !== 429) {
          throw new HttpError(`HTTP ${response.status} for ${url}`, response.status, url, text);
        }
        lastError = new HttpError(`HTTP ${response.status} for ${url}`, response.status, url, text);
      } else {
        return (await response.json()) as T;
      }
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await delay(150 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function safeText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build a URL with query params, skipping null/undefined values. */
export function withQuery(base: string, params: Record<string, string | number | undefined | null>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}
