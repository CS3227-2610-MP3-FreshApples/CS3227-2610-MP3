# U-02a iterative-TDD implementation checklist

Task: U-02a / A#5, branch `feat/reviews-core`
Source baseline: `6269f63` plus the existing uncommitted planning/log updates

Confirmed scope comes from `../../../spec/product.md` FR-03 and INV-02/03/09, `../../../spec/api.md`,
`../../../spec/data-model.md`, `../../../spec/security.md`, `../../../spec/verification.md` AT-03/AT-21/AT-23,
`../../../spec/governance.md` D-20/D-50/D-51/D-54, and `../../contracts.md` K3/K6/K7/K9.

Out of scope: K8 transition implementation and fake (A#6), post-commit dispatcher
wiring and User moderation-state UI (A#7), reports (U-03), and AI screening logic.

## Increments

- [x] Increment 1 — Review domain validation, projections, and repository primitives.
  - Behavioral tests: rating/body bounds and trimming; safe own-review/public projections;
    eligibility excludes pending/flagged/hidden/deleted/inactive-Movie Reviews; repository
    preserves the one-Review-per-User/Movie invariant and version/content-revision fields.
  - Validation: focused unit/integration tests, `npm run test:unit`, lint and type-check.
- [x] Increment 2 — Create/resubmit own Review API and transaction.
  - Behavioral tests: authenticated active User creates on an active Movie; pending state,
    content revision 1, K9 enqueue, rate limit, K7 marker, safe response; duplicate and
    archived-Movie rejection; concurrent create uniqueness; no transaction held during
    post-commit dispatch attempt.
  - Validation: focused API/database tests, unit tests, lint and type-check.
- [x] Increment 3 — Edit, rating-only edit, body edit, and delete API flows.
  - Behavioral tests: ownership and If-Match; rating-only clearance retention; body edit
    pending reset/content-revision increment; hidden-review edit preserves hidden state;
    soft delete and resubmission identity reuse; K9 cancellation/enqueue and K7 marker
    atomicity; D-81 bodyless DELETE with resulting ETag.
  - Validation: focused API/database tests, unit tests, lint and type-check.
- [x] Increment 4 — Review listing and aggregate/revision concurrency coverage.
  - Behavioral tests: public visible-review pagination and ordering; private `/me/reviews`
    projection; aggregate eligibility; Movie archive versus review-write race; stale
    writes and rollback of Review/K9/K7 work.
  - Validation: full unit/integration suites, lint, type-check, build, and applicable
    repository checks; complete U-02a handoff.

Each increment must first receive explicit human approval, capture an external baseline,
prove a focused red test, reach green, run required checks, create the visual diff and
deterministic evidence grade, then stop for human review before the next increment.
