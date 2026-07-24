/**
 * A tiny async mutex. Used to serialize mutating operations (writes) so two MCP
 * tool calls can never drive the shared browser page into a conflicting state at
 * the same time.
 */
export class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  /** Acquire the lock; resolves with a release function. */
  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.makeRelease();
    }
    return new Promise<() => void>((resolveAcquire) => {
      this.queue.push(() => resolveAcquire(this.makeRelease()));
    });
  }

  /** Run `fn` while holding the lock, releasing even if it throws. */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.locked = false;
      }
    };
  }
}
