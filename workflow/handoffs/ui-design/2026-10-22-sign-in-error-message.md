# Sign-in error message handoff

Task: Remove duplicate failed-login text from the sign-in page on
`feat/ui-design`.

## Changed files

- `src/app/(public)/sign-in/page.tsx` — limits `LiveRegion` to transient
  pending-login messages; final errors remain in the red alert container.

## Validation

- Focused auth/UI tests: passed, 11 tests.
- Full unit suite: passed, 111 files and 1,836 tests.
- Lint: passed.
- Next route type generation: passed.
- TypeScript: passed.
- `git diff --check`: passed.

## Next action

Human developer may review and commit the working-tree changes.
