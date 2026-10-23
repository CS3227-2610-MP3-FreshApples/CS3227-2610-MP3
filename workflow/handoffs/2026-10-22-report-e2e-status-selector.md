# Report E2E success/loading selector regression

- Task: fix supplied CI failure where `getByRole("status")` matches acceptance and loading messages simultaneously.
- Source: `4d2b21999c1e696bccadfbe1bab22d50678d9920` plus this working tree.
- Requirements: existing FR-06 report acceptance and accessible async feedback. No product behavior change or new requirement decision.
- Scope: test assertion/fixture coordination and disclosure only. No application, dependency, database or API changes.

## Changes

- `tests/e2e/admin-reports.spec.ts`: filter the status locator by “Report accepted” and assert the added-strike message. Gate the post-decision GET, assert that “Loading report…” is visible concurrently, and release the gate in finally. This deterministically covers the CI collision instead of depending on refresh speed. Existing If-Match, exact payload, private evidence and confirmation-target assertions remain intact.
- `logs/2026-10-22-admin-ui-navigation.md`: append this follow-up to the single summary for this chat; human verification pending.

Other E2E status assertions were inspected: catalogue messages already filter by content and status badges are scoped to their table row. No additional ambiguous selectors were found.

## Checks and evidence

- Exact `tests/e2e/admin-reports.spec.ts` browser test passed: 1 passed (10.4s), with success/loading overlap explicitly asserted.
- Executed with `npx.cmd playwright test --config .next/report-regression.config.ts`; the ignored generated config imports the existing isolated UI config and targets this original E2E file. The test already intercepts its entire API surface, so no database is needed for this specific regression. Used existing production build; no application source changed.
- `npx.cmd tsc --noEmit`: passed.
- `npx.cmd eslint tests/e2e/admin-reports.spec.ts`: passed.
- `git diff --check`: passed.
- Separate quality/reviewer agents inspected the test and reported no blocking findings; neither edited or approved the change.

Generated artifacts: ignored `.next/report-regression.config.ts`, `.next/report-regression-results`, TypeScript cache and test-server outputs. No shipped generated artifacts or dependencies. The full database-backed `npm run test:e2e` suite was not rerun locally; the supplied CI evidence showed the other 12 tests passed. Next human action: verify the session summary and rerun CI. No commits, pushes, PRs, deployments or file deletions.
