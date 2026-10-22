# Developer Guide

This guide will document the FreshApples architecture, development workflow, setup, and acknowledgements as implementation progresses.

## Release setup and operator runbook (B#11 / R-04)

Application code runs on Vercel; PostgreSQL runs on Supabase. GitHub Pages hosts only the product information site. The configuration contract is [spec/deployment.md](../spec/deployment.md). No hosted setup, backup upload, production migration or deployment is performed by this runbook's implementation. Record actual release evidence before declaring R-04 complete.

### Manual Vercel configuration

1. Use separate Preview/development and Production/Supabase projects and credentials. Set the Vercel production branch to `master`; retain required GitHub checks and human PR review. Verify the existing Hobby eligibility decision still applies to the actual repository and deployment owner.
2. Add variables from `.env.example` to the appropriate Vercel environment. `PUBLIC_APP_URL` is the exact browser origin, for example `https://your-app.vercel.app`, without trailing slash, path, query or fragment. It is server configuration despite its name; do not rename it to `NEXT_PUBLIC_APP_URL`. A mismatched origin causes CSRF failures. For Preview, use one stable trusted branch domain with its matching origin; arbitrary preview URLs do not automatically match it.
3. Set `APP_ENV=production` in Production and `development` in Preview. Set `DATABASE_URL` to the environment's least-privilege transaction-pooler connection (usually port 6543) and `DATABASE_CA_CERT` to the full project PEM CA. Remove `sslmode`/other `ssl*` URL parameters; the driver configures CA-verified TLS explicitly.
4. Set independent high-entropy `SESSION_SECRET`, `RATE_LIMIT_KEY_SECRET` and `CRON_SECRET` (at least 32 characters), distinct across environments; session and rate-limit secrets must differ. Retain the `.env.example` session TTL and moderation threshold unless the recorded policy changes. Do not add migration, backup or restore credentials to Vercel runtime.
5. Start with `AI_ENABLED=false`. For live AI, set `AI_PROVIDER=soc_llm`, `SOC_LLM_BASE_URL`, API key, model, verified prices and all required AI limits from `.env.example`/the deployment contract. Production must never use `fake`. Verify the current model and prices before enabling AI; development/production quotas must fit the shared allocation. The recorded partitions are 30/60 RPM and 26,666,666/53,333,333 microdollars daily respectively. Keep the initial one-item sweeps and bounded timeouts.
6. Enable Fluid compute and verify the deployed AI cron and review mutation Functions show a 120-second maximum duration. The existing Route Handler exports control this setting; no `MAX_DURATION` environment variable is required.
7. After environment changes, build a fresh deployment in that environment. Environment removal alone does not remove values already captured by an existing deployment. Never promote a Preview build containing development configuration to Production.

The committed `vercel.json` registers summaries at `0 0 * * *` UTC (about 08:00 SGT) and review moderation at `0 1 * * *` UTC (about 09:00 SGT). Verify both under the Production project's Cron Jobs after release. Vercel calls these GET routes on Production and supplies `Authorization: Bearer <CRON_SECRET>` when that variable is configured. Hobby timing can vary within the scheduled hour. Preview tests require manual requests with development secrets. See [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [cron quickstart](https://vercel.com/docs/cron-jobs/quickstart) and [Fluid compute](https://vercel.com/docs/fluid-compute) (checked 22 October 2026).

### Manual Supabase configuration and first Admin

Create separate development and production projects. Download each project's CA certificate and copy its direct/session connection for operator use and transaction-pooler connection for runtime. Create `app_runtime` as described below before applying migrations. Keep schema `app` unexposed to Supabase Data APIs; do not enable it as an exposed schema without the specified deny-by-default RLS and tests. No Supabase Auth setup, publishable key or service-role API key is needed.

Load operator secrets from an interactive prompt or private secret manager into process environment, never command arguments or shell history. Node operator scripts do not automatically load `.env.local`. `MIGRATION_DATABASE_URL` uses a privileged direct or session connection, with `DATABASE_CA_CERT` from the same project. TLS may be omitted only for local/test loopback databases. Run migrations before merging code that needs them, maintaining compatibility with the currently deployed version.

For the first Admin, temporarily configure `ADMIN_BOOTSTRAP_SECRET`, `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` in the intended environment, deploy, and invoke `POST /api/v1/internal/bootstrap/admin` with `x-admin-bootstrap-secret` from a private operator session. Never print or save those values as evidence. Then verify `/api/v1/health/ready` is 200 and run `npm run db:verify-first-admin` with the operator connection. It must exit zero with `admin_count=1`. Remove all three bootstrap variables, deploy again, and verify readiness remains 200 and the bootstrap endpoint rejects invocation. Follow the full D-83 procedure in `spec/deployment.md`; do not proceed after a failed verification.

Tester identities/access remain a human assignment under OQ-06. Do not distribute the production Admin credentials as tester access.

### Encrypted backups and guarded migrations

Install PostgreSQL client tools compatible with the source server (`pg_dump`, `pg_restore`, `psql`) on the operator machine and put them on `PATH`. Use PostgreSQL 17 for the prescribed local rehearsal. The database application archive includes schema `app`, data, migration bookkeeping and grants; it excludes cluster login roles, Supabase-managed schemas, Storage objects, Vercel settings and secrets. Preserve role provisioning and environment configuration separately in private operator records.

The CI integration job installs PostgreSQL 17 clients from PostgreSQL's signed apt repository so archive tests use tools compatible with its PostgreSQL 17 service. That Ubuntu installation step must be confirmed by the first PR CI run.

Set `BACKUP_ENCRYPTION_PASSPHRASE` to an independent high-entropy value of at least 32 characters, stored separately from backups. Set `BACKUP_OUTPUT_PATH` to a unique absolute path outside the checkout on private storage. Existing output files are refused. With the operator database variables set, run:

```text
npm run db:backup
```

The script streams a PostgreSQL custom archive into authenticated AES-256-GCM encryption using a scrypt-derived key. No plaintext archive is written. Only a zero exit status indicates success. Treat failed/partial outputs as unusable; never feed them to a release or overwrite them. Do not place archives in Git, public CI artifacts, the website or a shared public folder. Windows operators must additionally restrict the destination folder ACL to the authorized backup operators; POSIX mode bits alone do not establish Windows ACL privacy.

For a release with pending migrations, set a fresh backup path and run the guarded command:

```text
npm run db:release
```

This takes a backup first and calls the existing migration runner only after a successful export. `npm run db:migrate` remains the low-level operator command for already backed-up release steps and test setup. Never run it as a Vercel build/start hook. Do not record raw migration errors or connection strings as release evidence.

The deployment owner must select private off-site storage, verify its allowance/access controls, copy each successful encrypted export there, and configure an authenticated daily operator scheduler plus alerts for missed/failed exports. Keep the passphrase in a separate recovery location. Verify an uploaded export can be downloaded and restored before enabling the daily schedule. The Vercel application crons do not perform backups. No storage provider, upload automation, retention guarantee or daily backup operation has been configured by this change. RPO 24 hours and RTO 4 hours are team targets requiring rehearsal evidence; Supabase Free does not guarantee them. See [Supabase backups](https://supabase.com/docs/guides/platform/backups) (checked 22 October 2026).

### Isolated restore and rollback

Use a trusted export, since PostgreSQL archives can contain executable database definitions. Provision a new disposable PostgreSQL 17 database on loopback and the D-31 roles (`app_runtime`, `anon`, `authenticated`) first; do not migrate it or create any user relations. Restrict the operator's temporary directory ACL on Windows. Set `APP_ENV=test`, point `MIGRATION_DATABASE_URL` at that empty database, set `BACKUP_INPUT_PATH` to the encrypted archive and supply the original passphrase. Set `RESTORE_CONFIRM_EMPTY_DATABASE=I_CONFIRM_THIS_DISPOSABLE_DATABASE_IS_EMPTY`, then run:

```text
npm run db:restore
```

The tool authenticates the complete encrypted snapshot before passing any plaintext to `pg_restore`, refuses hosted/nonempty targets, and restores in one transaction with error-stop, preserving grants without restoring original object ownership. It never drops or cleans a schema. Verify migration history in `app.pgmigrations`, expected synthetic counts, constraints, runtime role permissions and app health against the restored database. Record duration and results. Privileged restore success alone does not establish least-privilege runtime health. A restored production export is still private production data: use an isolated operator machine, never development fixtures, prompts or ordinary test suites.

For code rollback, stop the release, select the previous compatible Production deployment in Vercel and smoke-check it with Production configuration. Database changes are not undone by a Vercel rollback. Do not edit shipped migrations or attempt automatic down migrations. If database recovery is required, pause writes, take an incident export, restore the chosen backup in isolation, assess post-backup data loss and have both developers approve a separate hosted recovery/cutover plan. The local restore command deliberately cannot perform that hosted cutover. Recheck runtime privileges, first Admin, readiness and business flows before reopening writes.

### Synthetic local demonstration data

`npm run db:seed` uses the existing authenticated Admin API and CSRF flow, calling the owning composition services. It creates three fictitious Movies in a local/test loopback app; it never inserts database rows directly, bootstraps accounts or uses production credentials. Provision a synthetic Admin first, then supply the seed settings documented in `.env.example` through private process environment. Use a disposable demonstration database; no concurrent-run or atomic rerun guarantee is provided. Shared development peer-tester access is a separate human action.

### Release evidence checklist

Record source revision, environment, UTC time, deployment owner and URL, commands/exit status, checks and redacted evidence path. Both developers review the release record. Required evidence includes successful private off-site export/download/isolated restore, runtime grants and migration history, code rollback rehearsal, fresh environment-scoped builds, health live/ready, first-Admin cleanup, browser User/Admin flows, and cron missing/invalid-secret rejection, authenticated execution, overlap/missed-run handling and backlog monitoring. Review pending/manual-review queues and usage/pause warnings before demonstrations. Never include payloads, account details, secret values or raw provider/driver errors.

## Admin Review API (A-04)

Active Admin sessions can read `/api/v1/admin/reviews` and `/api/v1/admin/reviews/:id`.
The list defaults to all Reviews, including retained hidden/deleted rows, with `page` and `pageSize`,
optional `movieId` and `assessment` filters, and stable `updated_at DESC, id ASC` ordering.
Filter values and projections are recorded in `spec/api.md` under A-04 API detail.
Historical assessments include their content revision; they do not describe newly edited text.

POST `approve`, `hide` or `restore` beneath `/api/v1/admin/reviews/:id` with a JSON `reason`
(10–1,000 trimmed Unicode code points), the quoted current version in `If-Match`, and the normal
session-bound CSRF token and same-origin header. Success returns the visibility/clearance state
and resulting ETag. Repeated transitions return 200 with the same version and an audited `no_op`;
a stale version returns 409 even for an otherwise redundant transition.

Moderation orchestrates K8, work updates and K5 in one transaction. Approval preserves deletion
and hidden state; restore only clears the Admin hidden flag. Pending, undeleted restored Reviews
stay unpublished while their current cancelled work is reactivated with attempt history preserved.
The recovery sweep performs screening later; these Admin routes never invoke the provider or add strikes.
The service works with AI disabled. Archived Movies remain non-public throughout these operations.

## Database roles (operator step)

Migrations never create login roles or set passwords (D-31). Before the first migration runs against a Supabase project, an operator creates the runtime role once in that project:

1. Connect with `psql` to the project's direct connection as the database owner.
2. Create the role with no elevated attributes:

   ```sql
   CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   ```

3. Set its password interactively with `\password app_runtime`. `psql` prompts for the password and sends only a hash. Never put the password in a SQL statement, a shell command, the Supabase SQL editor, the repository or a log.
4. Store the runtime connection string, which uses `app_runtime` through the transaction pooler, as the server-only `DATABASE_URL` in that environment's Vercel settings.

Supabase already provides the `anon` and `authenticated` roles. The initial migration fails and rolls back if `app_runtime`, `anon` or `authenticated` is missing. It revokes all access to schema `app` from `anon`, `authenticated` and `PUBLIC`, and grants `app_runtime` only the table privileges listed in `spec/data-model.md` "Runtime privileges" (D-32). The integration test harness creates the three roles as synthetic `NOLOGIN` roles in its disposable database.
