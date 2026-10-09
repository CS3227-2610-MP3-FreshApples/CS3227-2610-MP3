# Project Specification — Runtime and Deployment

## 10. Runtime / Deployment Requirements

### 10.1 Environments

Use Next.js App Router/TypeScript for both UI and backend Route Handlers, deployed together on Vercel Hobby. Use PostgreSQL in Supabase Free. There is no separately deployed API server or persistent worker. See [tech-stack.md](tech-stack.md) for the free-tier assessment.

| Environment | Application | Database |
| --- | --- | --- |
| Local/test | Next.js dev server; isolated tests with fake SoC adapter | Local PostgreSQL/container with disposable fixtures |
| Shared development | Vercel Preview deployment of trusted development changes | Supabase development project |
| Production | Vercel Production deployment from reviewed master revision | Separate Supabase production project |

Supabase's two free-project allocation is intended for development and production; confirm the account has both slots available. Preview and Production credentials must be scoped separately in Vercel. Never reuse production data or credentials in Preview. Do not provision a database branch per preview; use the shared development database with compatible migrations and synthetic data.

If SoC quota is shared, assign fixed development/production sub-budgets whose sums fit the allocation, or implement a shared coordinator. Controlled live tests use synthetic data. Verify that the SoC endpoint permits access from Vercel; campus/VPN-only access would require revisiting the runtime placement.

GitHub Pages remains the separate course-required product website with guides, release information and the live application link. It does not host the application API. Use free supplied domains initially.

### 10.2 Ports

Next.js serves frontend and /api/v1 together on localhost:3000. Local PostgreSQL defaults to 5432 (a local Supabase CLI environment may use a different documented port). Vercel exposes HTTPS 443; no public API port 4000 or inbound worker port is required.

Supabase runtime traffic uses the copied shared transaction-pooler connection string, normally port 6543, over TLS. Migration/export tools use direct or session-mode connections, normally 5432, depending on runner connectivity. These managed endpoints require credentials and are not browser-accessible application APIs.

### 10.3 Configuration contracts

Validate configuration on server initialization and in release checks. Invalid database/session configuration prevents readiness; missing AI configuration disables AI while core features remain available. Never print secret values. Keep names/placeholders only in .env.example; do not commit .env.local or Vercel environment downloads.

| Variable | Contract |
| --- | --- |
| APP_ENV | local, test, development or production; independent of Next.js NODE_ENV |
| PUBLIC_APP_URL | Absolute application origin; HTTPS in hosted environments |
| PORT | Local Next.js listener only; default 3000 |
| DATABASE_URL | Server-only Supabase transaction-pooler URL using least-privilege runtime role |
| MIGRATION_DATABASE_URL | Direct/session-pooled privileged connection; CI/operator only |
| SESSION_SECRET | High-entropy environment-specific secret for session/CSRF signing |
| SESSION_TTL_SECONDS | Default 28800 |
| SOC_LLM_BASE_URL | Verified HTTPS endpoint reachable from Vercel |
| SOC_LLM_API_KEY | Server-only secret; final auth mapping depends on verified SoC contract |
| SOC_LLM_MODEL | Verified permitted model identifier |
| SOC_LLM_REQUESTS_PER_MINUTE | Verified allocation or environment partition, no guessed default |
| SOC_LLM_TOKENS_PER_MINUTE | Verified allocation/partition if applicable |
| AI_DAILY_TOKEN_BUDGET | Required positive team-approved budget when AI is enabled |
| AI_ENABLED | Explicit boolean; false until provider validation succeeds |
| AI_MAX_CONCURRENT_REQUESTS | Default 1 per environment, enforced through PostgreSQL |
| AI_ATTEMPT_TIMEOUT_MS | Default 30000 |
| AI_MAX_ATTEMPTS | Default 2 |
| AI_EXECUTION_DEADLINE_MS | Default 75000, must leave headroom under function maxDuration |
| AI_SUMMARY_SAMPLE_SIZE | Default and initial maximum 20 |
| AI_SUMMARY_INTERVAL_DAYS | Default 1; supported lower-load option 7; eligibility checked in daily sweep |
| AI_SUMMARY_MAX_MOVIES_PER_RUN | Initial maximum 1; increase only after runtime/capacity validation and spec revision |
| CRON_SECRET | High-entropy server-only scheduler secret, distinct per environment; protects both recovery and summary sweeps |
| AI_MODERATION_MAX_EXECUTIONS | Default 3 per content revision before manual review; at most 2 provider attempts per execution |
| AI_MODERATION_RECOVERY_MAX_REVIEWS | Initial maximum 1 per daily recovery invocation; revise only after runtime/capacity validation |
| REPORT_SUSPENSION_THRESHOLD | Default 3 distinct accepted incidents per strike cycle; positive integer, changes require policy review |
| AI_INPUT_TOKEN_LIMIT | Maximum 8000, reduced if verified model context requires it |
| LOG_LEVEL | info by default; no sensitive payloads |
| VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID | Trusted deployment workflow configuration only; token is secret and not application runtime config |

Use the Node.js runtime for API/database/authentication/AI routes. Enable Vercel Fluid compute and export maxDuration = 120 on AI cron and review mutation Route Handlers; verify that this configuration is effective on the deployed Hobby project. It is a route setting, not an arbitrary environment variable. Non-screening routes should have smaller deadlines.

No Supabase publishable/service-role key is needed for direct server-side PostgreSQL access. Do not add NEXT_PUBLIC_ database/provider secrets. The database driver uses TLS, a small per-instance pool and transaction-pooler-compatible prepared-statement settings. Keep quota reservations in short transactions, outside provider calls.

### 10.4 Infrastructure constraints

DEP-01: Team-managed Vercel deployment is required; using Vercel directly is distinct from a coding-agent build-and-host environment. Do not use Codex/Claude hosting, Sites or an SDD toolkit.

DEP-02: GitHub Actions pipeline: install from lockfile → formatting/lint/type checks → unit/integration/security tests → Next.js build and secret scan → development deploy/smoke → human-reviewed production deploy from the same source revision → production smoke checks. Environment-specific builds may differ; do not promote an artifact containing development configuration into production blindly. Use Vercel's documented CLI/Actions flow and disable competing automatic production deployments if they would bypass release gates.

DEP-03: Run migrations as a controlled release step with a pre-migration backup and restore plan. Prefer backward-compatible migrations. Restore the previous compatible Vercel deployment for code rollback; database rollback requires a separate data plan.

DEP-04: Provide synthetic seeds and controlled peer-tester access. No production admin credentials in source, workflow logs or the public website. Use a maintained authentication library compatible with the account/session specification; Supabase Auth is not implicitly selected.

DEP-05: Record app/product URLs, source revision, deployment owner, deployment commands, health checks, backup restoration and rollback evidence. Keep the graded master branch current.

DEP-06: Validate Hobby eligibility for this non-commercial course project and the actual repository/deployment workflow before feature implementation. Git integration and contributor restrictions can affect two-developer repositories; designate one deployment owner without sharing personal credentials. CLI/Actions deployment does not override platform plan terms. If eligibility fails, record the blocker and evaluate course-provided hosting or sponsorship before changing providers.

DEP-07: Target zero hosting/database subscription cost. Monitor Vercel usage, Supabase database/egress usage and SoC allocation. Avoid paid add-ons or automatic plan upgrades. Free-tier limits and pauses may interrupt service; do not claim an always-on SLA.

DEP-08: Establish encrypted off-site database exports daily and before migrations, plus a tested restore command. Keep backups outside Git and public CI artifacts. Select a private storage location and verify any CI/storage allowance before enabling automation. Proposed RPO 24 hours/RTO 4 hours remain team targets, not Supabase Free guarantees.

DEP-09: Monitor Supabase pause warnings and resume before demonstrations. Configure one daily production Vercel cron (for example 0 0 * * *, UTC; approximate 08:00 SGT) to GET /api/v1/internal/cron/summaries with CRON_SECRET bearer authentication. The handler awaits at most one bounded generation, using durable pending markers, backoff and leases; no detached work. Hobby daily timing is approximate, not a deadline. Verify missing/invalid secret rejection, overlap handling, missed-run recovery and backlog monitoring. Preview/local tests invoke the same handler with isolated development secrets and a fake provider; do not assume production cron runs on Preview. See [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs), checked 9 October 2026.

DEP-10: Configure a separate daily GET /api/v1/internal/cron/review-moderation (for example 0 1 * * *, UTC), authenticated with CRON_SECRET and isolated from the summary sweep by its own lease. Most screening starts automatically inside review mutation handlers; this sweep recovers due durable work after contention, transient failure or crashes. Initially attempt one Review per invocation, preserve remaining work, and stop retrying a revision after 3 failed executions. Validate normal and outage-backlog throughput before release; sustained backlog requires greater validated recovery capacity or a revised execution host, not silent publication. Admins resolve needs_manual_review/flagged items without requesting AI. Tests use synthetic Reviews and a fake provider.
