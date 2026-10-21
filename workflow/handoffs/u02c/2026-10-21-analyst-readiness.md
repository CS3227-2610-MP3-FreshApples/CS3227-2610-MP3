# U-02c Analyst Readiness Handoff

## Assignment

| Field | Value |
| --- | --- |
| Task | U-02c / A#7 — moderation hook and My reviews UI |
| Role | Analyst (read-only assessment) |
| Source revision | `bdb86f5` (`master`, U-02b merged) |
| Permitted paths/actions | Inspect `spec/`, `workflow/`, `src/`, and `tests/`; propose readiness findings; no implementation or approval |
| Files changed by analyst | None |

## Inspected evidence

- `workflow/PLAN.md`, `workflow/COMMIT-PLAN.md`, and `workflow/contracts.md` §§3.3, 12 and 22–23.
- `spec/product.md` FR-03; `spec/api.md`; `spec/data-model.md`; `spec/ai.md`; `spec/security.md`; and `spec/verification.md` AT-03, AT-21, AT-23 and AT-24.
- U-02a review write/read services and routes, including `GET /api/v1/me/reviews`.
- B#4 K9 queue and fail-closed dispatcher stub, its contract tests, and the merged U-02b K8 provider.
- Current user page at `src/app/app/reviews/page.tsx`, which remains a placeholder.

## Assessment

U-02c can proceed after the human implementation gate. Its dependencies are present on `master`: U-02b/K8 is merged in PR #19 (`bdb86f5`) and B#4/K9 is merged in PR #11. The existing review write path already enqueues durable moderation work inside the review transaction and invokes the dispatcher only after commit; the bounded remaining work is to verify or complete that behaviour without duplicating K9, and to replace the My reviews placeholder with the approved authenticated projection and moderation-state presentation.

No missing requirement or specification conflict blocks the bounded slice. The task must not turn the fail-closed B#4 dispatcher stub into real AI moderation; that belongs to B#7/A-03.

## Acceptance examples to carry into implementation/tests

1. Given a new or body-edited Review, when its transaction commits, then exactly one current-version ModerationWork row is durable before any after-commit attempt, and a dispatcher failure leaves the Review pending and recoverable by the sweep.
2. Given a transaction that rolls back, then no ModerationWork row or dispatcher attempt is treated as committed.
3. Given a rating-only edit, then no new moderation work is enqueued and the existing moderation state is preserved.
4. Given a deleted Review, then outstanding moderation work is cancelled in the same transaction and no dispatcher call is made for the delete operation.
5. Given an authenticated User opening My reviews, then only that User's reviews are shown with safe fields and pending/flagged/cleared/hidden/deleted state distinctions; an anonymous or suspended caller is rejected by the existing guards.
6. Given two pages with equal sort keys, then `/me/reviews` remains stably ordered with the ID tie-breaker and uses the existing private/no-store response contract.

## Known gaps and next action

- The UI page is still a placeholder and needs the human-approved implementation scope.
- Add focused tests for after-commit invocation, rollback/no-dispatch, current-version queue idempotency, and the authenticated UI/API state projection. Do not assert live-model prose.
- The human developer must approve the A#7 implementation gate and set the task to `Ready`; after implementation, obtain the independent code-quality and reviewer/tester gates.

No files were changed by the analyst.
