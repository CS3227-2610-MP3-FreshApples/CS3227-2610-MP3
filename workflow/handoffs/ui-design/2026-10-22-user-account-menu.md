# User account menu handoff

Task: Add a username-triggered account menu to the normal-user navbar on
`feat/ui-design`.

## Changed files

- `src/components/user-account-control.tsx` — replaced the always-visible
  sign-out button with an accessible username-triggered menu containing
  “Manage your account” and “Sign out”.
- `tests/unit/auth/logout-client.test.ts` — verifies the account menu and its
  actions are present.

## Validation

- Focused logout-client tests: passed, 3 tests.
- Full unit suite: passed, 111 files and 1,836 tests.
- Lint: passed.
- Next route type generation: passed.
- TypeScript: passed.
- `git diff --check`: passed.
- Visual diff: `_temp/visual-diff.html` (20 changed files relative to HEAD,
  including the existing uncommitted branch work).

## Next action

Human developer may review and commit the working-tree changes.
