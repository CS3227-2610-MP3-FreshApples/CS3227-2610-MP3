# B#10 / A-06 architect readiness

## Scope

Read-only architecture assessment of B#10 (Admin user management: manual suspend and unsuspend) against `master` HEAD `cbbeec9`.

## Verdict

**BLOCKED.** K4 account-status ownership, K5 audit, optimistic versions, session revocation, and Account-first serialization are architecturally available. Implementation must wait for the missing Admin-user read/list/UI contract and human review of B#9's outstanding evidence.

## Blocking gaps

1. `GET /admin/users` lacks exact status filtering/default, `q` matching/normalization, and stable ordering/tie-break rules.
2. The approved read model and UI contract are not recorded; `/admin/users` is intentionally a placeholder.
3. No B#10 API/service/repository/UI implementation or B#10-specific tests exist.
4. B#9's PostgreSQL concurrency and Playwright evidence remains unverified and pending human review.

## Required boundaries once unblocked

- Use active-Admin authorization and CSRF/same-origin checks.
- Expose only `id`, `displayName`, `status`, and `version`; never credentials, sessions, strike ledgers, or received-report data.
- Call K4 for status changes; do not write Account directly. Lock with `lockUserAccountAtVersion`, apply `suspend`/`reinstate`, record one K5 audit entry, and commit atomically.
- Preserve no-op, stale-version `409`, Admin-target `403`, session-revocation, no-session-restoration, strike-cycle, and B#9 concurrency semantics.

## Evidence

`spec/api.md:69-71`, `spec/api.md:165`, `spec/security.md:64-66`, `workflow/contracts.md:199-206`, `workflow/PLAN.md:429-433`, `src/app/admin/users/page.tsx`, and `workflow/handoffs/ui-designer/2026-10-21-developer-b-ui-design.md:176-185`.

No files were changed and no tests were run by the architect.
