# A-02 handoff: Admin Announcement API (implementation agent)

| Field | Value |
| --- | --- |
| Task ID | A-02, B#6 commit 2 (API only; the Admin pages are B#6 commit 3) |
| Requirement/decision IDs | FR-07, AT-06; D-32, D-46, D-79, D-80, D-81; contracts §3, K2, K3, K5, O-23 |
| Source revision | `1dba3bc` on `feat/admin-catalogue` (uncommitted working tree) |
| Permitted paths/actions | `src/app/api/v1/admin/announcements/**`, `src/server/{repositories,services}/announcements/**`, `src/server/composition.ts`, `tests/**`, `workflow/`, `logs/`; no migrations, dependencies, spec edits or git writes |
| Next action | Human: Developer B reviews the diff, then hand off to the code-quality/test agent and the reviewer/tester |

## Endpoints

| Method and path | Guard | Behaviour |
| --- | --- | --- |
| GET /admin/announcements | `requireActiveAdmin` | every state, no filter; `updated_at DESC, id ASC`; page/pageSize invalid → 422; beyond total → empty items, real total |
| POST /admin/announcements | `requireActiveAdminMutation` | strict body `title, body, movieId?`; always a draft with `publishedAt` null; 201 + `ETag "1"`; `announcement.create` audit |
| GET /admin/announcements/:id | `requireActiveAdmin` | 200 + ETag in any state; malformed or unknown id → 404 |
| PATCH /admin/announcements/:id | `requireActiveAdminMutation` | If-Match (absent 428, malformed 400, stale 409 `stale_version`); nonempty strict subset of `title, body, movieId, state=draft|published`; deleted → 409 `conflict`; same values → 200 no-op |
| DELETE /admin/announcements/:id | `requireActiveAdminMutation` | soft delete; 204, no body, resulting ETag; repeat → 204 no-op, unchanged ETag |

Check order: guard (auth, role, status, Origin, CSRF) → path id → If-Match → body → in one transaction: lock the Announcement `FOR UPDATE` → version → movieId reference → deleted → no-op or write → K5.

Projection: `id, title, body, movieId, state, publishedAt, authorId, version, createdAt, updatedAt`.

## Design notes

- `planAnnouncementPatch` (pure) compares normalized values and returns the changed fields, the next state, the write (`none`, `publish`, `keep_published_at`) and the D-81 audit action. Only `publish` (draft→published) sets `published_at = now()`; every other write keeps it.
- The repository exposes `publish`, `update` and `markDeleted` as separate named writes, so no caller passes a flag to choose whether `published_at` changes.
- movieId existence is an unlocked read of `app.movie` inside the mutation transaction (O-23 consumer-owned read). Movies are never deleted (D-32 grants no DELETE), so the answer holds until commit. Announcements never lock or write a Movie; the FK check's implicit key-share lock is the only Movie lock.
- The movieId is lowercased during validation so a same-value PATCH compares equal to the stored UUID.
- Audit metadata: `previousVersion`, `newVersion`, `previousState`, `newState` and `<field>Changed` markers. Create records `newVersion` and `newState`. No title or body text.
- The Announcements module defines its own `AnnouncementActor` instead of importing Catalogue's `AdminActor`, so it doesn't depend on Catalogue.

## Changed files

| Path | Rationale |
| --- | --- |
| `src/server/repositories/announcements/{announcement-repository,index}.ts` (new) | Announcement row access and the movieId existence read |
| `src/server/services/announcements/announcement-input.ts` (new) | Strict zod create/patch schemas, trimming, code-point limits |
| `src/server/services/announcements/announcement-change.ts` (new) | Pure PATCH planner: no-op detection, publication write, audit action |
| `src/server/services/announcements/{admin-announcements,index}.ts` (new) | Service: transactions, version and lifecycle checks, K5 |
| `src/server/composition.ts` | `adminAnnouncementService` |
| `src/app/api/v1/admin/announcements/{route,http}.ts`, `[id]/route.ts` (new) | Route Handlers, same pattern as A-01 |
| `tests/unit/announcements/announcement-input.test.ts`, `announcement-change.test.ts` (new) | Validation and transition planning |
| `tests/integration/api/admin/admin-announcements.test.ts` (new) | API integration against PostgreSQL |
| `workflow/PLAN.md` | A-02 row and progress note |

## Tests and results

Environment: Windows 11, Node via npm scripts, `postgres:17` container on `127.0.0.1:55432` (5432 is taken on this host).

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS: 48 files, 793 tests (51 new) |
| `npm run test:integration` | PASS: 23 files, 523 tests (33 new) |
| `npm run build` | PASS; both `/api/v1/admin/announcements` routes compile |
| Mutation check: disabled the deleted-PATCH conflict; made `update` reset `published_at` | 3 integration tests failed as expected; the source was restored |

Covered: every §11.3 Announcement row except the U-01 public reads. That includes repeated DELETE, stale/absent If-Match on would-be no-ops, empty PATCH, same-value no-op, deleted PATCH (conflict vs stale), the publish → edit → unpublish → republish lifecycle, published + state=published (with and without content), mixed content + publish (one version, one publish audit, no text), archived and nonexistent/malformed references, malformed path id, tie ordering across pages, paging bounds, USER 403 with no write or audit, missing CSRF token and foreign Origin, markup stored inert with no audit copy, and audit-failure rollback.

## Known gaps and unverified items

1. **U-01 is not merged.** The public half of AT-06 (drafts and deleted rows never served, publish/unpublish/delete reflected publicly, link omitted for an archived Movie) is untested. The tests assert the stored `state` and `published_at` instead. Tracked in the PLAN.md A-02 progress note.
2. Out of commit 2 scope: the Admin pages and the AT-06 UI round trip (B#6 commit 3).
3. No concurrent-PATCH race test. The lock order is a single Announcement `FOR UPDATE` row, so two PATCHes serialize and the second gets 409 `stale_version`; this is not tested on competing connections.
4. `/admin/announcements` and `/announcements` pages already exist in the build output (from S-07's shell); they were not touched.
