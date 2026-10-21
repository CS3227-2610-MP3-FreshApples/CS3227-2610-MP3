import "server-only";

import type { ModerationDispatcher, ScreeningAttempt } from "./types";

// Contract stub (D-52, contracts §22 AM-15). B#7 (A-03) added the real dispatcher (dispatcher.ts), which applies
// D-54: it re-reads the Review under its lock (D-58) and, when it is hidden or deleted, cancels the work and
// returns `not_current` with no AIJob, budget, rate-limit or execution-count change. This stub stays for two
// cases: AI disabled, and D-56, where AI_PROVIDER=soc_llm with `profanity-policy-v0` keeps it wired instead of
// the real dispatcher (wiring.ts).

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
