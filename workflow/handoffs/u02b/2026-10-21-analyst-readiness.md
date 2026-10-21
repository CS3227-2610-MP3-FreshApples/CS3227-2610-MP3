# U-02b Analyst Readiness Handoff

## Assignment

| Field | Value |
| --- | --- |
| Task | U-02b / A#6 — K8 review transitions |
| Role | Analyst (read-only assessment) |
| Source revision | `998dd90` (`master`, U-02a merged) |
| Permitted paths/actions | Inspect `spec/`, `workflow/`, `src/`, and `tests/`; propose readiness findings; no implementation or approval |
| Files changed by analyst | None |

## Inspected evidence

- `workflow/PLAN.md`, `workflow/COMMIT-PLAN.md`, and `workflow/contracts.md` §§3.1–3.3 and 11.
- `spec/product.md` FR-03 and FR-09; `spec/api.md` review-admin routes and transition rules.
- `spec/data-model.md`, `spec/security.md`, and `spec/verification.md` AT-03, AT-09, AT-21 and AT-23.
- `src/server/shared/types.ts`, the merged Reviews module from U-02a, K7/K9 implementations and their tests.
- U-02a merge commit `998dd90` and its final validation handoff.

## Assessment

U-02b can proceed after the human implementation gate. The A#5 dependency is now on `master`, and the K8 contract is already frozen with typed locks, transition results, rejection types, fail-closed fake behavior and the archive lock operation. No missing requirement or specification conflict blocks the bounded K8 slice.

Implementation must remain limited to the Reviews transition provider and its contract tests/fake. It must not add Admin route or Moderation-work orchestration, duplicate K7 marker logic, or let AI output bypass the version/content/visibility guards.

## Acceptance examples to carry into implementation/tests

1. Given a locked pending Review whose captured content and row versions still match, when automatic clearance is applied, then it becomes AI-cleared, increments its row version, and advances Movie eligibility/revision atomically.
2. Given an edited, deleted, hidden, or already human-decided Review, when a late automatic clearance/flag arrives, then the transition returns `stale` and changes neither visibility nor moderation state.
3. Given a current pending/flagged Review, when an Admin approves it with the current `If-Match`, then it becomes cleared with `clearance_source = admin`; a stale version is rejected without mutation.
4. Given a Review on an archived Movie, when automatic moderation attempts a transition, then it returns `movie_archived` and does not publish the Review; Admin approve/hide/restore remains permitted according to the contract.
5. Given a hidden Review, when Admin restore is called with the current version, then only `hidden_at` is cleared and pending/flagged moderation is not bypassed. Repeating a no-op transition preserves the version.
6. Given Movie archive/restore and User review creation competing, then both use the Movie update lock and the final state cannot expose a review for an archived Movie; add the competing-write integration evidence at the K8 boundary.

## Gaps and next action

No analyst-level blocker was found. The remaining prerequisite is human approval of the A#6 implementation scope/branch. After implementation, run the K8 unit/contract tests plus PostgreSQL competing-write and revision/visibility tests, then obtain the independent code-quality and reviewer/tester gates. The archive/create race must not be left as an undocumented follow-up.

