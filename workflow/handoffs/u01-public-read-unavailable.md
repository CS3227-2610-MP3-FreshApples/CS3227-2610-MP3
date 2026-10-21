# U-01 public-read unavailable-state correction

- Task / requirements: U-01 public Movie and Announcement pages; safe handling of an unavailable read-service composition.
- Source revision: `89354fc` before this correction.
- Human authority: direct request to fix the reported runtime error.
- Permitted paths/actions: public U-01 pages, a reusable presentational component, focused rendering tests, workflow evidence, and the session log.

## Change

The public Announcements page, Movie list, and Movie detail page now render a text-only, accessible unavailable state when the relevant service is `null`, rather than exposing a server-composition exception. A shared server-rendered component keeps the message consistent with the public API's safe unavailable response.

Malformed movie IDs still use the existing not-found behavior before the service availability check. No service, repository, API, migration, or specification behavior changed.

## Verification

- Red: `npx vitest run tests/unit/catalogue/public-pages-unavailable.test.ts` failed with the reported announcement-service exception.
- Green: `npx vitest run tests/unit/catalogue/public-pages-unavailable.test.ts tests/unit/catalogue/public-pages.test.ts` passed: 2 files, 5 tests.
- `npm run test:unit` passed: 49 files, 717 tests.
- `npx tsc --noEmit`, `npm run lint`, and `git diff --check` passed.
- Production build was not run under the documented human-approved Turbopack permission exception.

## Scope and handoff

Changed files are the three U-01 public pages, `src/components/public-read-unavailable.tsx`, and the focused regression test. No dependencies, generated source, credentials, production data, or Git history changes were introduced. Visual review: `_temp/u01-unavailable-page-fix-visual-diff.html`, generated against external baseline `/tmp/u01-unavailable-page-baseline-Ujtso8` at `9cd3583908c308196de9f31a616b999b7c21f45f`.

Known gap: production build remains unverified due the existing environment restriction. Next human action: review the safe unavailable state and, if desired, explicitly request a commit.

## Grading

Second-pass audit: PASS for output correctness and process compliance. The focused test directly exercises the null-composition path on all three pages; the generic message has `role="alert"` and omits both prior raw exception strings. The deterministic iterative-TDD grader also returned PASS for both dimensions using `_temp/u01-unavailable-page-fix-evidence.json`.
