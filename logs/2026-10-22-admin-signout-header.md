# Admin sign-out header session

Date: 2026-10-22, Asia/Singapore
Task: Remove the Admin sign-out control after a successful logout.
Human owner/reviewer: awaiting assignment
Verification status: awaiting human verification

## Request and scope

The human reported that the navbar still showed the Sign out button after an
Admin signed out.

## Change

- Passed the shared auth-context clear callback through the public Admin
  header control.
- Added local signed-out state to the dedicated Admin workspace header so it
  unmounts immediately after a successful logout.
- Preserved the existing failed-logout message and retry behavior.

## Verification

| Check | Result |
| --- | --- |
| Focused auth/private UI tests (3 files, 9 tests) | PASS |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |

No dependencies, credentials, production data, or commits were added.

## Human verification

- [ ] Summary matches the interaction and outcomes.
- [ ] Changed files and checks match the working tree.
- [ ] Verify the navbar visually after Admin logout.

Reviewer:
Verification date:
Corrections or notes:
