/**
 * Retry helpers with exponential backoff.
 *
 * IMPORTANT SAFETY RULE: retries are for SAFE, IDEMPOTENT operations only —
 * navigations and reads. Write operations must NEVER be blindly retried (a retry
 * can duplicate a record). Write tools instead do a post-timeout existence check
 * before deciding whether a re-attempt is safe. See tools/logActivity.ts and
 * tools/createTask.ts.
 */

export interface RetryOptions {
  /** Number of RE-tries after the first attempt (so total attempts = retries + 1). */
  retries: number;
  /** Base delay in ms before the first retry. */
  baseDelayMs: number;
  /** Multiplier applied to the delay each retry. */
  factor?: number;
  /** Cap on the delay between attempts. */
  maxDelayMs?: number;
  /** Decide whether a given error is retryable. Default: always retry. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback fired before each retry (for logging). */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  factor = 2,
  maxDelayMs = 30_000,
): number {
  const delay = baseDelayMs * Math.pow(factor, attempt);
  return Math.min(delay, maxDelayMs);
}

/**
 * Run `fn`, retrying on failure with exponential backoff. Only use for
 * idempotent work.
 */
export async function retryAsync<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const {
    retries,
    baseDelayMs,
    factor = 2,
    maxDelayMs = 30_000,
    shouldRetry = () => true,
    onRetry,
    sleep = defaultSleep,
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const isLast = attempt === retries;
      if (isLast || !shouldRetry(err, attempt)) break;
      const delay = computeBackoffDelay(attempt, baseDelayMs, factor, maxDelayMs);
      onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}
