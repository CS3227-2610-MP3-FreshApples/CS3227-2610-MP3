# User login movies redirect session

Date: 2026-10-22
Branch: `feat/ui-design`

Human request: redirect a User to the movies page after a successful login
instead of the public home page.

Updated the server-authoritative client destination resolver so active USER
accounts resolve to `/movies`; active ADMIN accounts continue to resolve to
`/admin`, and suspended accounts continue to return no destination. Updated
the auth-client regression test accordingly.

Validation: focused auth-client tests passed; full unit suite passed with 111
files and 1,836 tests; lint, Next route type generation, TypeScript, and
`git diff --check` passed.

No dependencies, credentials, production data, or commits were added.
