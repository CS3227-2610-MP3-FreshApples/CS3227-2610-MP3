import "server-only";

import { performance } from "node:perf_hooks";

// The real time sources the composition root passes to the controller (D-69). Tests pass deterministic ones.

/** Uniform in [0, 1); used only for retry jitter, never for anything secret. */
export function systemRandom(): number {
  return Math.random();
}

/** Monotonic milliseconds, unaffected by wall-clock changes (D-65). */
export function monotonicClock(): number {
  return performance.now();
}

/** Resolves after `ms`, or at once when `cancel` aborts. Never rejects. */
export function sleep(ms: number, cancel?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (cancel?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      cancel?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    cancel?.addEventListener("abort", finish, { once: true });
  });
}
