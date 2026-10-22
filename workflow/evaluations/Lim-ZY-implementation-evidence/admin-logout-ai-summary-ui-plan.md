# Admin logout and AI summary UI implementation plan

## Confirmed scope

- Branch: `feat/admin-logout-ai-summary-ui`.
- Admin users receive a visible logout control in the admin dashboard shell.
- A successful logout calls the existing CSRF-protected logout API, invalidates the session, clears the session cookie, and navigates to `/sign-in`.
- A logout failure renders an inline, non-sensitive error and keeps the admin on the dashboard.
- The public Movie review-summary UI must satisfy the recorded AI-01 / FR-08 / D-90 / D-98 behavior. The current `master` tree already contains an implementation, so this increment verifies it and changes it only if a focused behavioral test demonstrates a gap.
- No changes to the already-existing unrelated `../../../test-results` worktree changes.

## Checklist

- [ ] Increment 1 — Admin logout control
  - Behavioral tests: successful admin logout sends the CSRF token and POST request, then redirects to `/sign-in`; failed CSRF/token/API requests show an inline safe error and do not navigate away.
  - Validation: focused unit tests, applicable UI-shell/auth tests, `npm run lint`, `npx tsc --noEmit`, and `npm run build` where the current environment supports them.
  - Evidence: red test before production edits, green focused test, required-check results, iteration-scoped visual diff, and deterministic iterative-TDD grade.

- [ ] Increment 2 — AI summary UI verification and any evidence-backed completion
  - Behavioral tests: ready, stale/missing, insufficient-review, unavailable, escaping, disclosure, timestamp, truncation, and no-control states; Movie detail mounting remains intact.
  - Validation: focused summary UI tests plus applicable repository checks and the iteration-scoped visual diff. If all approved behavior already passes, record that no production change was necessary and do not duplicate the existing implementation.
  - Evidence: continuation approval after Increment 1, baseline/red/green chronology where a gap exists, required-check results, visual diff, and deterministic iterative-TDD grade.

## Out of scope

- Changes to the logout API, session schema, CSRF contract, or authentication service unless a focused test proves the existing implementation violates the approved specification.
- New AI generation controls, summary POST endpoints, provider behavior, migrations, dependencies, deployment, commits, pushes, or pull requests.

## Planned handoff points

After each increment, stop and wait for explicit human approval before continuing to the next checklist item. Leave commits to the human unless separately authorized.
