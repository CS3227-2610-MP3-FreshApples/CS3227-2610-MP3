import "server-only";

import type { AiProvider } from "../../../config";
import { UNREVIEWED_PROFANITY_POLICY_VERSION } from "./policy/version";

/**
 * D-56: live screening never runs under the unreviewed policy. True for `soc_llm` with `profanity-policy-v0`, when
 * the composition root wires the D-52 dispatcher stub instead of the real dispatcher (D-101).
 */
export function requiresDispatcherStub(provider: AiProvider, policyVersion: string): boolean {
  return provider === "soc_llm" && policyVersion === UNREVIEWED_PROFANITY_POLICY_VERSION;
}

/** The one D-56 configuration issue, naming `AI_PROVIDER` and no values (D-37). Never throws. */
export function logUnreviewedPolicyIssue(): void {
  try {
    console.warn(
      JSON.stringify({
        event: "config.issue",
        variable: "AI_PROVIDER",
        message: "review screening stays pending: soc_llm is not used under an unreviewed profanity policy (D-56)",
      }),
    );
  } catch {
    // A log line must never stop the instance from starting.
  }
}
