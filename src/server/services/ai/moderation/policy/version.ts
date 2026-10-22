import "server-only";

// The profanity policy artifact (D-17, D-49). v0 was unreviewed and held no text; the reviewed policy is v1 (D-99),
// whose text is in text.ts. AI-02 forbids live screening under v0 (D-56). Changing this value is the policy
// migration D-49 describes.

/** Recorded on ModerationWork, AIJob and ReviewModeration (D-49). */
export const PROFANITY_POLICY_VERSION = "profanity-policy-v1";

/** The unreviewed version D-56 refuses to screen live with `soc_llm`. */
export const UNREVIEWED_PROFANITY_POLICY_VERSION = "profanity-policy-v0";
