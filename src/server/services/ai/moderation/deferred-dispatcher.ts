import "server-only";

import type { ModerationDispatcher, ScreeningAttempt } from "./types";

// Contract stub (D-52, contracts §22 AM-15). B#7 (A-03) replaces it with the real dispatcher, which must:
// - apply D-54: re-read the Review under its lock (D-58) and, when it is hidden or deleted, cancel the work and
//   return `not_current` with no AIJob, budget, rate-limit or execution-count change;
// - apply D-56: with AI_PROVIDER=soc_llm and `profanity-policy-v0`, the composition root keeps wiring this stub
//   instead of the real dispatcher.

const DEFERRED: ScreeningAttempt = "deferred";

/**
 * K9 dispatcher stub. `attemptAfterCommit` always returns `deferred`, so the Review stays pending. It takes no
 * dependencies: it opens no Tx, writes nothing, calls no provider and never throws. ModerationWork columns stay
 * unchanged, so never-attempted work keeps its place in the sweep order (AI-02).
 */
export function createDeferredModerationDispatcher(): ModerationDispatcher {
  return {
    attemptAfterCommit() {
      return Promise.resolve(DEFERRED);
    },
  };
}
