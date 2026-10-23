# Authentication consistency session

Date: 2026-10-22
Branch: `feat/ui-design`

Human request: keep authentication state consistent across all routes so a
logged-in User does not see anonymous navigation after moving from Home to
Movies or Announcements.

Added a root-level client `AuthProvider` that performs one `/api/v1/auth/me`
lookup and preserves the account state across route transitions. Public
navigation and the User account control consume that shared state, use stable
public links while the lookup is pending, and no longer restart their own
lookups on every pathname change. Admin-specific authorization remains behind
the existing Admin HTTP helper because the repository’s Admin module-boundary
test forbids Admin components from importing shared client modules.

Validation: full unit suite passed with 111 files and 1,836 tests; lint, Next
route type generation, TypeScript, and `git diff --check` passed. Visual diff:
`_temp/visual-diff.html`.

No dependencies, credentials, production data, or commits were added.
