# Sign-in error message session

Date: 2026-10-22
Branch: `feat/ui-design`

Human request: remove the duplicated failed-login message so only the red
error container remains visible.

Changed the sign-in page to render its polite live region only while the
transient “Signing in…” status is active. Completed authentication failures
continue to render through the red `StatusMessage` alert only.

Validation: focused public-auth and status primitive tests passed; full unit
suite passed with 111 files and 1,836 tests; lint, Next route type generation,
TypeScript, and `git diff --check` passed.

No dependencies, credentials, production data, or commits were added.
