# Backend implementation handoff — Admin summary regeneration

- Task: implement the backend for the approved `spec/admin-summary-regeneration.md` amendment.
- Requirement/decision scope: FR-08 / AI-01 and the unnumbered 23 October 2026 Admin summary regeneration amendment; K5 audit, K6 rate limiting, K7 Movie invalidation/scheduling, K10 execution provenance, and the `/api/v1/admin/movies/:id/summary/regenerate` contract.
- Source revision: `4d489beef31177a5c5e8a42f36d170e82205d9de`.
- Permitted paths/actions: `src/server/**`; `src/app/api/v1/admin/movies/[id]/summary/regenerate/route.ts`; focused backend unit/provenance tests; relevant fixed-policy expectation; this handoff. No migration was applied and no live provider was called.

## Changed files and rationale

- `src/server/services/ai/summary/admin-regeneration.ts`: adds the Admin-only service, strict empty-object validator, safe fault log, throttle-before-write ordering, atomic K7 invalidation/schedule/audit transaction, post-commit generation, outcome mapping, and capacity-backoff release.
- `src/app/api/v1/admin/movies/[id]/summary/regenerate/route.ts`: adds the protected POST Route Handler with active-Admin mutation/CSRF guard, strict body handling, request IDs, no-store responses, safe errors, and `maxDuration = 120`. Node.js is the project/default runtime; an explicit runtime segment export is incompatible with this app's Cache Components configuration and was omitted.
- `src/server/composition.ts`: wires the service whenever database dependencies exist, including when AI is disabled; the latter still commits pending invalidation and returns `pending`.
- `src/server/services/ai/summary/generation.ts`, `index.ts`: adds the distinct `generateForAdmin(movieId, requesterId)` entry point while retaining `generate(movieId)` for scheduler callers.
- `src/server/services/ai/runtime/types.ts`, `job-record.ts`, `src/server/repositories/ai/ai-job-repository.ts`: carries optional Admin requester provenance and persists `admin_request`; scheduler provenance remains `scheduler`/null.
- `src/server/services/rate-limit/types.ts`, `policies.ts`: adds fixed `summary_regeneration` policy of one request per account per 300 seconds.
- `src/server/services/audit/types.ts`: adds the approved `movie.summary_regenerate` action.
- `src/server/db/migrations/1792796400000_admin-summary-trigger.sql`: backward-compatible up migration extends the AI-job trigger CHECK; down section restores the prior CHECK. It was not run as a release migration.
- `tests/unit/ai/summary/admin-regeneration.test.ts`: covers service authorization, throttle ordering, atomic mutation sequence, archived/missing targets, insufficient input, disabled AI, post-commit faults, and schedule outcome handling.
- `tests/unit/ai/summary/admin-regeneration-route.test.ts`: covers the active-Admin/CSRF guard result, request IDs, strict input/media/malformed handling, missing target, throttle `Retry-After`, and safe pending response.
- `tests/unit/ai/summary/admin-regeneration-provenance.test.ts`: covers scheduler and Admin AI-job provenance.
- `tests/unit/rate-limit/rate-limit-keys.test.ts`: records the newly approved fixed policy in the existing exhaustive expectation.

## Verification evidence

- `npx.cmd vitest run --project unit tests/unit/ai/summary/admin-regeneration.test.ts tests/unit/ai/summary/admin-regeneration-provenance.test.ts tests/unit/ai/summary/admin-regeneration-route.test.ts tests/unit/rate-limit/rate-limit-keys.test.ts` — passed: 4 files, 45 tests.
- `npx.cmd tsc --noEmit --pretty false` — passed with no diagnostics after separating the scheduler and Admin generation interfaces.
- `npx.cmd eslint ...` over every changed backend/route/unit-test TypeScript file — passed with no findings.
- `git diff --check` — passed; only existing Git LF-to-CRLF working-copy warnings were printed for specification/workflow files owned by the parent task.
- Independent PostgreSQL evidence: `npm.cmd run test:integration -- tests/integration/ai/summary/admin-regeneration.test.ts` against the disposable loopback PostgreSQL 17 database — passed: 1 file, 3 tests, exit 0; duration 13.29 s, tests 4.08 s. The harness applied migrations only to its throwaway database. The independent details and initial timeout history are in `workflow/handoffs/admin-summary-regeneration/test-quality.md`.

## Generated artifacts, dependencies, and disclosure

- Generated artifacts: none.
- Dependencies added: none.
- Migration generated manually from the approved contract; not applied.
- Disclosure/log contribution: the parent task owns the single session disclosure in `logs/2026-10-23-admin-summary-regeneration.md`.

## Known gaps and next action

- Full build, full unit suite, integration suite, and end-to-end checks are coordinated by the parent task because UI, specification, documentation, and test-quality agents share this working tree.
- A separate reviewer/tester and human developer must review the implementation and migration before the human applies the migration, commits, or merges.
