# S-04 code-quality and reviewer-tester remediation

## Session summary

- Date and timezone: 17 October 2026, Asia/Singapore
- Task: Fix all authorized S-04 findings from the latest code-quality/test-generator and reviewer-tester audits.
- Branch: `feat/identity-sessions`
- Human authorization: explicit implementation authorization in the task request; no commit or push performed.
- Scope guard: `.codex/agents/implementation.toml` was preserved as an unrelated user change and not modified.
- Specification sources: `spec/api.md`, `spec/security.md`, `spec/governance.md` D-51, `workflow/contracts.md`, `AGENTS.md`.

## Findings addressed

- Centralized hosted/local auth-cookie name resolution and wired it through login, CSRF, `/auth/me`, logout, and authorization guards.
- Routed all five browser auth handlers through K2 `runRoute`; replaced the duplicate body parser with bounded `readJsonBody`; preserved strict validation-before-CSRF ordering.
- Added typed dependency-unavailable mapping to 503 while preserving unexpected-fault 500 and `TransactionConflict` 409 mappings.
- Enforced active account status in `/auth/me` and injected configured `SESSION_TTL_SECONDS` into session creation.
- Kept readiness’s Admin existence check within the two-second bound and classified database, timeout, bootstrap-required, and unexpected failures separately.
- Made AccountRepository capabilities required and removed repository non-null assertions from composition.
- Centralized registration validation and added strict login parsing without allowing unknown fields.
- Added login coverage for unknown email, invalid password, suspended accounts, pre-throttling, natural counter expiry, limiter failure, and accurate D-44 limit logging.
- Added PostgreSQL coverage for suspension/session/audit atomicity, rollback, competing writes, bootstrap isolation/idempotence/invalid input/audit rollback, and the bootstrap migration constraint.
- Added route and guard coverage for request IDs, oversized streamed bodies, unexpected errors, transaction conflicts, dependency failures, hosted cookies, readiness failures, and composed guard consumption.

## Files changed in this session

- `src/app/api/v1/auth/http.ts`
- `src/app/api/v1/auth/register/route.ts`
- `src/app/api/v1/auth/login/route.ts`
- `src/app/api/v1/auth/logout/route.ts`
- `src/app/api/v1/auth/me/route.ts`
- `src/app/api/v1/auth/csrf/route.ts`
- `src/app/api/v1/internal/bootstrap/admin/route.ts`
- `src/server/http/index.ts`
- `src/server/shared/errors.ts`
- `src/server/shared/index.ts`
- `src/server/services/identity/account.ts`
- `src/server/services/identity/auth.ts`
- `src/server/services/identity/csrf.ts`
- `src/server/services/identity/guards.ts`
- `src/server/services/identity/index.ts`
- `src/server/services/identity/session.ts`
- `src/server/services/health/readiness.ts`
- `src/server/services/rate-limit/rate-limiter.ts`
- `src/server/repositories/identity/account-repository.ts`
- `src/server/composition.ts`
- matching unit and integration tests under `tests/unit/` and `tests/integration/`

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS — 27 files, 376 tests |
| `npm run test:integration` with the existing loopback PostgreSQL configuration | PASS — 10 files, 293 tests |
| `npm run build` | UNVERIFIED/FAIL — Next/Turbopack CSS worker process creation is blocked by `Operation not permitted`, including an elevated retry |
| `npm run check:secrets` | UNVERIFIED — gitleaks v8.30.1 is not installed on PATH |
| `git diff --check` | Existing unrelated trailing whitespace remains in the user-modified `spec/governance.md`; no new source/test whitespace issue was introduced |

## Dependencies and generated artifacts

- No dependencies added or changed.
- No migrations were modified; the existing D-51 migration is covered by the new constraint test.
- The build generated the normal ignored `.next` output; no deliverable artifact was added intentionally.
- No credentials, production data, or secrets were recorded.

## Remaining human action

- Human reviewer should verify this summary, inspect the complete worktree diff against the existing unrelated changes, install/run gitleaks v8.30.1, and rerun the production build in an environment where Turbopack can spawn its CSS worker.
