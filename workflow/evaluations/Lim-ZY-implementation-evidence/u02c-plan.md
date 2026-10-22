# U-02c / A#7 iterative-TDD plan

Source revision: `bdb86f5` (`master`)
Owner: Developer A
Requirements: FR-03, AI-02, AT-03, AT-21, AT-23, AT-24; K9 contracts in `../../contracts.md` §§3.3, 12, 22–23.

## Confirmed scope

Complete the Developer A portion of U-02c using the existing K8 and K9 interfaces. Preserve the existing review-write transaction boundary: durable moderation work is written before commit, and `attemptAfterCommit` is called only after commit with no transaction open. Complete the authenticated `/app/reviews` My reviews page using the existing private `/api/v1/me/reviews` projection, excluding deleted and Admin-hidden Reviews and showing safe review fields with the approved moderation states. Do not implement the real AI dispatcher, moderation decisions, admin review queue, new schema, or new contract.

## Increment checklist

- [x] Increment 1 — My reviews page and safe private review listing.
  - Behavioral tests: authenticated page/API flow renders only the caller's non-deleted, non-hidden reviews; pending, flagged, and cleared states are distinguishable; loading, empty, unauthorized, and API-error states are accessible and safe.
  - Validation: focused UI/view-model tests, applicable unit tests, type-check, lint, and diff check.
  - Evidence: external baseline, red test before application edits, green focused test, iteration-scoped visual diff, deterministic and semantic grade.

- [x] Increment 2 — K9 review-write hook verification and remediation.
  - Behavioral tests: enqueue is durable inside create/body-edit transactions; rollback prevents dispatch; post-commit dispatcher failures preserve pending work; rating-only edits do not enqueue; deletion cancels outstanding work.
  - Validation: focused unit/integration tests, full unit tests, applicable PostgreSQL integration tests, type-check, lint, build, and diff check.
  - Evidence: continuation approval after Increment 1, external baseline, red/green test trace, visual diff, deterministic grade PASS, and semantic second-pass audit PASS.

- [x] Increment 3 — U-02c final API/UI integration coverage.
  - Behavioral tests: private `/me/reviews` ownership, stable pagination tie ordering, no-store response behavior, and end-to-end User visibility of review states.
  - Validation: focused API/E2E tests plus all repository-required checks applicable to the changed paths.
  - Evidence: continuation approval after Increment 2, external baseline, red/green test trace, visual diff, deterministic grade PASS, and semantic second-pass audit PASS; browser E2E remains unverified because the required production build is environment-blocked.

## Guardrails

- No application edits before human approval of this checklist.
- Each increment stops after one natural slice and waits for explicit continuation approval.
- No commit is authorized by this plan; leave commits for explicit human instruction.
- Preserve existing unrelated working-tree changes and do not modify migrations, dependencies, or specifications unless a recorded conflict requires a human decision.
