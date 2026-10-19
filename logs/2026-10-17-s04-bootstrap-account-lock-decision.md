# S-04 bootstrap Account-lock decision

## Session metadata

- Date and timezone: 17 October 2026, Asia/Singapore
- Task: Record the human-approved table-free first-Admin bootstrap design and
  obtain independent architect review.
- Branch: `feat/identity-sessions`
- Starting revision: `efe6d288d458ab88eecb2ab41d706881e1e08901`
- Participating roles: primary agent, analyst, architect
- Verification status: awaiting human verification

## Goal and approved scope

The human approved replacing the proposed `app.admin_bootstrap` singleton with
serialization on the existing durable Account table. Public registration and
first-Admin bootstrap remain separate named Identity operations and reuse
private normalization, password-policy, hashing, duplicate-email and Account
insertion primitives. Public registration always creates USER. Bootstrap takes
`SHARE ROW EXCLUSIVE` on `app.account`, checks Admin existence, creates and
audits one active Admin only when absent, and uses Admin existence as its
idempotency marker.

Scope is specification and planning artifacts only. Application code,
migrations and tests are excluded until architect review and the approved
iterative-TDD implementation increment.

## Sources and interaction summary

- The reviewer/tester and code-quality reviews identified the missing
  bootstrap data-model contract and a D-20 lock-order conflict.
- The analyst proposed a singleton state contract but correctly left the
  lock-order choice to architect/human review.
- The human selected the table-free Account-lock alternative and instructed
  that it be recorded before architect review.
- Consulted D-20, D-22 and D-51; the data-model lock order; deployment bootstrap
  procedure; database isolation/locking rules; architecture ownership rules;
  and the current registration/bootstrap services and repository.

## Changed files and rationale

- `spec/governance.md`: records the approved D-51 flow, shared private logic,
  Account table lock, idempotency source and absence of bootstrap state.
- `spec/data-model.md`: records the sole initial-release Account table-lock
  case and its place in the global lock order.
- `spec/deployment.md`: aligns the operator bootstrap description.
- `spec/tech-stack.md`: records the table-lock exception to ordinary row locks.
- `spec/architecture.md`: aligns Identity ownership and separate named flows.
- `_temp/s04-review-remediation-plan.md`: marks human decision/spec recording
  complete and architect/external-migration confirmation pending.
- `_temp/s04-bootstrap-storage-spec-proposal.md`: marks the earlier singleton
  proposal superseded without deleting its reasoning.
- This disclosure log.

Later in the same session, the human approved the deterministic operator
verification mechanism. `scripts/verify-first-admin.mjs`, its focused unit
test and the `db:verify-first-admin` package command were added; deployment and
release guidance now name that exact command. The human also deferred public
auth pages to the immediate task after S-04, while retaining FR-01/AT-01 as
incomplete until that follow-up passes.

### Operator-verifier iteration evidence

| Check | Result |
| --- | --- |
| Focused verifier test | PASS — 1 file, 9 tests |
| `npm run test:unit` | PASS — 28 files, 400 tests |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `git diff --check` | PASS |
| PostgreSQL integration | UNAVAILABLE — `TEST_DATABASE_URL` is unset; no live database result claimed |
| Iterative-TDD semantic grade | PASS — correctness and process |
| Iterative-TDD deterministic grade | PASS — correctness and process |

The iteration-scoped visual diff is `_temp/visual-diff.html`. No dependency or
lockfile change was required. No real Git commit, push, PR, deployment or live
operator action was performed. The untracked singleton migration remains
present because current bootstrap code and tests still depend on it; the human
authorized deletion only after the approved table-free refactor removes every
such dependency.

The human subsequently approved the Gate-B responsibility split and closure
rule. U-03 owns reporter-only report reads and guessed-report-ID `404`
isolation; R-02 owns the complete two-user/two-role matrix and final AT-01
evidence. S-04 may close its backend Identity scope with this dependency
recorded, while AT-01 remains partial until U-03 and R-02 pass.

The decision and verifier work added no dependency, migration, secret,
credential or production data.

### K3 acting-User shared-lock increment

After the human approved the remaining iterative-TDD work, an implementation
agent completed only Increment 1. Identity now exposes
`ActingAccountLocks.lockActiveUserShared(tx, accountId)`. Its repository query
uses the caller's transaction, takes the Account row `FOR SHARE` at global lock
position 1, and returns a lock only for an active USER. Missing, suspended and
ADMIN accounts receive the same `forbidden` domain result.

The focused PostgreSQL test first failed because the K3 provider did not exist,
then passed 5 tests after implementation. It also demonstrates that the shared
lock blocks a competing Account status write until the caller's transaction
ends. Full integration passed 13 files/301 tests; full unit passed 28 files/400
tests; type-check, lint and `git diff --check` passed. No dependency or
migration changed, and the bootstrap-table migration was not touched. The
iteration evidence is `_temp/s04-k3-increment-1-evidence.json`; its visual diff
is `_temp/visual-diff.html`. No commit, push or PR was authorized or performed.

### K4 account-status composition increment

After the human approved the next iteration, an implementation agent completed
only Increment 2. The composition root now exports the Identity-owned K4
`AccountStatusService` whenever its database-backed Account and Session
repositories are available, and exports `null` when core database dependencies
are invalid. The account-lock narrowing boundary now requires role data in its
repository contract and default-denies every runtime role value except `USER`;
missing, invalid and `ADMIN` roles cannot become status-change targets.

The focused unit test first failed for the intended missing/invalid-role flaw,
then passed 12 tests after implementation. Focused PostgreSQL validation passed
2 files/6 tests, including composition availability, atomic suspension with
session revocation, rollback, serialization, and reinstatement advancing the
strike cycle without restoring sessions. Full integration passed 14 files/304
tests; full unit passed 28 files/403 tests; type-check, lint and
`git diff --check` passed. The disposable loopback PostgreSQL container was
used only for synthetic tests. No dependency or migration changed, and the
bootstrap-table migration was not touched. Evidence is in
`_temp/s04-k4-increment-2-evidence.json`; the iteration visual diff is
`_temp/visual-diff.html`. No commit, push or PR was authorized or performed.

### D-44 client-IP continuation approval

After the Increment 2 handoff, the human explicitly approved proceeding with
the next iteration on 18 October 2026. Increment 3 is limited to the recorded
D-44 client-IP resolver contract: two named server-only functions, selected
once in the composition root and injected into the login route without a
per-request environment flag. No commit, push or PR was authorized.

Increment 3 completed that contract. `clientIpFromVercelHeaders` trims only
`x-real-ip` and returns `unknown` when it is missing or empty;
`placeholderClientIp` always returns `unknown`. The composition root selects
the placeholder for local/test and the hosted resolver for
development/production, and the login route receives the selected function
without a per-request environment control flag. Focused unit validation passed
2 files/18 tests, the database-backed authentication journey passed 1 file/1
test, full unit passed 29 files/411 tests, and full PostgreSQL integration
passed 14 files/304 tests. Type-check, lint, `git diff --check`, semantic grade
and deterministic grade all passed. Initial database attempts failed before
the disposable PostgreSQL network was aligned and are not claimed as test
passes. Evidence is `_temp/s04-client-ip-increment-3-evidence.json`; the
iteration visual diff is `_temp/visual-diff.html`. No dependency, migration,
commit, push or PR changed, and Increment 4 was not started.

### Registration and normalization continuation approval

After the Increment 3 handoff, the human explicitly approved the next
iteration on 20 October 2026. Increment 4 is limited to registration and D-50
normalization acceptance gaps; no commit, push or PR was authorized.

The real registration route/PostgreSQL test first failed because
`person@example_com` was accepted and persisted with HTTP 201. Identity now
rejects domain labels containing characters outside the ASCII letter, digit
and hyphen syntax after IDNA conversion. Acceptance coverage also exercises
separate `role` and `status` injections with no Account write, safe conflict
handling for two source addresses that normalize to one identity, stored
USER/active state, ASCII-only outer trimming, NFC and lowercase local parts,
IDNA/Punycode domains, controls, internal whitespace, malformed domains and
the exact 12/128-character password limits without truncation.

Focused validation passed 1 unit file/4 tests and 2 PostgreSQL files/5 tests.
Full unit validation passed 29 files/411 tests; full PostgreSQL integration
passed 15 files/308 tests; type-check, lint and `git diff --check` passed. The
disposable loopback PostgreSQL container held synthetic test data only. The
initial test attempts that could not reach PostgreSQL are not claimed as red
or validation evidence. No dependency or migration changed, and the
bootstrap-table migration was not touched. Increment evidence and grading are
in `_temp/s04-registration-increment-4-*.json`; the visual diff is
`_temp/visual-diff.html`.

## Verification and open gates

- Documentation consistency/diff checks: pending after edits.
- Architect review: **approve with required changes; not implementation-ready**.
  The Account table lock, cross-instance serialization, lock order and named
  service boundaries were approved. Blocking conflicts remain in readiness and
  CSRF/Origin contracts; migration disposition and the executable operator
  verification mechanism also require human decisions. Full findings and
  acceptance tests are preserved in
  `_temp/s04-bootstrap-account-lock-architect-review.md`.
- The human resolved that readiness is unavailable whenever no Admin exists,
  even with valid bootstrap configuration. D-38, D-39, API health, SEC-04,
  AT-26 and workflow artifacts were aligned.
- The human approved the bootstrap POST as the sole initial-release browser
  CSRF/Origin exception. It ignores browser cookies/identity and relies only on
  the constant-time-compared deployment secret.
- The human confirmed the untracked singleton-table migration was never
  applied externally. This does not by itself authorize file deletion.
- The human approved the bootstrap HTTP mapping and precedence on 19 October
  2026: availability/configuration/dependency failures return 503; missing or
  incorrect secret while enabled returns 403; normalized-email conflict
  returns 409; created and already-provisioned outcomes both return 200 with
  distinct minimal status bodies. Availability is checked before the secret.
  The human also approved deletion of the untracked migration after the
  table-free refactor removes every code dependency, and approved
  `npm run db:verify-first-admin` as the executable operator verification
  mechanism.
- Implementation remains gated by the approved iterative-TDD plan.

### Increment 9 bootstrap reconciliation

After the Increment 7 handoff, the human approved continuation and the
recommended bootstrap HTTP mapping and precedence. Increment 8 was already
complete, so the implementation agent performed only approved Increment 9.

The first-Admin Identity operation now takes `SHARE ROW EXCLUSIVE` on
`app.account` before checking Admin existence. Admin existence is the only
durable idempotency marker: a present Admin returns the typed
`already_provisioned` result without Account or AuditEntry writes; otherwise
the operation inserts one active Admin and its `account.admin_provisioned`
audit entry in the same transaction. Normalized-email conflict returns the
safe conflict result and never promotes an existing USER. Dependency and audit
failures are converted to the safe unavailable boundary. Readiness now uses a
typed internal sentinel instead of matching an exception message and remains
unavailable whenever no Admin exists, regardless of bootstrap configuration.

The deployment-only route checks configuration/service availability before a
constant-time comparison of the header secret. Missing/wrong secrets are 403
without invoking Identity; disabled/invalid configuration and dependency
failure are 503; normalized-email conflict is 409; created and idempotent
success are distinct minimal 200 bodies. Browser identity, cookies, CSRF,
Origin and inbound request IDs confer no bootstrap authority. Tests cover
secret non-disclosure, initialization non-invocation and the recorded mapping.

After a read-only dependency scan found no remaining live
`app.admin_bootstrap`, `lockBootstrap` or `completeBootstrap` dependency, the
human-authorized, untracked and never-applied
`src/server/db/migrations/1792200000000_first-admin-bootstrap.sql` file was
deleted. Fresh-schema object, constraint and privilege tests now confirm no
bootstrap table exists. The deletion is recoverable only from the Increment 9
external baseline until that temporary snapshot is cleaned up; it was not a
shipped migration or Git-tracked file.

Focused unit validation passed 3 files/15 tests. Focused PostgreSQL bootstrap,
readiness, schema and privilege validation passed 5 files/146 tests. Full unit
validation passed 29 files/420 tests; full PostgreSQL integration passed 17
files/320 tests; type-check, lint and `git diff --check` passed. The default
Turbopack `npm run build` remained blocked by the existing managed-environment
worker-port `EPERM`, including an approved external retry. The production
webpack fallback `npm run build -- --webpack` passed, generated all routes and
showed `/api/v1/internal/bootstrap/admin` as dynamic. No dependency, commit,
push or PR was added. Increment evidence and its baseline-scoped visual diff
are under `_temp/`.

## Human verification

- [ ] Summary matches the approved decision and actual changes.
- [ ] No sensitive values or production data are present.
- [ ] Architect findings and verification results are appended accurately.

Reviewer:
Verification date:
