# B#10 / A-06 analyst readiness

## Scope

Read-only assessment of B#10 (Admin user management: manual suspend and unsuspend) against `master` HEAD `cbbeec9`.

## Verdict

**BLOCKED.** The core A-06 requirements and K4/K5 transaction contract are recorded, and B#9 is merged, but B#9's concurrency/browser evidence remains pending human review. A-06 also needs the Admin-user list/read-model/UI decisions recorded before implementation.

## Requirements and acceptance

- `GET /admin/users`, `GET /admin/users/:id`, and `PATCH /admin/users/:id/status`.
- USER targets only; active Admin authorization, CSRF, reason, `If-Match`, no-op same-status behavior, and audited atomic changes.
- Suspension revokes sessions; reinstatement does not restore sessions and advances `strike_cycle`.
- AT-25 covers a no-report suspend/reinstate journey, authorization and stale-version failures, session revocation, no-op behavior, cycle advancement, and serialization with concurrent report acceptance.

## Blocking gaps

- B#9's PostgreSQL concurrency and Playwright evidence is unavailable and its human review is outstanding.
- The Admin-user list contract does not define status defaults/values, exact `q` matching semantics, or stable ordering/tie-breaks.
- The existing Admin users page is a protected placeholder; the approved read model and UI/mutation decisions are not recorded. “Confirmation naming the User” must be confirmed as UI-only rather than a request field.

## Evidence

`spec/api.md:69-71`, `spec/security.md:64-66`, `spec/product.md:159-169`, `workflow/contracts.md:199-206`, `workflow/PLAN.md:429-433`, `src/app/admin/users/page.tsx`, and `workflow/handoffs/ui-designer/2026-10-21-developer-b-ui-design.md:176-185`.

No files were changed and no tests were run by the analyst.
