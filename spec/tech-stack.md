# Project Specification — Technology Stack

Status: selected on 8 October 2026. This supplements sections 6, 10 and 14.

## Selected stack

| Layer | Selection |
| --- | --- |
| Frontend | Next.js App Router, React and TypeScript |
| Backend | Next.js Route Handlers under /api/v1, Node.js runtime |
| Application hosting | Vercel Hobby, subject to account/repository eligibility |
| Database | PostgreSQL hosted in Supabase Free |
| Database access | `pg` (node-postgres) driver behind a server-only repository layer, via Supabase transaction pooler |
| Runtime AI | SoC LLM, called only from Next.js server code |
| CI/CD | GitHub Actions checks and team-managed Vercel deployment |
| Product information website | GitHub Pages, as required by the course |

Pin compatible stable dependency versions during implementation and commit a lockfile. A separate Express backend, persistent worker, message broker, Supabase Edge Functions and Vercel AI Gateway are unnecessary for the initial scope.

Supabase is selected as the PostgreSQL host. Its Auth, Storage and Realtime services are not automatically added to the architecture. Existing account/session contracts remain in effect; choose a maintained authentication library before implementation. Adopting Supabase Auth later requires an explicit update to those contracts and tests.

## Free-tier constraints and responses

| Constraint | Project response |
| --- | --- |
| Vercel Hobby is intended for personal, non-commercial use; exhausting included resources can interrupt availability | **Confirmed 11 October 2026 (human-verified):** the course deployment is eligible for Hobby. Monitor usage and do not silently upgrade. [Hobby plan](https://vercel.com/docs/plans/hobby) |
| Hobby Git integration has organization/private-repository and contributor restrictions | **Confirmed 11 October 2026 (human-verified):** Git integration deploys the actual team repository, and contributors who are not Vercel project owners can trigger deployments. Nominate a deployment owner. GitHub Actions/CLI is a documented deployment method, but must not be assumed to waive account or repository eligibility. Never share personal credentials. [Git deployments](https://vercel.com/docs/git), [Actions deployment](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel) |
| Supabase Free provides two active projects and 500 MB database storage per project | **Confirmed 11 October 2026 (human-verified):** two active free projects are available. Allocate one to development and one to production. Monitor indexes, audit data and AI snapshots as well as reviews. Use local PostgreSQL for isolated tests. [Billing](https://supabase.com/docs/guides/platform/billing-on-supabase) |
| Free Supabase projects with low activity over seven days can pause | Check dashboard warnings and resume before demos/peer testing; document cold-start/unavailable behaviour. Free hosting is not an always-on SLA. [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) |
| Free database backups require a team-managed export plan | Export encrypted off-site backups and demonstrate restoration; do not assume paid backup/PITR features. [Backups](https://supabase.com/docs/guides/platform/backups) |
| Vercel Functions have bounded lifetimes; Hobby cron runs at most daily | Use one authenticated daily sweep for pending summaries, initially one Movie per run; keep work within the invocation and retain deferred markers. Enable Fluid compute and verify duration. Daily timing is approximate; monitor backlog. [Function limits](https://vercel.com/docs/functions/limitations), [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) (cron documentation checked 9 October 2026) |
| Serverless instances can open many database connections | Use the shared transaction pooler, TLS, a small per-instance connection pool and compatible driver settings. [Database connections](https://supabase.com/docs/guides/database/connecting-to-postgres) |

## Implementation simplifications

Use a single Next.js project with src/app for pages/Route Handlers, src/components for reusable UI and src/server for domain services, repositories, authentication and the SoC adapter. Keep sensitive modules server-only. Do not fetch the application's own HTTP endpoints from Server Components when the same authorized domain service can be called directly.

### Database driver

Use `pg` (node-postgres), pinned exactly in `package.json`, only from server-only repository modules in src/server. It is a plain PostgreSQL client, not an ORM; repositories write parameterized SQL. Settings required by the transaction pooler and existing contracts:

- One pool per server instance with at most 1 connection (see [architecture.md](architecture.md) 6.5).
- Never set a query `name`. Named prepared statements are not supported through the transaction pooler; unnamed parameterized queries (`$1`, `$2`, …) remain mandatory (SEC-05).
- TLS with certificate verification against the Supabase project CA (`DATABASE_CA_CERT`); never disable `rejectUnauthorized`. Do not put `sslmode` in `DATABASE_URL`, because it overrides the driver's TLS options.
- Return PostgreSQL `date` values as `YYYY-MM-DD` strings rather than JavaScript `Date`, so calendar dates such as release_date are not shifted by time zone. Configure this per pool through the `types` option, not the global `pg.types` registry.
- Bound statement time; the readiness probe uses 2 seconds (see [api.md](api.md) health contract).
- Session state does not persist between transactions through the pooler. Use transaction-scoped settings (`SET LOCAL`) and table-based leases, not session-level settings, session advisory locks or `LISTEN`/`NOTIFY`.

`pg` does not provide migrations; migration tooling is not selected by this decision. Feasibility evidence: `logs/2026-10-11-supabase-feasibility-smoke-test.md`.

Use dynamic rendering/no-store for private or changing data in the initial release to avoid accidental cross-user caching and stale moderation visibility. Public caching is an optimization only after invalidation tests exist. Route Handlers implement the [API contract](api.md); see [Next.js documentation](https://nextjs.org/docs/app/getting-started/route-handlers).

Summary generation starts only in the authenticated daily changed-Movie sweep. Every new Review/resubmission/body edit automatically triggers profanity screening after durable pending state is saved. The review handler awaits bounded execution; a separate daily recovery sweep processes deferred work. Both share quotas and leases. Pending/flagged Reviews remain unpublished until automatic clearance or human approval. No Admin requests or retries AI. Validate recovery capacity before release; see [ai.md](ai.md).

## Conditions that would warrant a change

Retain this stack unless deployment testing exposes a blocker. If Hobby eligibility or required team access fails, first seek a course-provided hosting allocation or education sponsorship; any replacement host must be checked for current free limits and SoC connectivity before selection. Do not assume a different free host is automatically simpler.

If future requirements need durable background processing, add a separately selected managed job service or worker host and revise the job contract. If uninterrupted availability or managed recovery becomes mandatory, a paid/course-funded allocation may be necessary; this specification does not promise a permanently free production SLA.

The SoC endpoint must be reachable from Vercel without university-only VPN/IP requirements. Confirmed on 11 October 2026 by a human-run smoke test from Vercel; see `logs/2026-10-11-soclaas-vercel-smoke-test.md`.
