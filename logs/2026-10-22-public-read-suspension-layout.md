# Public read suspension layout session

Date: 2026-10-22
Branch: `feat/ui-design`

Human request: keep the Movies and Announcements page headers and controls
visible when their public read services are suspended, showing the suspension
only in the content card area.

Moved the unavailable-state branches inside the existing page layouts. Movies
now keeps its catalogue heading, description, search input, sort control, and
Search button visible; Announcements keeps its page heading and description.
The unavailable card uses a unique nested heading ID on each page.

Validation: focused public catalogue tests passed; full unit suite passed with
111 files and 1,836 tests; lint, Next route type generation, TypeScript, and
`git diff --check` passed.

No dependencies, credentials, production data, or commits were added.
