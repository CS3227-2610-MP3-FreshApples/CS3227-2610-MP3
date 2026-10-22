# S-04 Gate A — architect review of table-free Account-lock bootstrap

Status: **Approve with required changes; not implementation-ready.**

Source: revision `efe6d288d458ab88eecb2ab41d706881e1e08901` plus
the current working-tree specification changes.

## Approved architectural core

- `LOCK TABLE app.account IN SHARE ROW EXCLUSIVE MODE` under PostgreSQL
  `READ COMMITTED` is self-exclusive, serializes bootstrap transactions across
  server instances, conflicts with the `ROW EXCLUSIVE` lock used by Account
  writes, and remains compatible with ordinary `ACCESS SHARE` reads.
- Taking the table lock before the Admin-existence query ensures a waiting
  transaction sees the preceding transaction's committed Admin.
- `Account table -> Account query/insert -> AuditEntry` complies with D-20 and
  introduces no lock cycle as long as no transaction locks AuditEntry or
  another later table before attempting an Account write.
- Public USER registration and secret-gated first-Admin bootstrap must remain
  separate named operations. They may share private normalization, password
  policy/hashing, duplicate-email mapping and insertion primitives; no public
  role selector or behavioral mode flag is permitted.
- Admin existence is a valid durable idempotency marker under the current
  no-hard-account-deletion posture. A conflicting USER email remains USER,
  creates no audit entry, and fails safely. Audit failure rolls back Admin
  creation.
- Validation and Argon2 hashing must finish before the table lock is acquired
  so bootstrap does not unnecessarily extend the Account-write pause.

## Blocking specification conflicts

1. **Readiness:** D-51 makes Admin existence/bootstrap availability affect
   readiness, while D-38, D-39 and the API health contract currently permit
   only core-configuration and database-probe readiness inputs. A human must
   approve the complete state matrix, especially `no Admin + valid bootstrap
   configuration`, then align governance, API, security, verification and
   workflow contracts.
2. **CSRF/Origin:** D-14 and SEC-04 apply CSRF plus exact Origin to every unsafe
   method, while the operator procedure describes a deployment-secret-only
   POST. A human must either approve an explicit deployment-only exception
   whose sole authority is the constant-time-compared bootstrap secret and
   which ignores browser cookies, or require the operator request to satisfy
   the normal CSRF/Origin flow. Missing/wrong secret, disabled, conflict and
   success responses must be recorded.
3. **Migration disposition:** repository evidence shows the singleton-table
   migration is untracked, but a human must confirm whether it was applied to
   any persistent database. If never applied, deletion still requires explicit
   permission. If applied, preserve it and add a new migration that removes
   the table and grants.
4. **Operator verification:** deployment permits an unspecified Admin-only view
   or database release check. A human must name the executable verification
   command/API and credential boundary.
5. **Workflow contract:** `../../contracts.md` must gain the D-51 provider
   contract, typed outcomes and Account table-lock sequence, and remove any
   bootstrap-state methods during the approved implementation/spec-alignment
   increment.

## Required acceptance tests

- Use at least two independent database pools/connections plus a barrier to
  prove cross-instance serialization; a single one-connection pool with
  `Promise.all` is insufficient.
- Concurrent bootstraps create exactly one Admin and one
  `account.admin_provisioned` audit; waiters return already provisioned and see
  the committed Admin.
- While the bootstrap lock is held, plain Account SELECT succeeds and Account
  registration/status/Admin writes wait, then continue after commit without a
  deadlock.
- Concurrent bootstrap and an audited account-status change preserve
  Account-before-Audit order and complete without `40P01`.
- Existing Admin is a no-op. An existing USER with the same normalized email is
  not promoted and causes no audit or other mutation.
- Audit failure rolls back Admin creation and a later bootstrap can succeed.
- Registration rejects role/status injection and always stores active USER;
  bootstrap and registration share normalization, password and duplicate-email
  behavior.
- Missing, incorrect, disabled and removed bootstrap secrets never invoke the
  service or leak configuration; cookies provide no bootstrap authority.
- Responses, audit metadata, logs, assets and release evidence contain no
  secret, password, raw credential or unredacted environment listing.
- The approved readiness matrix is tested before and after variable removal.
- Schema-object, privilege and constraint tests prove `app.admin_bootstrap` is
  absent, and a fresh PostgreSQL 17 database accepts every retained migration.
- A later approved Admin-creation operation can create another Admin while
  first-Admin bootstrap remains a no-op.

## Remaining human decisions

- Readiness state matrix.
- Bootstrap POST CSRF/Origin policy and API responses.
- External application status and deletion disposition of the untracked
  singleton-table migration.
- Exact operator verification mechanism.

No files were changed by the architect. No automated tests were run for the
read-only review.
