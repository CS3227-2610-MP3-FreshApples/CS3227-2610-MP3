# B#9 / A-05 iterative TDD plan

## Confirmed scope

Implement Developer B's A-05 report-decision workflow: Admin report list/detail, accepted or dismissed decisions, optional review hiding, lifetime-unique strikes, threshold suspension with session revocation, audit, Admin UI, and required tests.

The approved API decisions are:

- `GET /admin/reports` defaults to `status=open`; status accepts `open`, `accepted`, `dismissed`, or `all`; category is optional and uses the five Report categories; ordering is `created_at DESC, id ASC`; standard pagination and `no-store` apply.
- List items expose identifiers, status/category/timestamp/version, minimal reporter and target identity/status, and current Review summary. Full explanation/evidence is detail-only.
- `GET /admin/reports/:id` exposes the immutable evidence snapshot, current live Review state, current-cycle strike count and threshold, projected effect, and any recorded decision. It is Admin-only and never target-facing.
- `POST /admin/reports/:id/decision` requires active Admin authorization, CSRF/same-origin checks, and `If-Match`. The body is `{ disposition, actions, reason }`; accepted allows `[]` or `["hide_review"]`; dismissed requires `[]`; reason is trimmed and 10–1,000 code points.
- Missing/malformed input is `422`; missing precondition uses the existing precondition error; stale or already-closed Reports return `409`; unknown IDs return `404`; successful responses return the updated Report, Decision, `strikeAdded`, `accountStatus`, and the new Report ETag.
- Report acceptance remains one Account → Movie → Review → Report transaction. K4 owns status/session changes, K8 owns review hiding, K11 owns evidence projection, K5 audit is atomic, and AI cannot create strikes or suspensions.

Decision ID D-104 was assigned by the human and the specification/contract update is approved.

## Increment checklist

- [ ] Increment 1 — approved A-05 contract and Admin report read models
  - Record the confirmed decisions in `../../../spec/api.md`, `../../../spec/governance.md`, and `../../contracts.md` as human-approved decision D-104.
  - Add red/green behavioral tests for default-open/all/status/category filtering, stable ordering, pagination, list/detail projections, immutable evidence, live Review state, projected effect, Admin authorization, `no-store`, and target privacy.
  - Implement only the report repositories/services, composition wiring, and Admin GET routes needed for those behaviors.
  - Run focused unit/API/integration tests, `npx tsc --noEmit`, `npm run lint`, and the iteration grader.

- [ ] Increment 2 — decision input, transport, and guarded report closure
  - Add red/green tests for request validation, CSRF/If-Match, stale/repeated decisions, accepted/dismissed actions, response shape, and ETags.
  - Implement the decision parser and Admin POST route without adding strike/account mutation yet.
  - Run focused tests and required checks; grade and hand off for approval.

- [ ] Increment 3 — atomic acceptance effects
  - Add red/green PostgreSQL tests for decision insertion, lifetime-unique strikes, optional K8 hiding, threshold suspension, session revocation, lock ordering, concurrent acceptances, reinstatement cycles, and audit rollback.
  - Implement the B#9 domain service and repositories using K4/K8/K11/K5.
  - Run focused integration tests and required checks; grade and hand off for approval.

- [ ] Increment 4 — Admin report UI and end-to-end coverage
  - Add red/green UI/API tests for filters, detail, effect preview, confirmation, accepted/dismissed flows, errors, accessibility and private-data boundaries.
  - Implement the Admin report queue/detail/decision UI within the B#9 permitted paths.
  - Run unit, integration, E2E, lint, type-check, build, secret-scan if available, visual diff, and the iteration grader; hand off for approval.

## Scope constraints

No migration is expected. Do not modify A-owned identity/review modules except through existing K3/K4/K8 interfaces. Do not commit, push, or open a PR. Preserve unrelated working-tree changes.
