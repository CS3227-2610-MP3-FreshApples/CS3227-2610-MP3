# S-04 iterative-TDD implementation plan

Source revision: `efe6d288d458ab88eecb2ab41d706881e1e08901` on `feat/identity-sessions`.

This plan covers the approved S-04 identity scope while preserving the existing
working-tree changes. The implementation agent must complete one increment per
human approval and stop after each handoff.

## Requirements carried into implementation

- Registration accepts only `email`, `password`, and `displayName`; unknown or
  privileged `role`/`status` fields return 422 and create no account.
- Email normalization follows the recorded FreshApples policy and is used for
  uniqueness and login throttling.
- Passwords use Argon2id, 12–128 characters, require at least one number and
  one special character, and are never truncated.
- Sessions are opaque random tokens; only hashes are stored, with an 8-hour
  absolute lifetime and secure cookie attributes.
- Login uses the recorded generic-failure and suspended-account throttling
  behavior (D-44), including the pre-throttled no-verify path.
- CSRF uses the recorded D-14 wire contract and exact Origin check.
- Guards recheck account status on every request; suspension revokes sessions.
- Audit/security events and transactions follow the existing K5/K6 contracts.
- The proposed D-51 first-Admin bootstrap remains a separate final increment;
  its exact protected route/operator invocation must be human-approved before
  implementation. It must not run during build or ordinary function startup.

## Checklist

- [x] Increment 1 — Identity primitives and account service
  - Implement normalized-email/password/display-name validation, Argon2id
    hashing/verification, account repository, account creation, and safe
    account projection.
  - Behavioral tests: accepted/rejected email and password boundaries;
    role/status injection rejected without a write; normalized-email uniqueness;
    password hashes are not reversible or returned; account creation persists
    USER/active.
  - Checks: focused unit tests, full unit tests, type-check, lint.

- [x] Increment 2 — Opaque sessions and CSRF wire service
  - Implement session token generation/hash persistence, expiry/logout/revocation,
    cookie serialization, D-14 token issuance/verification, pre-session binding,
    rotation, and invalidation rules.
  - Behavioral tests: plaintext token never persists; expiry/logout/revocation;
    CSRF malformed/expired/wrong-binding/cross-origin rejection; hosted cookie
    attributes; pre-session lifetime; login rotation.
  - Checks: focused unit/integration tests, full unit tests, type-check, lint.

- [ ] Increment 3 — Authentication services and HTTP handlers
  - Implement register, login, logout, `/auth/me`, and `/auth/csrf` Route
    Handlers with strict request validation, safe errors, CSRF/Origin checks,
    session cookies, and the D-44 limiter sequence.
  - Behavioral tests: register/login/logout/me success and failure paths;
    generic unknown/invalid/suspended failures; pre-throttled no verification;
    successful active login; request IDs and cookie clearing.
  - Checks: focused API integration tests, full unit tests, type-check, lint.

- [ ] Increment 4 — Authorization guards and status enforcement
  - Implement authenticated/active-user/active-admin guards, per-request status
    recheck, transaction-safe account-status service, and session revocation on
    suspension.
  - Behavioral tests: unauthenticated/role/status failures; suspended sessions
    fail immediately; concurrent suspension and request behavior; revocation is
    atomic with status/audit update.
  - Checks: focused integration tests, full unit tests, type-check, lint.

- [ ] Increment 5 — First-Admin bootstrap (only after explicit decision)
  - Implement the exact human-approved protected one-time invocation using
    `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`, serialized durable
    state, Identity transaction/audit path, idempotence, readiness behavior, and
    post-success secret removal procedure.
  - Behavioral tests: creates exactly one Admin when absent; no-op when present;
    concurrent invocations serialize; credentials never log or return; missing
    values keep readiness unavailable; build/startup never invokes bootstrap.
  - Checks: focused integration/API tests, full unit tests, type-check, lint,
    build/readiness checks as applicable.

## Process gates

Before each increment: capture a complete external working-tree baseline,
select the smallest behavioral red test, then implement only that increment.
After each increment: run required checks, create the iteration-scoped visual
diff and evidence manifest, run the deterministic grader, and stop for human
approval before continuing. No commit is authorized by this plan.
