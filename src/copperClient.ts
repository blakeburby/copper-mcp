/**
 * Thin fetch wrapper around the Copper Developer API.
 *
 * This is the ONE place that knows about the base URL, auth headers, and how to
 * turn an HTTP failure into a message an agent can actually act on. Every tool
 * goes through `copperRequest`.
 *
 * Docs: https://developer.copper.com/introduction/requests.html
 */

const BASE_URL = "https://api.copper.com/developer_api/v1";

/** Raised for anything the caller should surface as clean text, not a stack trace. */
export class CopperApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CopperApiError";
  }
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** How many total attempts (1 initial + retries) for a transient failure. */
const MAX_ATTEMPTS = 3;
/** Per-request timeout so a hung socket fails fast and can be retried. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Statuses worth retrying. These all mean Copper did NOT process the request at
 * the application layer (rate-limited or a gateway hiccup), so retrying is safe
 * even for the write tools — it can't produce a duplicate. A 4xx (bad request)
 * or 500 is deliberately NOT retried.
 */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getCredentials(): { apiKey: string; userEmail: string } {
  const apiKey = process.env.COPPER_API_KEY;
  const userEmail = process.env.COPPER_USER_EMAIL;
  if (!apiKey || !userEmail) {
    throw new CopperApiError(
      0,
      "Copper credentials are not configured. Set COPPER_API_KEY and COPPER_USER_EMAIL " +
        "in the environment (see the `env` block in your Claude Desktop config).",
    );
  }
  return { apiKey, userEmail };
}

/** Map a non-2xx response into a short, agent-readable explanation. */
function humanizeError(status: number, rawBody: string): string {
  // Copper usually returns { "status": 401, "message": "..." } — surface it if present.
  let apiMessage = "";
  try {
    const parsed = JSON.parse(rawBody);
    apiMessage = parsed?.message ?? parsed?.error ?? "";
  } catch {
    apiMessage = rawBody.slice(0, 200);
  }

  switch (status) {
    case 401:
      return "Copper API returned 401 Unauthorized — check COPPER_API_KEY and COPPER_USER_EMAIL.";
    case 403:
      return "Copper API returned 403 Forbidden — this API key lacks permission for that resource.";
    case 404:
      return "Copper API returned 404 Not Found — the requested record or endpoint does not exist.";
    case 422:
      return `Copper API returned 422 Unprocessable — the request was malformed${
        apiMessage ? `: ${apiMessage}` : "."
      }`;
    case 429:
      return "Copper API returned 429 Too Many Requests — rate limit hit (180 req/min). Wait and retry.";
    default:
      return `Copper API returned ${status}${apiMessage ? ` — ${apiMessage}` : "."}`;
  }
}

/**
 * Perform a Copper API request and return the parsed JSON body.
 * Throws {@link CopperApiError} with a clean message on any failure.
 */
export async function copperRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  const { apiKey, userEmail } = getCredentials();
  const url = `${BASE_URL}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      "X-PW-AccessToken": apiKey,
      "X-PW-Application": "developer_api",
      "X-PW-UserEmail": userEmail,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  // Retry transient failures (network throws like undici's "fetch failed" from a
  // reused-but-dead keep-alive socket, plus 429/5xx gateway blips) with backoff.
  // This is what keeps a live demo from dying on a one-off connection reset.
  let lastNetworkError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level failure (reset/timeout/DNS/offline) — never got a response.
      lastNetworkError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(300 * attempt);
        continue;
      }
      throw new CopperApiError(
        0,
        `Could not reach the Copper API after ${MAX_ATTEMPTS} attempts: ${lastNetworkError}`,
      );
    }

    const text = await response.text();
    if (!response.ok) {
      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(300 * attempt);
        continue;
      }
      throw new CopperApiError(response.status, humanizeError(response.status, text));
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  // Unreachable — the loop either returns or throws — but satisfies the type checker.
  throw new CopperApiError(0, `Could not reach the Copper API: ${lastNetworkError}`);
}
