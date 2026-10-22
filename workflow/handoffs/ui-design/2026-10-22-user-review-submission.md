# Normal-user review submission UI handoff

Task: Implement the approved normal-user review submission UI on `feat/user-review-ui` from `master`.

## Scope completed

- Added an authenticated review submission surface to public movie details pages.
- Added rating selection from 1–10 and a plain-text review body constrained to 10–2,000 characters.
- Added sign-in guidance for unauthenticated visitors.
- Reused the existing `/api/v1/movies/[id]/reviews` contract with a CSRF token from `/api/v1/auth/csrf`.
- Displayed safe validation, submission, network, authorization, rate-limit, and pending-moderation feedback while preserving entered values on failure.

## Files changed

- `src/app/(public)/movies/[id]/_components/review-submission-form.tsx`
- `src/app/(public)/movies/[id]/_lib/review-submit-client.ts`
- `src/app/(public)/movies/[id]/page.tsx`
- `tests/unit/user-ui/review-submission.test.ts`

## Validation

- Red focused test failed before the client existed.
- Focused tests: 10 passed.
- Full unit suite: 1,709 passed.
- Lint, route type generation, TypeScript, source-only TypeScript, and whitespace checks: passed.
- Build: skipped per the standing Turbopack instruction.
- E2E: not run because `TEST_DATABASE_URL` was unavailable.
- Visual diff: `_temp/user-review-ui-visual-diff.html`.
- Evidence: `_temp/user-review-ui-evidence.json`.

## Known gaps

- No end-to-end browser journey was run in this environment because disposable PostgreSQL was not configured.
- No edit/delete review UI was included; the approved scope was submission only.
- No commit was created.
