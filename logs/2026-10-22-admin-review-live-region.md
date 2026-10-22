# Admin review live-region fix session

Date: 2026-10-22, Asia/Singapore  
Task: Fix the Admin review E2E strict-mode failure after moderation decisions.  
Human owner/reviewer: awaiting assignment  
Verification status: awaiting human verification

## Request and scope

The Admin review E2E journey found two matching polite live regions under
`data-moderation-status`: the active “Saving moderation decision…” message and
an empty live-region paragraph. The strict locator could not identify the
saved decision message.

## Change

Updated `ReviewDetail` so the live-region paragraph is rendered only when the
announcement has content. Moderation status messages now expose one matching
live region during an action, including the final “decision saved” message.

## Verification

| Check | Result |
| --- | --- |
| Focused Admin review/status tests (3 files, 11 tests) | PASS |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |
| Real E2E journey | UNAVAILABLE: `TEST_DATABASE_URL` unset and Chromium not installed |

No dependencies, credentials, production data, or commits were added.

## Human verification

- [ ] Summary matches the interaction and outcomes.
- [ ] Changed files and checks match the working tree.
- [ ] E2E journey is rerun in the configured CI/test environment.

Reviewer:  
Verification date:  
Corrections or notes:
