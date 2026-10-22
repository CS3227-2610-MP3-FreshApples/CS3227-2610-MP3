# User navigation back-link handoff

Task: Correct the User UI back-link destinations and labels on `feat/ui-design`.

## Changed files

- `src/app/app/_components/user-ui.tsx` — made `UserBackLink` accept `href`
  and `label` while preserving its styling.
- `src/app/app/page.tsx` — Overview now links to `/movies` with “Go back to
  movies”.
- `src/app/app/reviews/page.tsx` and `src/app/app/reports/page.tsx` — both
  link to `/app` with “Go back to overview”.
- `tests/unit/user-ui/private-pages.test.ts` — verifies the new labels and
  destinations.

## Validation

- Focused private-page tests: passed, 3 tests.
- Lint: passed.
- Next route type generation: passed.
- TypeScript: passed.
- `git diff --check`: passed.

## Next action

Human developer may review and commit the cumulative working-tree changes.
