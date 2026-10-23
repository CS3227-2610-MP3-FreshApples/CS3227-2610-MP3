# Admin summary regeneration UI handoff

## Assignment

| Field | Value |
| --- | --- |
| Task ID | Admin summary regeneration UI (unnumbered scoped amendment) |
| Requirement IDs | FR-08, AI-01; `spec/admin-summary-regeneration.md` contract and acceptance |
| Role | Implementation agent |
| Source revision | `4d489beef31177a5c5e8a42f36d170e82205d9de` |
| Permitted paths | `src/app/admin/movies/_components/edit-movie.tsx`, new summary-regeneration component, `src/app/admin/_lib/movie-client.ts`, `tests/unit/admin-ui/summary-regeneration*.test.ts`, and this handoff |
| Permitted actions | Implement and locally verify the approved active-Movie Admin UI and browser client only |

## Changes and rationale

- `src/app/admin/_lib/movie-client.ts` adds the exact three-outcome response DTO and a `regenerateMovieSummary` client. It sends `POST /api/v1/admin/movies/:id/summary/regenerate` with strictly `{}` through the existing CSRF-aware `adminWrite`, does not send `If-Match`, encodes the path ID, performs no retry, and rejects expanded or malformed success bodies.
- `src/app/admin/movies/_components/summary-regeneration.tsx` adds the active-Movie control. It explains immediate invalidation, disables and relabels the button while the request is pending, maps generated/pending/insufficient-review outcomes to accessible status messages, maps safe client failures to an alert, and links to the authoritative public movie page.
- `src/app/admin/movies/_components/edit-movie.tsx` renders the control only when `archivedAt` is null.
- `tests/unit/admin-ui/summary-regeneration-client.test.ts` verifies the endpoint, exact body, CSRF header, lack of `If-Match`, all outcomes, strict DTO rejection, ID encoding, authentication/authorization errors, and no automatic retry.
- `tests/unit/admin-ui/summary-regeneration-ui.test.ts` verifies the invalidation explanation, public link, outcome copy and accessible status roles, and failure alert role.

No Client Component imports `src/server`, and no Movie metadata/version recovery behavior was changed.

## Tests and checks

- Red test: `npx.cmd vitest run --project unit tests/unit/admin-ui/summary-regeneration-client.test.ts tests/unit/admin-ui/summary-regeneration-ui.test.ts` — failed as expected before implementation: 2 files failed / 10 tests failed because the client function and component did not exist.
- Focused/regression tests: `npx.cmd vitest run --project unit tests/unit/admin-ui/summary-regeneration-client.test.ts tests/unit/admin-ui/summary-regeneration-ui.test.ts tests/unit/admin-ui/admin-pages.test.ts tests/unit/admin-ui/admin-clients.test.ts` — passed, 4 files / 179 tests.
- Lint: `npm.cmd run lint -- --quiet` — passed with exit code 0.
- Type check: `npx.cmd tsc --noEmit` — not clean because concurrent backend work made two existing AI-summary test doubles incomplete: `tests/integration/ai/summary/summary-sweep.test.ts:544` and `tests/unit/ai/summary/sweep.test.ts:130` lack the new `generateForAdmin` method. No frontend error was reported.
- The first attempt to invoke `npx` through `npx.ps1` was blocked by the machine execution policy; the recorded checks used `npx.cmd`.

## Artifacts, dependencies, and disclosure

- Generated artifacts: none.
- Dependencies added: none.
- Database migrations run: none.
- Live provider calls or production data: none.
- Disclosure/log contribution: the parent agent owns the single-session entry at `logs/2026-10-23-admin-summary-regeneration.md`; this handoff supplies the UI evidence for that summary.

## Known gaps and next action

Parent completion evidence: the separate scheduler/Admin interfaces resolved the intermediate type errors; final type-check and production build passed. Full unit tests: 2,000 passed. Full PostgreSQL integration tests: 807 passed. Chromium journey plus provisioning: four passed, including real-session anonymous/CSRF rejection, pending regeneration, throttle and preserved unsaved movie edits. The local test-server process required stopping after assertions passed; harness then exited 0. The remaining bullets below describe gaps at the UI assignment's original handoff, superseded by this evidence where applicable.

- The repository-wide type check must be rerun after the backend-owned summary test doubles implement the approved `generateForAdmin` interface.
- Build, database integration, end-to-end, and live accessibility checks were not run in this bounded frontend assignment.
- A separate reviewer/tester should check the frontend diff against the approved amendment, then the human developer should review it with the backend work before any commit or deployment.
