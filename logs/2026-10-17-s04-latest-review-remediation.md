# S-04 latest tester and code-quality review remediation

## Session summary

- Date and timezone: 17 October 2026, Asia/Singapore
- Task: Implement the six remaining tester/code-quality findings supplied by the human developer.
- Authorization: explicit implementation request; no commit, push, deployment, or Git history change performed.
- Scope guard: `.codex/agents/implementation.toml` was already modified in the worktree and was not changed.
- Source of truth: `AGENTS.md`, the approved S-04 identity/security/deployment specifications, and the supplied findings.

## Findings resolved

1. Bootstrap configuration now reuses the canonical user password predicate: 12–128 Unicode code points, at least one Unicode number, and at least one special character. Negative configuration tests cover short, long, missing-number, missing-special, and Unicode code-point cases. Invalid bootstrap configuration is disabled, so readiness cannot treat it as enabled.
2. Removed the unused `authOrUnavailable` helper and its unused type import.
3. `runRoute` places its server-generated request ID into the handler request context. Identity guards preserve that validated `X-Request-Id` for `access.denied` and CSRF security events, with a generated fallback for direct non-route guard consumers. Regression coverage verifies the ID is preserved and inbound IDs are replaced.
4. Added a PostgreSQL-backed Admin-only guard consumer integration test covering an authenticated USER denial, an inactive-account denial, and an active Admin success through the same consumer boundary.
5. Kept the operator-only Vercel removal procedure and added a deterministic D-51 evidence checklist in `docs/releases.md`. It explicitly records the required redacted evidence and states that live Vercel execution requires a human operator; no live platform evidence is claimed.
6. Ran the requested verification and recorded exact outcomes below.

## Changed files for this session

- `src/server/services/identity/password-policy.ts`
- `src/server/services/identity/account.ts`
- `src/server/config/parse-config.ts`
- `src/app/api/v1/auth/http.ts`
- `src/server/http/index.ts`
- `src/server/services/identity/guards.ts`
- `tests/unit/config/parse-config.test.ts`
- `tests/unit/identity/authorization-and-status.test.ts`
- `tests/unit/http/errors.test.ts`
- `tests/integration/api/auth/admin-guard-consumer.test.ts`
- `docs/releases.md`
- this session log

No dependency or migration was added or modified. Failed builds produced only ignored `.next` output. No credentials, production data, or live platform evidence were recorded.

## Exact verification results

| Check | Result |
| --- | --- |
| `npm run test:unit` | PASS — 27 files, 391 tests |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `git diff --check` | PASS |
| `TEST_DATABASE_URL=postgresql://postgres:local-password@127.0.0.1:5432/postgres npm run test:integration` | BLOCKED — Vitest reported `No test files found` followed by global-setup `Error: read ECONNRESET`; direct host-to-loopback `pg` connectivity reproduced the same `ECONNRESET`. The existing Docker container was inspected and accepts `pg_isready`/in-container `psql`, but the host test process cannot maintain the mapped connection. No container was removed or reset. |
| `npm run build` | BLOCKED — Next.js 16.4.0 Turbopack failed twice, including approved external execution, while processing `src/app/globals.css`: `creating new process` → `binding to a port` → `Operation not permitted (os error 1)`. |
| `npm run check:secrets` | BLOCKED — `gitleaks is not on PATH; install gitleaks v8.30.1 (D-41)`. |

## S-04 status

Implementation and unit/static checks for these findings are complete. S-04 is not fully satisfied: loopback integration evidence, gitleaks evidence, the production build, and required human review/operator D-51 execution remain outstanding. The D-51 checklist is present, but it is not a substitute for human Vercel control-plane execution.

## Next human action

Restore host access to the disposable PostgreSQL container or run the integration suite in the approved environment, install/use gitleaks v8.30.1, rerun `npm run build` where Turbopack can bind its worker port, then complete the human diff review and operator-only D-51 evidence record.
