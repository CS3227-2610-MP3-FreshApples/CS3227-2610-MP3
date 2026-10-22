# A-04 commit 1 implementation handoff

- Task: A-04, Admin Review API. Requirements: FR-09 (Admin side), SEC-09, AT-21, AT-23.
- Source revision: `c091b35b882b875b02f3a3ba033567347fc7fcbb` plus this working-tree change.
- Authority: the requester assigned implementation, delegated resolution of missing decisions, requested no reviewer agents, and subsequently authorized splitting the work into commits. One focused commit is planned on the existing feature branch.
- Permitted scope: Admin Review routes, Moderation-owned queries/work/service, composition wiring, scoped tests, API details, guide and session evidence. Local commit authorized; no push or deployment.
- Contracts: O-21, O-22, O-23; K8 → work → K5 in the caller's transaction; D-50, D-55, D-58.

## Changed files and rationale

| Files | Purpose |
| --- | --- |
| `spec/api.md` | Record the delegated list/filter/projection/no-op details before implementation |
| `src/server/repositories/moderation/admin-review-query-repository.ts` | Read-only cross-module Review/assessment/work query, stable ordering and current-revision filters |
| `src/server/repositories/moderation/admin-review-work-repository.ts` | Supersede/cancel outstanding work and reactivate the exact cancelled row without resetting history; reuse K9 insertion |
| `src/server/services/moderation/admin-review-input.ts` | Strict reason validation and optional filters |
| `src/server/services/moderation/admin-reviews.ts` | Service authorization and K8/work/K5 transaction orchestration; no provider or strike dependency |
| `src/server/composition.ts` | Wire the manual service independently of AI enablement |
| `src/app/api/v1/admin/reviews/route.ts`, `[id]/route.ts`, `[id]/approve/route.ts`, `[id]/hide/route.ts`, `[id]/restore/route.ts`, `http.ts` | Five guarded routes and shared transport checks; safe no-store responses and ETags |
| `tests/unit/moderation/admin-review-input.test.ts`, `admin-review-service.test.ts` | Input limits and direct service authorization |
| `tests/integration/api/admin/admin-reviews.test.ts` | Real route/session/CSRF/database behavior, restoration matrix, no-ops, rollback, ordering, filters and version races |
| `tests/integration/ai/moderation/dispatcher.test.ts` | Replace approval race stand-in with the real Admin service on another runtime-role connection during the fake provider call |
| `docs/DeveloperGuide.md` | API usage and operational restore behavior |
| `logs/2026-10-21-a04-implementation.md` | Single session disclosure summary, awaiting human verification |

## Validation

Environment: Windows, Node.js, repository-pinned dependencies, disposable PostgreSQL 17 bound to loopback.
Database suites apply all migrations to a throwaway database and use synthetic data. No production credentials or live provider were used by tests.

Initial tests failed because the parser and routes did not yet exist. The first implemented focused run
passed 55 tests across the Admin API and real-dispatcher suites. Subsequent additional coverage includes
assessment provenance/order, competing approvals, public eligibility revision changes and suspended sessions.

| Command | Result |
| --- | --- |
| `npm.cmd run test:unit -- --maxWorkers=2` | PASS: 92 files, 1,671 tests. Two default-worker runs each timed out on the existing `client-ip.test.ts` composition import at 5 seconds; all other tests passed. Reducing workers passed without changing tests or timeouts. |
| `npm.cmd run test:integration` with loopback `TEST_DATABASE_URL` | PASS: 45 files, 791 tests, including the new API tests and real approval-during-AI race. |
| `npm.cmd run lint` | PASS, no findings. |
| `npx.cmd tsc --noEmit` | PASS. |
| `npm.cmd run build` | PASS; all five new endpoints are dynamic. The initial build rejected explicit `runtime`/`dynamic` exports under Cache Components; removing them follows existing Admin routes and the local Next.js guide. Node.js is the default. |
| `npm.cmd run test:e2e` | PASS: 8 tests, exit 0. Windows teardown stalled after all tests passed; stopping only this run's two Next.js processes let Playwright finish and the wrapper clean up. Tracked test-output files were restored to their original state. |
| `npm.cmd run check:secrets` | Could not run: `gitleaks` is absent from PATH. Requires v8.30.1 per the existing script. |
| `git diff --check` | PASS. |

## Artifacts and follow-up

- Dependencies/migrations: none added; existing shipped migrations unchanged.
- Generated artifacts: local `.next` build output, TypeScript incremental metadata and browser test output only; not delivery source. Pre-existing tracked browser output is unchanged.
- Independent reviewer agents: not run, as requested. This handoff is implementation evidence, not approval.
- This API-only increment does not implement the A-04 Admin UI. No live SoC or deployment/accessibility validation is claimed.
- Human follow-up: verify the session log, review delegated API details and diff, install the pinned secret scanner and rerun its check, then decide whether to push/open a PR/merge. No push or PR is included in this authorization.
