# U-03 iterative-TDD implementation plan

Task: U-03 / A#8 — Report submission and reporter-only history
Branch: `feat/moderation-report-submission`, created from `master`
Requirements: FR-04, INV-04, INV-07, AT-04, AT-22 privacy
Source of truth: approved `../../../spec`, `../../contracts.md` K3/K6/K7/K11, and the U-03 analyst/architect readiness handoffs.

Confirmed behavior:

- An active User can report another User’s visible Review with a category and 10–1,000-character explanation.
- The target is derived from the locked Review; the submission writes one immutable K11 evidence snapshot in the same transaction.
- Self-reports, duplicate open reports, and deleted/hidden/pending/flagged/archived Review targets are rejected safely.
- Report history is reporter-only, private, stably ordered, and returns 404 for guessed IDs, including when the caller is the target User.
- Private responses are `no-store`; receipts exclude evidence, explanations, reporter/target details, decisions, strikes and counts.
- Report creation uses the existing `report_create` rate limit and existing auth/CSRF/API error contracts.

## Increment checklist

- [ ] Increment 1 — report evidence/receipt types, repository and submission service. Add focused unit and PostgreSQL integration tests for snapshot creation, target derivation, self-report rejection, visibility/archival checks, duplicate-open protection, lock/reverify behavior and rollback. Run focused tests, full unit/integration suites, type-check, lint and diff-check; create iteration-scoped visual diff and deterministic grade.
- [x] Increment 2 — `POST /api/v1/reports`, `GET /api/v1/me/reports`, and `GET /api/v1/me/reports/:id`. Add API integration tests for authentication, CSRF/Origin, rate limits, safe errors, reporter filtering, guessed-ID 404s, pagination/order and `no-store`. Run the applicable repository checks, visual diff and deterministic grade.
- [x] Increment 3 — User report-submission and reporter-history UI, including the public Review “Report user” action. Add accessible rendering/client tests and the relevant API/UI journey coverage. Run the applicable repository checks, visual diff and deterministic grade.

Each later increment requires explicit human continuation approval after the previous increment handoff. No commit is authorized by this plan; leave the branch ready for human review unless separately instructed to commit.

Known environment gap: prior U-02 validation records production build and browser E2E as unavailable because of the environment-level Next.js TypeScript `--showConfig`/Turbopack restrictions. This is not an implementation decision for U-03 and must be reported accurately if it persists.
