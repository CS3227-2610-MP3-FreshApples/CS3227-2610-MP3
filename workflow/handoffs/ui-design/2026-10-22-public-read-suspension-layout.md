# Public read suspension layout handoff

Task: Preserve Movies and Announcements page structure while showing read
service suspension only in the content area on `feat/ui-design`.

## Changed files

- `src/app/(public)/movies/page.tsx` — keeps the catalogue header and search
  form rendered, then places `PublicReadUnavailable` where movie results and
  pagination would appear.
- `src/app/(public)/announcements/page.tsx` — keeps the announcements header
  rendered and places the unavailable card below it.
- `tests/unit/catalogue/public-pages-unavailable.test.ts` — verifies the
  headers and Movies search controls remain present during suspension.

## Validation

- Focused catalogue tests: passed, 7 tests.
- Full unit suite: passed, 111 files and 1,836 tests.
- Lint: passed.
- Next route type generation: passed.
- TypeScript: passed.
- `git diff --check`: passed.

## Next action

Human developer may review and commit the working-tree changes.
