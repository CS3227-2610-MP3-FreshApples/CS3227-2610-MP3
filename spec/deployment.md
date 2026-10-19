# Project Specification — Runtime and Deployment

## 10. Runtime / Deployment Requirements

### 10.1 Environments

Use Next.js App Router/TypeScript for both UI and backend Route Handlers, deployed together on Vercel Hobby. Use PostgreSQL in Supabase Free. There is no separately deployed API server or persistent worker. See [tech-stack.md](tech-stack.md) for the free-tier assessment.

| Environment | Application | Database |
| --- | --- | --- |
| Local/test | Next.js dev server; isolated tests with fake SoC adapter | `postgres:17` container (GitHub Actions service container in CI) or native PostgreSQL 17, freshly migrated per test run with disposable fixtures (D-10); loopback connection without TLS (D-30); test harness creates the synthetic roles (D-31) |
| Shared development | Vercel Preview deployment of trusted development changes | Supabase development project |
| Production | Vercel Production deployment from reviewed master revision | Separate Supabase production project |

Supabase's two free-project allocation is intended for development and production; confirm the account has both slots available (confirmed 11 October 2026, human-verified). Preview and Production credentials must be scoped separately in Vercel. Never reuse production data or credentials in Preview. Do not provision a database branch per preview; use the shared development database with compatible migrations and synthetic data.

If SoC quota is shared, assign fixed development/production sub-budgets whose sums fit the allocation (D-16); no shared cross-environment coordinator is built. Controlled live tests use synthetic data. The SoC endpoint must permit access from Vercel; campus/VPN-only access would require revisiting the runtime placement. Access from Vercel was confirmed on 11 October 2026 by a human-run smoke test.

GitHub Pages remains the separate course-required product website with guides, release information and, after the application is deployed, the live application link. It does not host the Next.js application or its API. The MarkBind source lives in `docs/` and GitHub Actions publishes it to the `gh-pages` branch at <https://CS3227-2610-MP3-FreshApples.github.io/CS3227-2610-MP3>. The Next.js application uses a separate free Vercel domain that must be recorded after deployment.

### 10.2 Ports

Next.js serves frontend and /api/v1 together on localhost:3000. Local PostgreSQL defaults to 5432 (a local Supabase CLI environment may use a different documented port). Vercel exposes HTTPS 443; no public API port 4000 or inbound worker port is required.

Supabase runtime traffic uses the copied shared transaction-pooler connection string, normally port 6543, over TLS. Migration/export tools use direct or session-mode connections, normally 5432, depending on runner connectivity. These managed endpoints require credentials and are not browser-accessible application APIs.

### 10.3 Configuration contracts

Validate configuration on server initialization and in release checks. Invalid core configuration (D-28: APP_ENV, PUBLIC_APP_URL, DATABASE_URL, DATABASE_CA_CERT, SESSION_SECRET, RATE_LIMIT_KEY_SECRET, and SESSION_TTL_SECONDS/REPORT_SUSPENSION_THRESHOLD when set) prevents readiness; missing AI configuration disables AI while core features remain available; a missing CRON_SECRET makes both cron routes reject every request. Never print secret values. Keep names/placeholders only in .env.example; do not commit .env.local or Vercel environment downloads. The environment-variable and first-Admin bootstrap policy is the approved D-51 decision in governance.

Validity rules (D-37). A core variable that breaks a rule makes core configuration invalid. A non-core variable that breaks a rule is treated as missing.

- `APP_ENV` is exactly one of `local`, `test`, `development` or `production`.
- `PUBLIC_APP_URL` is an absolute origin with no path, query or fragment, and uses `https` when `APP_ENV` is `development` or `production`.
- `DATABASE_URL` is a `postgres://` or `postgresql://` URL with no `sslmode` or other `ssl*` query parameter.
- `DATABASE_CA_CERT` contains at least one PEM certificate block. It is required in `development` and `production` and optional in `local` and `test` (D-30).
- `SESSION_SECRET`, `RATE_LIMIT_KEY_SECRET` and `CRON_SECRET` are each at least 32 characters, and `SESSION_SECRET` differs from `RATE_LIMIT_KEY_SECRET`.
- `SESSION_TTL_SECONDS`, when set, is an integer from 60 to 28800. The SEC-03 8-hour absolute expiry is the maximum.
- `REPORT_SUSPENSION_THRESHOLD`, when set, is a positive integer.
- `AI_ENABLED` is exactly `true` or `false`.
- `AI_PROVIDER` is `soc_llm` or `fake`, and `fake` is invalid in `production`.
- The numeric AI variables are positive integers within the limits in the table below.
- AI is enabled only when `AI_ENABLED=true` and every AI variable that AI needs is present and valid. Otherwise AI is disabled and core readiness is unaffected (D-28).

| Variable | Contract |
| --- | --- |
| APP_ENV | local, test, development or production; independent of Next.js NODE_ENV |
| PUBLIC_APP_URL | Absolute application origin; HTTPS in hosted environments |
| PORT | Local Next.js listener only; default 3000 |
| DATABASE_URL | Server-only Supabase transaction-pooler URL using least-privilege runtime role |
| DATABASE_CA_CERT | Server-only PEM CA certificate of the environment's Supabase project, used to verify TLS for runtime and migration connections. Optional only in local/test with a loopback database (D-30) |
| MIGRATION_DATABASE_URL | Direct/session-pooled privileged connection; CI/operator only. Its TLS is verified against DATABASE_CA_CERT |
| SESSION_SECRET | High-entropy environment-specific secret for session/CSRF signing |
| SESSION_TTL_SECONDS | Default 28800 |
| RATE_LIMIT_KEY_SECRET | High-entropy environment-specific secret used only to HMAC email and IP rate-limit keys (D-12) |
| SOC_LLM_BASE_URL | `https://soclaas-api.comp.nus.edu.sg` (D-48): HTTPS, reachable from Vercel, without a trailing `/v1`; the adapter appends versioned paths |
| SOC_LLM_API_KEY | Server-only secret, sent as `Authorization: Bearer <key>` (SoCLaaS keys have the form `clsk_<prefix>_<secret>`). Keys are issued per SoC account; rotating a key disables the old one at once (D-48) |
| SOC_LLM_MODEL | `default`, the SoCLaaS operator-managed alias (D-48); confirm with `GET /v1/models` that the key can use it before enabling AI |
| SOC_LLM_REQUESTS_PER_MINUTE | Verified allocation or environment partition, no guessed default. The SoCLaaS default limit is 90 requests per minute per API key (OQ-01, D-48); development and production values must sum to at most 90. Production 60, development 30 (D-25) |
| AI_DAILY_BUDGET_MICRODOLLARS | Required positive budget when AI is enabled; counted per UTC calendar day (D-13, D-25). Must be at least the AI-03 reservation for AI_INPUT_TOKEN_LIMIT input tokens and 1,200 output tokens at the configured prices, or AI is disabled (D-78). Production 53,333,333; development 26,666,666 (sum within the USD 80/day allocation) |
| SOC_LLM_INPUT_PRICE_MICRODOLLARS_PER_MTOK | Input price of SOC_LLM_MODEL in microdollars per million tokens, as reported by `GET /v1/models`: 411810 on 16 October 2026 (D-48); no default; missing value disables AI |
| SOC_LLM_OUTPUT_PRICE_MICRODOLLARS_PER_MTOK | Output price of SOC_LLM_MODEL in microdollars per million tokens, as reported by `GET /v1/models`: 1456571 on 16 October 2026 (D-48); no default; missing value disables AI |
| AI_ENABLED | Explicit boolean; false until provider validation succeeds |
| AI_PROVIDER | soc_llm or fake. fake selects the deterministic adapter for local, test and development use (D-16); configuration validation rejects fake when APP_ENV is production |
| AI_MAX_CONCURRENT_REQUESTS | Default and maximum 1 per environment, enforced through PostgreSQL (D-65) |
| AI_ATTEMPT_TIMEOUT_MS | Default and maximum 30000 (D-65) |
| AI_MAX_ATTEMPTS | Default and maximum 2 (D-65) |
| AI_EXECUTION_DEADLINE_MS | Default and maximum 75000, minimum 15000; must leave headroom under function maxDuration (D-65, D-76) |
| AI_SUMMARY_SAMPLE_SIZE | Default and initial maximum 20 |
| AI_SUMMARY_INTERVAL_DAYS | Default 1; supported lower-load option 7; eligibility checked in daily sweep |
| AI_SUMMARY_MAX_MOVIES_PER_RUN | Initial maximum 1; increase only after runtime/capacity validation and spec revision |
| CRON_SECRET | High-entropy server-only scheduler secret, distinct per environment; protects both recovery and summary sweeps |
| ADMIN_BOOTSTRAP_EMAIL | Optional first-Admin bootstrap input; sensitive deployment configuration, used only by the explicit one-time bootstrap operation and removed after successful provisioning |
| ADMIN_BOOTSTRAP_PASSWORD | Optional first-Admin bootstrap input; sensitive deployment configuration, consumed only server-side by the explicit one-time bootstrap operation, never logged or returned, and removed after successful provisioning |
| ADMIN_BOOTSTRAP_SECRET | Deployment-only secret required to invoke the dedicated Vercel bootstrap function; never exposed to browser sessions, logs or responses, and removed after successful provisioning |
| AI_MODERATION_MAX_EXECUTIONS | Default 3 per content revision before manual review; at most 2 provider attempts per execution |
| AI_MODERATION_RECOVERY_MAX_REVIEWS | Initial maximum 1 per daily recovery invocation; revise only after runtime/capacity validation |
| REPORT_SUSPENSION_THRESHOLD | Default 3 distinct accepted incidents per strike cycle; positive integer, changes require policy review |
| AI_INPUT_TOKEN_LIMIT | Maximum 8000, reduced if verified model context requires it |
| LOG_LEVEL | info by default; no sensitive payloads |
| VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID | Not used while D-18 (Vercel Git integration) is in effect. If a CI deployment job is introduced by a later decision: trusted deployment workflow configuration only; token is secret and not application runtime config |

Use the Node.js runtime for API/database/authentication/AI routes. Enable Vercel Fluid compute and export maxDuration = 120 on AI cron and review mutation Route Handlers; verify that this configuration is effective on the deployed Hobby project. It is a route setting, not an arbitrary environment variable. Non-screening routes should have smaller deadlines.

No Supabase publishable/service-role key is needed for direct server-side PostgreSQL access. Do not add NEXT_PUBLIC_ database/provider secrets. The database driver (`pg`) uses CA-verified TLS, a small per-instance pool and no named prepared statements; see [tech-stack.md](tech-stack.md). Keep quota reservations in short transactions, outside provider calls.

### 10.4 Infrastructure constraints

DEP-01: Team-managed Vercel deployment is required; using Vercel directly is distinct from a coding-agent build-and-host environment. Do not use Codex/Claude hosting, Sites or an SDD toolkit.

DEP-02: Release pipeline (D-18). GitHub Actions runs on every pull request to `master`: install from lockfile → formatting/lint/type checks → unit/integration/security tests → Next.js build and secret scan (gitleaks plus a built-asset canary, D-29). These jobs are required status checks, and branch protection on `master` requires a human-reviewed pull request with passing checks. Vercel Git integration builds a Preview deployment with development configuration for pushed branches; smoke-check it before merge. Merging to `master` is the human-reviewed production release: Vercel builds Production from that same source revision with production configuration, followed by production smoke checks. Environment-specific builds may differ; never promote a Preview build containing development configuration into Production. No production deployment path may bypass branch protection. The jobs, triggers, check names, formatting and dependency-audit steps are in D-40; the gitleaks pin and canary list in D-41; the Playwright harness in D-42.

DEP-03: Run migrations with node-pg-migrate (D-08) as a controlled release step with a pre-migration backup and restore plan. Because merging to `master` deploys Production (D-18), apply a release's production migrations before merging the code that requires them; such migrations must remain compatible with the currently deployed code. Prefer backward-compatible migrations. Restore the previous compatible Vercel deployment for code rollback; database rollback requires a separate data plan.

DEP-04: Provide synthetic seeds and controlled peer-tester access. No production admin credentials in source, workflow logs or the public website. Use a maintained authentication library compatible with the account/session specification; Supabase Auth is not implicitly selected. D-11 satisfies this with `@node-rs/argon2` for Argon2id hashing and an in-repo opaque session implementation.

First-Admin bootstrap is not part of `next build` or ordinary function startup. If enabled for Vercel, configure `ADMIN_BOOTSTRAP_SECRET`, `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` only as sensitive Production variables, invoke the dedicated Vercel server function with the deployment-only secret after deployment, verify that exactly one Admin exists, and remove all three variables before normal operation. The Identity bootstrap operation reuses public registration's normalization, password-policy, hashing, duplicate-email and private Account-insertion primitives, but remains a separate named operation: public registration always creates an active USER and cannot select a role, while only the secret-gated bootstrap path creates an active ADMIN. In one short transaction, bootstrap takes `SHARE ROW EXCLUSIVE` on `app.account`, checks for an existing Admin, creates and audits the first Admin only when absent, then commits. Admin existence is the idempotency marker; no bootstrap-specific table or completion row exists. The table lock serializes concurrent invocations across server instances and briefly blocks other Account writes, including registration, while ordinary reads remain available. A conflicting USER email is never promoted. Readiness remains unavailable whenever no Admin exists, including while valid bootstrap variables are configured; the deployment-only bootstrap endpoint remains separately callable by the operator. That POST ignores browser cookies and does not require browser CSRF or Origin headers, because only its constant-time-compared `ADMIN_BOOTSTRAP_SECRET` authorizes it. Preview uses separate synthetic values; Production credentials and bootstrap secrets are never reused in Preview.

Operator procedure for D-51 bootstrap-variable removal (Vercel Production)

1. In the deployment owner’s authenticated Vercel project context, verify the deployment is the intended Production deployment and invoke `POST /api/v1/internal/bootstrap/admin` with `Authorization`-independent header `x-admin-bootstrap-secret: <ADMIN_BOOTSTRAP_SECRET>`. Do not place the secret in shell history or CI logs; use an interactive secret prompt or the Vercel dashboard/API request facility. Record only the deployment URL, UTC time, response status, response `status` (`created` or `already_provisioned`), and request ID.
2. Verify readiness is healthy. Then, from the controlled operator environment with `MIGRATION_DATABASE_URL` and `DATABASE_CA_CERT` set without placing either value in command arguments or shell history, run `npm run db:verify-first-admin`. The script opens a bounded read-only transaction, queries only the aggregate number of `role = 'ADMIN'` accounts, prints only `admin_count=<n>`, and exits zero only for `admin_count=1`. It never prints account rows, emails, connection details or raw driver errors. A readiness response other than `200`, a nonzero verifier exit, or any count other than one stops the procedure; retain the bootstrap variables for diagnosis and do not retry blindly. Record only the command name, source revision, environment name, UTC time, exit status and aggregate count.
3. After successful verification, remove each variable from the Vercel Production environment using the authenticated operator CLI or dashboard. The CLI procedure is:

   ```text
   vercel env ls production
   vercel env rm ADMIN_BOOTSTRAP_SECRET production --yes
   vercel env rm ADMIN_BOOTSTRAP_EMAIL production --yes
   vercel env rm ADMIN_BOOTSTRAP_PASSWORD production --yes
   vercel env ls production
   ```

   The final listing must show none of the three names. If the CLI is unavailable, perform the equivalent authenticated removal through Vercel Project Settings → Environment Variables or the Vercel project environment-variable API; never ask the application function to remove its own variables. Record the final listing or dashboard/API evidence with values redacted.
4. Recheck readiness and the bootstrap endpoint after removal. Readiness remains healthy because an Admin exists; the bootstrap endpoint must no longer accept an invocation because configuration is disabled. A failed removal or failed verification is an operator incident: restore the intended variable state through the authenticated Vercel control plane and repeat the checks with a new release record.

The application only consumes bootstrap configuration and cannot self-delete Vercel environment variables. Removal is an explicit, idempotent operator action: rerunning the removal commands for an already-absent variable is treated as success after the final listing confirms absence. Never record the secret, password, email value, or an unredacted environment listing as evidence.

DEP-05: Record app/product URLs, source revision, deployment owner, deployment commands, health checks, backup restoration and rollback evidence. Keep the graded master branch current.

DEP-06: Validate Hobby eligibility for this non-commercial course project and the actual repository/deployment workflow before feature implementation. Git integration and contributor restrictions can affect two-developer repositories; designate one deployment owner without sharing personal credentials. Hobby eligibility and repository deployment, including deployments triggered by non-owner contributors, were confirmed on 11 October 2026 (human-verified). CLI/Actions deployment does not override platform plan terms. If eligibility fails, record the blocker and evaluate course-provided hosting or sponsorship before changing providers.

DEP-07: Target zero hosting/database subscription cost. Monitor Vercel usage, Supabase database/egress usage and SoC allocation. Avoid paid add-ons or automatic plan upgrades. Free-tier limits and pauses may interrupt service; do not claim an always-on SLA.

DEP-08: Establish encrypted off-site database exports daily and before migrations, plus a tested restore command. Keep backups outside Git and public CI artifacts. Select a private storage location and verify any CI/storage allowance before enabling automation. Proposed RPO 24 hours/RTO 4 hours remain team targets, not Supabase Free guarantees.

DEP-09: Monitor Supabase pause warnings and resume before demonstrations. Configure one daily production Vercel cron (for example 0 0 * * *, UTC; approximate 08:00 SGT) to GET /api/v1/internal/cron/summaries with CRON_SECRET bearer authentication. The handler awaits at most one bounded generation, using durable pending markers, backoff and leases; no detached work. Hobby daily timing is approximate, not a deadline. Verify missing/invalid secret rejection, overlap handling, missed-run recovery and backlog monitoring. Preview/local tests invoke the same handler with isolated development secrets and a fake provider; do not assume production cron runs on Preview. See [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs), checked 9 October 2026.

DEP-10: Configure a separate daily GET /api/v1/internal/cron/review-moderation (for example 0 1 * * *, UTC), authenticated with CRON_SECRET and isolated from the summary sweep by its own lease. Most screening starts automatically inside review mutation handlers; this sweep recovers due durable work after contention, transient failure or crashes. Initially attempt one Review per invocation, preserve remaining work, and stop retrying a revision after 3 failed executions. Validate normal and outage-backlog throughput before release; sustained backlog requires greater validated recovery capacity or a revised execution host, not silent publication. Admins resolve needs_manual_review/flagged items without requesting AI. Tests use synthetic Reviews and a fake provider.
