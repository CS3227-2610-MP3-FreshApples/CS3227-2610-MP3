# Release Information

## Current status

FreshApples is under active development. No production application release has been published yet.

The product website is deployed independently through GitHub Pages. The Next.js application will use a separate free Vercel domain when it is ready for release.

## D-83 first-Admin bootstrap evidence

The following checklist is the deterministic release record for the operator-only Vercel environment-variable removal procedure in `spec/deployment.md` 10.3. It is an evidence template, not proof that the Vercel control plane was executed. A human deployment operator must complete and retain it outside the repository with secrets and environment values redacted.

Record these fields for each Production bootstrap run:

| Check | Required evidence | Pass condition |
| --- | --- | --- |
| Intended deployment | Production deployment URL, source revision, operator and UTC time | URL and revision match the release under verification |
| Bootstrap invocation | HTTP status, redacted response `status`, response request ID | HTTP `200` and `created` or `already_provisioned`; no secret or password recorded |
| Admin invariant | `npm run db:verify-first-admin`, source revision, environment name, UTC time, exit status and aggregate `admin_count`; never credentials or account rows | Exit `0` and `admin_count=1` |
| Readiness before removal | Readiness HTTP status and request ID | HTTP `200` with the generic ready response |
| Variable removal | Redacted Vercel environment listing or dashboard/API evidence | `ADMIN_BOOTSTRAP_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, and `ADMIN_BOOTSTRAP_PASSWORD` are absent from Production |
| Post-removal verification | Readiness result and bootstrap endpoint status/request ID | Readiness remains HTTP `200`; bootstrap endpoint is unavailable and does not provision |

The verifier reads `MIGRATION_DATABASE_URL` and `DATABASE_CA_CERT` only from the controlled operator environment, uses a bounded read-only transaction and emits no account or connection data beyond the aggregate count. The application cannot remove Vercel variables and this repository does not claim live platform execution. A failed operator check is a release blocker until the operator restores the intended Vercel state and records a new verification result. Rerunning removal for an already-absent variable is successful only when the final redacted listing confirms absence.
