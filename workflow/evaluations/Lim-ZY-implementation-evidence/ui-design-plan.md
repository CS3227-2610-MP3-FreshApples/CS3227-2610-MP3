# Developer A UI design implementation plan

Branch: `feat/ui-design` from `master`

Source of truth: `../../handoffs/ui-designer/2026-10-21-developer-a-ui-design.md`, current `../../../spec`, and existing tests.

Scope: implement the UI design for Developer A pages that are currently coded on `master`. This includes the shared public/User shell, home, public catalogue, movie details, announcements, sign-in, register, and the currently coded User overview/reviews/reports surfaces. It excludes new review/report mutation UI that depends on the unresolved own-review projection and report-receipt product decisions recorded in the handoff.

## Checklist

- [x] Pre-Increment 3 refinement — authenticated public navigation
  - Behaviour: active User login redirects to `/`; the public navigation replaces Sign in/Register with the authenticated display name and account link; Admin routing remains unchanged.
  - Tests: auth-client destination regression and public-navigation rendering/state tests.
  - Checks: focused tests, full unit suite, lint, type-check; build may remain skipped per user instruction.

- [x] Increment 1 — Shared shell and design tokens
  - Behaviour: responsive public/User shell, active navigation, skip link, consistent focus/action/status styling, responsive page container, and accessible loading/error primitives.
  - Tests: update/add route-shell and UI primitive rendering tests for active navigation, shell hierarchy, focus treatment, and status visibility.
  - Checks: focused UI tests, `npm run test:unit -- tests/unit/ui-shell`, lint, type-check.

- [x] Increment 2 — Public discovery and authentication pages
  - Behaviour: home landing page; styled Movies and Announcements pages; styled Movie detail metadata; responsive, recoverable Sign in/Register forms; preserve existing API and privacy contracts.
  - Tests: focused public-page/auth-page rendering tests for hierarchy, empty/error/loading states, labels, and preserved form feedback.
  - Checks: focused tests, full unit suite, lint, type-check, build if available.

- [x] Increment 3 — Currently coded User pages
  - Behaviour: styled User overview, My reviews, and My reports surfaces with honest placeholder/available-state messaging; private shell presentation; no invented data or unresolved review mutation contract.
  - Tests: focused User-page rendering tests for private navigation, empty states, safe status language, and no report/AI/private-data leakage.
  - Checks: focused tests, full unit suite, lint, type-check, build if available.

- [ ] Final validation
  - Review the complete diff against the handoff and `../../../spec`.
  - Run the repository-required checks that are available.
  - Record evidence, visual-diff limitation or artifact, known gaps, and next human action in a workflow handoff and session log.

## Explicit exclusions

- No new API/database contract is invented for review mutations.
- No UI for hidden/deleted/resubmission state is implemented until the own-review projection decision is recorded in `../../../spec`.
- No dark mode, custom fonts, image pipeline, UI dependency, or animation framework is added.
- No commits, pushes, or pull requests are created without separate explicit authorization.
