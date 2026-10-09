# Project Specification - AI Behaviour

This expands FR-08 and FR-09. Both runtime AI features use SoC LLM; no other runtime model fallback is authorized.

## AI-01: Scheduled public review summary

1. A secret-authenticated daily scheduler selects active Movies with pending eligible-review changes, never-attempted first, then oldest last-attempt time, then pending time and ID. Public reads and browser actions never initiate generation. Default refresh interval is 1 day; 7 days is the configurable lower-load alternative.
2. Read eligible Reviews and Movie.reviews_revision consistently. Skip unchanged Movies and Movies successfully refreshed within the configured interval. Pending changes survive missed runs and capacity deferrals; an update need not occur again in the next period.
3. Fewer than 3 eligible Reviews yields insufficient_reviews without a provider call or execution record. Retain the change marker; later eligible changes can make the Movie ready.
4. Reuse a valid result or running job keyed by Movie, revision, model and prompt version. Uniformly sample without replacement up to 20 Reviews; persist IDs/versions and sampling seed. Summarize the current set, not only recent updates.
5. Supply plain-text bodies capped at 1,000 characters and ratings labelled 1-10. Mark truncation. Enforce an 8,000 input-token cap including instructions; reduce included text/reviews deterministically and disclose actual count. If fewer than 3 fit, fail safely.
6. Request valid JSON: overall summary at most 800 characters; up to 3 strengths, 3 criticisms and 3 mixed-opinion items, each at most 240 characters with nonempty supporting IDs from the sample. Validate schema, lengths and allowed source IDs. Store model/prompt versions and generation time.
7. Recheck active Movie, source revision and execution lease before publication. Publish and clear the pending marker atomically only if all match. Concurrent changes invalidate the result and retain pending work.
8. Keep unchanged summaries valid without a 24-hour expiry. Review creation/edit/deletion/hide/restore and Movie visibility changes invalidate immediately; never display old text afterward. Archived Movies return public 404. Restored Movies become pending.

The public UI shows generation time, included and eligible counts, truncation notice and the fixed label "AI summary of a sample; may miss opinions or make mistakes". Counts/times come from the server. Missing/stale output shows awaiting scheduled update with no generation/retry control. Zero to two Reviews show insufficient reviews. Reading a summary requires no account or job access.

### Scheduling and load

Run one bounded daily sweep, initially attempting at most one Movie per invocation so one 75-second generation fits the 120-second function limit. Acquire a database scheduler lease; overlapping/duplicate invocations cannot dispatch duplicate work. Persist per-Movie next-attempt time and select eligible work with never-attempted Movies first, then oldest last-attempt time, pending time and ID. Capacity/quota exhaustion defers work without losing its change marker. Failed/stale attempts receive at least a one-day backoff and move behind other waiting Movies after each attempt so one failing Movie cannot starve others; new changes do not bypass backoff.

Measure throughput against the changed-Movie rate; monitor oldest pending age and count. A weekly interval reduces repeated generation for frequently changed Movies but cannot solve an arbitrarily growing backlog of distinct Movies. If the sweep cannot meet the agreed freshness target, revise scheduler capacity/hosting before promising daily summaries. No detached work or self-fan-out after response. Unchanged content never causes regeneration merely because time passed. Retention cleanup must preserve the current valid summary.

## AI-02: Automatic review profanity moderation

Every new Review, author resubmission and body edit atomically saves pending moderation work before attempting AI. No Admin/User requests the check separately. Rating-only edits retain text clearance. Input contains only pseudonymous Review ID/content_revision, the complete body (maximum 2,000 characters), and a versioned profanity policy. Exclude history, Reports, explanations, emails, ratings, sessions and profiles. Bound input including policy to 8,000 tokens; if the full text cannot fit, retain it for manual review instead of screening a fragment.

The policy defines profanity, contextual quotations, obfuscated spellings and supported languages. Negative movie opinions alone are not profanity. Review and version the policy before enabling screening.

Expected validated output:

```json
{
  "assessment": "uncertain",
  "explanation": "The expression needs contextual review.",
  "matches": [],
  "limitations": ["Human review is required."]
}
```

assessment is suspected_profanity, no_profanity_detected or uncertain. explanation is at most 800 characters. matches contains at most 10 { quote, reason } objects; quote is at most 200 characters and an exact substring of the supplied Review; reason is at most 240 characters. suspected_profanity requires a match; no_profanity_detected requires none. limitations contains at most 5 strings of at most 240 characters. Reject unknown fields/enums, invented quotations and invalid structure. Matches need not enumerate every occurrence.

The server validates the output and applies a fixed publication rule: clean -> cleared; suspected or uncertain -> flagged. Pending/flagged Reviews remain unpublished. These are Review moderation states, not Reports or account sanctions. The model has no tools or direct database access. Admins can approve a held Review with a reason or apply hidden_at; late AI output cannot override that decision. Automatic clearance never clears hidden_at or deleted_at.

Persist content_revision, captured Review.version and model/prompt/policy versions. Deduplicate by Review/content revision/model/prompt/policy. Guard completion by execution lease, current content revision and captured row version. A concurrent mutation or human decision makes the attempt stale; retain pending work only if still required for current text. Show escaped source and automatic assessment to Admins; filters include pending/flagged/failed and an all-reviews reset. Policy changes apply to future checks; explicit policy migration must define any historical re-screening, never silently reuse a mismatched assessment.

### Automatic dispatch and recovery

The review mutation transaction commits the pending Review and durable ModerationWork before the provider call. After commit, the same Route Handler attempts one bounded check when quota/capacity permits, awaits it, then responds with the saved Review and its current state. No fire-and-forget work. Creation succeeds even when AI cannot run; saved pending text is not reported as a failed submission.

Deferred/transient-failure work remains durable with next_attempt_at and bounded backoff. A separate authenticated daily moderation recovery sweep automatically attempts at most one due Review per invocation under the existing runtime limit. Never-attempted work comes first, then oldest last attempt and ID. Guard duplicate sweeps with a lease. After 3 failed executions of the same content revision, stop automatic retries and mark needs_manual_review; keep it pending and visible in the Admin queue. Invalid output or non-transient input/provider errors go directly to manual review. Capacity deferrals do not consume execution attempts. New body edits create work for the new revision and supersede obsolete work.

No Admin action is required to initiate or retry screening. Admins resolve flagged/manual-review items directly. Daily recovery is a fallback, not a promise of prompt processing under sustained load. Monitor count/age of held work; validate capacity against the expected submission rate and revise recovery capacity before release if it cannot keep up. Deleted or admin-hidden Reviews cancel outstanding work; resubmission starts a fresh check. Archived Movies defer checks until restored. Restoring an admin-hidden Review with pending clearance reactivates automatic work for its current content revision; restore never itself grants clearance.

AI never creates or accepts Reports, adds strikes or changes accounts. Human Report acceptance remains the only source of report-based strikes.

## AI-03: Shared resource controls

Limits: 1 active execution per subject/type/content revision and 1 active AI execution per environment shared by scheduled summaries and automatic review screening. Existing per-User review-write throttles limit screening triggers; no per-Admin AI-request throttle is needed. Public/admin reads consume no provider budget and cannot dispatch work. Pending work is durable when capacity is unavailable.

Configure verified SoC request/token quotas and a required shared daily token budget. Coordinate all instances through PostgreSQL reservations. Partition shared development/production allocations so their sums fit, or provide a shared coordinator. Missing quota/budget configuration disables generation safely.

Use 30 seconds per provider attempt, at most 2 attempts per execution and a 75-second execution deadline including storage. Configure maxDuration = 120 with Fluid compute on AI cron and review mutation handlers and verify deployment. Retry transient network errors, 429 and provider 5xx with jitter and Retry-After only if time remains. Apply AI-02 limits across recovery executions as well. Cap output at 1,200 tokens for summaries and 1,000 for screening; input plus output must fit verified context.

The cron or review mutation Route Handler awaits execution and persists results before responding. No detached continuation. Shared capacity exhaustion retains summary or moderation work for its next sweep. Duplicate submissions cannot start duplicate checks; existing review-write conflict/idempotency semantics apply. Expire abandoned leases on later access/sweeps and reject late writes. Recovery is automatic, never dependent on an Admin POST.

Reserve token usage before dispatch and reconcile afterward, charging conservatively when usage is unknown. Safe failures leave core features usable; never expose provider raw errors or promise unsupported completion times.

## AI-04: Guardrails and limitations

Static instructions and policies are versioned. Reviews and outputs are untrusted data serialized with clear boundaries. Instruct the model to ignore embedded commands. Delimiters alone are not protection: bounded context, validation, no tools, server authorization and human moderation enforce containment.

Render escaped plain text; reject unexpected URLs/markup fields. Validation cannot prove grounding or detection accuracy. Evaluate injection, fabricated sources, exfiltration, attempted moderation actions, obfuscated profanity, benign quotations and uncertain language. Neither feature has SQL, browsing, tools, account writes or moderation access.
