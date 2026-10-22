# Admin popup and mutation feedback fixes

- Task: requester’s popup completion, suspend/reinstate feedback and hover corrections.
- Source: `71e2487faa247c5b75f883eeac1270161db4222b` plus this working tree.
- Requirements: product §5.2 requester-approved refinements; FR-01/05/06/07, A-06, AT-25, K12.
- Scope: UI presentation, client response handling, synthetic tests and disclosure. No server authorization, API contract, database or deployment changes.

## Changed files and rationale

- `spec/product.md`: record approved popup, hover and uncertain-response behavior before code.
- `src/components/confirmation-dialog.tsx`: styled, separated Cancel/Confirm actions, wrapping text, native modal activation and shared focus containment/restoration helpers.
- `src/app/admin/users/_components/user-list.tsx`: native modal/backdrop, bounded scrolling, busy guards, focus restoration and refresh of uncertain results. Removed textarea autofocus because it captured focus before the modal could remember its opener.
- `src/app/(public)/movies/[id]/_components/public-review-list.tsx`: public report popup uses native modality/backdrop and bounded scrolling.
- `src/app/admin/_components/admin-feedback.tsx` and `src/app/globals.css`: hover feedback for enabled buttons and shared links styled as buttons; retain disabled and reduced-motion behavior.
- `src/app/admin/_lib/admin-http.ts`: unavailable feedback no longer promises that an uncertain mutation saved nothing; advises checking state before retrying, for all Admin clients.
- `src/app/admin/_lib/user-client.ts`: after an unavailable response, read the safe user projection with no-store and accept recovery only for the exact ID, requested status and a newer version. Never replay the mutation.
- `src/app/admin/movies/_components/movie-list.tsx`, `edit-movie.tsx`, `src/app/admin/announcements/_components/edit-announcement.tsx`, `src/app/admin/reports/_components/report-detail.tsx`, `src/app/admin/reviews/_components/review-detail.tsx`: refresh state or offer loading the latest version after uncertain results. Existing announcement list already reloads.
- `tests/unit/admin-ui/admin-http.test.ts`, `user-client.test.ts`: lost/malformed/412 responses, both statuses, no replay, wrong/stale identity/status and read-back failure paths.
- `tests/ui/playwright.config.ts`, `admin-feedback.spec.ts`: synthetic Chromium presentation checks against the production build, blank app environment, no database or live accounts. After build run `npx.cmd playwright test --config tests/ui/playwright.config.ts`.
- Disclosure: appended to the existing chat-session summary `logs/2026-10-22-admin-ui-navigation.md`.

## Diagnosis and limits

The requester identified Vercel preview and supplied a platform `PRECONDITION_FAILED` response. Status committed despite that response, and navigation retained stale presentation. Current endpoint/client projections agree; no proven server schema/transaction defect was found. Recovery verifies state after a lost/replaced response; it does not claim to eliminate the unverified Vercel transport cause. If-Match/ETag contracts and server-side version guards remain intact.

Other mutation screens now show accurate uncertainty and allow current-state inspection; only user-status writes have automatic status reconciliation. Do not infer successful edits from unvalidated responses or blindly retry mutations.

## Validation and review

- Full suite: `npm.cmd run test:unit -- --maxWorkers=2 --testTimeout=20000` passed 110 files / 1,797 tests. Default runs hit unrelated 5-second composition-import timeouts in `tests/unit/http/client-ip.test.ts`; no test implementation or repository timeout configuration was changed.
- Targeted client suites: 57 tests passed.
- After the final focus changes, the relevant UI suites passed 17 files / 274 tests.
- Final production build (including TypeScript), lint and `git diff --check` passed after modal focus fixes. An explicit earlier `npx.cmd tsc --noEmit` also passed after correcting a status fixture type.
- `npx.cmd playwright test --config tests/ui/playwright.config.ts`: 2 passed (7.3s). Verified suspend/reinstate reconciliation through synthetic committed 412s, exactly two writes, fresh list after dashboard/back navigation, hover styling, native modality, Escape/cancel restoration, Tab containment, separated 44px shared actions and mobile popup bounds. Desktop account and mobile shared-confirmation screenshots were visually inspected. The sandbox run passed its test assertions but could not finish Windows server-process cleanup; the final run outside the restricted sandbox exited successfully.
- Separate quality/reviewer agents found no blocking production issue. Reviewer’s anchor-hover finding was resolved; quality reviewer’s read-back failure coverage gap was addressed.
- Browser iteration found a real autofocus/restoration bug (fixed) and added explicit Tab wrapping. Test corrections excluded status badges/Next.js announcers from error assertions and used the movie action’s accessible name.

No dependencies, migrations, commits, pushes, PRs or deployments. Generated artifacts: ignored `.next` build and `.next/ui-test-results` screenshots/results, TypeScript cache and any Chromium diagnostic `debug.log`; no shipped generated source. Docker access was unavailable, so database integration and real authenticated E2E tests were not run. Public report popup’s live User journey and actual Vercel preview deployment remain unverified. Next human action: review the diff, verify the interaction summary and validate a new preview deployment.
