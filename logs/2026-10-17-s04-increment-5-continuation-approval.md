# S-04 Increment 5 continuation approval

## Human approval

The human explicitly approved continuation for S-04 Increment 5 after the
previous identity implementation handoff. Implement only the approved D-51
first-Admin bootstrap scope and stop after its evidence, checks, visual diff,
and deterministic grade.

## Confirmed boundary

- Use a dedicated Vercel server function with deployment-only
  `ADMIN_BOOTSTRAP_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, and
  `ADMIN_BOOTSTRAP_PASSWORD`.
- Create exactly one Admin only when no Admin exists.
- Use the Identity transaction and audit path; serialize concurrent attempts
  with durable database state and remain idempotent after success.
- Never log or return credentials or the bootstrap secret.
- Never invoke bootstrap during build, module initialization, or ordinary
  startup.
- Keep readiness unavailable when no Admin exists and required bootstrap
  configuration is absent.

## Scope

This continuation permits only the Increment 5 route/function, configuration,
durable state, readiness integration, matching tests, migration, evidence and
interaction-summary files required by the approved behavior. No commit is
authorized.

## Remediation and validation

- Added the standard `server-only` mock to the new PostgreSQL integration test.
- Added `admin_bootstrap` to schema object and runtime privilege expectations.
- Updated health integration fixtures and assertions for D-51 readiness: a
  configured bootstrap permits readiness before provisioning; absent bootstrap
  configuration with no Admin returns unavailable.
- Focused unit tests passed (6 files, 129 tests); full unit tests passed (27
  files, 360 tests); loopback integration passed (9 files, 286 tests);
  type-check and lint passed.
- The production build was attempted twice, including with escalation, and
  both attempts failed in Next/Turbopack CSS worker process creation with
  `Operation not permitted` while binding to a port.
- The secret scan script reported that gitleaks v8.30.1 is not on PATH.
- The iteration visual diff and deterministic evidence grade were generated;
  process compliance passed, while output correctness failed only because the
  required build and secret scan checks did not pass.

## Later remediation-plan Increment 5 — SEC-06 HTTP/PostgreSQL evidence

The remediation checklist subsequently reused the Increment 5 label for the
SEC-06 login-throttling evidence increment. After the Increment 4 handoff, the
human explicitly said to proceed with the next iteration. This approval is
limited to the SEC-06 login route/service, rate-limit boundary, directly
matching tests, and iteration evidence; it does not authorize a commit.

The implementation session captured a complete external working-tree
baseline before edits and added a real Route Handler/PostgreSQL acceptance
suite covering the five-failure limit, integer `Retry-After`, normalized-email
sharing, per-IP isolation, forwarded-header spoof resistance, fail-closed 503,
generic unknown/wrong-password/suspended responses, no pre-throttle password
verification or increment, successful-login non-consumption, natural expiry,
status-cycle persistence, and no suspended-account session. The red test found
that Identity emitted `auth.login_throttled` but omitted D-47's corresponding
`rate_limit.rejected` event. The minimum production change records both events
against the actual rejecting limit. No credentials or production data were
used or recorded.
