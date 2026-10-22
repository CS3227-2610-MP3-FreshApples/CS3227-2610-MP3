# A#11 Architect Readiness Handoff

- Task: A#11 — User-side AI fixtures, journey and access matrix
- Role: Architect, read-only
- Requirements: AI-04, SEC-08, AT-11, verification.md 11.1, AT-01, AT-04
- Source revision: `d135824`
- Permitted actions: inspect specifications, plans, contracts, source, tests and Git state; no edits or implementation
- Files changed by architect: none

## Readiness

A#11 is architecturally bounded but blocked from implementation. The existing test harness, K3 identity guards, K10 AI runtime/fakes and route/service boundaries are compatible with the planned test scope. No new contract, schema or architecture decision is required now. The implementation must wait for the feature owners to merge the dependencies identified by SP-6 rather than testing absent behavior or duplicating feature logic in fixtures.

## Boundary and threat findings

- Keep AI containment tests at the provider/feature boundary; fixtures must not grant authorization, invoke moderation/report mutations, expose secrets or assert exact live-model prose.
- Run access-matrix checks through the public API and authenticated HTTP paths, including CSRF/status/session behavior, instead of reaching into repositories or service internals.
- Use separate synthetic users and roles and verify private `no-store` responses and cache isolation; guessed IDs must not reveal another User’s reports or reviews.
- Keep the User journey independent of Admin-only routes and actions. It may consume the merged feature APIs, but must not recreate U-03, U-04 or A-03 behavior inside test helpers.
- Enable the deterministic fake only under the recorded R-02 test configuration; preserve the production wiring and fail-closed behavior.

## Gaps, risks and next action

SP-6 is not satisfied. U-04 and A-03 are not complete for the R-01 AI fixture scope, and the full U/A surface required by R-02 is not present. U-03’s merge removes one dependency gap but does not make A#11 ready. A#11 therefore remains Blocked; no implementation or `Ready` transition is justified. After the dependencies merge, re-run the architect review against the pinned merged revision and require evidence for both AI success/failure paths, private-cache isolation, guessed-ID privacy and keyboard/focus/error/live-region checks.

No files were changed by the architect.
