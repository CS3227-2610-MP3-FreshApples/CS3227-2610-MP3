# User account menu session

Date: 2026-10-22
Branch: `feat/ui-design`

Human request: replace the always-visible normal-user sign-out button in the
navbar with a username-triggered menu containing “Manage your account” and
“Sign out”.

Updated `UserAccountControl` to use a native accessible details/summary menu.
The username is the menu trigger, the account-management link targets `/app`,
and sign-out remains protected by the existing busy state and logout flow.
Updated the normal-user shell regression test to verify the menu contents.

Validation: focused logout-client tests passed; full unit suite passed with
111 files and 1,836 tests; lint, Next route type generation, TypeScript, and
`git diff --check` passed. Visual diff: `_temp/visual-diff.html`.

No dependencies, credentials, production data, or commits were added.
