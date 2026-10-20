# S-04 Identity release evidence

Source revision: `efe6d288d458ab88eecb2ab41d706881e1e08901`, plus the
reviewed S-04 working-tree increments. Environment: local Node.js test runner
and disposable loopback PostgreSQL 17. All fixtures and build canaries are
synthetic. This handoff records repository evidence only; it is not evidence
of a live Vercel or Supabase operation.

## Acceptance traceability

| Row | S-04 acceptance outcome | Concrete automated evidence | Result |
| --- | --- | --- | --- |
| S04-AC-01 | Registration rejects `role`/`status` with no write; registration creates active USER; admin consumer denies USER without mutation; logout, suspension and cross-origin rejection work. The guessed-report-ID portion remains assigned to U-03/R-02. | `tests/integration/api/auth/registration-acceptance.test.ts`; `tests/integration/api/auth/admin-guard-consumer.test.ts`; `tests/integration/api/auth/auth-journey.test.ts`; `tests/integration/api/auth/csrf-boundary.test.ts` | PARTIAL |
| S04-AC-02 | Normalized duplicate email returns safe 409; throttling and enumeration resistance hold. | `tests/integration/api/auth/registration-acceptance.test.ts`; `tests/integration/api/auth/login-throttling.test.ts` | PASS |
| S04-AC-03 | Unknown email, wrong password and suspended account use the same response and both counters; pre-throttled and successful behavior is correct; counters expire without reinstatement reset. | `tests/integration/api/auth/login-throttling.test.ts`; `tests/unit/identity/auth-service.test.ts` | PASS |
| S04-AC-04 | Plaintext session tokens are absent from persistence and logs; only the required opaque cookie carries the browser credential. | `tests/integration/identity/session-repository.test.ts`; `tests/unit/audit/security-log.test.ts`; `tests/integration/api/auth/auth-journey.test.ts` | PASS |
| S04-AC-05 | D-50 email normalization, domain grammar, duplicate identity and password boundaries are covered. | `tests/unit/identity/account-service.test.ts`; `tests/integration/api/auth/registration-acceptance.test.ts` | PASS |
| S04-AC-06 | Strict CSRF wire format, uniform denials, hosted cookies, pre-session lifetime and invalidation are covered. | `tests/unit/identity/session-and-csrf.test.ts`; `tests/integration/api/auth/csrf-boundary.test.ts` | PASS |
| S04-AC-07 | Repository/build checks cover placeholders, server-only configuration, bundle canaries and secret scanning. Live Preview/Production separation and deployed variable configuration remain operator-only. | `tests/unit/config/parse-config.test.ts`; `tests/unit/ci/check-bundle-canary.test.ts`; `tests/e2e/health.spec.ts` | PARTIAL |
| S04-AC-08 | Secret-only bootstrap authorization, account-table serialization, atomic account/audit creation, idempotency, readiness and no startup/build invocation are covered. Live invocation, exact-one-Admin verification and bootstrap-variable removal remain operator-only. | `tests/unit/auth/bootstrap-route.test.ts`; `tests/integration/identity/admin-bootstrap.test.ts`; `tests/integration/api/health/health.test.ts`; `tests/unit/ci/verify-first-admin.test.ts` | PARTIAL |

AT-01 remains partial until U-03 and R-02 pass. U-03 owns reporter-filtered
report reads and guessed-ID `404`; R-02 owns the complete two-user/two-role
matrix and final system-level result.

FR-01 remains partial until the deferred public auth pages pass E2E. The
backend registration, login, logout and current-session APIs do not by
themselves complete the required public pages or post-authentication routing.

## Sensitive-data evidence

- Password hashing and storage: `tests/unit/identity/account-service.test.ts`,
  `tests/integration/api/auth/registration-acceptance.test.ts` and
  `tests/integration/identity/admin-bootstrap.test.ts`.
- Session-token hashing, persistence and invalidation:
  `tests/integration/identity/session-repository.test.ts` and
  `tests/integration/api/auth/auth-journey.test.ts`.
- Restricted structured logging: `tests/unit/audit/security-log.test.ts` and
  `tests/support/contracts/security-log.contract.ts`.
- Normalized-email and client-IP rate-limit HMAC persistence, including secret
  rotation: `tests/unit/rate-limit/rate-limit-keys.test.ts` and
  `tests/integration/rate-limit/rate-limiter.test.ts`.
- Bootstrap response/log exclusion: `tests/unit/auth/bootstrap-route.test.ts`
  and `tests/integration/identity/admin-bootstrap.test.ts`.
- Client bundle checks: `tests/unit/ci/check-bundle-canary.test.ts`,
  `scripts/check-bundle-canary.mjs`, and the final Increment 10 command record.

## External verification still required

| Check | State | Required evidence |
| --- | --- | --- |
| Preview/Production separation | OPERATOR REQUIRED | Redacted Vercel configuration plus proof that each environment reaches only its own storage. |
| Vercel bootstrap invocation and variable removal | OPERATOR REQUIRED | Controlled invocation record, readiness result, `db:verify-first-admin` aggregate result, and final redacted variable listing. |
| Deployed health and bootstrap behavior | OPERATOR REQUIRED | Production/Preview smoke checks tied to the released revision. |
| Vercel sensitive-variable configuration | OPERATOR REQUIRED | Redacted project configuration proving server-only variables are sensitive and test/migration URLs are absent from runtime configuration. |
| Guessed-report-ID/full access matrix | U-03/R-02 REQUIRED | Reporter-only `404` isolation and final two-user/two-role matrix. |
| Public authentication pages | DEFERRED FOLLOW-UP | Public registration/sign-in and role-routing E2E evidence. |

## Final command record

Increment 10 records the exact command, result, environment and artifact path
in `_temp/s04-release-increment-10-evidence.json`. An unavailable local check
remains unavailable here; it is never promoted to PASS based on configuration
or CI intent alone.
