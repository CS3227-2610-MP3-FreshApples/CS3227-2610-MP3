# S-04 final code-quality and reviewer-tester remediation

## Session summary

- Date and timezone: 17 October 2026, Asia/Singapore
- Task: Implement every finding from the latest final code-quality/test-generator and reviewer-tester reports.
- Human owner/reviewer: awaiting assignment
- Human authorization: explicit implementation authorization in the task request; no commit or push performed.
- Scope guard: `.codex/agents/implementation.toml` was an existing unrelated worktree change and was not modified.
- Specification sources: `AGENTS.md`, `spec/governance.md` D-47/D-51, `spec/deployment.md`, `spec/security.md`, `workflow/contracts.md` K3/AM-10, and S-04.

## Findings addressed

- K3 authorization guards now receive the server-only `SecurityLog` boundary and emit safe D-47 `access.denied` events for authenticated role/status denials, while CSRF failures use `auth.csrf_failed` and missing/invalid 401 credentials remain unlogged per D-47. Auth `/me`, logout, and bootstrap denials use the Route Handler request ID; guard-only authorization events use a fresh server-generated request ID and never log tokens, cookies, email, IP, or passwords.
- Added `requireCronCaller` with exact `Authorization: Bearer <CRON_SECRET>` validation, constant-time equal-length comparison, rejection of missing/invalid/extra credentials, and no Admin-session fallback. The composition root wires the configured cron secret and security log.
- Added `tests/integration/api/auth/auth-journey.test.ts`, which uses the real composition and loopback PostgreSQL through actual Route Handlers for CSRF/pre-session, registration, login, `/auth/me`, CSRF-bound logout, and post-logout rejection.
- Removed the unused `findByNormalizedEmail` capability from the Identity service dependency and removed the unnecessary AuthService-to-Identity registration delegation. Registration is composed through the dedicated Identity service while login retains its account lookup.
- Resolved D-51 deployment traceability: deployment wording now identifies D-51 as approved and documents an executable, operator-only Vercel procedure to invoke bootstrap, verify exactly one Admin/readiness, remove all three bootstrap variables, and record redacted evidence. The procedure explicitly says the application cannot self-delete Vercel variables and is idempotent for already-absent variables.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS; one stale unused test variable was removed before the final run |
| `npm run test:unit` | PASS — 27 files, 381 tests |
| `npm run test:integration` with `TEST_DATABASE_URL=postgresql://postgres:local-password@127.0.0.1:5432/postgres` and the existing loopback PostgreSQL 17 container | PASS — 11 files, 294 tests |
| `npm run build` | BLOCKED/UNVERIFIED — Next 16.4.0 Turbopack fails in both sandboxed and approved external execution while processing `src/app/globals.css`: it cannot create the CSS worker/bind its port (`Operation not permitted`) |
| `npm run check:secrets` | UNVERIFIED — the script reports gitleaks v8.30.1 is not installed on `PATH` |

## Dependencies and generated artifacts

- No dependencies added or changed.
- No database migration was modified or added for this remediation.
- `next build` generated only ignored `.next` output; no deliverable artifact was added intentionally.
- No credentials, production data, raw tokens, or secret values were recorded.

## S-04 status and remaining action

- S-04 implementation findings in this scope are addressed and focused/full unit plus loopback integration checks pass.
- S-04 is not release-complete until a human reviews the complete worktree diff, installs/runs gitleaks v8.30.1, and reruns the production build in an environment where Turbopack can spawn its CSS worker. The required independent human review and approval remain open.

## Increment 10 continuation

- Human continuation approval: “Great proceed with the next iteration.” The
  approved scope was Increment 10 of the S-04 remediation plan; no commit,
  push, deployment or external environment mutation was authorized.
- Added the durable S-04 release-evidence handoff and a unit check that keeps
  all eight acceptance rows mapped while leaving FR-01, AT-01, U-03/R-02 and
  operator-only deployment evidence explicitly partial.
- Extended D-41 bundle canaries to the three D-51 bootstrap values, including
  CI generation and unit coverage. A synthetic canary webpack build found none
  of the nine values or server-only variable names in `.next/static`.
- Strengthened database/API evidence for password hashes, session-token hashes,
  safe bootstrap audit metadata and response-body exclusion. Existing D-44
  tests prove email/IP HMAC storage and key changes after secret rotation.
- The production-server E2E run exposed a Next.js request-brand failure in the
  API wrapper. `runRoute` now clones the framework request before adding its
  generated request ID instead of reconstructing it with the global Request
  constructor.
- The E2E harness now passes synthetic per-run bootstrap configuration to its
  isolated server and provisions its disposable Admin through the real
  secret-only endpoint before asserting readiness. This is local test evidence,
  not a deployed Vercel operator action.
- Final local results: unit 30 files/421 tests; PostgreSQL integration 17
  files/320 tests; E2E 3/3; lint, type-check and diff check passed. The default
  Turbopack build remains unavailable because the managed environment rejects
  its worker port with `EPERM`; the webpack production build passed. Local
  gitleaks remains unavailable and was not installed or downloaded.
- No dependencies were added. Generated outputs are the ignored `.next`
  production build, the tracked Playwright last-run status, and ignored
  Increment 10 evidence/grade/visual-diff artifacts. No real credential,
  production data, raw token or generated secret was recorded.
