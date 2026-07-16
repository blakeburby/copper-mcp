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

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "X-PW-AccessToken": apiKey,
        "X-PW-Application": "developer_api",
        "X-PW-UserEmail": userEmail,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // Network-level failure (DNS, TLS, offline) — never reached the API.
    throw new CopperApiError(
      0,
      `Could not reach the Copper API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new CopperApiError(response.status, humanizeError(response.status, text));
  }

  return (text ? JSON.parse(text) : {}) as T;
}
