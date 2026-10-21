# U-02b Architect Readiness Handoff

## Assignment

| Field | Value |
| --- | --- |
| Task | U-02b / A#6 — K8 review transitions |
| Role | Architect (read-only assessment) |
| Source revision | `998dd90` (`master`, U-02a merged) |
| Permitted paths/actions | Inspect approved specifications, contracts, code and tests; identify boundary/threat risks; no implementation or approval |
| Files changed by architect | None |

## Boundary and contract assessment

U-02b can proceed after the human implementation gate. A owns K8 in `src/server/services/reviews/`; B consumes the provider from moderation and catalogue orchestration. The frozen `ReviewTransitions` contract is sufficient for this slice, and U-02a now supplies the Review schema/repository and shared `ReviewUpdateLock` types on `master`.

Every transition must run inside the caller's transaction. `lockReviewForTransition` must acquire the Movie `FOR UPDATE` lock before the Review `FOR UPDATE` lock and re-verify the relationship. `lockReviewsOfMovie` must use the approved ascending-ID order for archive/restore. K8 may call K7's `markReviewsChanged` when eligibility changes, but must not write ModerationWork or AuditEntry; callers own K9 orchestration and K5 audit records.

## Threat and verification findings

- Automatic clearance/flagging must fail closed on captured content revision, row version, hidden/deleted state, and archived Movie state; it must not override a later human decision.
- Admin transitions require the caller to supply authorization, reason/audit handling and current If-Match; K8 itself must enforce the version and domain-state rules rather than trusting route checks.
- Approve must not undo deletion or admin hiding. Restore clears only `hidden_at` and must not bypass pending/flagged moderation. No-op transitions preserve the version and are reported by the caller as `no_op`.
- Eligibility changes must update Movie revision/summary invalidation atomically with the Review transition. A failed marker update must roll back the Review change.
- The archive/create race is a shared-lock invariant: K8's `lockReviewsOfMovie` and U-02a's Movie update lock must be exercised against PostgreSQL with competing writes.
- The fake must fail closed: automatic transitions return `stale`, Admin transitions return `stale_version` unless explicitly scripted, and it must never clear a Review by default.

## Unresolved risks and next action

No new contract, schema, or architecture decision is required. The human should approve the bounded A#6 scope and allow implementation from `master`; the implementer should not depend on an unmerged branch. After implementation, require focused transition tests, PostgreSQL lock/concurrency evidence, lint, type-check and the full applicable test suite before the human merge review.

