# Navbar brand update session

Date: 2026-10-22
Branch: `feat/ui-design`

Human request: change the public navbar brand from “Movie Reviews” to
“FreshApples”.

Updated the public root and public route shell titles to `FreshApples`, which
changes the shared navbar label while preserving its existing destination and
styling. Added a route-shell assertion for the new brand.

Validation: focused route-shell tests passed; lint, Next route type generation,
TypeScript, and `git diff --check` passed.

No dependencies, credentials, production data, or commits were added.
