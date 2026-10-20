# A-01 handoff: Admin Movie API (implementation agent)

| Field | Value |
| --- | --- |
| Task ID | A-01 (API half; Admin pages not in this increment) |
| Requirement/decision IDs | FR-05, INV-05, INV-09, AT-02; D-20, D-46, D-51, D-79, D-80, D-81; contracts §3.3, K2, K3, K5, K7, K8, P-01, P-12 |
| Source revision | `7d7c574` on `feat/admin-catalogue` (uncommitted working tree) |
| Permitted paths/actions | `src/app/api/v1/admin/movies/**`, `src/server/{repositories,services}/catalogue*/**`, `src/server/composition.ts`, `tests/**`; no migrations, dependencies, git writes or spec edits |
| Next action | Human: record the K8 interim decision (see Gaps), review the diff, then hand off to the code-quality/test agent and the reviewer/tester |

## Endpoints

| Method and path | Guard | Behaviour |
| --- | --- | --- |
| GET /admin/movies | `requireActiveAdmin` | archived included; `updated_at DESC, id ASC`; page/pageSize invalid → 422; beyond-total page → empty items with the real total |
| POST /admin/movies | `requireActiveAdminMutation` | strict zod body; D-80 defaults; 201 + `ETag "1"`; `movie.create` audit |
| GET /admin/movies/:id | `requireActiveAdmin` | 200 + ETag; malformed or unknown id → 404 |
| PATCH /admin/movies/:id | `requireActiveAdminMutation` | If-Match (absent 428, malformed 400, stale 409); nonempty strict subset; same-value → 200 no-op + `no_op` audit; archived Movies editable and stay archived; never touches `reviews_revision` |
| DELETE /admin/movies/:id | `requireActiveAdminMutation` | archive via the orchestrator; 204, no body, resulting ETag; repeat → 204 no-op, unchanged ETag |
| POST /admin/movies/:id/restore | `requireActiveAdminMutation` | restore via the orchestrator; 200 Movie + ETag; repeat on an active Movie → 200 no-op |

Check order in mutations: guard (auth, role, status, Origin, CSRF) → path id → If-Match → body. A USER never sees validation detail.

## Archive/restore orchestrator (P-12)

`src/server/services/catalogue-archive/`, a sibling module that Catalogue core never imports. Inside one transaction:

1. K7 `lockMovieForUpdate` and a read of the locked row.
2. Compare If-Match with the version. If the requested state already holds, record a `no_op` K5 entry and commit with no further work.
3. Otherwise K8 `lockReviewsOfMovie`, then set or clear `archived_at` (version + 1, `updated_at`), then K7 `markReviewsChanged`, then a K5 `movie.archive`/`movie.restore` `applied` entry.

Audit metadata holds only scalar markers: `previousVersion`, `newVersion`, `archivedBefore`/`archivedAfter` and `<field>Changed`. It never holds text (D-46, D-81).

## Changed files

| Path | Rationale |
| --- | --- |
| `src/server/repositories/catalogue/admin-movie-repository.ts` (new), `index.ts` | Admin Movie row access; separate from the K7 repository so K7 keeps its narrow surface |
| `src/server/services/catalogue/movie-input.ts` (new) | Strict zod create/patch schemas, trimming, code-point limits, calendar-date check, D-80 defaults and clearing |
| `src/server/services/catalogue/admin-movies.ts` (new), `index.ts` | List/get/create/update service with the Admin Movie projection |
| `src/server/services/catalogue-archive/{movie-archive,index}.ts` (new) | Archive/restore orchestrator and the `ReviewsOfMovieLock` structural type it depends on |
| `src/server/composition.ts` | `adminMovieService`, plus `movieArchiveService = null` until K8 exists |
| `src/app/api/v1/admin/movies/{route,http}.ts`, `[id]/route.ts`, `[id]/restore/route.ts` (new) | Route Handlers. `[id]` handlers wrap `runRoute` per request, because K2 `runRoute` does not pass the Next.js route context. K2 is unchanged |
| `tests/unit/catalogue/movie-input.test.ts`, `movie-archive.test.ts` (new) | Validation, and orchestration order with fakes |
| `tests/integration/api/admin/admin-movies.test.ts` (new) | API integration against PostgreSQL |
| `tests/support/fakes/review-locks.ts` (new) | Interim K8 stand-in: `SELECT … FOR UPDATE ORDER BY id`, recording calls |

## Tests and results

Environment: Windows 11, Node via npm scripts, `postgres:17` container bound to `127.0.0.1:55432`. Port 5432 is reserved on this host, so this differs from the AGENTS.md command only in the port.

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS: 46 files, 742 tests |
| `npm run test:integration` | PASS: 22 files, 490 tests (47 new in `admin-movies.test.ts`) |
| `npm run build` | PASS; the three `/api/v1/admin/movies` routes compile under Next.js route-type validation |
| Mutation check: removed the If-Match-before-no-op check and skipped the marker on restore | 3 integration tests failed as expected; the source was restored |

Covered from the task brief: USER → 403 with no mutation or audit, on all six handlers; unknown or derived field → 422; stale If-Match → 409 with no change; archive sets `archived_at` (U-01 is not merged, so the test asserts the column); restore bumps `reviews_revision` and sets `summary_pending_since`. Also covered: anonymous 401, CSRF and foreign-Origin 403, 428/400 preconditions, no-op ETags, oldest pending time kept, Review rows unchanged across archive/restore, and audit-failure rollback (via a temporary trigger) returning a safe 500.

## Known gaps and unverified items

1. **K8 is not available. The decision is unrecorded.** The real `lockReviewsOfMovie` is Developer A's (U-02) and is not on any branch. On 20 Oct the human chose option (a), a B-side structural type with a test fake (`logs/2026-10-20-b6-readiness-merge-and-renumbering.md`), but no decision number has been recorded because of the D-number clash with `feat/ai-summary-core`. Consequences now in the code:
   - `movieArchiveService` is `null` in the composition root, so in a deployed build DELETE and restore return **503 `service_unavailable`** until K8 is wired.
   - The archive/restore API tests inject the orchestrator through a partial `vi.mock` of the composition root, with the PostgreSQL stand-in in place of K8.
   - When U-02 merges, wire `createMovieArchiveService` with the real K8, delete the stand-in and the mock, and rerun the suite.
2. Admin pages (`/admin/movies` UI, a confirmation dialog naming the Movie) are not implemented. The AT-02 UI round trip with U-01 is still open.
3. The archive-vs-review-submission race (§11.3) needs U-02's review write path and is not tested.
4. Agent choice to confirm: a PATCH with an empty object, or a non-object body, reports its field error under the key `request`. D-80 does not name the key.
5. Agent choice to confirm: the Admin Movie projection is `id, title, synopsis, releaseDate, genres, director, cast, runtimeMinutes, archivedAt, version, createdAt, updatedAt`, with no summary or revision internals. api.md names only "current metadata, archive state, version".
6. The PLAN.md tracker row for A-01 is not updated.
