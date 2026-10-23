# U-02b / A#6 iterative implementation plan

## Confirmed scope

Implement Developer A's K8 Reviews transition provider on branch
`feat/reviews-transitions`, as specified by `../../COMMIT-PLAN.md` and
`../../contracts.md` §11. The implementation is limited to version-guarded
automatic clearance/flagging, Admin approve/hide/restore transitions, review
transition locking and moderation reads, the fail-closed K8 fake, and focused
unit/contract/PostgreSQL tests. It must preserve the existing module ownership,
lock order, K7 revision invalidation boundary, and K9/audit caller boundary.

Source and gate: U-02a/A#5 is merged in `master` at `998dd90`; analyst and
architect readiness handoffs conclude that A#6 may proceed after human
implementation approval. No new specification or contract decision is needed.

## Increment checklist

- [x] Increment 1 — K8 lock/read boundary and fail-closed fake.
  - Add the smallest behavioral contract tests for `lockReviewForTransition`,
    `readReviewForScreening`, `lockReviewsOfMovie`, and the default fake.
  - Red: tests fail because the K8 provider/fake is absent.
  - Green: implement only the provider interfaces, repository lock/read
    operations, and fail-closed fake needed by those tests.
  - Validate focused tests, lint, type-check, and `git diff --check`.

- [x] Increment 2 — automatic transitions.
  - Add behavioral tests for version/content guards, pending-only clearance,
    hidden/deleted rejection, archived-Movie deferral, K7 marker atomicity,
    and no AI ability to override human decisions.
  - Implement `applyAutomaticClearance` and `applyAutomaticFlag` with the
    minimum transition/repository changes; no ModerationWork or AuditEntry
    writes.
  - Validate focused unit and PostgreSQL integration tests plus required
    style/type checks.

- [x] Increment 3 — Admin transitions and archive/create race.
  - Add behavioral tests for approve/hide/restore, stale If-Match, no-op
    version preservation, deletion/hide preservation, and the competing
    Movie archive/review-create lock invariant.
  - Implement the Admin transitions and all-Movie review locking, including
    atomic K7 invalidation.
  - Validate focused and full applicable tests, lint, type-check, build,
    visual diff, and the iterative-TDD deterministic/semantic grading.

## Guardrails

- Do not edit specifications or migrations.
- Do not add Admin routes, Moderation-work orchestration, or AI provider calls.
- Do not modify unrelated existing user changes, including the pre-existing
  UI-designer handoff files.
- Do not commit unless the user explicitly authorizes a commit after a passing
  iteration grade.

The first increment requires human approval of this checklist before any
application-code edit.
