# Persistent Admin header controls

- Task: requester wants Admin display name and red Sign out at the right of every header, including public pages, followed by commit/PR suggestions.
- Requirement: product §5.2 persistent Admin header controls; existing FR-01, D-21 and CSRF logout contract.
- Source revision: `95e299b77f15c41b8a626958aef927f335484ae4` plus this working tree.
- Scope: shared header/account presentation, public identity refresh, synthetic tests, specification/disclosure. No server authorization, database, API or deployment changes.

## Changed files and rationale

- `spec/product.md`: record the approved persistent controls and anonymous-public-access behavior before implementation.
- `src/components/admin-header-account-control.tsx`: shared display name, red sign-out, busy state, inline failure feedback and CSRF-protected logout; successful logout clears public identity, redirects to sign-in and refreshes route data.
- `src/components/route-navigation.tsx`: use existing public session lookup to show Admin controls; explicit header actions take precedence. Refresh on pathname changes and clear invalid/failed identity lookup results. Successful logout callback clears identity even when a public layout is preserved or the current page is sign-in.
- `src/components/route-shell.tsx`: keep explicit header action and public Admin controls in the same right-aligned header area via navigation composition, including the Suspense fallback.
- `src/app/admin/_components/admin-account-control.tsx`: retain its existing Admin account lookup/redirect behavior and delegate button presentation to the shared component. Existing exported logout alias retained for compatibility.
- `src/components/user-account-control.tsx`: delegate Admin sessions to the same presentation if an Admin opens the User workspace; ordinary User controls remain unchanged.
- `tests/unit/admin-ui/admin-pages.test.ts`: allow the new approved shared header component in the module-boundary check.
- `tests/ui/admin-header.spec.ts`: eight route headers, single controls, client navigation, mobile overflow, inline logout failure/retry, CSRF, logout to sign-in, immediate control removal and anonymous Home/Movies/Announcements without redirects. APIs use synthetic intercepted fixtures.
- `logs/2026-10-22-admin-ui-navigation.md`: append to the existing chat-session summary; human verification pending.

## Validation and review

- `npx.cmd vitest run --project unit tests/unit/ui-shell tests/unit/admin-ui/admin-pages.test.ts tests/unit/auth`: 16 files / 202 tests passed after final identity-refresh changes.
- `npm.cmd run build` including TypeScript: passed.
- `npm.cmd run lint`: passed.
- `npx.cmd playwright test --config tests/ui/playwright.config.ts`: all 6 tests passed (21.7s), including both new header journeys and prior popup/account/catalogue recovery regressions. Ran outside the restricted sandbox to permit Windows cleanup of its own local test-server process tree.
- `git diff --check`: passed.
- Separate quality/reviewer agents inspected the diff without editing. Review found stale public-header identity after logout; callback clearing, pathname refresh and invalid-lookup clearing resolved it, confirmed by follow-up source review. Quality review's accidental loading-label encoding issue was fixed. Legacy alias unit tests remain compatibility coverage; the new browser test exercises the actual shared button.

Generated artifacts: local ignored `.next` build/browser outputs and TypeScript cache; no shipped generated source. Dependencies/migrations: none. No files deleted, commits, pushes, PRs or deployments. Live Vercel preview, database integration, real authenticated E2E and full manual accessibility testing remain unverified. Next human action: review changes, verify the session summary and validate a fresh preview deployment.
