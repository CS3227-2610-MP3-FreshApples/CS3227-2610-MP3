# S-04 Gate A — AdminBootstrapState specification proposal

Status: **Superseded by the human-approved table-free Account-lock decision
recorded in the authoritative specifications; architect review pending.**

This file preserves the earlier analyst proposal and its reasoning. It is not
the selected design and must not be implemented.

Source revision: `efe6d288d458ab88eecb2ab41d706881e1e08901`
on `feat/identity-sessions`, plus the current working tree.

Traceability: D-20, D-27, D-30--D-33, D-51, DEP-03, DEP-04,
DEP-08, SEC-02, SEC-05, SEC-07 and AT-01. No new requirement ID is
introduced.

## Proposed data-model wording

Add an `AdminBootstrapState` entry to `../../../spec/data-model.md`, mapped to
`app.admin_bootstrap`:

> **Proposed — AdminBootstrapState:** Identity-owned durable singleton state
> used only to serialize D-51 first-Admin provisioning. Physical table:
> `app.admin_bootstrap`.
>
> The table contains exactly:
>
> - `id boolean NOT NULL DEFAULT TRUE`
> - `completed_at timestamptz NULL` with no default
> - primary key on `id`
> - `CHECK (id = TRUE)` named `admin_bootstrap_singleton_check`
>
> The table may initially contain zero rows. The Identity bootstrap repository
> lazily inserts the sole `id = TRUE` row in the bootstrap transaction, using
> conflict-safe insertion, and locks it with `FOR UPDATE`. The primary key and
> check constraint permit at most one row.
>
> `completed_at` is monotonic. It remains null until a bootstrap transaction
> either creates the first Admin or observes that an Admin already exists.
> Completion sets it using `COALESCE(completed_at, now())`, preserving the
> first completion timestamp. It is durable coordination state, not the sole
> source of truth for whether an Admin exists; the transaction must also check
> the Account table.
>
> The same Identity transaction must serialize the invocation, check Admin
> existence, create the Admin when necessary, record
> `account.admin_provisioned` without credentials, and mark bootstrap
> completion. Any failure rolls back the Account, audit entry, bootstrap-row
> insertion and completion update together.
>
> Identity owns all reads and writes. Other modules must not access this table
> directly. The table is not exposed through public APIs, Client Components,
> Supabase Data APIs, browser sessions, or ordinary Admin/User endpoints. The
> dedicated D-51 server function calls the Identity service rather than
> accessing the table.
>
> `app_runtime` receives exactly `SELECT`, `INSERT`, and `UPDATE`. It receives
> no `DELETE`, `TRUNCATE`, `REFERENCES`, or `TRIGGER` privilege.
> Migration/operator credentials create and own the table. `anon`,
> `authenticated`, and `PUBLIC` receive no schema or table privileges.
>
> The table stores no email, normalized email, password, password hash,
> bootstrap secret, session value, account identifier, request payload,
> provider response, or environment-variable value. `completed_at` is
> operational metadata and must not appear in public responses or logs.
>
> The singleton row is retained for the lifetime of the environment, including
> after bootstrap variables are removed. Runtime code must not delete or reset
> it. Environment teardown or an approved database restore is the only
> ordinary removal mechanism.
>
> The migration is additive and backward-compatible with code that does not
> yet call bootstrap. It follows DEP-03/DEP-08: take and record the required
> pre-migration backup, apply through the controlled migration role, and verify
> restoration evidence. The migration has no destructive down operation;
> database rollback uses the documented backup/restore plan. If it has been
> applied anywhere, corrections require a new migration rather than editing
> the applied file.

## Unresolved architecture decision: lock order

The proposal cannot yet be approved because the current implementation and
D-20 conflict:

- D-20 requires `Account -> ... -> other table` lock order.
- The current bootstrap transaction locks `app.admin_bootstrap` first and then
  reads or creates an Account.

The architect must assess the boundaries and threats, and a human must select
and record one of these alternatives:

1. Approve a narrowly bounded lock-position-zero exception:
   `AdminBootstrapState -> Account -> AuditEntry`, usable only by the D-51
   first-Admin Identity transaction.
2. Redesign bootstrap serialization to comply with D-20 without an exception.

The analyst does not select between these alternatives.

## Proposed acceptance examples

- Fresh environment: zero bootstrap rows and zero Admins; one valid invocation
  creates one Admin, one audit entry, and the singleton with non-null
  `completed_at`.
- Three concurrent valid invocations: exactly one returns `created`; the
  others return `already_provisioned`; exactly one Admin and one provisioning
  audit entry exist.
- Existing Admin with absent/incomplete state: invocation creates no Account
  and marks the singleton complete.
- Completed state with different later credentials: no Account or audit entry
  is created, and the original `completed_at` is preserved.
- Audit failure: Account creation, audit write, singleton creation/update, and
  completion all roll back.
- Invalid bootstrap fields: no transaction and no bootstrap row.
- Restart/new server instance: persisted singleton state continues to make
  bootstrap idempotent.
- After environment variables are removed: the row remains; readiness is
  healthy because an Admin exists; the endpoint is unavailable.
- Schema test: exactly the two specified columns, types, nullability, default,
  primary key, and named check; `id = FALSE` is rejected.
- Privilege test: exact `app_runtime` permissions; API roles and `PUBLIC` have
  none; runtime deletion and truncation fail.
- Security test: the table, API response, audit metadata, logs, and built
  client assets contain no bootstrap credentials or secret.
- Release test: migration backup, application, schema/privilege checks,
  rollback plan, and restoration evidence are recorded.

## Assumptions and risks

- `completed_at` records bootstrap completion/observation time, not necessarily
  the original Admin account creation time.
- The table serializes bootstrap callers; it cannot prevent a separate direct
  or future code path from concurrently creating an Admin. All first-Admin
  creation must remain confined to the Identity bootstrap service.
- "Exactly one Admin" is a bootstrap outcome, not a permanent database
  constraint against future approved Admin accounts.
- Repository evidence indicates the migration is untracked, absent from HEAD,
  and no production application release is recorded. A human must still
  confirm it was never manually applied to an external database.
- Durable retention has negligible privacy impact because the table contains
  only a boolean singleton key and timestamp.

## Required next review

An architect must review the proposal and resolve the lock-order alternative.
A human must then approve the chosen contract before the proposal is written
into `../../../spec` or Increment 9 changes bootstrap schema or application code.
