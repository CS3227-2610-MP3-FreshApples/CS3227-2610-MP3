# Admin summary regeneration: independent quality and test generation

- Task: Admin manual AI summary regeneration, independent quality/test generation role.
- Requirements: FR-08 / AI-01, INV-09; scoped contract in `spec/admin-summary-regeneration.md` under the user's delegated resolution of blockers.
- Source revision: `4d489beef31177a5c5e8a42f36d170e82205d9de` plus the concurrent working-tree implementation.
- Permitted writes: `tests/integration/ai/summary/admin-regeneration.test.ts` and this handoff only. No production changes, dependencies, Git history changes, external systems or release migrations.

## Changes and coverage

Added PostgreSQL integration tests using a generated least-privilege local runtime role, synthetic accounts/Reviews, existing real repositories, K7 locking/marking/scheduling, K5 audit, K6 limiter, K10 controller and marker fake provider.

1. Establish an actual current summary through normal generation, then regenerate unchanged Reviews despite recent success. Check that old output is stale and revision/audit writes are visible from an independent owner connection before provider execution; no transaction remains open during the call. Verify Movie.version and every Review row are preserved, and the new successful job records `admin_request`, the requesting Admin and the new revision.
2. Fewer than three Reviews still advances the revision and records durable pending work, preserving its oldest timestamp and one-day attempt schedule. No job/provider call occurs. A second request is rate-limited before any further Movie/audit/job write.
3. Inject an audit failure after invalidation/schedule work; verify the transaction rolls those changes back and never starts provider execution.

Expected behaviour was derived from the amended acceptance contract. Existing concurrency/publication suites remain responsible for shared lease races and stale publication; this file does not duplicate those scenarios.

## Validation

- `npm run test:integration -- tests/integration/ai/summary/admin-regeneration.test.ts`: PowerShell rejected `npm.ps1` because script execution is disabled; no tests ran through that invocation.
- `npm.cmd run test:integration -- tests/integration/ai/summary/admin-regeneration.test.ts` with the parent-provided disposable loopback PostgreSQL 17: initial fixture run passed, 1 file / 3 tests, exit 0. Duration 12.91 s. The harness applied migrations only to its throwaway local database.
- `npx.cmd eslint tests/integration/ai/summary/admin-regeneration.test.ts`: passed, exit 0 on the initial file.
- Strengthened-fixture rerun initially exceeded Vitest's default 5-second test timeout (first test 7.604 s; 2 passed / 1 timed out, no assertion failure). The multi-generation integration case now has an explicit 30-second timeout; assertions are unchanged.
- Final `npm.cmd run test:integration -- tests/integration/ai/summary/admin-regeneration.test.ts`: passed, 1 file / 3 tests; duration 13.29 s, tests 4.08 s. Synthetic disposable loopback PostgreSQL 17 only.
- Final `npx.cmd eslint tests/integration/ai/summary/admin-regeneration.test.ts`: passed, exit 0. Only the explicit test timeout changed afterward.

## Production quality review and limits

Inspected manual service transaction ordering and error mapping, generation entry points, job provenance mapping and the new trigger migration. No actionable production-code finding identified within this scope. This is not approval of the implementation or tests.

No generated artifacts or dependencies added. Route/CSRF/authorization and outcome-unit tests belong to the backend worker; UI accessibility checks belong to the UI/reviewer work. Full-suite lint/type/build/integration results and browser validation are coordinated by the parent. Human verification of the session interaction summary and separate review are still required before merge.

Next action: parent incorporates final focused results, runs applicable full checks, and obtains independent review/human approval. Production migrations remain an operator release step.
