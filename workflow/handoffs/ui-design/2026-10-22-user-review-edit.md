# User review edit and duplicate-submission UI handoff

Task: Implement approved option 1 on the isolated `feat/user-review-ui` worktree.

## Scope completed

- Extended `GET /api/v1/me/reviews` own-review projection with the safe integer `version` needed for optimistic concurrency.
- Loaded the User’s own review for the current movie.
- Switched the movie-page surface to edit mode when an own review already exists.
- Displayed an approved own review as “Your published review”; the public review list continues to render the approved review as community content.
- Sent edits through the existing PATCH endpoint with `If-Match` and CSRF protection.
- Prevented a second submission for the same User/movie pair in the UI; server-side conflict protection remains unchanged.

## Files changed

- `spec/api.md`
- `src/server/services/reviews/review-read.ts`
- `src/app/app/reviews/_lib/review-client.ts`
- `src/app/(public)/movies/[id]/_lib/review-submit-client.ts`
- `src/app/(public)/movies/[id]/_components/review-submission-form.tsx`
- `tests/unit/reviews/review-input-and-projections.test.ts`
- `tests/unit/user-ui/review-client.test.ts`
- `tests/unit/user-ui/review-submission.test.ts`

## Validation

- Red test: versioned edit client test failed before implementation.
- Focused tests: 20 passed.
- Full unit suite: 1,711 passed.
- Lint, route type generation, TypeScript, and whitespace checks: passed.
- Build: skipped per the standing Turbopack instruction.
- E2E: skipped because `TEST_DATABASE_URL` was unavailable.
- Visual diff: `_temp/user-review-edit-visual-diff.html`.
- Evidence: `_temp/user-review-edit-evidence.json`.
- Deterministic iterative-TDD grade: overall `PASS` (output correctness `PASS`; process compliance `PASS`).

## Known gaps

- No browser E2E journey was run in this environment.
- No commit was created.
- The next increment requires human review and explicit approval before work continues.
