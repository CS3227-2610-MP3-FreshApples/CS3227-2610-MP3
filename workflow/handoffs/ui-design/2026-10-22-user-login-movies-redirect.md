# User login movies redirect handoff

Task: Redirect successful User logins to `/movies` on `feat/ui-design`.

## Changed files

- `src/components/auth-client.ts` — active USER login destination changed
  from `/` to `/movies`; Admin and suspended-account behavior is unchanged.
- `tests/unit/auth/auth-client.test.ts` — verifies the new User destination.

## Validation

- Focused auth-client tests: passed, 3 tests.
- Full unit suite: passed, 111 files and 1,836 tests.
- Lint: passed.
- Next route type generation: passed.
- TypeScript: passed.
- `git diff --check`: passed.

## Known gaps and next action

- No build or E2E run was requested for this small redirect change.
- Human developer may review and commit the working-tree changes.
