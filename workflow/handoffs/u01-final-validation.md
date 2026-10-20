# U-01 final validation handoff

- Task: U-01, final validation and commit preparation.
- Requirements/decisions: FR-02, FR-07, INV-02, INV-05, CON-01, D-79.
- Final validation baseline: `/tmp/u01-iteration-5-baseline-qLwDFW`, commit `6aa640cea47304b49c3c926071d9c5150fae5430`.
- Permitted scope: final validation, visual review, evidence and a proposed conventional commit only.
- Excluded: production changes, migrations, dependencies and creating a commit.

## Final validation

- `npm run test:unit` — PASS; 48 files, 716 tests.
- `npm run test:integration` — PASS; 22 files, 449 tests, using a disposable loopback PostgreSQL 17 container which was stopped and removed after the run.
- `npx tsc --noEmit` — PASS.
- `npm run lint` — PASS.
- `git diff --check` — PASS.
- `npm run build` — SKIPPED under the human-approved Turbopack permission exception.
- `npm run test:e2e` — SKIPPED because the recorded command requires a successful build first.
- `npm run check:secrets` — SKIPPED because it requires a successful build first and `gitleaks` is unavailable.
- Final validation visual diff — `_temp/u01-iteration-5-visual-diff.html`; 0 source changes, because this was a validation-only increment.

## Iterative-TDD evidence status

Increments 1–4 each recorded a deterministic PASS at their respective completion gates. Their external temporary baseline directories were absent when attempting a final re-grade, so a current deterministic re-grade reports missing baseline artifacts rather than a product failure. This final handoff therefore does not claim a repeatable aggregate PASS; it explicitly records the evidence-retention gap. No evidence was reconstructed or backfilled.

## Proposed commit for human review

```text
feat(catalogue): add public catalogue and announcement reads (FR-02, FR-07)

Implement public active Movie list, search and detail reads with eligible-review
aggregates, alongside published Announcement reads that safely null archived Movie
references. Add the versioned public GET routes and text-only Server Component pages
with loading, error and empty states. Cover query normalization, projections,
PostgreSQL behavior, API boundaries and page rendering.
```

No dependencies, generated source, database migrations or commits were added. A human should review the retained visual diffs, resolve whether the non-durable baseline evidence is acceptable, then explicitly authorize any commit.

## Post-validation Cache Components correction

Removed `dynamic = "force-dynamic"` from the three public pages and `runtime = "nodejs"` from the three public GET Route Handlers after Next.js 16.4 reported both exports as incompatible with `cacheComponents: true`. The second Turbopack build advanced past all six route-config errors and then stopped at the established sandbox CSS-worker permission failure. Focused page/API tests, full unit, type-check, lint and diff checks passed. The corresponding visual diff is `_temp/u01-cache-components-compat-visual-diff.html`.
