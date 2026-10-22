# User UI back-to-main links handoff

Task: Add the Overview page’s back-to-main-page button to My Reviews and My
Reports on `feat/ui-design`.

## Changed files

- `src/app/app/reviews/page.tsx` — added the matching back link and corrected
  the page prop type for Next route validation.
- `src/app/app/reports/page.tsx` — added the matching back link and corrected
  the page prop type for Next route validation.
- `src/app/app/page.tsx` — made the reviews and reports cards themselves link
  to their destinations and removed the nested action links.
- `src/app/app/_components/user-ui.tsx` — shared back link, Overview card, and
  retry button abstractions used by the User pages and lists.
- `tests/unit/user-ui/private-pages.test.ts` — asserts both pages expose the
  `/` back link and that Overview cards navigate directly to the private pages.

## Validation

- Focused unit test: passed, 3 tests.
- Full unit suite: passed, 111 files and 1,836 tests.
- Lint: passed.
- Next route type generation: passed.
- TypeScript: passed.
- `git diff --check`: passed.
- Visual diff: `_temp/ui-design-back-link-visual-diff.html`.

## Known gaps and next action

- No build or E2E run was requested for this small UI-only change.
- Human developer may review and commit the working-tree changes.
