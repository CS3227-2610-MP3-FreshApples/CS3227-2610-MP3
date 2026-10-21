# 2026-10-21 E2E archive expectation fix

## Request

Resolve the Admin catalogue E2E failure where the archive test still expected the interim `service_unavailable` response after K8 archive/restore wiring was implemented.

## Change

- Updated `tests/e2e/admin-catalogue.spec.ts` to retain the confirmation/cancel assertion, then verify the production archive success state and the restore round trip back to Active.
- Updated the stale D-84 comment describing archive/restore as unwired.

## Validation

- Full serial Admin catalogue E2E spec: 8 passed, including the provisioning checks.
- `git diff --check`: passed.
- Chromium and the disposable loopback PostgreSQL service were used only for test verification; no production data or credentials were used.

## Not performed

- No commit, push, PR, or deployment was performed in this session.
