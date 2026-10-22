# Developer B Admin UI design implementation plan

Branch: `feat/ui-design-admin` from `master`

Source of truth: current `../../../spec`, existing Developer B Admin implementation, `../../handoffs/A-01-A-02/2026-10-20-a01-a02-admin-ui.md`, and `../../handoffs/ui-designer/2026-10-21-developer-b-ui-design.md`.

Scope: additive UI presentation for every currently coded Developer B/Admin page, plus honest presentation pages for the currently placeholder Admin overview, Reviews, Reports, and Users routes. Preserve guarded browser API access, existing API contracts, authorization boundaries, plain-text handling, and existing Admin behavior.

## Checklist

- [x] Increment 1 — Admin shell, overview, and shared state polish
  - Behaviour: coherent Admin page hierarchy, responsive shell/account control, overview destination cards, and consistent loading/error/empty/status surfaces.
  - Tests: focused Admin shell/overview rendering tests and existing Admin state tests.
  - Checks: focused tests, full unit suite, lint, type-check, build if available.

- [x] Increment 2 — Movie and Announcement Admin flows
  - Behaviour: visually consistent list/table, pagination, CRUD forms, detail/edit screens, state badges, action groups, stale/error/loading feedback, and responsive layouts.
  - Tests: focused Admin catalogue/announcement page and component rendering tests; preserve mutation/error behavior.
  - Checks: focused tests, full unit suite, lint, type-check, build if available.

- [x] Increment 3 — Reviews, Reports, and Users presentation pages
  - Behaviour: replace placeholders with safe available/empty/loading/error states and implementation-ready page hierarchy without inventing unavailable read models or mutation controls.
  - Tests: focused rendering tests for safe copy, privacy boundaries, and no fabricated metrics/actions.
  - Checks: focused tests, full unit suite, lint, type-check, build if available.

## Explicit exclusions

- No new API, database, authorization, moderation, account-status, report-decision, strike, suspension, or AI contract.
- No Admin review/report/user data queries until the approved read models are available.
- No email, reporter identity, strike ledger, received-report details, raw provider errors, or session details in UI.
- No new dependency, image pipeline, font, dark theme, animation framework, or experimental navigation pattern.
- No changes to existing uncommitted workflow files outside the implementation handoff/log entries required for this session.

## Approval gate

Application code will not be edited until the human approves this checklist. Only one increment will be implemented per approval cycle.
