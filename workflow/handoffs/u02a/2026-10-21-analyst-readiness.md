# U-02a Analyst Readiness Handoff

## Assignment

| Field | Value |
| --- | --- |
| Task | U-02a / A#5 — review core lifecycle |
| Role | Analyst (read-only assessment) |
| Source revision | `6269f63` (`master`, 21 October 2026) |
| Permitted paths/actions | Inspect `spec/`, `workflow/`, `src/`, and `tests/`; propose readiness findings; no implementation or approval |
| Files changed by analyst | None |

## Inspected evidence

- `workflow/PLAN.md`, `workflow/COMMIT-PLAN.md`, and `workflow/contracts.md` §§3.3, 10–12.
- `spec/product.md` FR-03 and INV-02/03/09; `spec/api.md` review endpoints and If-Match rules.
- `spec/data-model.md`, `spec/security.md`, `spec/ai.md`, and `spec/verification.md` AT-03, AT-21, AT-23 and AT-24.
- `spec/governance.md` D-20, D-50, D-51 and D-54.
- `src/server/composition.ts` and the merged K7/K9/S-06 implementations and tests.

## Findings

U-02a can proceed to implementation after the human gate. The approved scope is sufficiently specified and its SP-2 dependencies are present on `master`: identity guards/status checks, the shared rate limiter, K7 Movie locks/revision marker, K9 durable moderation-work queue, and the S-06 runtime/fake.

U-02a should implement only the A#5 scope: create, own-review edit/delete/resubmission, private/public projections, validation, uniqueness, aggregate/revision invalidation, and stale `If-Match`/concurrency tests. U-02b owns the K8 transition implementation and contract fake; U-02c owns the post-commit moderation attempt and User UI hook.

## Acceptance examples to carry into implementation/tests

1. An active User creates a valid Review on an active Movie: the Review is pending, has `content_revision = 1`, durable moderation work exists, and the public listing/aggregate excludes it.
2. A second concurrent create for the same User/Movie pair produces one Review and one conflict; the database uniqueness invariant remains intact.
3. A body edit or resubmission increments `content_revision`, resets clearance to pending, and preserves the Review identity; a rating-only edit retains existing text clearance.
4. A body edit of a published Review removes it from public eligibility and advances the Movie revision atomically; a rating-only edit of an eligible Review also advances the revision per D-51/AM-13.
5. A different User cannot mutate the Review; an archived Movie rejects User mutations; stale or absent `If-Match` returns the specified safe error without mutation.
6. A hidden Review may be edited by its author without clearing `hidden_at`; the body edit still queues moderation as required by D-54.

## Gaps and next action

No unresolved requirement, contract, or architecture conflict was found. The current repository has no production Review service/routes yet; that is the expected implementation gap, not a readiness blocker. Before coding, the human developer should confirm the A#5 file scope and implementation gate, then create the `feat/reviews-core` branch/worktree. Record any new behaviour decision in `spec/` before implementation if a conflict appears.

