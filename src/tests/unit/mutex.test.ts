import { describe, it, expect } from "vitest";
import { Mutex } from "../../utils/mutex.js";

describe("Mutex", () => {
  it("serializes concurrent runExclusive calls (prevents overlap)", async () => {
    const mutex = new Mutex();
    const events: string[] = [];

    const task = (id: string) =>
      mutex.runExclusive(async () => {
        events.push(`start-${id}`);
        await new Promise((r) => setTimeout(r, 10));
        events.push(`end-${id}`);
      });

    await Promise.all([task("A"), task("B"), task("C")]);

    // Every start must be immediately followed by its own end — no interleaving.
    for (let i = 0; i < events.length; i += 2) {
      const id = events[i].split("-")[1];
      expect(events[i]).toBe(`start-${id}`);
      expect(events[i + 1]).toBe(`end-${id}`);
    }
  });

  it("releases the lock even when the critical section throws", async () => {
    const mutex = new Mutex();
    await expect(
      mutex.runExclusive(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(mutex.isLocked).toBe(false);

    // Lock is reusable afterwards.
    const out = await mutex.runExclusive(async () => 42);
    expect(out).toBe(42);
  });

  it("acquire()/release() hands the lock to the next waiter", async () => {
    const mutex = new Mutex();
    const release1 = await mutex.acquire();
    expect(mutex.isLocked).toBe(true);

    let secondAcquired = false;
    const p = mutex.acquire().then((release2) => {
      secondAcquired = true;
      release2();
    });

    expect(secondAcquired).toBe(false); // still blocked
    release1();
    await p;
    expect(secondAcquired).toBe(true);
    expect(mutex.isLocked).toBe(false);
  });
});
