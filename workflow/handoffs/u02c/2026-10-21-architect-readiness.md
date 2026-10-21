# U-02c Architect Readiness Handoff

## Assignment

| Field | Value |
| --- | --- |
| Task | U-02c / A#7 — moderation hook and My reviews UI |
| Role | Architect (read-only assessment) |
| Source revision | `bdb86f5` (`master`, U-02b merged) |
| Permitted paths/actions | Inspect approved specifications, contracts, code and tests; identify boundary/threat risks; no implementation or approval |
| Files changed by architect | None |

## Boundary and contract assessment

U-02c can proceed after the human implementation gate. A owns the review-write integration and User-facing My reviews page. B owns K9 queue/dispatcher and K10 runtime. A may call K9 `enqueue`, `cancelForDeletedReview`, and `attemptAfterCommit` through their interfaces, but must not write ModerationWork directly, call the provider, or implement moderation decisions.

The approved transaction sequence is: account and Movie/Review locks, Review mutation, K9 queue write while the Review lock is held, K7 marker when required, commit, then K9 `attemptAfterCommit` with no transaction open. The existing K9 contract and merged K8 provider are sufficient for this slice. `maxDuration = 120` remains on review mutation routes.

## Threat and verification findings

- The after-commit call must never be awaited while a database transaction is open; failures must be contained because durable work is the recovery source.
- A client must not select or override `authorId`, moderation state, visibility, queue status, policy version, or provider fields. The My reviews projection must remain author-filtered server-side.
- Pending, flagged, hidden and deleted reviews must not leak into public projections; the User projection may show only the approved safe fields and state labels.
- Queue writes must remain parameterized, idempotent for the current review/content/prompt/policy tuple, and supersede lower revisions under the Review lock. No new migration or contract is required for the bounded task.
- Tests should cover rollback, dispatcher failure, duplicate/current-version enqueue, delete cancellation, private access, pagination tie ordering, and no provider call from A-owned code.

## Unresolved risks and next action

No new contract, schema, or architecture decision is required. The human should approve the bounded A#7 scope and implementation gate. The implementer should use the existing K9/K8 interfaces, keep the UI/API changes within Developer A's allowed paths, and obtain independent code-quality and reviewer/tester validation before merge.

No files were changed by the architect.
