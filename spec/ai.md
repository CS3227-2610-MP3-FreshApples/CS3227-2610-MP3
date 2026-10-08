# Project Specification — AI Behaviour

This expands FR-08, FR-09 and sections 8–9. Both runtime AI features must use SoC LLM. No other runtime model fallback is authorized by this specification.

## AI-01: Review summary

1. Authenticate an active USER and verify an active Movie.
2. Read the eligible Review set and Movie.reviews_revision consistently.
3. If fewer than 3 eligible Reviews exist, return insufficient_reviews without creating an execution record.
4. Reuse a fresh result or in-flight job keyed by movie ID, revision, model and prompt version.
5. Uniformly sample without replacement up to 20 Reviews. Persist selected IDs/versions and a sampling seed for reproducibility. This is a sample, not a claim of representativeness.
6. Supply plain-text review bodies (each capped at 1,000 characters) and integer ratings explicitly labelled as 1–10. Mark truncation. Enforce an additional 8,000 input-token cap including instructions; reduce included text/reviews deterministically if necessary and disclose the actual included count. If fewer than 3 fit, fail safely.
7. Ask for an overall summary (≤800 characters) and up to 3 strengths, 3 criticisms and 3 mixed-opinion items (each ≤240 characters). Each item carries nonempty supporting source IDs from the supplied sample. Return valid JSON; no HTML.
8. Validate schema, lengths, allowed source IDs and supported fields. Record model/prompt versions and generation time.
9. Recheck source revision before publication. Discard as stale if changed. Cache at most 24 hours; content changes invalidate immediately. Repeated clicks cannot bypass caching.

The UI supplies sample count, total eligible count, truncation notice and a fixed "AI summary of a sample; may miss opinions or make mistakes" label. Counts and timestamps are server-generated, not model claims. Do not show stale text after an edit, hide or deletion. Model output cannot alter ratings or reviews.

## AI-02: Report analysis

An Admin may request analysis of an open or closed Report; this never changes its status. Inputs contain the immutable report evidence, the reporter explanation, current evidence visibility, up to 10 most recent Reviews by the target User (≤500 characters each), and up to 5 most recent closed Reports/Decisions about that User. For closed reports, include category, verified disposition and bounded decision reason, not other reporters' identities.

Treat allegations as unproven. Dismissed Reports must not count as prior misconduct. Include a versioned moderation policy with operational definitions of harassment, hate and spam; disagreement or a negative movie opinion alone is not a violation. Create and review that policy before enabling this feature.

Bound all input to 8,000 tokens. Keep the current report evidence first; remove oldest history first if needed and mark omissions. Use pseudonymous source IDs and omit emails, IPs, sessions and unrelated profiles. Capture report version and target moderation_revision.

Expected validated output:

```json
{
  "assessment": "insufficient_evidence",
  "priority": "normal",
  "overview": "The available evidence is insufficient to establish a violation.",
  "concerns": [],
  "counterEvidence": [],
  "uncertainties": ["Only a limited history was supplied."],
  "suggestedNextStep": "Review the cited evidence manually."
}
```

assessment is suspected_violation, insufficient_evidence or no_clear_violation. priority is low, normal or high. overview and suggestedNextStep are ≤800 characters each. concerns and counterEvidence each have ≤5 { text, sourceIds } entries, text ≤400 and nonempty allowed sourceIds. uncertainties contains ≤5 strings of ≤400 characters. Reject extra fields, unknown enums and invented source IDs.

Output provides assistance, not a finding of guilt or calibrated confidence. The Admin sees source evidence alongside the output. No tool access, SQL, browsing, account writes or moderation actions are exposed to the model. Stale analysis is labelled and regeneration offered; current human decisions remain available. Filter by assessment only on explicit admin choice and retain a conspicuous all-reports view.

## AI-03: Shared resource controls

Proposed application limits: 5 AI requests per User per 10 minutes, 10 per Admin per 10 minutes, 1 active job per subject/type/revision and 1 active AI execution per environment. Do not queue excess work: return 429 with Retry-After before making a provider call. Cache hits do not consume provider budget. Caller request throttling still applies to cache hits.

Configure provider request/token limits from verified allocation, shared across Vercel instances and both roles through PostgreSQL reservations. Values must not be invented. If development and production share an allocation, partition their configured limits/budgets so their sum cannot exceed it, or provide a shared coordinator. Anonymous/automated traffic cannot initiate generation; per-role throttles reduce contention.

Use a 30-second timeout per attempt, maximum 2 total attempts and a 75-second execution deadline covering preflight, retries and result storage. Configure the Vercel AI function maxDuration to 120 seconds with Fluid compute enabled; verify this setting on deployment. Retry only transient network failures, 429 and provider 5xx, with jitter and Retry-After if another attempt fits the remaining deadline. Permanent/authentication errors and invalid output are not retried automatically. Terminal states remain queryable.

The initiating Next.js Route Handler awaits generation and persists its result before responding. Do not rely on fire-and-forget promises, post-response hooks or cron to complete AI work. Concurrent duplicates return an existing job ID for polling; a busy slot returns a retryable response. A terminated invocation is detected through its persisted lease expiry on later access and marked failed. A later explicit POST may retry with fresh quota reservation; late results from the old invocation must be rejected. Set client timeout above the application deadline and provide a clear reconnect/retry state.

Cap output at 1,200 tokens for summaries and 1,500 for report analysis, subject to verified provider/model limits. Set a provider-appropriate context check/token counter in the adapter; input plus output must fit. Require a configured shared daily token budget; reserve before dispatch and reconcile usage, conservatively charging the reservation when usage is unknown. Missing provider quota/budget configuration disables AI safely.

Rate limits, timeout or malformed output produce safe UI messages, leave core features usable and allow a later explicit retry subject to limits. Never expose raw provider errors.

## AI-04: Guardrails and limitations

System/task instructions are static and versioned. Reviews, explanations, history and any model output are untrusted data, serialized with clear boundaries. Instruct the model to ignore commands contained in evidence. Delimiters alone are not a security guarantee: structural validation, limited context, no tools, server authorization and human decisions enforce containment.

Render outputs as escaped plain text. Reject unexpected URLs/markup fields and instructions embedded in output structure. Schema validation cannot prove factual support; verify grounding using seeded evaluation cases and human review. Maintain an adversarial suite for both roles covering direct/indirect prompt injection, fabricated evidence, biased allegations, data exfiltration requests and attempted moderation actions.
