# S-04 D-51 bootstrap invocation decision

## Decision

The first-Admin bootstrap is a dedicated Vercel server function invoked with a
separate deployment-only `ADMIN_BOOTSTRAP_SECRET`. It uses the sensitive
`ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` values server-side.

## Recorded constraints

- It is never run by `next build`, module initialization, or ordinary function
  startup.
- It is inaccessible to normal browser Users and Admin sessions.
- It creates one Admin only when none exists, uses one Identity transaction,
  records an audit event without credentials or secrets, serializes concurrent
  invocations durably, and is idempotent after success.
- All three bootstrap variables are removed after successful provisioning.
- The exact Vercel function route and request transport remain implementation
  details within this approved boundary; they must not expose credentials or
  the deployment-only secret in logs or responses.

## Files updated

- `spec/governance.md` D-51
- `spec/deployment.md` DEP-04 and environment-variable contract
- `workflow/PLAN.md` S-04 description and acceptance criteria
- `.env.example`

No real secret was recorded and no tests were run because this was a
specification/configuration decision only.
