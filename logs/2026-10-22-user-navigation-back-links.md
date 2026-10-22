# User navigation back-link session

Date: 2026-10-22
Branch: `feat/ui-design`

Human request: change User navigation back links so Overview goes to Movies,
while My Reviews and My Reports return to the User Overview.

Updated the shared `UserBackLink` to accept a destination and label. Overview
now displays “Go back to movies” linking to `/movies`; My Reviews and My
Reports display “Go back to overview” linking to `/app`.

Validation: private-page tests passed; lint, Next route type generation,
TypeScript, and `git diff --check` passed.

No dependencies, credentials, production data, or commits were added.
