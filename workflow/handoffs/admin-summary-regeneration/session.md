# Admin summary regeneration - session handoff

Task: add manual Admin summary regeneration on the movie page.
Requirements: FR-08, AI-01, AI-03; specification: spec/admin-summary-regeneration.md.
Starting revision: 4d489beef31177a5c5e8a42f36d170e82205d9de.
Scope: summary Admin service/API, private job provenance, new migration, Admin movie edit UI, tests, specs, guides and disclosure. No unrelated service changes or dependency additions.
Authorization: the human requested the feature, delegated resolution of blockers/missing decisions, and then permitted multiple commits. No push, PR, merge or deployment is authorized.

## Result and rationale

Active Admins can regenerate an unchanged summary from the movie edit page. The service checks role, consumes the per-account five-minute throttle, commits K7 revision invalidation/schedule and K5 audit together, and awaits the existing bounded generator after commit. The Movie edit version and unsaved UI text are preserved. Public reads remain read-only. Failures/deferments retain pending work; recovery uses the existing daily sweep interval/backoff. Admin execution records include honest requester provenance.

Read-only analyst and architect findings were incorporated into the scoped amendment before implementation. A separate implementation agent owned the backend and another the UI. A separate test-quality agent added actual PostgreSQL/controller tests; an independent reviewer found no blocking code findings. See backend.md, ui.md, test-quality.md and review.md in this directory.

## Final verification

Environment: Windows PowerShell; npm.cmd/npx.cmd avoid the machine's blocked PowerShell npm scripts. Disposable Docker PostgreSQL 17 bound to 127.0.0.1:55432; synthetic fixtures; no live SoC call. Installed PostgreSQL 18 client tools were added to PATH for backup/restore tests against PostgreSQL 17. Evidence is recorded here and in the role handoffs; console test results were observed directly.

- npm.cmd run test:unit -- --maxWorkers=2: PASS, 123 files / 2,000 tests, exit 0.
- npm.cmd run test:integration -- --testTimeout=30000 --hookTimeout=30000: PASS, 52 files / 807 tests, exit 0; TEST_DATABASE_URL pointed only at the disposable loopback server, and local PostgreSQL client tools were on PATH.
- npm.cmd run build: PASS, exit 0; compiled and type-checked the application and new route.
- npm.cmd run lint: PASS, exit 0. New browser test also passed scoped ESLint.
- npx.cmd tsc --noEmit --pretty false: PASS, exit 0 after test inference fixes.
- npm.cmd run test:e2e -- tests/e2e/admin-summary-regeneration.spec.ts: PASS, 4 Chromium tests including provisioning, exit 0. The new journey covers real anonymous and missing-CSRF rejection, a real disabled-AI pending request, server throttle, preserved unsaved form text and subsequent metadata save. Playwright left its own Next.js server tree running after assertions; parent stopped that verified process tree and the harness completed successfully.
- git diff --check: PASS. Existing line-ending normalization notices are informational.
- npm.cmd run check:secrets: NOT RUN successfully; exit 1 because gitleaks is absent from PATH. Follow-up: install the recorded gitleaks version and rerun after build.

Earlier broad tests timed out under excessive concurrent host load; the lower-concurrency unit rerun and final integration run passed. Earlier backup failures were caused by missing pg_dump/pg_restore on PATH; the final full run includes successful backup tests. The build caught incompatible runtime/dynamic route exports (Node.js is the default) and test type inference errors, all corrected before the final passing build.

## Artifacts, disclosure and remaining work

Added migration: src/server/db/migrations/1792796400000_admin-summary-trigger.sql. It extends the AIJob trigger constraint only, preserving existing values and rows. The shipped migration is unchanged. It was applied only by disposable test harnesses. An operator must take the prescribed backup and follow the controlled migration/restore release plan before release.

Build/test artifacts: local .next build and Playwright results; no generated product asset or dependency was added. Pre-existing tracked test-result files cleared/rewritten by Playwright were restored to avoid unrelated changes.

Disclosure: logs/2026-10-23-admin-summary-regeneration.md, awaiting human verification. No credentials or production content were recorded. Human review/merge/release remains required. Live SoC evaluation, deployed capacity/scheduling, a full User browser journey and manual accessibility checks remain unverified. Manual-request-specific stale race and scheduled recovery integration cases reuse existing publication/sweep coverage, as noted by independent review.

## Changed files
- docs/DeveloperGuide.md
- docs/UserGuide.md
- logs/2026-10-23-admin-summary-regeneration.md
- spec/admin-summary-regeneration.md
- spec/ai.md
- spec/api.md
- spec/architecture.md
- spec/data-model.md
- spec/governance.md
- spec/product.md
- spec/README.md
- spec/security.md
- spec/verification.md
- src/app/admin/_lib/movie-client.ts
- src/app/admin/movies/_components/edit-movie.tsx
- src/app/admin/movies/_components/summary-regeneration.tsx
- src/app/api/v1/admin/movies/[id]/summary/regenerate/route.ts
- src/server/composition.ts
- src/server/db/migrations/1792796400000_admin-summary-trigger.sql
- src/server/repositories/ai/ai-job-repository.ts
- src/server/services/ai/runtime/job-record.ts
- src/server/services/ai/runtime/types.ts
- src/server/services/ai/summary/admin-regeneration.ts
- src/server/services/ai/summary/generation.ts
- src/server/services/ai/summary/index.ts
- src/server/services/audit/types.ts
- src/server/services/rate-limit/policies.ts
- src/server/services/rate-limit/types.ts
- tests/e2e/admin-summary-regeneration.spec.ts
- tests/integration/ai/summary/admin-regeneration.test.ts
- tests/unit/admin-ui/summary-regeneration-client.test.ts
- tests/unit/admin-ui/summary-regeneration-ui.test.ts
- tests/unit/ai/summary/admin-regeneration.test.ts
- tests/unit/ai/summary/admin-regeneration-provenance.test.ts
- tests/unit/ai/summary/admin-regeneration-route.test.ts
- tests/unit/rate-limit/rate-limit-keys.test.ts
- workflow/contracts.md
- workflow/handoffs/admin-summary-regeneration/backend.md
- workflow/handoffs/admin-summary-regeneration/review.md
- workflow/handoffs/admin-summary-regeneration/test-quality.md
- workflow/handoffs/admin-summary-regeneration/ui.md
- workflow/handoffs/admin-summary-regeneration/session.md
