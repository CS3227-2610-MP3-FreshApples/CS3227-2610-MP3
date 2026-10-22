# Movie and announcement committed-write recovery

- Task: requester’s examples of false errors after movie title edits, announcement publication and announcement edits.
- Source revision: `2c81e0cc079712ee346bd4246a79315724b3f957` plus this working tree.
- Requirements: FR-05, FR-07, D-79–D-81, product §5.2 requester-approved committed catalogue/editorial recovery.
- Scope: browser-side response recovery, synthetic tests and specification/disclosure evidence. No API, server authorization, database, dependency or deployment changes.

## Changed files

- `spec/product.md`: record recovery acceptance criteria before implementation.
- `src/app/admin/_lib/admin-http.ts`: reusable uncertain-write verification and requested-field matching; reject empty changes and unknown projection fields, preserve array ordering, apply explicit text trimming rules. Mark uncertainty only after dispatch for transport errors, 412/5xx or invalid successful responses; never reconcile pre-dispatch CSRF failures or definite 4xx failures.
- `src/app/admin/_lib/user-client.ts`: apply the same post-dispatch uncertainty guard to existing account-status recovery.
- `src/app/admin/_lib/movie-client.ts`: recover movie edits/archive/restore using a no-store resource read, exact resource ID, newer version and matching requested fields/state. Archive returns the verified resulting version.
- `src/app/admin/_lib/announcement-client.ts`: recover content edits and publish/unpublish, including combined edits/state transitions, after comparing every requested normalized field; never accept a deleted announcement as a successful edit.
- `tests/unit/admin-ui/catalogue-mutation-recovery.test.ts`: synthetic 412/lost/malformed responses; no replay; correct uncached paths/headers; normalization; negative identity/version/field/state cases; preserve definite rejections and uncertain creation/read failures.
- `tests/ui/catalogue-mutation-recovery.spec.ts`: production-build browser journeys for an archived Movie title edit, list/detail navigation, announcement publication, content edits and unpublication, asserting fresh visible content and no false error/duplicate write.
- `logs/2026-10-22-admin-ui-navigation.md`: continuation of the single summary for this chat, pending human verification.

## Rationale and limits

Previous automatic recovery was limited to account status. Other callers refreshed state or exposed a refresh button but still displayed an unavailable error after a committed write. These clients now return verified stored projections to their existing success paths, so editors replace their content/version and list actions announce success.

No mutation is retried. Read-back must prove the requested state at a newer version; mismatches, unchanged versions and read failures remain uncertain. Explicit validation, permission and conflict failures remain failures. Creates have no known resource ID after a lost response, so they are never inferred successful or replayed. No-op writes whose version did not advance also remain uncertain if their response is lost. If-Match, ETags and all server-side guards remain intact.

The hosting cause of Vercel PRECONDITION_FAILED remains unverified. Tests reproduce the committed-write/failed-response boundary with isolated synthetic fixtures; this is client recovery, not a claim that Vercel infrastructure was changed.

## Validation

- Initial Admin UI unit suites: 11 files / 279 tests passed before the final empty-change/field-whitelist refinements.
- Final `npm.cmd run build` (including TypeScript), `npm.cmd run lint`, and `git diff --check` passed.
- `npx.cmd playwright test --config tests/ui/playwright.config.ts`: 4 tests passed (23.9s), covering existing account/modal regressions plus archived movie title editing and announcement publication/content editing/unpublication. Verified no false errors, stored normalized content, navigation freshness and no duplicate mutations. Run outside the restricted sandbox so Windows can clean up its own test-server process tree, as in the previous browser verification.
- Final full unit suite: `npm.cmd run test:unit -- --maxWorkers=2 --testTimeout=20000` passed 111 files / 1,836 tests. An earlier run concurrent with production build had one composition-import timeout (1,825 passed / 1 timed out); rerunning the full suite without the competing build passed. No repository timeout settings or unrelated tests changed.
- Separate quality review reported no blocking findings. Independent reviewer found pre-dispatch false recovery and uppercase Movie UUID mismatches; both were fixed with regression tests and confirmed resolved in a follow-up source review. No agent approves merge/release.

Generated artifacts: ignored `.next` production build/browser results and TypeScript cache only, plus any local Chromium diagnostics. Dependencies/migrations: none. No commits, pushes, PRs or deployment actions. Live Vercel preview, PostgreSQL integration and real authenticated E2E remain outside this synthetic presentation/client run. Next human action: review the diff, verify the interaction summary, and confirm these flows in a new Vercel preview deployment.
