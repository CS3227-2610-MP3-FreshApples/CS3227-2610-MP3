import "server-only";

// The profanity policy artifact (D-17, D-49). v0 is unreviewed and this directory holds no policy text until
// OQ-04 records it; the reviewed policy starts at `profanity-policy-v1`. AI-02 forbids live screening under v0
// (D-56). Changing this value is the policy migration D-49 describes.

/** Recorded on ModerationWork, AIJob and ReviewModeration (D-49). */
export const PROFANITY_POLICY_VERSION = "profanity-policy-v0";
