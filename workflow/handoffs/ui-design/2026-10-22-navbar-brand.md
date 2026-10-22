# Navbar brand update handoff

Task: Rename the public navbar brand to `FreshApples` on `feat/ui-design`.

## Changed files

- `src/app/page.tsx` — public home shell title is now `FreshApples`.
- `src/app/(public)/layout.tsx` — public route shell title is now
  `FreshApples`.
- `tests/unit/ui-shell/route-shells.test.ts` — verifies the public navbar
  renders the new brand.

## Validation

- Focused route-shell tests: passed, 4 tests.
- Lint: passed.
- Next route type generation: passed.
- TypeScript: passed.
- `git diff --check`: passed.

## Next action

Human developer may review and commit the working-tree changes.
