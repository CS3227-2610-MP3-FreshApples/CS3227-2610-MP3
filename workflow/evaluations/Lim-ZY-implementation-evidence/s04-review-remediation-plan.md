# S-04 review-remediation iterative-TDD plan

Prepared from the independent reviewer/tester and code-quality/test review of
revision `efe6d288d458ab88eecb2ab41d706881e1e08901` plus the current dirty
working tree. This plan supplements, and does not replace,
`_temp/s04-identity-implementation-plan.md`.

Overall reviewed status: **S-04 is partial and does not yet meet its completion
criteria.** The implementation agent must preserve current user changes,
perform exactly one approved increment per turn, obtain explicit approval
before the next increment, and never commit unless separately instructed.

## Confirmed scope and acceptance basis

- S-04: FR-01, INV-01, SEC-01--04, SEC-06, DEP-04 and AT-01
  (`../../PLAN.md`, Task S-04).
- Public registration accepts exactly `email`, `password`, and `displayName`,
  always creates an active USER, and rejects injected `role` or `status` with a
  safe 422 and no write.
- Authentication includes register, login, logout and current-session lookup,
  plus public sign-in/registration pages and role-based routing to `/app` or
  `/admin` (FR-01 and D-21).
- Identity provides K3 guards and `ActingAccountLocks.lockActiveUserShared`, and
  exposes the K4 account-status service through the composition graph (D-20 and
  `../../contracts.md`).
- D-44 requires two named client-IP helpers selected in the composition root,
  not an environment-mode flag passed to a helper.
- Passwords, sessions, CSRF, login throttling, email normalization and the
  first-Admin bootstrap retain their already-approved contracts.

## Human/specification gates before application changes

- [x] **Gate A -- record and approve the bootstrap storage contract.**
  `src/server/db/migrations/1792200000000_first-admin-bootstrap.sql` introduced
  `app.admin_bootstrap`, but `../../../spec/data-model.md` does not define that table's
  schema, ownership, retention or runtime privileges.
  - [x] Analyst proposal completed:
    `_temp/s04-bootstrap-storage-spec-proposal.md`.
  - [x] Architect reviewed the approved table-free Account-lock design and
    returned **approve with required changes; not implementation-ready**. The
    lock mode and Account-before-Audit order are sound. The review is recorded
    in `_temp/s04-bootstrap-account-lock-architect-review.md`.
  - [x] Human approved the table-free contract: separate named USER/Admin
    operations reuse private account-creation primitives; bootstrap takes
    `SHARE ROW EXCLUSIVE` on `app.account`; Admin existence is the durable
    idempotency marker; no bootstrap-specific table is used.
  - [x] The approved decision is recorded in `../../../spec/governance.md`,
    `../../../spec/data-model.md`, `../../../spec/deployment.md`, `../../../spec/tech-stack.md` and
    `../../../spec/architecture.md` before implementation changes.
  - [x] Human confirmed the untracked singleton-table migration was never
    applied externally. Deletion remains separately permission-gated by
    `../../../AGENTS.md` and is not authorized by that confirmation alone.
  - [x] Human decided readiness is unavailable whenever no Admin exists,
    including with valid bootstrap variables; the aligned contracts are
    recorded in governance, API, security, verification and workflow files.
  - [x] Human approved the deployment-only bootstrap POST as the sole
    D-14/SEC-04 browser-CSRF/Origin exception, relying only on the
    constant-time-compared deployment secret and ignoring browser cookies and
    identity. The human approved the safe HTTP mapping and precedence on
    19 October 2026; it is recorded in `../../../spec/api.md` before Increment 9.
  - [x] Human selected `npm run db:verify-first-admin` as the exact operator
    command used to verify that exactly one Admin exists before bootstrap
    variables are removed.
- [x] **Gate B -- ownership/scope for the full AT-01 guessed-report-ID case is
  approved.** Report APIs do not yet exist, and the broader two-user/two-role
  guessed-ID matrix is assigned later in the plan (`../../PLAN.md` near the
  system access-matrix task). S-04 can prove its admin-stub boundary, but it
  cannot fabricate a Report API. Record the later task that will provide this
  AT-01 evidence.
  - [x] U-03 implements
    reporter-only report reads and the recorded guessed-ID `404`; R-02 executes
    the full two-user/two-role matrix and closes system-level AT-01 evidence.
  - [x] S-04 may close as a backend Identity implementation with
    this cross-task dependency explicitly outstanding; AT-01 itself must remain
    partial until U-03 and R-02 pass.
- [x] **Gate C -- defer public auth pages to the immediate task after S-04.**
  The human explicitly deferred sign-in/registration pages and post-login role
  routing. This removes them from S-04 implementation scope but not from FR-01
  or final acceptance: the follow-up task must be recorded and completed before
  FR-01/AT-01 or the product is declared complete.

No application-code increment may begin until the human approves this plan and
the gate relevant to that increment. Specification changes precede code.

## Implementation checklist

- [x] **Increment 1 -- implement the K3 acting-USER shared lock contract.**
  - Add the approved `ActingAccountLocks.lockActiveUserShared(tx, accountId)`
    provider in Identity, using the caller's transaction, Account `FOR SHARE`
    at global lock position 1, and rejecting missing, suspended, or ADMIN
    accounts as `forbidden`.
  - Keep guards outside transactions; do not duplicate account-status logic in
    consumer modules.
  - Red test: PostgreSQL integration cases for active USER success; missing,
    suspended and ADMIN denial; and a competing status write demonstrating the
    shared-lock/lock-order contract.
  - Focused validation: the new K3 integration/unit tests, existing identity
    authorization tests, full unit suite, integration suite, type-check and
    lint.

- [x] **Increment 2 -- expose a type-safe K4 account-status provider.**
  - Construct and export `AccountStatusService` from `../../../src/server/composition.ts`
    with the Identity account and session repositories so consumers do not
    construct repository dependencies themselves.
  - Strengthen `account-status.ts` so the repository's required `role` cannot
    be recast as optional; missing/invalid role data must not be accepted as a
    USER target.
  - Red tests: composition contract exposes K4 only when dependencies are
    available; ADMIN/malformed targets are denied; suspension atomically
    changes status and revokes sessions; reinstatement advances the strike
    cycle without restoring sessions.
  - Focused validation: account-status unit and PostgreSQL atomicity tests,
    composition/configuration tests, full unit and integration suites,
    type-check and lint.

- [x] **Increment 3 -- conform client-IP derivation to D-44.**
  - Replace `clientIp(request, appEnv)` with the two recorded named helpers:
    hosted `clientIpFromVercelHeaders` and local/test `placeholderClientIp`.
    Select/inject the helper in the composition root; do not pass a control
    mode flag per request.
  - Red tests: trim `x-real-ip`; map absent/empty values to `unknown`; local and
    test always use `unknown`; development/production use the hosted helper;
    ignore `x-forwarded-for` and all other spoofable headers.
  - Focused validation: helper, composition and login-route tests, full unit
    suite, type-check and lint.

- [x] **Increment 4 -- close registration and normalization acceptance gaps.**
  - Add route/service/database evidence that supplied `status` and `role` each
    return `422 validation_failed` with no account created.
  - Prove two addresses that normalize to one account return a safe 409 through
    the real route and database, without leaking the original address or raw
    database/provider errors.
  - Expand D-50 boundary coverage for ASCII trimming, NFC local parts,
    case-folding, IDNA2008/Punycode domains, controls/internal whitespace,
    malformed domains, and 12--128 password boundaries without truncation.
  - Red tests must fail for the specific missing route/database behavior before
    any production edit; if production already passes, keep the acceptance
    tests and record that no production change was required.
  - Focused validation: registration/account-service tests, real PostgreSQL API
    journey, full unit and integration suites, type-check and lint.

- [x] **Increment 5 -- prove SEC-06 through the real HTTP/database boundary.**
  - Add database-backed API tests for five failures followed by 429 and correct
    `Retry-After`; normalized-email counter sharing; per-IP isolation;
    `x-forwarded-for` spoof resistance; and fail-closed 503 on limiter failure.
  - Prove unknown email, invalid password, and correct-password suspended
    account return the same generic response and each consume both counters.
    Prove pre-throttled requests neither verify passwords nor increment, and
    successful active login consumes nothing.
  - Prove counters expire naturally, survive suspension/reinstatement, and
    suspended accounts never receive a session.
  - Focused validation: auth-service tests, rate-limiter integration tests,
    HTTP auth journey, full unit and integration suites, type-check and lint.

- [x] **Increment 6 -- complete strict CSRF wire and route-boundary evidence.**
  - Enforce D-14's URL-safe unpadded Base64 grammar for nonce and signature in
    addition to signature verification; retain constant-time comparison and
    exact Origin matching.
  - Add route-level rejection cases for missing, expired, malformed,
    wrong-session and wrong-signature tokens; expired/malformed pre-session;
    and wrong/missing Origin. Every case returns the uniform safe 403
    `csrf_failed` contract.
  - Prove hosted cookie attributes and the 30-minute pre-session lifetime;
    login clears the pre-session binding; logout, expiry, suspension and
    revocation invalidate session-bound CSRF use.
  - Focused validation: CSRF service and auth-route tests, PostgreSQL auth
    journey/session tests, full unit and integration suites, type-check and
    lint.

- [x] **Increment 7 -- make authorization denial prove no mutation.**
  - Replace or extend the Admin endpoint test stub so an active USER receives
    403 and an observable mutation counter/table remains unchanged. Cover
    unauthenticated, suspended USER, wrong-role and active ADMIN outcomes.
  - Add the S-04 portion of the two-user/two-role access matrix without
    inventing unavailable Report endpoints. Link the deferred guessed-report-ID
    row to the human-approved owner from Gate B.
  - Prove guards re-read account status on every request and do not use stale
    role/status caches.
  - Focused validation: authorization unit tests and PostgreSQL admin-consumer
    integration tests, full unit and integration suites, type-check and lint.

- [ ] **Deferred follow-up after S-04 -- add public auth pages and role-based routing.**
  - After Gate C, add public sign-in and registration pages within the existing
    UI conventions. Use the HTTP API from Client Components; do not access the
    database or server-only services from UI code.
  - On successful authentication, route active USER accounts to `/app` and
    active ADMIN accounts to `/admin`; surface safe validation/authentication
    errors and support sign-out/current-session behavior without exposing
    secrets or session tokens.
  - Before editing, read the applicable local Next.js guide under
    `../../../node_modules/next/dist/docs` as required by `../../../AGENTS.md`.
  - Red E2E tests: registration-to-USER workspace; USER sign-in; ADMIN sign-in;
    validation error/focus behavior; generic failed login; logout and protected
    route denial afterward. Include keyboard and responsive manual checks.
  - Focused validation: UI component tests if present, auth API tests, focused
    Playwright journey, full unit suite, production build, type-check and lint.

- [x] **Increment 8 -- add the operator-only first-Admin verifier.**
  - Add `npm run db:verify-first-admin`, backed by a server-only script that
    reads `MIGRATION_DATABASE_URL` and `DATABASE_CA_CERT`, uses CA-verified TLS,
    performs only a bounded read-only Admin count, prints only
    `admin_count=<n>`, and exits zero exactly when the count is one.
  - It must never accept credentials in command arguments or print connection
    details, account rows, email addresses, raw driver errors or secret values.
  - Red/green tests cover zero, one and multiple Admins; missing/invalid
    configuration; connection/query failure sanitization; read-only SQL; and
    deterministic exit status/output.
  - Align the D-51 operator procedure and release evidence checklist with the
    exact command. Do not claim live production evidence.
  - Focused validation: verifier unit tests, full unit suite, type-check, lint,
    and `git diff --check`. PostgreSQL integration is required before release
    but may be recorded unavailable if no loopback test database is accessible.

- [x] **Increment 9 -- reconcile and harden the first-Admin bootstrap.**
  - Only after Gate A, align specifications first and then the existing durable
    singleton storage, repository privileges and migration strategy with the
    approved data-model contract. Never modify a shipped migration.
  - Replace readiness's literal `"admin bootstrap required"` control-flow
    string with a typed sentinel/result while preserving the public readiness
    body.
  - Red integration/API tests: exactly one Admin under concurrent invocation;
    secret rejection; idempotent success; rollback of account/bootstrap/audit
    together; no credential/secret output or logs; missing values with no Admin
    keep readiness unavailable; build/module initialization/ordinary startup
    never invoke bootstrap.
  - Focused validation: bootstrap/readiness unit and PostgreSQL tests, build,
    full unit and integration suites, type-check and lint.
  - The human confirmed the untracked singleton migration was never applied
    externally and explicitly authorized deletion after all code/test reliance
    is removed. Do not delete it earlier. The completed increment must have no
    `admin_bootstrap`, `lockBootstrap` or `completeBootstrap` reference outside
    historical `_temp/`/`../../../logs` artifacts.

- [x] **Increment 10 -- complete security, deployment and release evidence.**
  - Prove plaintext passwords, session tokens, bootstrap secrets, normalized
    emails and raw client IPs are absent from persistence where forbidden,
    logs, responses and client assets. Confirm HMAC rate-limit keys change when
    the configured secret changes.
  - Run the production build and secret scan; inspect built client assets for
    server-only variables. Record failures honestly if the execution
    environment cannot run build workers.
  - Run all S-04 unit, PostgreSQL integration, API integration and E2E tests.
    Record commands, source revision, environment, pass/fail and evidence paths.
  - Update S-04 traceability so every in-scope acceptance row points to a test
    and result. Mark the Gate-B guessed-report-ID case as externally pending
    until its owning Report task supplies evidence.
  - This increment cannot claim live Preview/Production separation, controlled
    Vercel bootstrap invocation/removal, deployed health, or secret-variable
    configuration without operator evidence. Record these under the external
    verification checklist below.
  - Final validation: `npm run test:unit`, configured
    `npm run test:integration`, `npm run build`, configured
    `npm run test:e2e`, `npm run lint`, `npx tsc --noEmit`,
    `npm run check:secrets`, and `git diff --check`.

## External and cross-task verification checklist

These findings must remain visible but cannot be truthfully completed by an
implementation agent using only the local repository.

- [ ] A controlled operator verifies separate Preview and Production values
  and confirms neither environment can access the other's storage.
- [ ] A controlled operator invokes the dedicated bootstrap function on
  Vercel, records idempotent success without secret exposure, removes all
  bootstrap variables, and verifies readiness afterward.
- [ ] Release evidence confirms server-only variables are sensitive Vercel
  values; `TEST_DATABASE_URL` and `MIGRATION_DATABASE_URL` are absent from
  application runtime configuration.
- [ ] The later Report/access-matrix task supplies AT-01 guessed-report-ID
  isolation and the full two-user/two-role matrix.
- [ ] The final release environment runs build/E2E/secret checks if local
  sandbox restrictions prevent them during an increment.

## Per-increment iterative-TDD gates

For every approved increment, the implementation agent must:

1. Capture the complete current working tree in an external temporary Git
   snapshot, excluding only the real `.git/`, before application edits.
2. Add/select the smallest behavioral test and record the expected red result.
   Stop if it passes initially or fails for an unrelated reason.
3. Make only the minimum in-scope production change, run focused green tests,
   and refactor only when useful.
4. Run all applicable repository checks and record skipped/unavailable checks
   as such.
5. Generate `_temp/visual-diff.html` from the iteration baseline using the
   `present-changes-visually` skill.
6. Complete the iteration evidence manifest and require both output correctness
   and process compliance to pass the iterative-TDD grader before checking off
   the increment.
7. Prepare, but do not create, a scoped Conventional Commit unless the human
   separately authorizes that exact commit.
8. Update the single human-verified session summary under `../../../logs` when files
   outside `_temp/` change, without secrets.
9. Hand off rationale, tradeoffs, changed files, generated artifacts,
   dependencies, disclosure file, tests/results, unverified items and the next
   increment; then stop for human approval.

## Known constraints

- The prior review passed 27 unit-test files / 391 tests, lint, type-check and
  `git diff --check`; these do not close the missing acceptance evidence above.
- Integration tests were not run because `TEST_DATABASE_URL` was unset.
- A production build attempt was inconclusive because the review environment
  could not bind the build worker's local port.
- No dependency addition is currently justified. Any proposed dependency is a
  new decision and requires human approval and a pinned lockfile update.
- `_temp/` artifacts are ignored and must not be committed.
