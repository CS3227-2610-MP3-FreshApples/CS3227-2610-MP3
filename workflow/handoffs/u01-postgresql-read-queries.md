# U-01 PostgreSQL read-query handoff

- Task: U-01, iterative-TDD Increment 2 — PostgreSQL Movie list/detail and Announcement reads.
- Requirements/decisions: FR-02, FR-07 public read, INV-02, INV-05, D-79.
- Baseline: `0834f0c9cbbb1a49f39a6ae5353d7d3e050fc64f` in `/tmp/u01-iteration-2-baseline-UTW6vk`.
- Scope: read repositories, transaction-scoped services, focused PostgreSQL integration tests, evidence/disclosure.
- Excluded: routes, pages, migrations, specifications, shared contracts, admin/review mutation code, dependencies and commits.

## Result

Implemented active Movie list/search/detail reads, D-79 ordering, pagination, eligible-review aggregates, published Announcement reads, and null Movie references for absent or archived linked Movies.

## Verification

- Red focused integration test: failed with the expected missing `createPublicMovieReadRepository` export.
- Green focused integration test: `TEST_DATABASE_URL=postgresql://postgres:<synthetic-local-password>@127.0.0.1:5432/postgres npm run test:integration -- tests/integration/catalogue/public-reads.test.ts` — 1 file, 6 tests passed.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.
- Production build/Turbopack — not run; permission restriction applies.

No dependencies, migrations or commits were added. Route handlers and pages remain for later increments. Human review is required before marking this increment complete.
