# Authentication consistency handoff

Task: Share authenticated account state across public route transitions and the
User shell on `feat/ui-design`, while preserving the Admin module boundary.

## Changed files

- `src/components/auth-context.tsx` — root-level provider and shared account
  state.
- `src/app/layout.tsx` — mounts the provider around all application routes.
- `src/components/route-navigation.tsx` — consumes shared auth state and avoids
  anonymous-link fallback while authentication is loading.
- `src/components/navigation-data.ts` — exposes stable public links for the
  loading state.
- `src/components/route-shell.tsx`, `src/app/page.tsx`, and
  `src/app/(public)/layout.tsx` — pass stable loading links to public shells.
- `src/components/user-account-control.tsx` — consumes shared state and clears
  it after logout.
- Admin-specific account control remains unchanged and continues to use
  `src/app/admin/_lib/admin-http.ts` as required by the Admin module-boundary
  test.

## Validation

- Full unit suite: passed, 111 files and 1,836 tests.
- Lint: passed.
- Next route type generation: passed.
- TypeScript: passed.
- `git diff --check`: passed.
- Visual diff: `_temp/visual-diff.html` (27 changed files relative to HEAD,
  including existing uncommitted branch work).

## Known gaps and next action

- Build and E2E were not run.
- Human developer may review and commit the working-tree changes.
