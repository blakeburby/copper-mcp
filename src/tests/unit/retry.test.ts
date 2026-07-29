import { describe, it, expect, vi } from "vitest";
import { retryAsync, computeBackoffDelay } from "../../utils/retry.js";

const noSleep = async () => {};

describe("computeBackoffDelay", () => {
  it("grows exponentially and respects the cap", () => {
    expect(computeBackoffDelay(0, 100, 2)).toBe(100);
    expect(computeBackoffDelay(1, 100, 2)).toBe(200);
    expect(computeBackoffDelay(2, 100, 2)).toBe(400);
    expect(computeBackoffDelay(10, 100, 2, 1000)).toBe(1000);
  });
});

describe("retryAsync", () => {
  it("returns the first successful result without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    const out = await retryAsync(fn, { retries: 3, baseDelayMs: 1, sleep: noSleep });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to `retries` times then throws the last error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fail");
    });
    await expect(
      retryAsync(fn, { retries: 2, baseDelayMs: 1, sleep: noSleep }),
    ).rejects.toThrow("fail");
    // initial attempt + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops early when shouldRetry returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("no-retry");
    });
    await expect(
      retryAsync(fn, {
        retries: 5,
        baseDelayMs: 1,
        sleep: noSleep,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("no-retry");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("eventually succeeds after transient failures", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (n++ < 2) throw new Error("transient");
      return "recovered";
    });
    const out = await retryAsync(fn, { retries: 3, baseDelayMs: 1, sleep: noSleep });
    expect(out).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
