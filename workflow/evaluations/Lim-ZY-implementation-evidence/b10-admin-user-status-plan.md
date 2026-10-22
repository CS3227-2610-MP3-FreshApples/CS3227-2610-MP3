# B#10 / A-06 iterative implementation plan

## Confirmed scope

Human-approved B#9 acceptance as a usable dependency and approved the B#10 decisions:

- `GET /admin/users` accepts optional `status=active|suspended`; omitted status lists both.
- `q` is trimmed, case-insensitive substring search over `display_name`; empty/whitespace-only means no filter; maximum 200 Unicode code points.
- Stable ordering is case-insensitive `display_name ASC, id ASC`.
- Standard pagination applies: page 1, page size 20, cap 100; invalid values return 422.
- List and detail projections expose only `id`, `displayName`, `status`, and `version`.
- “Confirmation naming the User” is UI-only; the mutation body remains `status` and `reason`, with current `If-Match`.
- Manual status changes use K4/K5, Account-first locking, atomic session revocation/audit, no-op same-status behavior, and strike-cycle advancement only on suspended → active.

## Increment checklist

- [x] Increment 1 — Record the approved A-06 API/contract decisions and implement the Admin user read model: query validation, repository/service, `GET /admin/users`, and `GET /admin/users/:id`. Behavioral tests cover filters, search, stable ordering, pagination, projection privacy, Admin authorization, and missing users. Run focused tests, unit tests, type-check, lint, visual diff, and the deterministic iteration grader. Grade: PASS.
- [x] Increment 2 — Implement `PATCH /admin/users/:id/status` through K4/K5. Behavioral tests cover suspend, reinstate, same-status no-op, reason validation, If-Match/stale version, USER-only targeting, CSRF/authorization, session revocation, audit, and transaction behavior. Run the applicable checks, visual diff, and grader. Grade: PASS.
- [x] Increment 3 — Implement `/admin/users` UI using the approved projection and guarded client architecture. Behavioral tests cover search/filter/pagination, status display, confirmation naming the target, reason handling, stale/error/success states, accessibility, and privacy. Run the applicable checks, visual diff, and grader. Grade: PASS.
- [x] Increment 4 — Validate B#10 against AT-25, including serialization with concurrent B#9 report acceptance using PostgreSQL. Run the required integration/e2e checks available in the environment, final static checks, visual diff, and aggregate evidence review. Grade: PASS.

## Human gates

- Human approval is required before Increment 1 application edits.
- Human approval to continue is required after each increment handoff.
- No commit is authorized by this plan; the working tree will be handed off for human commit approval.

## Scope boundaries

Allowed implementation scope is A-06 Admin user status and its approved specification/contract updates, tests, `src/app/admin/users*`, related Account read/status service/repository integration, and required handoff/evidence files. Do not change B#9 behavior, migrations, dependencies, or unrelated Admin modules.
