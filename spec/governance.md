# Project Specification — Constraints and Decisions

## 12. Constraints

### 12.1 Technical

CON-01: Movie listings and details are text-only; no image storage pipeline.

CON-02: Use SoC LLM for both runtime AI features. Verify and enforce actual allocation constraints. No assumed provider compatibility or unrestricted retries.

CON-03: Use team-managed deployment with suitable automation; build-and-host environments offered by coding agents are prohibited.

CON-04: Perform SDD directly without an SDD toolkit. Maintain specifications in this directory, with stable requirement IDs and traceable acceptance evidence.

### 12.2 Regulatory / Course / Organisation

The following are requirements:

- Exactly two roles and two developers; each developer completes all features for a specific role plus a substantial portion of shared work.
- At least one LLM feature for each role.
- Simple, separate role interfaces; properly designed shared components following SRP and DRY.
- Explicit implementation and testing of security for runtime AI and the development process.
- Spec-driven development and basic multi-agent software engineering, including specialized-agent evidence.
- Online deployment and separated development/production environments.
- Source code in src/; agent workflow artifacts consolidated in workflow/ as far as practical.
- docs/UserGuide.md accurately describes current features and tester access.
- docs/DeveloperGuide.md covers design, process, workflow files and acknowledgements for reused ideas/code/documentation.
- A GitHub Pages product website.
- docs/Reflections.md contains concrete AI security, SDD and multi-agent SE reflections.
- logs/ contains AI-produced summaries of development prompts/interactions, verified by a human.
- Correct repository naming/structure and up-to-date master branch for grading.

The brief states the submission deadline as 23 October (Friday), 2 pm SGT. In the current project context this is 23 October 2026, 14:00 Asia/Singapore; verify against the official course submission channel. No additional legal compliance claims are made.

### Team ownership

| Owner | Role features | Substantial shared responsibilities |
| --- | --- | --- |
| Developer A (Lim-ZY) | User UI, discovery, reviews, reporting, optional watchlist (summary moved to Developer B, D-85) | Identity/session implementation, public API contracts, User security tests, user guide |
| Developer B (thegrimbee) | Admin UI, Movie CRUD, moderation, announcements, review profanity moderation, public review summary (U-04, D-85) | Database/migrations, deployment/CI, audit/job infrastructure, developer guide |
| Both | Cross-review and end-to-end integration | Architecture, provider adapter contract, threat model, acceptance tests, reflections, logs, product website and release |

The Developer A/Developer B split above is adopted (12 October 2026). Developer A is Lim-ZY and Developer B is thegrimbee (GitHub usernames); tester accounts remain open under OQ-06. Shared foundations must have clear owners without splitting a role's features between developers. D-85 is the one recorded exception: the User-facing public review summary (U-04) is owned by Developer B. D-20 assigns the account-status service to Identity (Developer A); Moderation (Developer B) calls it.

### SDD and specialized-agent workflow

1. Analyst proposes a scoped requirement change with IDs, assumptions and acceptance examples.
2. Architect reviews boundaries, contracts and threats; records decisions and unresolved risks.
3. A human developer reviews the spec before implementation.
4. Implementation agent works on an assigned scope using approved specs and isolated test data.
5. A code-quality and test-generation agent checks readability, coupling and cohesion and adds independent tests.
6. A separate reviewer/tester agent checks intent, negative cases, security and the implementation diff; it must not merely copy implementation assumptions.
7. Human developer resolves findings and approves merge; both developers review release evidence.
8. Update specs first for behaviour changes, then code, tests, guides and interaction summaries together.

This defines a future development workflow; it does not claim agents were used to produce this draft. Roles can run sequentially through separate task invocations; simultaneous agents are not necessary.

Each handoff records task ID, requirement IDs, source revision, permitted paths/actions, changed files, rationale, tests run/results, known gaps and next action. Keep prompts, role definitions, runners and grader-facing scripts under workflow/. Natural exceptions include CI files in .github/workflows/ and specs in spec/. Explain these in the developer guide.

Suggested future artifacts:

- workflow/README.md and role prompts for analyst, architect, implementer and reviewer/tester.
- workflow/handoffs/ for task evidence; workflow/evaluations/ for security and AI evaluation rubrics.
- logs/YYYY-MM-DD-task.md with human-verified summaries, no secrets.
- docs/Reflections.md with concrete examples of injection attacks, guardrail tests, human gates, specification changes and handoff mistakes.

## 13. Assumptions

| ID | Starting assumption |
| --- | --- |
| ASM-01 | Anonymous visitors can browse and read scheduled summaries; authenticated Users author reviews/reports |
| ASM-02 | Reports target users through a specific Review; profile-only reports are deferred |
| ASM-03 | One account has one role; admins do not post reviews as admins |
| ASM-04 | One editable Review per User/Movie, rated on a 1–10 integer scale |
| ASM-05 | Movie deletion is reversible archival; evidence is retained privately |
| ASM-06 | No email delivery, social sign-in or self-service password reset in the first release |
| ASM-07 | Selected: Next.js/TypeScript frontend and backend on Vercel; PostgreSQL on Supabase. Target free tiers; eligibility and operational limits require deployment checks |
| ASM-08 | English is the initial UI/evaluation language; text may contain Unicode |
| ASM-09 | AI uses bounded review text and cannot sanction; human-accepted reports trigger deterministic threshold suspension |
| ASM-10 | Numeric performance, retention and application-rate limits are initial design targets |

## 14. Open Questions / Approved Exceptions

| ID | Decision needed | Resolution required by |
| --- | --- | --- |
| OQ-01 | Verify models, context, quotas, retention and permitted data. Endpoint and API-key authentication from Vercel confirmed 11 October 2026 by a human-run smoke test. Limits, human-reported 12 October 2026 and checked against the SoCLaaS usage-limits guide on 16 October 2026: the default per-API-key limits are 90 requests per minute and a budget of 80,000,000 microdollars (USD 80) per day and 800,000,000 microdollars (USD 800) per month; SoC may also apply lifetime credits and model access policy, and may adjust the limits. No tokens-per-minute limit is documented. Endpoint, authentication and error shape were checked against the guides, and the model (`default`, then an alias of `qwen3.6:35b`), per-token prices and context length against a human-run `GET /v1/models` with the project key, on 16 October 2026 (D-48). Retention and permitted data are not covered by the guides and need no further verification (thegrimbee, 16 October 2026; D-48). **Resolved 16 October 2026.** Interim operating posture: D-16 | Before provider integration and production enablement |
| OQ-02 | Verify regions and environment-specific SoC quota partitioning. Resolved 11 October 2026 (human-verified): Vercel Hobby eligibility, repository deployment including by non-owner contributors, Supabase two-project allocation, and SoC LLM and Supabase reachability from Vercel (see `logs/`). Stack selection is resolved | Before infrastructure implementation |
| OQ-03 | Confirm proposed account recovery scope; report privacy and anonymous summary access are resolved | Before respective product flows |
| OQ-04 | Finalize profanity policy text and contested-decision process; default three-incident suspension and reinstatement cycle are specified. Policy storage, versioning and initial language scope are resolved by D-17. Owner: Developer B (thegrimbee), target before A-03 acceptance | Before moderation/AI acceptance |
| OQ-05 | Confirm retention, operator deletion process and privacy notice | Before production |
| OQ-06 | Assign tester accounts. Developer names (Lim-ZY as A, thegrimbee as B) and the A/B ownership split are resolved (see Team ownership) | Before task allocation/release |
| OQ-07 | Select optional watchlist, spoiler handling, filters or admin statistics | Only after core scope is on track |
| OQ-08 | Confirm repo naming requirement and official deadline; the product name is resolved as FreshApples | Before release |
| OQ-09 | Verify host meets backup, restore and performance targets | Before production acceptance |

Approved exceptions:

| Advisory | Scope | Justification | Approved | Review by |
| --- | --- | --- | --- | --- |
| GHSA-vfj7-8cjw-p6xm (`braces` <=3.0.3, stack-exhaustion denial of service through deeply nested patterns; high) | Development only: `eslint-config-next` 16.4.0 → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces` 3.0.3. It accounts for all five high entries in `npm audit` on 15 October 2026 | ESLint applies it only to the repository's own file patterns, never to untrusted input, and it never runs at runtime. `npm audit --omit=dev` reports nothing. No patched `braces` release exists (3.0.3 is the latest), so `overrides` cannot fix it. The only automatic fix downgrades `eslint-config-next` to 14.x, which does not match Next.js 16 | thegrimbee, 15 October 2026, on the agent's recommendation | 15 November 2026, or earlier if a fixed `braces` or `eslint-config-next` is published |

Design decision D-01: Automatically screen every new Review and changed/resubmitted body for profanity. No Admin request initiates screening. Save pending, publish only current clean output, and hold suspected/uncertain content for human review. Admins can approve/hide with an audited reason. AI does not accept Reports or apply account sanctions.

Design decision D-02: Public summaries use reproducible sampling of at most 20 Reviews, minimum 3. Check daily and generate only after review changes; retain pending changes across deferrals. No request-summary feature. Valid unchanged output has no daily expiry. Use shared budgets and optionally a 7-day interval when measured usage warrants it.

Design decision D-03: Use Next.js for frontend/backend on Vercel and PostgreSQL in Supabase, targeting the free tiers. See [tech-stack.md](tech-stack.md) for assessment and verified documentation links.

Design decision D-04: Use bounded daily cron for summaries and immediate submission-triggered review moderation, with durable pending work and daily automatic recovery. Initially process one item per sweep and validate backlog capacity before release. No persistent worker is required; AI-request/retry controls are absent.

Design decision D-05: Received Reports and strike counts are admin-only. Three distinct human-accepted review incidents in the current cycle suspend the account until audited reinstatement. Lifetime target/review uniqueness prevents duplicate penalties. Reinstatement advances the cycle; permanent banning is outside initial scope.

Design decision D-06: The product is named FreshApples. Its MarkBind documentation website is sourced from `docs/` and published by GitHub Actions from `master` to the `gh-pages` branch at <https://CS3227-2610-MP3-FreshApples.github.io/CS3227-2610-MP3>. This site contains product information and guides only; the Next.js application remains a separate Vercel deployment and its URL is added to the website after deployment.

Design decision D-07: Use `pg` (node-postgres) as the server-only PostgreSQL driver through the Supabase transaction pooler, with the settings recorded in [tech-stack.md](tech-stack.md). No ORM is adopted. Migration tooling is selected by D-08.

Design decision D-08 (migrations): Use node-pg-migrate, pinned exactly, with plain SQL migration files named with timestamp prefixes so parallel branches do not collide. It runs only over `MIGRATION_DATABASE_URL` (direct or session connection, CA-verified TLS) from controlled CI/operator steps (DEP-03). Shipped migrations are never edited. Confirm the pinned version supports these connection and TLS settings before the first migration.

Design decision D-09 (test frameworks): Use Vitest for unit, database-integration and API-integration tests and Playwright for end-to-end tests, both pinned exactly as devDependencies. CI runs Playwright against Chromium only. Test commands are added to `package.json` and `AGENTS.md` when the harness is set up.

Design decision D-10 (local/test PostgreSQL): Use a `postgres:17` container locally and as a GitHub Actions service container, matching the Supabase major version. A native PostgreSQL 17 install is an accepted local fallback. Each test run applies all migrations to a fresh database; tests isolate data by truncation between test files, not by per-test transaction rollback, so concurrency, lease and competing-write tests observe committed data.

Design decision D-11 (authentication): Hash passwords with `@node-rs/argon2` (Argon2id, reviewed library defaults, SEC-02) and implement opaque server-side sessions in `src/server` against the Session table (SEC-03). No authentication framework, JWT or sealed-cookie session library is adopted. This combination satisfies DEP-04's maintained-library requirement.

Design decision D-12 (rate limiting): Enforce SEC-06, the review/report limits in [security.md](security.md) and SEC-11 request throttles through one shared fixed-window counter table (RateLimitWindow in [data-model.md](data-model.md)) with an atomic upsert-increment. A fixed window may admit up to twice a limit across a window boundary; this is accepted while limits remain initial targets (ASM-10). Keys containing emails or IP addresses store an HMAC under `RATE_LIMIT_KEY_SECRET`, never the raw value.

Design decision D-13 (AI capacity and budget): The single active AI execution per environment (AI-03) is a SchedulerLease row named `ai_execution`. The daily budget uses the AIBudgetDay and AIBudgetReservation tables, in microdollars (D-25). The per-minute SoC request quota uses a RateLimitWindow key; there is no token quota (D-48). Budget days are UTC calendar days.

Design decision D-14 (CSRF): SEC-04 uses a stateless, versioned HMAC-SHA-256 token signed with `SESSION_SECRET` and bound to the current session, plus an exact `Origin` match to `PUBLIC_APP_URL` on every unsafe browser method. The token wire format is `csrf_v1.<issuedAt>.<nonce>.<signature>`, with URL-safe Base64 without padding for nonce and signature; the signature covers `csrf_v1|subject|issuedAt|nonce`, where subject is the current session ID or signed pre-session ID. Tokens are compared in constant time and expire after 8 hours. Anonymous unsafe requests (`/auth/register`, `/auth/login`) use a signed opaque pre-session cookie with a 30-minute lifetime. No CSRF table or Session column is added.

- Clients obtain the token from `GET /api/v1/auth/csrf` and send it in `X-CSRF-Token`.
- The authenticated cookie is `fa_session`; the anonymous cookie is `fa_presession`. In hosted HTTPS both use the `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`; `fa_presession` additionally uses `Max-Age=1800`.
- A missing or invalid pre-session causes `/auth/csrf` to issue a new signed pre-session and token. With a valid pre-session it may issue a fresh token without changing the pre-session.
- Successful login clears `fa_presession` and binds later tokens to the new session. Logout, expiry, suspension and session revocation invalidate the associated binding. A token from another session or pre-session is rejected.
- Expired, malformed, wrongly bound, wrongly signed and Origin-failing requests all return 403 `csrf_failed` without revealing the failure reason.
- The D-83 deployment-only first-Admin bootstrap POST is the sole initial-release exception to the browser CSRF and Origin rule. It ignores browser session and pre-session cookies, accepts no browser identity as authority, and relies only on the separately configured high-entropy `ADMIN_BOOTSTRAP_SECRET`, compared in constant time before the Identity service is called. Missing, incorrect, disabled and removed bootstrap secrets never invoke the service. This exception does not apply to any User/Admin browser route or other internal route.

Design decision D-15 (provider configuration names): The SoC variables are the `SOC_LLM_*` names in [deployment.md](deployment.md) 10.3. `.env.example` lists every 10.3 variable with placeholders and no guessed model default.

Design decision D-16 (SoC interim posture): Until OQ-01 is resolved, development uses the deterministic fake adapter and production runs with `AI_ENABLED=false`. Obtain quota and budget figures from the SoC portal's budget-visibility interface and confirm retention with course staff. Development and production receive fixed sub-budgets whose sum fits the verified allocation (D-25); no cross-environment coordinator is built. OQ-01 was resolved on 16 October 2026 (D-48). This posture stays in force until a human records its end; production AI enablement still requires provider validation (deployment.md 10.3).

Design decision D-17 (profanity policy): The policy is a versioned static artifact in source under `src/server`, and its version identifier is the `policy_version` recorded by AI jobs and moderation results. It is not stored in or edited through the database. The initial supported language is English (ASM-08). The policy text and contested-decision process remain open under OQ-04.

Design decision D-18 (deployment mode): Vercel Git integration deploys Preview builds from branches and Production from `master`. GitHub Actions runs the release checks as required status checks, and branch protection on `master` requires a reviewed pull request with passing checks. No personal Vercel token is stored in CI. See DEP-02.

Design decision D-19 (default branch): `master` is the repository's default and graded branch. `main` is retired as a target; deleting it requires explicit human approval.

Design decision D-20 (account status and lock order): The Identity module owns every write to the Account row, including status, version, strike_cycle and session revocation, and exposes an account-status service that runs inside the caller's transaction. Moderation owns Reports, decisions and ModerationStrike, decides when a suspension or reinstatement is required, and calls the Identity service; it does not write Account directly. Transactions lock rows in the global order defined in [data-model.md](data-model.md). The D-83 first-Admin transaction follows that order by taking its recorded Account table lock before checking or creating an Account and before writing AuditEntry; it does not introduce a pre-Account coordination lock.

Design decision D-21 (page routes): Public pages (home, movie list and detail, announcements, sign-in and registration) are served at the root. User-only pages are under `/app`, Admin pages under `/admin`. Next.js route groups may share layouts without changing these URLs. Role checks stay in services and handlers (architecture 6.6).

Design decision D-22 (validation): Validate request bodies, query parameters, stored JSON (evidence snapshots, AI outputs) and, per D-37, environment configuration with zod schemas in strict mode, pinned exactly. Schemas live with the server modules that own them and contain no credentials or ORM-private fields (architecture 6.6). Registration accepts only `email`, `password`, and `displayName`. Supplied role or status fields are unknown mutation fields and return `422 validation_failed`; no account is created. The Identity service unconditionally persists `role = USER` and `status = active`.

Design decision D-23 (composition root): The only module-level instances allowed in `src/server` are created in one composition root, `src/server/composition.ts`: the per-instance database pool and the service graph built from configuration. They are module-level constants created once per server instance; no other module holds shared mutable state, and every service receives its dependencies through its constructor. This is a recorded exception to the AGENTS.md rule against shared globals.

Design decision D-24 (contract open items): The open items O-01–O-34 and proposals P-01–P-13 in `workflow/contracts.md` were resolved on 12 October 2026. Behavioural outcomes are recorded in [api.md](api.md) (error codes, statuses, ETag, CSRF endpoint, no-op and archived-Movie rules, SoC base URL), [security.md](security.md) (CSRF names, client IP, limiter rules, audit results), [data-model.md](data-model.md) (ModerationWork cancellation and nullable model, evidence_version, lease names and durations, same-table lock order), [ai.md](ai.md) (token estimate, policy path), [deployment.md](deployment.md) (AI_PROVIDER, base URL) and [tech-stack.md](tech-stack.md) (isolation, timeouts, nested transactions). Module-structure outcomes are in `workflow/contracts.md` §16.

Design decision D-25 (SoC budget unit and partition): The application budget is money, matching the SoC allocation: AI_DAILY_BUDGET_MICRODOLLARS replaces the token budget, and cost is computed from token usage and the verified per-million-token prices of the configured model. Production receives two thirds and development one third of the allocation: 60 and 30 requests per minute, and 53,333,333 and 26,666,666 microdollars per UTC day. The USD 800 monthly cap is not enforced by the application; SoC 429 budget responses defer work (AI-03).

Design decision D-26 (migrations directory): node-pg-migrate migration files live in `src/server/db/migrations/`, owned by Developer B (database/migrations). Both the test harness and the operator release step pass this directory explicitly to node-pg-migrate. The directory holds migration SQL files only; it is never imported by application code.

Design decision D-27 (application schema): All application tables, types and indexes live in a PostgreSQL schema named `app`. Nothing is created in `public`. Supabase Data APIs expose only their default schemas, and `app` is never added to the exposed list. Migrations and repositories use schema-qualified names (`app.review`) and do not rely on `search_path`, which does not depend on the transaction pooler's session handling. node-pg-migrate keeps its bookkeeping table in `app`. Migrations revoke all privileges on `app` from `anon`, `authenticated` and `public`. The runtime role (`app_runtime`) receives `USAGE` on `app` and only the table-level DML it needs, with no DDL, no access to the migration bookkeeping table, and no UPDATE or DELETE on AuditEntry.

Design decision D-28 (core configuration): Readiness and core features require exactly these valid variables: `APP_ENV`, `PUBLIC_APP_URL` (needed by the SEC-04 Origin check), `DATABASE_URL`, `DATABASE_CA_CERT`, `SESSION_SECRET`, `RATE_LIMIT_KEY_SECRET` (needed by the SEC-06 login throttle), and, when set, valid values of the defaulted `SESSION_TTL_SECONDS` and `REPORT_SUSPENSION_THRESHOLD`. Invalid core configuration makes readiness return 503. `CRON_SECRET` is not core: when it is missing, both cron routes reject every request with 401 while user and admin features keep working. AI variables are never core (deployment.md 10.3). `PORT`, `LOG_LEVEL` and `MIGRATION_DATABASE_URL` are not runtime readiness inputs: `LOG_LEVEL` falls back to `info` when invalid.

Design decision D-29 (secret scanning): SEC-07 secret scanning uses the gitleaks CLI (MIT-licensed). CI downloads an exactly pinned release and verifies its SHA-256 checksum before running it. The `gitleaks-action` wrapper is not used because it requires a licence key for organization repositories. CI runs gitleaks over the pull request's commit range and over the built `.next/static` directory. A canary check also builds with distinctive synthetic values for every server-only secret and fails if any of them appears in `.next/static`. Findings fail the job. False positives are allowed only through a reviewed `.gitleaks.toml` allowlist entry with a justification comment (security.md "Development-process security"). Developers may run the same pinned CLI locally; it is not an npm dependency.

Design decision D-30 (local/test database TLS): Database TLS is either CA-verified or absent, never unverified. In `APP_ENV=local` or `test` only, `DATABASE_CA_CERT` may be omitted, and then the runtime pool and the migration runner connect without TLS, but only to a loopback host (`localhost`, `127.0.0.1` or `::1`). This covers the D-10 container and the GitHub Actions service container. In `development` and `production`, `DATABASE_CA_CERT` is required and a missing value is invalid core configuration. The migration runner verifies TLS against the same project CA in `DATABASE_CA_CERT`; no separate migration CA variable is added.

Design decision D-31 (database roles): Migrations never create login roles or set passwords. In each Supabase project an operator creates `app_runtime` (LOGIN, password entered outside the repository and logs) before the first migration; the procedure goes in the developer guide (R-04). The test harness creates `app_runtime`, `anon` and `authenticated` as synthetic roles in the disposable database before migrating, so the same migration files run unchanged locally, in CI and on Supabase, and fail loudly if a role is missing. These synthetic roles stay `NOLOGIN`. For end-to-end runs only (D-42), the harness also creates a per-run login role with a uniquely generated name and a randomly generated synthetic password. The role is a member of `app_runtime` with `INHERIT`, so it holds exactly `app_runtime`'s privileges, and it is dropped when the run ends. The harness never gives `app_runtime` itself `LOGIN` or a password, and it never prints the password.

Design decision D-32 (runtime privileges): `app_runtime` receives `USAGE` on schema `app` and exactly the table privileges listed in [data-model.md](data-model.md) "Runtime privileges". It has no `TRUNCATE`, `REFERENCES`, `TRIGGER` or DDL rights. `DELETE` is granted only where a recorded behaviour needs it. Retention purges (OQ-05) add grants in a later migration when their design is approved. Every migration that adds a table grants its privileges explicitly; default privileges are not used.

Design decision D-33 (schema conventions): The database enforces structure (types, NOT NULL, keys, foreign keys, uniqueness, state vocabularies, numeric ranges and array cardinality). Text length and trimming rules (code points after trimming) are enforced by the owning service's zod schemas (D-22), not by database CHECKs. Closed state vocabularies use `text` columns with CHECK constraints, not PostgreSQL enum types. Open vocabularies that change through contract PRs (AuditEntry `action` and `target_type`, AIJob `error_code`) are unconstrained `text`. Column conventions are listed in [data-model.md](data-model.md) "Schema conventions".

Design decision D-34 (watchlist schema): The optional WatchlistEntry table is not created by the initial migration. If FR-10 is selected (OQ-07), it is added by a new migration.

Design decision D-35 (synthetic seed): The synthetic seed script (DEP-04) creates data only through the owning services wired by the composition root: Accounts through Identity (D-20), Movies and Announcements through Catalogue and Announcements, Reviews and Reports through their services. It refuses to run when `APP_ENV` is `production`, uses only synthetic values, and prints no credentials. It is built after S-04 and A-01, not in S-01.

Design decision D-36 (transaction conflicts and readiness probe): The transaction helper (K1) converts PostgreSQL deadlock (40P01) and serialization (40001) failures into a typed `TransactionConflict` error that carries no driver types. The API kernel (K2) maps it to 409 `conflict`; it is never retried automatically. K1 also exposes a separate `probe()` operation for readiness that runs a read-only query with a 2-second limit covering both connection acquisition and the query; ordinary transactions keep the 5-second limits.

Design decision D-37 (configuration validity): Configuration is validated with zod (D-22 extended to environment variables) once per server instance in the composition root. Validity rules are listed in [deployment.md](deployment.md) 10.3. AI configuration never makes core configuration invalid: invalid or incomplete AI settings, including `AI_PROVIDER=fake` when `APP_ENV=production`, disable AI and are reported by variable name in server logs. Validation messages name variables, never values.

Design decision D-38 (health handlers): The api.md health contract is implemented as follows.
- `GET /api/v1/health/live` and `GET /api/v1/health/ready` are Node.js-runtime Route Handlers that export only `GET`. Next.js answers `HEAD` by calling the `GET` handler, so `HEAD` responses carry the same headers without a body. Next.js generates the responses for `OPTIONS` (the `Allow` header) and for other methods (405). These framework-generated responses are outside the health shape contract and are the one exception to the api.md 8.1 `X-Request-Id` rule.
- Both handlers run at request time: they call `connection()` from `next/server` before doing any work, so they are never prerendered under `cacheComponents` (they never read build-time config).
- Every health response carries `Cache-Control: no-store`, a JSON content type and a server-generated UUID `X-Request-Id` (api.md 8.1). It carries no `Set-Cookie`. Inbound request IDs, cookies and session headers are ignored.
- Health handlers never use the K2 error envelope, at any status. This is permanent: it follows from the api.md 8.4 rule that health responses keep their minimal shapes even on failure.
- Setting the headers directly in the handlers is Developer B's interim decision while the K2 kernel (S-02) is unmerged, so the handlers do not import `src/server/http/`. Once K2 merges, they may switch to a K2 header helper only if the behaviour stays identical.
- Liveness reads no configuration and does not import the composition root, the database or any adapter. It returns 200 `{ "status": "ok" }` whenever the process can run the handler, including when core configuration is invalid.
- Readiness returns 503 `{ "status": "unavailable" }` without opening a database connection when core configuration is invalid (D-28). Otherwise it calls K1 `probe()` (D-36) once. If the probe resolves, it performs a read-only Account query for Admin existence. It returns 200 `{ "status": "ready" }` only when at least one Admin exists; zero Admins returns 503 even when valid bootstrap configuration is present. A probe rejection/timeout, an Admin-existence query failure or any other unexpected exception returns 503 with the same body.
- The readiness decision is a server-only function under `src/server/services/health/`. The composition root builds its input from `config.core` and `database` as one of two values:
  - invalid configuration, carrying the variable names from the core-configuration issues (needed by D-39);
  - valid configuration, carrying the probe operation and a read-only
    `adminProvisioned` operation.

  The function does not receive a validity flag alongside both values, because that would be control coupling (AGENTS.md).
- Flood protection at the edge relies on Vercel's platform protection; the application adds no limiter to health routes, because a limiter would need database access. R-04 records what the Hobby plan provides.
- Accepted risk: the per-instance pool has one connection, so readiness can report 503 while a request holds that connection for more than 2 seconds.

Design decision D-39 (readiness failure logs): Each 503 readiness response writes exactly one JSON line with `console.error`, fields `event` = `health.ready.unavailable`, `requestId`, `reason` and, for configuration failures only, `variables`.
- `reason` is one of `core_config_invalid`, `database_unavailable` (probe or Admin-existence query rejected or timed out), `admin_bootstrap_required` (the database is reachable but has no Admin) or `unexpected_error`.
- `variables` lists the variable names from the configuration issues, never their values.
- The line never contains error messages, stack traces, SQLSTATEs, hostnames, connection strings or versions.
- Successful health responses are not logged. These logs stay in Vercel runtime logs, which only project members can read. No log drain is configured without a new decision.

Design decision D-40 (CI checks): `.github/workflows/ci.yml` implements the DEP-02 checks.
- **Triggers:** `pull_request` targeting `master`, `push` to `master` and `workflow_dispatch`. It never uses `pull_request_target`.
- **Workflow settings:** `permissions: contents: read`. A concurrency group per ref cancels superseded runs. Node.js 24 everywhere (`actions/setup-node`), and the Vercel project's Node.js version is set to the same major version (R-04). Every action is pinned to a full commit SHA with a version comment.
- **Secrets:** no job reads repository secrets or deploy credentials. All environment values in CI are synthetic. No job deploys (D-18).
- **Jobs, whose names are the required status checks a human configures:**
  - `lint-typecheck`: `npm ci`, `npm run lint`, `npx tsc --noEmit`.
  - `unit`: `npm run test:unit`.
  - `integration`: `npm run test:integration` against a `postgres:17` service bound to loopback (D-10).
  - `e2e`: the Playwright suite (D-42).
  - `build-secret-scan`: the build, gitleaks and canary checks (D-41).
  - `dependency-audit`: `npm audit --json` over all dependencies, checked by `scripts/check-audit.mjs` (no new dependency). High and critical advisories fail the job. An accepted advisory is recorded in §14 "Approved exceptions" with its advisory ID, justification and review date, never suppressed silently. npm has no ignore list, so the approved advisories are mirrored in `audit-exceptions.json` at the repository root, with entries `{ "id": "GHSA-…", "reviewBy": "YYYY-MM-DD" }`. The script fails when:
    - a high or critical advisory's GHSA ID is not listed;
    - a listed entry is past its `reviewBy` date (UTC);
    - a listed entry no longer matches any reported advisory, so stale entries are removed.

    A pull request that changes `audit-exceptions.json` must change §14 in the same pull request. `--omit=dev`, `continue-on-error` and lowering the audit level are not used.
- **Job order:** the jobs run in parallel, with no `needs:` between them. The arrows in DEP-02 give the logical order of the checks, not a required job sequence. Each job installs from the lockfile itself, and branch protection requires every job to pass.
- **Formatting:** DEP-02's formatting check is satisfied by the ESLint step. No separate formatter is adopted.
- **Security tests:** DEP-02's security tests are the security-relevant tests inside the unit, integration and e2e projects (for example configuration redaction, runtime privileges and later the access matrix), together with `build-secret-scan` and `dependency-audit`. There is no separate security test command.

Design decision D-41 (secret scan pin and canary): The pinned gitleaks release is v8.30.1. CI downloads `gitleaks_8.30.1_linux_x64.tar.gz` and checks it against SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` (taken from the release's checksums file) before extracting it.
- **Commit-range scan:** with full fetch depth, gitleaks scans the pull request commit range (`base..head`) on `pull_request` and the pushed range (`before..after`) on `push`, using `gitleaks git --log-opts`.
- **Build:** the `build-secret-scan` job runs `npm run build` once with distinctive synthetic canary values for every server-only secret: `DATABASE_URL` and `MIGRATION_DATABASE_URL` (canary in the password), `SESSION_SECRET`, `RATE_LIMIT_KEY_SECRET`, `CRON_SECRET`, `SOC_LLM_API_KEY`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` and `ADMIN_BOOTSTRAP_SECRET`. `DATABASE_CA_CERT` is a public CA certificate and is not a canary. The bootstrap email is included because D-83 classifies every bootstrap value as sensitive deployment configuration even though an email address is not normally a secret.
- **Built-asset checks:** the job then runs `gitleaks dir .next/static`. `scripts/check-bundle-canary.mjs` fails if any canary value appears in any file under `.next/static`.
- **New secrets:** a pull request that adds a server-only secret to deployment.md 10.3 adds it to the canary list in the same pull request.
- **Configuration:** `.gitleaks.toml` extends the default rules and starts with an empty allowlist; each entry needs a justification comment and human review.
- **Negative-path evidence:** a commit stays in the scanned range after it is reverted. The S-03 evidence that CI fails on a failing test and on a synthetic secret therefore comes from a throwaway branch off the S-03 branch, with its own pull request that is closed without merging, and the S-03 pull request links those failing runs. The secret is a synthetic value that matches a default gitleaks rule. Producing this evidence never uses an allowlist entry, a history rewrite or a weakened scan.
- **Local use:** `npm run check:secrets` needs gitleaks on `PATH` and otherwise fails with a clear message. It runs:
  - `gitleaks git` over the commits on the current branch that are not on `origin/master` (`origin/master..HEAD`);
  - `gitleaks dir .next/static`.

  It does not build. If `.next/static` is missing, it fails and tells the developer to run `npm run build` first. The canary check runs only in CI, because it needs the canary build.
- **Pin changes:** changing the version or checksum requires a reviewed pull request that updates this decision.

Design decision D-42 (Playwright harness): The configuration is `playwright.config.ts` at the repository root. It sets `testDir: tests/e2e` and one Chromium project (D-09).
- **Command:** the script is `npm run test:e2e`, which runs the wrapper described under Lifecycle. It is recorded in `AGENTS.md` Commands when S-03 lands.
- **Build:** `npm run test:e2e` does not build; run `npm run build` first. The `e2e` CI job runs `npm run build` itself with the e2e environment below. It does not reuse the canary build from `build-secret-scan`.
- **App under test:** Playwright's `webServer` starts the production build with `next start` on `127.0.0.1` port 3100, using:
  - `APP_ENV=test`, `PUBLIC_APP_URL=http://127.0.0.1:3100`, `AI_PROVIDER=fake` and `AI_ENABLED=false` (R-02 enables AI with the marker fake, D-57);
  - no `DATABASE_CA_CERT` (D-30);
  - `SESSION_SECRET`, `RATE_LIMIT_KEY_SECRET` and `CRON_SECRET` generated randomly for each run, distinct and at least 32 characters (deployment.md 10.3);
  - `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` and `ADMIN_BOOTSTRAP_SECRET` generated or fixed to synthetic per-run test values. The health smoke invokes the real bootstrap endpoint once before expecting readiness, because D-38/D-83 require an Admin for readiness. These variables exist only in the disposable local process and do not constitute deployed operator evidence;
  - `DATABASE_URL` naming the run's database and login role.
- **Database:** the server is the loopback PostgreSQL 17 named by `TEST_DATABASE_URL`, and the same loopback-only refusal as the integration harness applies (D-10, D-30). Each run creates a uniquely named database, creates the synthetic D-31 roles and applies every migration, then creates the per-run login role from D-31. The app connects as that login role, so it holds exactly `app_runtime`'s privileges.
- **Lifecycle:** Playwright 1.64.0 starts `webServer` before `globalSetup`, so the database cannot be prepared in `globalSetup`. Instead, `npm run test:e2e` runs a Node.js wrapper under `tests/setup/` with no new dependency. The wrapper prepares the database and login role, runs `playwright test` with the e2e environment, and then drops the database and the login role even when tests fail. It exits with Playwright's exit code. It may share the loopback check and role creation with the integration harness.
- **Initial suite:** S-03 adds a health smoke spec (live returns its exact body before provisioning; a local synthetic first-Admin bootstrap succeeds; ready then returns its exact body and `no-store`; both health routes are reached anonymously without redirects), so the suite is never empty. User and Admin journeys are added in R-02.

Design decision D-43 (rate-limit windows and admission): The shared limiter (D-12) works as follows.
- **Clock:** windows are computed from the database clock (`now()`), never the application server's clock.
- **Windows:** fixed and aligned to the Unix epoch. `window_start` is `to_timestamp(floor(extract(epoch FROM now()) / windowSeconds) * windowSeconds)`, and the window ends `windowSeconds` later.
- **Admission:** a consume of `units` is admitted when the window's count plus `units` is at most the limit, and the count then grows by `units`. Otherwise it is rejected and the count is unchanged (security.md). "10 per minute" therefore admits the 10th mutation in a window and rejects the 11th.
- **Atomicity:** the check and the increment are one `INSERT … ON CONFLICT … DO UPDATE … WHERE` statement in the limiter's own short transaction (data-model.md "Lock order"). Concurrent callers on different connections cannot exceed the limit.
- **Read-only check:** reports allowed when one more unit would be admitted (count below the limit). It creates no row.
- **Retry-After:** a rejection carries `ceil(window end − now())` seconds, at least 1, from the same database clock, sent as integer seconds in the `Retry-After` header.
- **Input validity:** `limit` and `units` are positive integers. `windowSeconds` is a positive integer of at most 86,400. A `units` value above `limit` could never be admitted, so the limiter throws instead of returning a retry time. Like every limiter failure, that throw fails closed (security.md). Callers keep each request within the limit.
- **When consumers call it:** once per request, after authentication and CSRF checks and before the request opens its transaction. A request that later fails validation still counts.
- **Accepted risk:** concurrent login attempts can all pass the read-only check before any failure is counted, so a burst may get a few guesses beyond the limit in one window. Concurrency per instance bounds this; the limit is an initial target (ASM-10). Accepted by thegrimbee on 16 October 2026.

Design decision D-44 (rate-limit keys, policies and client IP):
- **Key format:** `bucket_key` is `<limit name>:<subject>`. The subject is one of:
  - `account:<UUID in lowercase>` for per-User limits;
  - `env` for the per-environment SoC limits;
  - `email:<hmac>` for normalized emails;
  - `ip:<hmac>` for client IPs.
- **HMAC:** `<hmac>` is lowercase hex HMAC-SHA256 keyed with `RATE_LIMIT_KEY_SECRET` over the UTF-8 string `<limit name>:email:<normalized email>` or `<limit name>:ip:<client IP>`. Account UUIDs are not personal contact data and are stored raw. Rotating `RATE_LIMIT_KEY_SECRET` resets email and IP counts; this is accepted.
- **Normalization:** Identity normalizes emails before building a key. The limiter receives an already normalized email and an already derived client IP.
- **Client IP:**
  - In `development` and `production`, the client IP is the trimmed `x-real-ip` header value. `X-Forwarded-For` and every other client-supplied header are ignored.
  - In `local` and `test`, and in hosted environments when `x-real-ip` is absent or empty, the client IP is the fixed placeholder `unknown`.
  - The derivation is a server-only helper in the API kernel, chosen by `APP_ENV` in the composition root. It is two named functions, not a mode flag.
- **Fixed policies:** constants in the limiter module, which are initial targets (ASM-10). Changing one is a spec change.
  - `login_failure_email` and `login_failure_ip`: 5 per 900 seconds.
  - `review_mutation`: 10 per 60 seconds per account.
  - `report_create`: 5 per 3,600 seconds per account.
- **SoC policy:** `soc_requests` (`SOC_LLM_REQUESTS_PER_MINUTE` per 60 seconds) uses the `env` subject. AI execution builds it from AI configuration (S-06). The variable is required for AI to be enabled. There is no tokens-per-minute policy (D-48).
- **Login sequence (SEC-06):**
  - Login checks both login-failure limits before verifying the password. If either rejects, it returns 429 `rate_limited` with the larger retry time and does not verify the password.
  - Unknown email, invalid password and known suspended-account attempts all follow the same failed-authentication path. Unknown emails use a fixed dummy Argon2id hash for comparable work; suspended accounts verify against their stored hash but never receive a session, even when the password is correct.
  - After that failed-authentication path, the service consumes one unit on each limit and returns the generic credential error, whatever the consume outcomes. A rejected consume at that point only means the count has already reached the limit. Suspended-account attempts therefore consume both the normalized-email and client-IP quotas; the counters retain their normal 15-minute expiry and are not reset by reinstatement.
  - A successful verification consumes nothing.

Design decision D-45 (rate-limit purge): The limiter exposes a purge operation that deletes at most 1,000 RateLimitWindow rows per call in its own short transaction. It deletes rows whose `window_start` is earlier than `now()` minus the longest fixed policy window (currently 3,600 seconds). Every such window has ended, because no window is longer than that. The review-moderation cron route (DEP-10) calls the purge once per invocation after the cron secret is verified and before its sweep. A purge failure is logged under D-47's rules and does not stop the sweep.

Design decision D-46 (audit entry validation and request IDs): The audit module validates each entry with a strict zod schema (D-22) before inserting it. A violation throws, so the caller's transaction rolls back. The rules:
- **Vocabularies:** `action` and `target_type` must come from the unions in `workflow/contracts.md` §8. They are unconstrained text in the database (D-33) but closed in code, and adding a value is a contract PR.
- **Identifiers:** `target_id`, a non-null `actor_id` and `request_id` are UUIDs.
- **Metadata shape:** metadata is a flat object of at most 20 keys. Keys match `^[a-z][a-zA-Z0-9_]{0,63}$`. Values are strings of at most 1,000 code points, finite numbers, booleans or null.
- **Forbidden keys:** these key names are rejected, compared case-insensitively with underscores removed: `password`, `passwordhash`, `token`, `sessiontoken`, `csrftoken`, `secret`, `email`, `body`, `explanation`, `snapshot`, `evidencesnapshot`, `prompt`, `response` and `output`. This check is defence in depth. Callers remain responsible for what they place in values, and their tests assert their metadata.
- **Storage:** `created_at` comes from the database clock.
- **Request IDs:**
  - For an HTTP request, including the cron routes, `request_id` is the response's `X-Request-Id`.
  - An operator command, such as Admin provisioning, generates one random UUID per run, uses it for every entry of that run and may print it.
- **No read API:** the audit module offers no read, update or delete operation.

Design decision D-47 (security event logs): Denied and failed attempts (security.md, architecture 9.5) are written as one JSON line per event with `console.warn`. They go through a server-only security-log interface in the audit module.
- **Events:**
  - `auth.login_failed`: a password verification failed.
  - `auth.login_throttled`: a login was rejected by a login-failure limit.
  - `auth.csrf_failed`: a 403 `csrf_failed` response.
  - `access.denied`: a 403 `forbidden` response.
  - `rate_limit.rejected`: a 429 from any other limit.
  - `rate_limit.purge_failed`: a D-45 purge failure.
  - 401, 409 and 422 responses are not logged.
- **Fields:** `event`, `outcome` (`failed`, `throttled` or `denied`, determined by the event) and `requestId`. The outcomes are: `auth.login_failed` and `rate_limit.purge_failed` → `failed`; `auth.login_throttled` and `rate_limit.rejected` → `throttled`; `access.denied` and `auth.csrf_failed` → `denied` (thegrimbee, 16 October 2026). When applicable, a line also carries `actorId` (the authenticated account's UUID), `limit` (the limit name) and `code` (the api.md error code).
- **Never logged:** emails, IP addresses, bucket keys, passwords, tokens, cookies, request bodies, error messages, stack traces and SQLSTATEs.
- **Failure handling:** writing a line never throws.
- **Storage:** lines stay in Vercel runtime logs, as for D-39.
- **Ownership:** S-05 provides the interface, the console implementation and a recording fake. The API kernel, Identity and K3 auth guards emit the events.

Design decision D-48 (SoCLaaS facts and model): Recorded by thegrimbee on 16 October 2026 after checking the SoC DocHub SoCLaaS guides (access, API, quickstart, usage-limits and models pages).
- **Endpoint and authentication:** the gateway is OpenAI-compatible at `https://soclaas-api.comp.nus.edu.sg`. Requests send `Authorization: Bearer <key>`. Keys have the form `clsk_<prefix>_<secret>`, are issued per SoC account, and rotating a key disables the old one at once. Gateway errors have the shape `{"error": "<message>"}` (api.md 8.4).
- **Limits:** the limits are SoCLaaS defaults per API key: 90 requests per minute, USD 80 per day and USD 800 per month, reset on UTC boundaries. SoC may also apply lifetime credits and model access policy, and may adjust the limits. The D-25 partition stays; it is safe whether the environments share one key or use separate keys. The application does not enforce lifetime credits or the monthly cap; SoC 429 responses defer work (AI-03). Expected usage is low, so this is accepted (thegrimbee, 16 October 2026).
- **No token quota:** SoCLaaS documents no tokens-per-minute limit. `SOC_LLM_TOKENS_PER_MINUTE` and the `soc_tokens` rate limit are removed. The input token cap (8,000) and the output caps (AI-03) still apply. Removing `soc_tokens` from the K6 contract was approved by both developers (Lim-ZY and thegrimbee) on 16 October 2026.
- **Model:** `SOC_LLM_MODEL` is `default`, the SoCLaaS operator-managed alias (thegrimbee, 16 October 2026). A human-run `GET /v1/models` with the project key on 16 October 2026 reported it as an alias of `qwen3.6:35b`, with a context length of 262,144 tokens and prices of 411,810 microdollars per million input tokens and 1,456,571 per million output tokens.
- **Prices:** the source is `GET /v1/models` (`soclaas.input_microdollars_per_million_tokens` and `soclaas.output_microdollars_per_million_tokens`). The models guide page lists outdated prices and is not used for them. SoC uses prices only for rate control.
- **Alias risk:** operators can repoint `default`, so its target, prices and behaviour can change without notice. The recorded model ID stays `default`, so job dedup keys and summary provenance do not detect the change, and the configured prices can drift from the real ones. This is accepted (thegrimbee, 16 October 2026). When the target changes, re-read `GET /v1/models` and update the price variables. Trial models (`x-test-1`, `x-test-2`) are not used.
- **Reasoning output (resolved by D-59):** the quickstart sends `"reasoning_effort": "none"` with Qwen and Gemma models. Reasoning output could use up the 1,000- and 1,200-token output caps (AI-03). The adapter sends it (D-59).
- **Retry-After:** the guides do not document a `Retry-After` header. Retries honour it when present and otherwise use jittered backoff (AI-03).
- **Retention and permitted data:** the guides say only that SoCLaaS records API usage and request metadata for reporting, quotas and auditing. They say nothing about prompt retention or permitted data. thegrimbee decided on 16 October 2026 that no further verification is needed, which resolves OQ-01. Provider inputs stay minimal (security.md).

Design decision D-49 (moderation prompt and policy versions): ModerationWork, AIJob and ReviewModeration record the following version identifiers (AI-02, D-17). Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026.
- **Source:** both values are string constants exported by the moderation module. The prompt version lives in `src/server/services/ai/moderation/`. The policy version lives beside the policy artifact in `src/server/services/ai/moderation/policy/` (D-17). Neither is read from configuration or the database.
- **Format:** `<name>-v<integer>`. The initial values are `review-screening-prompt-v1` and `profanity-policy-v0`.
- **v0 is unreviewed:** until OQ-04 records the reviewed policy text, the policy version is `profanity-policy-v0` and the policy artifact holds no policy text. AI-02 forbids enabling screening before the policy is reviewed, so v0 work is screened only by the fake provider (D-16). The reviewed policy starts at `profanity-policy-v1`.
- **Version change (the policy migration AI-02 requires):** when either constant changes, `pending` work recorded under the old versions is superseded at its next dispatch or sweep. Work for the current versions replaces it, so the current text is screened again under the new versions. `needs_manual_review` work, completed assessments and Admin decisions are kept and never re-screened automatically. An assessment made under other versions is never reused. The moderation module (A-03) implements this.

Design decision D-50 (ModerationWork queue writes): K9 `enqueue` and `cancelForDeletedReview` work as follows. Both run inside the caller's review-write transaction after the Review lock (contracts §3.3). Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026.
- **Model:** `enqueue` writes `model_id` NULL. The first dispatch sets it from `SOC_LLM_MODEL` (A-03). The queue therefore never reads AI configuration, and its idempotency does not depend on whether AI is enabled.
- **Idempotency:** if the Review already has a row with the same content revision, prompt version and policy version, `enqueue` inserts nothing for that revision, whatever that row's `model_id` or status. Otherwise it inserts one row with status `pending`, `execution_count` 0, `next_attempt_at` `now()` and `last_attempt_at` NULL. `enqueue` never reactivates a row in a final status. Reactivating work when an admin-hidden Review is restored (AI-02) belongs to the moderation module, not to `enqueue`.
- **Supersession:** in the same call, every row of the Review with a lower content revision and status `pending`, `running` or `needs_manual_review` becomes `superseded`. Rows for the same revision are not changed. A late result for a superseded `running` row is rejected, because completion requires status `running` (A-03) and the K8 revision guard.
- **Cancellation:** `cancelForDeletedReview` sets every row of the Review with status `pending`, `running` or `needs_manual_review` to `cancelled`. With no such row it does nothing. Rows that are `completed`, `superseded` or `cancelled` are unchanged. The admin-hide cancellation (A-04) uses the same set of statuses.
- **Side effects:** both operations set `updated_at` (D-33). Neither changes `execution_count`, `last_attempt_at` or any Review row, and neither calls the provider. An unknown Review violates the foreign key, so the call throws and the caller's transaction rolls back.

Design decision D-51 (Movie locks, review-change marker and summary schedule): K7 works as follows. Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026.
- **Locks:** `lockActiveMovieForUpdate` takes `FOR UPDATE`, and `lockActiveMovieShared` takes `FOR SHARE`, before checking `archived_at`. On an archived Movie they return `archived` while holding the lock, and the caller rolls back. Holding the lock is what makes archiving serialize with review writes (FR-05 edge case).
- **When a Review mutation advances the marker:** when the set of eligible Reviews changes, or when the mutation changes the rating or body of a Review that is eligible before it. A rating-only edit of an eligible Review therefore advances it, because the rating changes the aggregate and the summary input (FR-08, INV-09, AI-01). A rating-only edit of a pending, flagged, hidden or deleted Review does not. A mutation that changes nothing never advances it (data-model.md).
- **`markReviewsChanged`:** sets `reviews_revision` + 1, `summary_pending_since = coalesce(summary_pending_since, now())` and `updated_at = now()`, and returns the new revision. It does not change `Movie.version`, which stays the If-Match token for Admin Movie edits, archive and restore (api.md 8.1). It does not change `summary_next_attempt_at` or `summary_last_attempt_at`, because new changes do not bypass backoff (AI-01). It does not inspect the lock's `archived` flag, because archive and restore call it after changing `archived_at`. Other callers reach it only for active Movies, because eligibility requires one.
- **`recordSummaryAttempt`:** sets `summary_last_attempt_at = now()`, `summary_next_attempt_at` to the given time and `updated_at`. It does not change the revision or the pending time.
- **`recordSummaryPublished`:** when the Movie is active and `reviews_revision` equals the published revision, it sets `summary_pending_since` NULL, `summary_last_success_at = now()` and `updated_at`. It leaves `summary_next_attempt_at` as the attempt set it. Otherwise it returns `stale` and writes nothing.

Design decision D-52 (contract stubs before the AI runtime): The contract-stub task (B#4) delivers the real K7 (D-51) and the real K9 `ModerationWorkQueue` (D-50), with PostgreSQL integration tests. Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026.
- **Stubs:** two stubs are production code. `attemptAfterCommit` in the moderation module returns `deferred`, and the K10 controller stub in `src/server/services/ai/runtime/` returns `disabled`. Neither calls the provider or writes anything. They leave ModerationWork columns unchanged, so never-attempted work keeps its place in the sweep order (AI-02). They create no AIJob, lease, budget or rate-limit rows, and they change no Review. A-03 replaces the dispatcher stub and S-06 replaces the controller stub.
- **Wiring:** the composition root wires both stubs and does not construct an LLM provider until S-06. Production may run the stubs, because they fail closed and production AI stays disabled under D-16 either way. R-04 verifies that the real implementations are wired before D-16's posture ends.
- **Fakes:** the call-recording fakes live in `tests/support/fakes/`. The deterministic LLM fake lives in `src/server/adapters/soc-llm/` (contracts §1 rule 6, D-16).
- **Adapter shape:** the adapter fixes its model when it is constructed (from `SOC_LLM_MODEL`) and exposes it as `modelId`. The deadline is passed as an `AbortSignal` that the controller derives from the attempt timeout and the execution deadline. This is how K10 meets api.md 8.2.

Design decision D-53 (deterministic LLM fake): `FakeLlmProvider` (D-16, D-52) behaves as follows. Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026.
- **Script:** each `complete` call consumes the next scripted outcome in order. Once the script is used up, each call returns `unavailable` (contracts §13). An aborted call also consumes its outcome, so call counts stay predictable.
- **Outcomes:** success with usage; success with unknown usage (`usage: null`); malformed output; any `LlmFailure` (`rate_limited` with or without `retryAfterSeconds`, `timeout`, `unavailable`, `rejected`, `malformed_response`); and `hang`, which settles only when the signal aborts.
- **Malformed output:** a success whose `content` is not valid JSON or breaks the output schema. This is what a real gateway returns when the model writes bad output, and the caller's `validate` rejects it as `invalid_output` (AI-02 sends that to manual review). `malformed_response` stays a separate failure for a gateway reply the adapter itself cannot parse.
- **Abort:** if the signal is already aborted when `complete` is called, or aborts while the call is pending (only `hang` is ever pending), the result is `timeout`. The fake never rejects its promise.
- **Scope (D-57):** tests construct it directly. The composition root never builds it; running servers use the marker fake instead.
- **Model:** the constructor requires a model ID, and `modelId` reports it unchanged. There is no default model ID.
- **Inspection:** the fake records each request's messages and `maxOutputTokens`, so tests can check input bounding and prompt/data separation (AI-04). It never logs them.
- **Determinism:** no randomness, wall clock or network. Responses do not depend on message content.

Design decision D-54 (moderation work for hidden or deleted Reviews): Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Author edits:** FR-03 lets an author edit or delete their own Review whether or not an Admin has hidden it, and the User API is unchanged. An edit never changes `hidden_at`, so the author still cannot undo a hide (FR-03). A body edit or resubmission of a hidden Review increments `content_revision`, resets clearance to `pending` and calls K9 `enqueue`, like any other (AI-02: every body edit saves pending work).
- **Dispatch:** neither `attemptAfterCommit` nor the recovery sweep sends a hidden or deleted Review to the provider. The dispatcher re-reads the Review in a transaction that holds the Review lock (D-58). If the Review is hidden or deleted, it sets that work `cancelled` and returns `not_current`. This is the AI-02 cancellation of work for admin-hidden Reviews. It creates no AIJob and changes no `execution_count`. It reserves no budget and consumes no rate limit.
- **Sweep selection:** due-work selection excludes work whose Review is hidden or deleted, so such work never takes the sweep's one-Review slot. The re-read under the lock covers a hide or delete that races the selection.
- **Archived Movies:** unchanged. Work is deferred until the Movie is restored (AI-02).

Design decision D-55 (reactivation when a hidden Review is restored): Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026; Developer B delegated the choice to the agent's recommendation.
- **When:** in the A-04 restore transaction, after K8 `restoreHiddenReview` succeeds, the moderation module acts only when the Review's `moderation_state` is `pending` and it is not deleted. Restore never undoes a deletion (data-model.md), and flagged or cleared Reviews need no screening (AI-02).
- **Which row:** the row for the Review's current content revision under the current prompt and policy versions (D-49).
  - If that row is `cancelled`, it becomes `pending` in place with `next_attempt_at = now()` and `updated_at` set. Its `execution_count`, `last_attempt_at` and `model_id` are kept, so the three-execution limit still counts per content revision (AI-02). Work already at the limit moves to `needs_manual_review` at its next dispatch without a provider call.
  - If that row is in any other status, nothing changes.
  - If there is no such row (for example after a version change), one row is inserted exactly as D-50 `enqueue` inserts it.
- **Only this transition leaves `cancelled`.** `enqueue` still never reactivates a final row (D-50). Rows for other revisions or versions stay as they are.
- **No dispatch from the restore route:** the Admin restore request makes no provider call. The recovery sweep screens the reactivated work, and no Admin action is needed to start it (AI-02).

Design decision D-56 (no live screening under the unreviewed policy): Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026; Developer B delegated the choice to the agent's recommendation. AI-02 forbids screening before the policy is reviewed, and D-49 records `profanity-policy-v0` as unreviewed.
- **Rule:** when AI is enabled with `AI_PROVIDER=soc_llm` and the policy version is `profanity-policy-v0`, the composition root wires the D-52 dispatcher stub instead of the real dispatcher. It also logs one configuration issue naming `AI_PROVIDER` (D-37, values never logged). With `AI_PROVIDER=fake`, or with a reviewed policy version, it wires the real dispatcher. Summaries are unaffected.
- **Form:** two named constructors chosen in the composition root, not a flag passed into the moderation module (contracts §1 rule 2). A unit test covers the choice.
- **Effect:** review work stays `pending` and durable. Once a reviewed version ships, D-49's version-change rule supersedes the v0 work and screens the current text again.
- **Owners:** the A-03 wiring implements this rule, including the log line (D-71, D-78), and R-04 verifies it.

Design decision D-57 (LLM fake in running servers): Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Which fake:** when `AI_PROVIDER=fake`, the composition root builds `MarkerFakeLlmProvider` in `src/server/adapters/soc-llm/`, with `modelId` from `SOC_LLM_MODEL`. The scripted `FakeLlmProvider` (D-53) is used only by tests that construct services directly.
- **Markers:** the outcome comes from the first marker of the form `[fake-llm:<outcome>]` in a `user`-role message. The system message is never scanned. The outcomes are:
  - `clean`: a valid AI-02 `no_profanity_detected` output;
  - `flag`: a valid AI-02 `uncertain` output with no matches;
  - `summary`: a valid AI-01 summary output;
  - `invalid`: content that fails `validate`;
  - `unavailable`, `rejected`, and `rate_limited` with `retryAfterSeconds` null;
  - `timeout`: the call waits until the signal aborts and then returns `timeout`.
- **Fail closed:** no marker, or an unknown marker, gives `unavailable`, so the fake never clears a Review unless the text asks it to (contracts §1 rule 6). A marker that does not fit the feature gives that feature's invalid-output path.
- **Canned outputs and usage:** the outputs are constants beside the fake, and unit tests check them against the AI-02 and AI-01 output schemas (delivery of those tests: D-70). Usage is a fixed constant.
- **No state:** the fake holds no script, no request log and no mutable field (D-23). Concurrent requests and parallel Playwright workers therefore get predictable outcomes, and no review text is kept in memory. It never logs content.
- **E2E (amends D-42):** when R-02 adds the AI journeys, the e2e environment sets `AI_ENABLED=true` and `AI_PROVIDER=fake`. It uses synthetic placeholders for the SoC variables: `SOC_LLM_BASE_URL=https://fake-llm.invalid`, a non-secret placeholder `SOC_LLM_API_KEY`, `SOC_LLM_MODEL=fake-model`, and the required numeric variables. The fake never reads the URL or key. Local and development use the same placeholders. Until R-02, the e2e environment keeps `AI_ENABLED=false`.
- **Test design:** a summary request contains several review bodies, and the first marker wins. E2E fixtures therefore keep the moderation markers of reviews submitted through the UI out of the samples that carry a `summary` marker, for example by using a different Movie.
- **Accepted risk:** in development, any User can choose their own Review's screening outcome with a marker. Development holds only synthetic data (DEP-04), and production cannot select the fake (D-37, `src/server/config/ai.ts`). Accepted by thegrimbee (delegated) on 17 October 2026.

Design decision D-58 (ModerationWork locking): Approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Rule:** every insert or update of a ModerationWork row happens in a transaction that holds its Review's `FOR UPDATE` lock, taken in the D-20 order (Movie, then Review). This covers:
  - `enqueue` and `cancelForDeletedReview` in the review write;
  - A-04 approve, hide and restore (D-55);
  - the report-acceptance hide (A-05);
  - every A-03 transaction that claims, cancels (D-54), completes or routes work to manual review.
- **Why:** under that lock, D-50's check followed by an insert cannot race. The database key also includes `model_id` (`NULLS NOT DISTINCT`), so it cannot enforce D-50 idempotency on its own. No migration is needed.
- **Position:** ModerationWork rows are locked after Movie and Review (D-20, "other tables afterwards"), and before the AIJob lease check in a publish transaction (P-08). No transaction locks ModerationWork and then a Movie or Review. Several rows of one Review are locked in ascending ID order (D-20).
- **K10 bookkeeping:** an A-03 transaction that writes ModerationWork never writes K10 bookkeeping rows (SchedulerLease, AIBudgetDay, AIBudgetReservation, AIJob creation). Those stay in K10's own short transactions (P-04, P-13).
- **Unlocked selection:** due-work selection is an unlocked read, and the locking transaction re-checks status and Review state.
- **Scope:** which columns a claim changes, and when `execution_count` advances, are A-03's. Capacity deferral still consumes no execution (AI-02).

Design decision D-59 (SoC chat request and response): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation. Resolves the open `reasoning_effort` point of D-48.
- **Request body:** `POST /v1/chat/completions` with exactly `model` (the adapter's fixed model), `messages` (role and content as given), `max_tokens` (the caller's output cap), `stream: false` and `reasoning_effort: "none"`. No temperature, tools, `response_format` or JSON mode (api.md 8.4). Redirects are not followed, so the bearer key is never sent to another host.
- **Why `reasoning_effort: "none"`:** the SoC quickstart sends it with Qwen models, `default` points to a Qwen model (D-48), and reasoning output would use up the 1,000- and 1,200-token caps (AI-03). If the gateway refuses the field, the 400 maps to `rejected` (D-60) and AI fails safe.
- **Verification:** the provider validation that must pass before `AI_ENABLED=true` (deployment.md 10.3) includes one real call with this body, confirming that `max_tokens` and `reasoning_effort` are accepted.
- **Success:** HTTP 200, a JSON object, `choices[0].message.content` a string and `choices[0].finish_reason` equal to `stop`. Anything else is `malformed_response`, including `length` (truncated output), missing or empty `choices`, null or non-string content and a non-JSON body. Other fields, including any reasoning field, are ignored and never logged.
- **Usage:** `usage.prompt_tokens` and `usage.completion_tokens`, when both are non-negative integers, become `TokenUsage`. Otherwise usage is null (unknown) and is charged conservatively (D-63). Amended: values above 2,147,483,647 also give null usage (D-75); redirects are read as `misconfigured` (D-74).

Design decision D-60 (SoC HTTP outcome mapping): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation.
- **429:** `rate_limited`. `retryAfterSeconds` is the `Retry-After` value when it is a non-negative integer number of seconds, and null otherwise (including the HTTP-date form).
- **408:** `timeout`.
- **Other 4xx** (400, 401, 403, 404 and the rest): `rejected`. 401 and 403 are configuration faults; they fail safe and are not retried.
- **5xx, and network, DNS, TLS or connection errors:** `unavailable`.
- **Abort of the deadline signal**, before or during the response body: `timeout`.
- **Containment:** error bodies, provider messages, URLs and the key are never logged, returned or stored. `complete` never rejects.
- **Amended:** 401, 403, 404 and 3xx are `misconfigured` (D-74); `Retry-After` is capped and bodies are bounded (D-75).

Design decision D-61 (retries and execution outcomes): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Retried** (a second attempt, only within D-65's time rules): `rate_limited`, `timeout` and `unavailable`, matching AI-03's transient network errors, 429 and 5xx. **Not retried:** `rejected`, `malformed_response` and output that fails `validate`.
- **Backoff before the second attempt:** `Retry-After` when present; if it does not fit in the time left, there is no second attempt. Otherwise a jittered delay (D-69).
- **Outcome from the last attempt:**
  - `rate_limited`: `deferred` with that attempt's `retryAfterSeconds`;
  - `timeout` or `unavailable`: `failed` with cause `transient`;
  - `rejected` or `malformed_response`: `failed` with cause `provider_rejected`;
  - `validate` failure: `failed` with cause `invalid_output`.
- **Why 429 defers:** SoC returns 429 for both rate and budget limits (D-48), D-25 says SoC 429 responses defer work, and AI-02 says capacity deferrals consume no execution. `deferred` may therefore be returned after an AIJob exists. That job ends `failed` with `error_code` `provider_rate_limited`; the outcome still carries no job ID.
- **Accepted risk:** a lasting SoC limit (for example the monthly cap, which the application does not enforce) defers work indefinitely without manual-review escalation. Backoff and the daily sweep bound the calls, and held-work monitoring (AI-02) shows the backlog.
- **AIJob final status:** `published` gives `succeeded`; `failed` and a deferral after job creation give `failed`; `stale` gives `stale`. Which transaction writes each status: D-73. Configuration faults defer (D-74).

Design decision D-62 (SoC request quota per request): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Rule:** each provider request consumes one `soc_requests` unit through K6, in K6's own transaction with no transaction open, immediately before that request. An execution therefore consumes one or two units.
- **First attempt:** the unit is consumed before the step-1 transaction. If it is denied, `run` returns `deferred` with K6's `retryAfterSeconds` and writes nothing else. If step 1 then defers (slot or budget), the unit stays spent; over-counting is conservative.
- **Second attempt:** if its unit is denied, there is no second attempt, and the outcome comes from the first attempt under D-61.
- **Amended:** an unlocked slot pre-check runs before the first unit is consumed (D-77).
- **Why:** SoC's limit counts requests (CON-02, D-48), and AI-03 allows two per execution. Consuming before step 1 means no job or reservation rows exist for a request that cannot be sent.

Design decision D-63 (daily budget lifecycle): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Budget day:** the UTC date from the database clock at step 1. Step 1 creates the AIBudgetDay row when it is missing, with `budget_microdollars` from `AI_DAILY_BUDGET_MICRODOLLARS`. Each step 1 sets `budget_microdollars` to the larger of the configured value and `reserved + consumed`, so a configuration change applies the same day and the check constraint always holds. A reservation is always settled against its own budget day, even after midnight.
- **Reserve:** the AI-03 amount R, from the D-68 estimate. If `reserved + consumed + R` exceeds the budget, `run` returns `deferred` (D-67) and writes nothing.
- **Charge per attempt:**
  - an attempt that reports usage: ceil((input tokens × input price + output tokens × output price) ÷ 1,000,000), the AI-03 formula with reported usage;
  - an attempt answered with a 4xx status other than 408: 0, because the gateway refused it before generation;
  - any other attempt (timeout, abort, network error, 5xx, malformed response): R, because its usage is unknown.
- **Reconciled:** used when some attempt may have incurred cost. The charge is the sum of the attempt charges, so two unknown-cost attempts charge 2R. `input_tokens`, `output_tokens` and `actual_microdollars` are recorded only when every costed attempt reported usage, and are null otherwise.
- **Released:** used when no request could have incurred cost (none was sent, or every request was refused with a 4xx other than 408). `actual_microdollars` is 0 and the token columns are null.
- **AIBudgetDay movement:** reserve adds R to `reserved_microdollars`. Settling subtracts R from `reserved_microdollars` and adds the charge to `consumed_microdollars`, capped at the remaining headroom so the check constraint holds (no migration). The reservation row keeps the true amount. Under-recording above the cap is accepted, because SoC's 429 is the hard limit (D-25, D-48).
- **Abandoned reservations** are settled under D-66 at R × `AI_MAX_ATTEMPTS` (D-73).
- **Amended:** settlement guards are in D-73; a budget deferral commits the expiry (D-77); a 3xx or a configuration-fault 4xx is charged 0 (D-74).

Design decision D-64 (AIJob column values): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Subject and trigger:**
  - Summary: `subject_id` is the Movie ID, `input_revision` is `reviewsRevision`, `trigger` is `scheduler` and `requester_id` is null.
  - Moderation: `subject_id` is the Review ID, `input_revision` is the captured `contentRevision`, and `trigger` is `review_write` when `requesterId` is set and `scheduler` otherwise.
  - `model_id` is the provider's `modelId`. `policy_version` is null for summaries.
- **`dedup_key`:** `JSON.stringify` of an array, so components can never run together:
  - `["summary", movieId, reviewsRevision, modelId, promptVersion]`;
  - `["review_moderation", reviewId, contentRevision, modelId, promptVersion, policyVersion]` (the AI-02 dedup components).
- **`input_hash`:** lowercase hex SHA-256 (`node:crypto`, no new dependency) of `JSON.stringify` of the messages as `{role, content}` objects in order.
- **`attempt_count`:** the number of provider requests sent, 0 to 2.
- **`lease_until`:** D-65.
- **`expires_at`:** `created_at` plus 7 days, the input-snapshot retention deadline (data-model.md retention proposal). Purging is retention work under OQ-05, not S-06.
- **`bounded_input_snapshot`:** the caller's `BoundedInput.snapshot` exactly as given. The controller adds no prompt text and no provider response.
- **`error_code`:** null on success, otherwise one of `provider_rate_limited`, `provider_timeout`, `provider_unavailable`, `provider_rejected`, `provider_malformed_response`, `provider_misconfigured` (D-74), `invalid_output`, `deadline_exceeded`, `publish_stale`, `storage_failed` (D-75) or `lease_expired`. It never holds provider text.

Design decision D-65 (execution limits, deadline and lease timing): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Configuration maxima** (deployment.md 10.3; minimum deadline in D-76): `AI_MAX_CONCURRENT_REQUESTS` at most 1, `AI_MAX_ATTEMPTS` at most 2, `AI_ATTEMPT_TIMEOUT_MS` at most 30000 and `AI_EXECUTION_DEADLINE_MS` at most 75000. A larger value is a configuration issue that disables AI (D-28, D-37). Smaller values are allowed, for example in tests. **Why:** AI-03 fixes these limits, the single `ai_execution` row holds one execution, and a 90-second lease stays under the 120-second `maxDuration`.
- **Lease:** the `ai_execution` lease and AIJob `lease_until` are the step-1 database time plus `AI_EXECUTION_DEADLINE_MS` plus 15 seconds (data-model.md SchedulerLease). O-29's 90 seconds is the value at the default deadline.
- **Deadline:** measured from the start of `run` on the server's monotonic clock. Provider attempts must end 5 seconds before the deadline, leaving time for storage. Each attempt's `AbortSignal` fires at the earlier of the attempt timeout and that point. A second attempt starts only if, after its backoff, at least 5 seconds remain before that point.
- **Late validation:** the publish transaction starts only before the deadline. Otherwise nothing is published, the outcome is `failed` with cause `transient`, and `error_code` is `deadline_exceeded`.
- **Late commit:** a publish transaction that reaches the P-08 check after the AIJob lease has expired rolls back, giving `stale` with `error_code` `lease_expired`.
- **Settlement:** the final settlement transaction always runs, whatever the deadline.
- **Amended:** deadline coverage, the first-attempt rule and the 15,000 ms minimum are in D-76; bookkeeping faults in D-75.

Design decision D-66 (slot acquisition and abandoned work): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Acquire:** the step-1 transaction locks the `ai_execution` row `FOR UPDATE`, inserting it first with an expired lease if it is missing. If it is held and unexpired, the transaction rolls back and `run` returns `deferred` with the D-67 `retryAfterSeconds`. If it is free or expired, `run` takes it with a new `lease_token` and the D-65 `lease_until`.
- **Expire abandoned work:** in the same transaction, every `running` AIJob whose `lease_until` has passed becomes `stale` with `error_code` `lease_expired`. Its `reserved` reservation is reconciled at R with null usage, against its own budget day (D-63).
- **Lock order:** P-13, with several rows of one table locked in ascending key order (budget days by date, reservations and jobs by ID). The new running AIJob and then its reservation are inserted last; the foreign key requires the job first (D-73).
- **Duplicate:** if the AIJob insert conflicts with `ai_job_running_dedup_key_key`, the whole transaction rolls back and `run` returns `duplicate` with the running job's ID. With one slot this is a guard that should not be reached.
- **Release:** release changes the lease only where `lease_token` matches, so a holder whose lease was taken over never releases the new holder's lease. `withSweepLease` uses the same guarded acquire and release, with 150-second leases.
- **Who expires:** only `run`'s step 1, so recovery is automatic (AI-03) and no separate cleanup job exists. Paths that never reach step 1 leave abandoned rows until the next one (D-77). Guards, abandoned-reservation charges and lock modes: D-73.

Design decision D-67 (`deferred` retry hints): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Values of `retryAfterSeconds`:**
  - request quota denied: K6's value (§9);
  - `ai_execution` slot held: the seconds until that lease's `lease_until`, rounded up, at least 1;
  - daily budget exhausted: the seconds until the next UTC midnight, rounded up, at least 1;
  - provider 429 after the last attempt: that attempt's `Retry-After` under D-60, or null.
- **Source:** lease and midnight times come from the database clock in the step-1 transaction.
- **Use:** the value is a hint. Callers may schedule the next attempt no earlier than it, and keep their own backoff and AI-02 limits. Amends the null value in D-66.

Design decision D-68 (input estimate and output cap checks): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation.
- **Estimate:** the controller recomputes the AI-03 estimate (O-26) from `messages` and uses the larger of its value and the caller's `estimatedInputTokens`. The recomputed estimate is used both for the input cap and for the reservation. A caller's estimate therefore never lowers either.
- **Input cap:** an estimate above `AI_INPUT_TOKEN_LIMIT` returns `input_too_large` before any quota, lease, reservation or job write.
- **Output cap:** `maxOutputTokens` must be a positive integer of at most 1,200, the larger AI-03 cap. Any other value is a caller bug: `run` throws before any write.
- **Context:** no context-length variable is added. With the verified 262,144-token context (D-48), 8,000 input plus 1,200 output always fits. If a model change reduces the context, `AI_INPUT_TOKEN_LIMIT` is lowered as deployment.md 10.3 already says.

Design decision D-69 (retry backoff and injected time sources): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation. Amends the backoff bullet of D-61.
- **Backoff:** with no `Retry-After`, the delay before the second attempt is uniformly random between 1,000 and 3,000 milliseconds. With `Retry-After`, the delay is exactly that many seconds. In both cases the D-65 time rules decide whether the second attempt starts.
- **Testability:** the controller receives its random source, monotonic clock and sleep function as constructor dependencies. The composition root passes the real ones, and tests pass deterministic ones. These are injected values, not shared mutable state (D-23).

Design decision D-70 (marker fake delivery and output-schema tests): Approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026; Developer B delegated the choice to the agent's recommendation. Amends the canned-output tests of D-57.
- **S-06 delivers** `MarkerFakeLlmProvider` (D-57) and its unit tests:
  - marker selection, where the first marker in a `user` message wins and the system message is never scanned;
  - no marker or an unknown marker gives `unavailable`;
  - `timeout` waits for the signal to abort;
  - statelessness;
  - the promise never rejects.
- **Schema tests move:** the AI-01 and AI-02 output schemas do not exist yet. The task that adds each schema adds the D-57 conformance test for the fake's constants in `tests/`: U-04 (Developer A; Developer B since D-85) for `summary`, and A-03 (Developer B) for `clean` and `flag`. Until then, S-06 writes the constants to match the field rules in ai.md AI-01 and AI-02.
- **Why:** S-06 must not create or import feature-owned schemas. The conformance test still exists before any journey depends on the fake's outputs (R-02).

Design decision D-71 (S-06 paths and wiring): Recorded by thegrimbee on 18 October 2026 from the S-06 analysis; Developer B delegated the choice to the agent's recommendation. Every path below is owned by Developer B. Resolves the conflict between PLAN.md S-06's allowed paths and D-52, D-56, D-57, D-65 and architecture.md 6.6.
- **Allowed paths** (PLAN.md S-06):
  - `src/server/adapters/soc-llm/` and `src/server/services/ai/runtime/`;
  - `src/server/repositories/ai/`, for new runtime repositories over SchedulerLease, AIBudgetDay, AIBudgetReservation and AIJob only. The ModerationWork repository is A-03's and stays unchanged.
  - `src/server/config/ai.ts`, for the D-65 maxima and the D-76 and D-78 minima only;
  - `src/server/composition.ts`, for AI runtime wiring only;
  - `tests/`.
- **Wiring:**
  - When AI is enabled, the composition root builds the provider (`MarkerFakeLlmProvider` for `fake`, the SoC adapter for `soc_llm`), the real controller and `SchedulerLeases`.
  - When AI is disabled, it keeps the D-52 controller stub and builds no provider.
  - The K9 dispatcher stays the D-52 stub. A-03 wires the real dispatcher and implements D-56's choice between them.
- **Import boundary** (AM-18): `adapters/soc-llm` may be imported only by `services/ai/runtime/`, `composition.ts` and `tests/`. `tests/unit/ai/llm-fake-boundary.test.ts` is updated to check that rule, and to check by file name that only the scripted fake (`fake-llm-provider.ts`, D-53) is never imported by `src/` outside the adapter. The check matches the text `fake-llm-provider` anywhere in a file, so the marker fake's file name must not contain it (D-78).

Design decision D-73 (job finalization and settlement guards): Recorded by thegrimbee on 19 October 2026 from the S-06 architect review (H1, M1, M3, L5, L11). Approved by both developers (Lim-ZY and thegrimbee) on 19 October 2026; Developer B delegated the choice to the agent's recommendation. Amends D-61's final-status bullet, D-63's abandoned-reservation bullet and D-66's expiry bullet (contracts §25).
- **`succeeded` is written in the publish transaction.** The P-08 check is one guarded `UPDATE` of the AIJob that sets `status = 'succeeded'`, `attempt_count`, a null `error_code` and `updated_at` where `status = 'running'` and `lease_until > clock_timestamp()`. If it updates no row, the publish transaction rolls back and the outcome is `stale` with `error_code` `lease_expired`. A committed publish therefore always has a `succeeded` job.
- **`failed` and `stale` are written in the settlement transaction**, with `attempt_count` and `error_code`, only where `status = 'running'`. If the row is no longer running (the D-66 expiry got there first), nothing is written.
- **`attempt_count`** is written with the final status. A job expired under D-66 keeps the value step 1 wrote (0), so on a `lease_expired` job it is a lower bound.
- **Each reservation is settled once.** Settlement changes a reservation only where `status = 'reserved'`, and moves AIBudgetDay only when that update changed a row. The settlement transaction and the D-66 expiry may race; whichever commits first settles, and the other does nothing.
- **Abandoned reservations:** step 1 settles every `reserved` reservation whose AIJob `lease_until` has passed, whatever the job's status. This covers a function killed after its publish committed but before settlement. The charge is R × `AI_MAX_ATTEMPTS`, the most an execution can incur under D-63, recorded as `reconciled` with null usage and null `actual_microdollars`, and capped at the day's headroom (D-63). Running jobs whose lease has passed become `stale` with `lease_expired`, as in D-66.
- **Lock modes:** K10 locks AIJob rows only through `UPDATE` (a no-key-update row lock), never `SELECT … FOR UPDATE`. A publish callback's inserts into ReviewSummary or ReviewModeration take a key-share lock on the AIJob through the `job_id` foreign key before the P-08 update. Key-share does not conflict with no-key-update, so an expiry or settlement never waits on it, and the P-08 update is the last lock K10 itself takes. SchedulerLease and AIBudgetDay rows are locked with `SELECT … FOR UPDATE`.
- **Order of new rows:** P-13's order applies to existing rows. A new AIJob is inserted before its reservation because of the `ai_job_id` foreign key; new rows are invisible to other transactions, so this does not affect lock ordering.
- **Clock:** lease comparisons in K10 transactions use `clock_timestamp()`, not `now()`, because `now()` is the start of a transaction that may have waited on domain locks.
- **Tests:** PostgreSQL integration tests cover expiry racing a late settlement, expiry racing a publish, and a reservation left `reserved` after a committed publish.

Design decision D-74 (provider configuration faults): Recorded by thegrimbee on 19 October 2026 from the S-06 architect review (H2, L1). Approved by both developers (Lim-ZY and thegrimbee) on 19 October 2026; Developer B delegated the choice to the agent's recommendation. Amends D-59's redirect rule, D-60's 4xx bullet, D-61's outcome list, D-63's zero-charge rule and D-64's `error_code` list. U-04 and A-03 receive `deferred` in a new case (contracts §25, AM-21).
- **New failure kind:** `LlmFailure` gains `{ kind: "misconfigured" }`. The adapter returns it for 401, 403 and 404, and for any 3xx. Requests use `redirect: "manual"`, so a redirect is seen as its status and the key is never sent to another host.
- **Handling:** not retried; charged 0, like other refused requests; outcome `deferred` with `retryAfterSeconds` null; the AIJob ends `failed` with `error_code` `provider_misconfigured`. Like a provider 429 (D-61), it consumes no AI-02 execution and never sends work to manual review.
- **Unchanged:** 400 and every other 4xx except 401, 403, 404, 408 and 429 remain `rejected`, so a gateway refusal of `reasoning_effort` still fails safe as `provider_rejected`. The D-59 provider validation before `AI_ENABLED=true` covers that case. Any status in 1xx or 2xx other than 200 is `malformed_response`.
- **Why:** rotating a SoC key disables the old one at once (D-48), and D-49 never re-screens `needs_manual_review` work automatically. Mapping configuration faults to manual review would strand every Review written while the key is wrong. Deferring keeps the work pending, and screening resumes with no Admin action once the configuration is fixed.
- **Accepted risk:** while the key or base URL is wrong, work defers indefinitely, as for a lasting SoC limit (D-61). Held-work monitoring (AI-02) shows the backlog.

Design decision D-75 (bookkeeping faults and untrusted provider values): Recorded by thegrimbee on 19 October 2026 from the S-06 architect review (M2, L2, L3). Approved by both developers (Lim-ZY and thegrimbee) on 19 October 2026; Developer B delegated the choice to the agent's recommendation. Amends D-59, D-60 and D-64 (contracts §25).
- **`run` never throws**, except for the D-68 output-cap caller bug. Its own faults map as follows:
  - the K6 consume or the step-1 transaction fails (conflict, timeout, connection): `deferred` with `retryAfterSeconds` null. The step-1 transaction rolled back, so nothing was written.
  - the publish transaction fails for any reason other than the callback's `stale` result or the D-73 lease guard (conflict, timeout, a throw from `publish`), or `validate` throws: `failed` with cause `transient` and `error_code` `storage_failed` (added to D-64's list). There is no second publish attempt.
  - the settlement transaction fails: it is not retried, and the outcome already decided is returned unchanged, so a published result stays `published`. The lease expires, and the next step 1 settles the reservation and expires the job under D-73. The job may then end `stale` although the caller saw `failed`.
- **Usage values:** usage is accepted only when both values are integers from 0 to 2,147,483,647, the range of the `integer` token columns; otherwise usage is null (amends D-59). A computed charge that is not a safe integer counts as unknown and is charged R.
- **`Retry-After`:** a value above 86,400 seconds is treated as 86,400 (amends D-60).
- **Response bodies:** the adapter reads the body of a 200 response only, and at most 1 MiB of it; a longer body is `malformed_response`. Error-response bodies are discarded unread.

Design decision D-76 (deadline coverage and timing budget): Recorded by thegrimbee on 19 October 2026 from the S-06 architect review (M4, L10). Approved by both developers (Lim-ZY and thegrimbee) on 19 October 2026; Developer B delegated the choice to the agent's recommendation. Clarifies AI-03's "execution deadline including storage" and amends D-65.
- **Coverage:** the 75-second deadline covers `run`'s quota consume, step 1, provider attempts and `validate`, and the publish transaction must start before it (D-65). The publish and settlement transactions themselves are bounded by K1's limits (5-second connection acquire, 5-second statement timeout), not by the deadline signal.
- **Timing budget:** the 45 seconds between the deadline and `maxDuration = 120` cover the route's own work before `run` (its K6 consumes and its review-write or claim transaction), the publish and settlement transactions, and the response. A function killed after the publish commit is recovered by D-73.
- **First attempt:** like the second (D-65), it starts only if at least 5 seconds remain before the attempt end point. Otherwise no request is sent, the reservation is `released`, the job ends `failed` with `deadline_exceeded`, and the outcome is `failed` with cause `transient`.
- **Minimum:** `AI_EXECUTION_DEADLINE_MS` below 15,000 is a configuration issue that disables AI, so the first attempt always has a usable window. Tests that construct the controller directly control time through the injected clock (D-69).

Design decision D-77 (quota pre-check and expiry reach): Recorded by thegrimbee on 19 October 2026 from the S-06 architect review (M5, L16). Approved by both developers (Lim-ZY and thegrimbee) on 19 October 2026; Developer B delegated the choice to the agent's recommendation. Amends D-62's first-attempt bullet, D-63's budget-deferral rule and D-66's "Who expires" bullet (contracts §25).
- **Slot pre-check:** before consuming the first `soc_requests` unit, `run` reads the `ai_execution` lease without a lock. If it is held and unexpired by the database clock, `run` returns `deferred` with the D-67 slot hint and consumes nothing. Step 1 stays authoritative. There is no budget pre-check, because only step 1 settles abandoned reservations (D-73).
- **Budget deferral commits the expiry:** when step 1 finds the budget insufficient, it commits the D-66 and D-73 expiry, then returns `deferred`. It does not take the slot or insert a job or reservation. Abandoned jobs and reservations are therefore settled even on a day whose budget is spent.
- **Who expires:** only step 1. Paths that never reach it (AI disabled, the D-52 and D-56 stubs, a quota denial, the slot pre-check, `input_too_large`) leave abandoned rows until the next step 1. This is safe: every use of the slot, the budget or a dedup key passes through step 1, which expires abandoned rows first. This is how K10 meets AI-03's "expire abandoned leases on later access".
- **ModerationWork:** K10 never touches ModerationWork (D-58). A-03 must recover work that a crashed execution left `running`; how it detects such work is an A-03 decision.
- **Accepted risk:** concurrent requests that all pass the pre-check still spend units before step 1 defers all but one. This over-counts conservatively (D-62).

Design decision D-78 (S-06 wiring, configuration and test details): Recorded by thegrimbee on 19 October 2026 from the S-06 architect review (L4, L7, L12–L15); Developer B delegated the choice to the agent's recommendation. Every item is in Developer B paths.
- **Budget day:** computed in SQL as the UTC date of the step-1 transaction time, with `AT TIME ZONE 'UTC'`, never from the session time zone.
- **Budget minimum:** `AI_DAILY_BUDGET_MICRODOLLARS` below the AI-03 reservation for `AI_INPUT_TOKEN_LIMIT` input tokens and 1,200 output tokens at the configured prices is a configuration issue that disables AI. Otherwise one reservation could never fit a day and would defer forever.
- **No database:** when AI is enabled but `database` is null, the composition root keeps the D-52 controller stub and builds no provider.
- **D-56 logging:** A-03 logs the `AI_PROVIDER` issue together with its dispatcher choice. S-06 wires the dispatcher stub (D-71) and logs nothing for D-56.
- **Adapter testing:** the SoC adapter takes `fetch` as a constructor dependency, and the composition root passes the global `fetch`. One `LlmProvider` contract suite runs against `FakeLlmProvider` and against the adapter with a stub `fetch` (contracts §1 rule 7). Tests make no network call.
- **Marker fake file:** `marker-fake-provider.ts` in `src/server/adapters/soc-llm/`, so the D-71 boundary check does not match it.

Design decision D-79 (U-01 public read boundaries and query semantics): Recorded by Lim-ZY on 20 October 2026 after the U-01 analyst and architect review; approved by the human developer before implementation.
- U-02 owns the visible public review listing and `GET /movies/:id/reviews`. U-01 owns movie metadata, public aggregates, movie listing/search, and published announcement reads.
- The public Announcement DTO contains `id`, `publishedAt`, `title`, `body`, and `movie`. `movie` is `{ id, title }` only for an active referenced Movie; it is `null` for no reference or an archived referenced Movie. The announcement itself remains public when its associated Movie is archived.
- `release_desc` places null release dates last and uses ascending Movie ID as its tie-breaker. `title_asc` uses case-insensitive title ordering and ascending Movie ID as its tie-breaker.
- `q` is trimmed before validation and matching. Omitted, empty and whitespace-only values mean no title filter. Non-empty values are limited to 200 Unicode code points.
- Public pages are Server Components that call read services directly; public Route Handlers remain the versioned HTTP contract for browser/API consumers. Both paths use the same public DTOs and projection rules.

Suggested enhancements, in priority order: private watchlist; spoiler controls; genre filters; admin report-age/AI-failure statistics. Each requires its own requirement and acceptance update before implementation.

Design decision D-72 (Frontend route/layout structure): Recorded by Lim-ZY on 17 October 2026. Renumbered from a duplicate D-49 on 18 October 2026; D-49 is the moderation prompt and policy versions decision. S-07 logs and `tests/unit/ui-shell/route-shells.test.ts` cite this decision as D-49
Below is the decided layout structure to follow for NextJS frontend:
```markdown
src/app/
├── layout.tsx                    # global HTML, metadata, global styles
├── page.tsx                      # public home: /
├── (public)/
│   ├── movies/
│   │   ├── page.tsx              # /movies
│   │   └── [id]/page.tsx         # /movies/:id
│   └── announcements/page.tsx    # /announcements
├── app/
│   ├── layout.tsx                # User shell: /app
│   ├── page.tsx                  # User overview
│   ├── reviews/page.tsx          # /app/reviews
│   └── reports/page.tsx          # /app/reports
└── admin/
    ├── layout.tsx                # Admin shell: /admin
    ├── page.tsx                  # Admin overview
    ├── movies/page.tsx           # /admin/movies
    ├── reviews/page.tsx          # /admin/reviews
    ├── reports/page.tsx          # /admin/reports
    ├── announcements/page.tsx   # /admin/announcements
    └── users/page.tsx            # /admin/users
```

`(public)` is a true Next.js route group and does not affect URLs. `app/` and `admin/` should remain real folders because `/app` and `/admin` are required URL prefixes.

Design decision D-82 (Email normalisation): Recorded by Lim-ZY on 17 October 2026. Renumbered from a duplicate D-50 on 20 October 2026; D-50 is the ModerationWork queue writes decision. S-04 logs and `workflow/handoffs/s04-release-evidence.md` cite this decision as D-50
- The policy is:
  - Trim only leading/trailing ASCII whitespace.
  - Require exactly one @.
  - Reject control characters, internal whitespace, comments, quoted local-parts, and malformed domains.
  - Normalize the domain with IDNA2008 to lowercase ASCII/Punycode.
  - Normalize the local part with Unicode NFC, then lowercase it for FreshApples account identity.
  - Do not apply provider-specific rules such as Gmail dot removal or +tag removal.
  - Store only the resulting normalized_email; use it consistently for registration, login, throttling, and future recovery flows.
  - Keep the original address out of logs and audit metadata.

Design decision D-83: Deployment environment configuration and first-Admin bootstrap. Recorded by Lim-ZY. Renumbered from a duplicate D-51 on 20 October 2026; D-51 is the Movie locks, review-change marker and summary schedule decision. S-04 logs cite this decision as D-51
- `.env.example` contains names and safe placeholders only. Real values are supplied through environment-specific Vercel configuration or a controlled local/CI/operator environment; no `.env` file, Vercel environment download, credential or generated secret is committed.
- Preview and Production receive separate values. Server-only secrets (`DATABASE_URL`, `SESSION_SECRET`, `RATE_LIMIT_KEY_SECRET`, `SOC_LLM_API_KEY`, `CRON_SECRET` and the first-Admin bootstrap values) are configured as sensitive Vercel variables and are never exposed through `NEXT_PUBLIC_` variables, client props, logs or built assets.
- Non-secret settings use ordinary environment variables. `TEST_DATABASE_URL` is local/CI-only, and `MIGRATION_DATABASE_URL` is restricted to controlled migration/operator use; neither is application runtime configuration on Vercel.
- First-Admin bootstrap, if enabled for the Vercel deployment, is a dedicated Vercel server function invoked with the separate deployment-only `ADMIN_BOOTSTRAP_SECRET` plus `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`. It does not run during `next build`, module initialization or every function startup. It creates an Admin only when no Admin exists, uses the Identity service and one transaction, records an audit event without credentials, and is idempotent after success.
- Public USER registration and first-Admin bootstrap are separate named Identity operations; neither accepts a caller-selected role or a role/mode flag. They reuse the same email normalization, password validation and hashing, duplicate-email handling and private Account-insertion primitives. Public registration always persists `role = USER` and `status = active`; only the secret-gated bootstrap operation may invoke the Admin insertion path.
- The bootstrap transaction takes `SHARE ROW EXCLUSIVE` on the durable `app.account` table before checking whether an Admin exists. This database-coordinated table-level lock serializes concurrent bootstrap invocations across server instances and temporarily blocks other Account writes, including public registration, while leaving ordinary reads available. If an Admin exists, bootstrap is a no-op. Otherwise the same transaction creates one active Admin through the shared Identity account-creation primitive and then writes `account.admin_provisioned` to AuditEntry. Account creation and audit either commit or roll back together, and Account precedes AuditEntry in the global lock order.
- Admin existence in `app.account` is the durable idempotency source of truth. No `admin_bootstrap` table, singleton row, completion marker, advisory lock or other bootstrap-specific database state is created. "Exactly one Admin" is the bootstrap outcome, not a permanent constraint preventing later approved Admin creation. A conflicting existing normalized email fails safely and is never promoted from USER to ADMIN.
- The bootstrap variables are removed from the Vercel environment by the deployment operator after successful provisioning, using the executable, idempotent procedure in `spec/deployment.md` 10.3. The application never attempts to self-delete Vercel variables. If no Admin exists, readiness remains unavailable for normal traffic whether bootstrap values are valid, missing or invalid; bootstrap invocation is a separate operator operation.
- The bootstrap function must be inaccessible to normal browser Users and Admin sessions and must require the deployment-only secret. It is the explicit D-14/SEC-04 exception described above: it ignores browser cookies and does not require a CSRF token or Origin header because neither browser sessions nor browser origin confer authority. The function route and request transport are implementation details within this approved Vercel-function boundary and must not expose bootstrap credentials or the secret in logs or responses.

Design decision D-79 (Admin Movie and Announcement lifecycle): Recorded on 19 October 2026 for A-01 and A-02. The human requester delegated resolution of the analyst findings to the agent's recommendations in this session. Approved by both developers (Lim-ZY and thegrimbee) on 20 October 2026, including the shared-contract edits to contracts §3.3, K2 and K5.
- **Repeated actions:** with a current If-Match, archiving an archived Movie, restoring an active Movie and deleting a deleted Announcement succeed as no-ops. Preserve the resource version, timestamps, archive/publication timestamps, reviews_revision and summary markers; insert an audit entry with result `no_op`. Check the version before deciding no-op, so stale requests still return 409 `stale_version`.
- **Movie changes:** actual metadata edits, archive and restore increment Movie.version once and set updated_at. Metadata edits are allowed on archived Movies but do not restore them. Archive and restore also advance reviews_revision and set summary_pending_since if absent, including Movies with no eligible Reviews. Same-value metadata edits do not advance either version or revision. D-51's marker never increments Movie.version itself.
- **Deleted Announcements:** deletion is terminal. Admin list/detail retain access, but any otherwise valid PATCH of a deleted Announcement with a current version returns 409 `conflict`. No restoration endpoint is introduced. A repeated DELETE remains the no-op above.
- **Publication:** creation is always draft with published_at null. Only draft-to-published sets published_at to the transaction's current UTC time. Unpublish retains the previous published_at for history; publishing that draft again replaces it. Editing a published Announcement changes the public content immediately in the same transaction. Supplying state=published when already published does not reset published_at. Deletion preserves published_at and sets state=deleted.
- **Versions:** each actual Announcement PATCH or deletion increments version once and sets updated_at, even when content and state both change. Same-value PATCH of a non-deleted resource is a no-op, preserving timestamps/version and recording `no_op`. Author identity remains the original creator; the acting editor is recorded in audit.
- **Atomicity:** mutations and their audit entries commit together. Movie archive/restore locks Movie then all Reviews in ascending id order; only an actual transition changes archive state and the review marker. No-op requests may return after the Movie lock/version check and audit without locking Reviews because they change no eligibility.

Design decision D-80 (Admin inputs and list ordering): Recorded on 19 October 2026 under the same delegated authorization as D-79. Approved by both developers (Lim-ZY and thegrimbee) on 20 October 2026. Implements FR-05, FR-07 and api.md 8.1 without changing the schema.
- **PATCH:** accept a nonempty subset of writable fields; an empty object returns 422 `validation_failed` with fieldErrors. Unknown fields remain invalid. Omitted fields retain their values. Trim text and array elements before checking code-point limits and storing them. Compare normalized writable values to detect no-ops; arrays are order-sensitive and are not sorted or deduplicated.
- **Movie defaults and clearing:** on creation, omitted releaseDate/runtimeMinutes become null, genres/cast become empty arrays, and director becomes the empty string (the existing column is NOT NULL). On PATCH, releaseDate/runtimeMinutes accept null to clear; genres/cast accept [] to clear and reject null; director accepts an empty/whitespace string to clear and rejects null. Title/synopsis remain nonempty and reject null. releaseDate is a real Gregorian calendar date in YYYY-MM-DD with year 0001–9999, not a timestamp; impossible dates return 422. Other field limits remain those in data-model.md.
- **Announcement reference:** omitted movieId at creation means null; PATCH null clears it. A non-null movieId must be a UUID identifying an existing Movie; malformed or nonexistent values return 422 `validation_failed` with a movieId field error. An archived Movie is a valid reference. Validate the reference in the mutation transaction. Public output omits its navigable Movie link while archived, including when the reference was assigned after archive. No Movie state transition or Movie write occurs when assigning a reference.
- **Announcement text:** title/body are required on creation, optional on PATCH, and never nullable or empty after trimming. Creation cannot supply state, publishedAt or actor fields. Other derived fields remain non-writable.
- **Ordering:** GET /admin/movies and GET /admin/announcements order by updated_at DESC, id ASC. GET /announcements includes only published rows and orders by published_at DESC, id ASC. All use the pagination envelope and bounds in api.md 8.1; an out-of-range positive page returns an empty items array with the actual total. Equal sort keys use ID; offset pagination does not promise a snapshot across concurrent writes.
- **Ordering consequence:** Movie.updated_at also changes for review-marker updates under D-51, so review activity can move a Movie in the Admin list. This is an activity order, not an Admin-edit-only order. Public announcement link eligibility is computed from the Movie's current archive state at read time, never frozen when the reference is written.

Design decision D-81 (Admin responses and audit selection): Recorded on 19 October 2026 under the same delegated authorization as D-79. Approved by both developers (Lim-ZY and thegrimbee) on 20 October 2026. Clarifies api.md 8.1, K2 and K5; implementation remains separately reviewed work.
- **Responses:** Movie restore returns 200 with the full Admin Movie resource and its current version/quoted ETag, whether applied or no-op. Movie and Announcement creates return 201; PATCH returns 200 with the resource/version/ETag even for a no-op. Movie archive and Announcement delete return 204 with no body and the resulting quoted ETag, unchanged on no-op. More generally a versioned DELETE returns its resulting version in ETag only, an explicit exception to the resource-body rule; unversioned logout is unaffected. Existing Review delete implementations must be checked for conformance in their owning task.
- **Concurrency:** preconditions remain mandatory for no-ops and deletes. Authentication, status and CSRF guards still run for no-ops. Lock/check the target version before determining lifecycle conflicts or no-op; this does not impose a new ordering among unrelated transport validation errors.
- **Audit:** one K5 entry per successful A-01/A-02 mutation, including no-ops. Movie actions use the corresponding create/update/archive/restore action. Announcement creation/deletion use create/delete; PATCH uses publish or unpublish when it actually changes state, otherwise update. A mixed content/state PATCH uses the state-transition action, with minimal metadata identifying all changed writable fields and previous/new state. A same-state-only PATCH uses announcement.update with result no_op. Do not copy title, synopsis, body or cast text into audit metadata: record changed-field names as scalar markers, state/reference/archive changes and old/new versions, within D-46 limits. Actor and request ID are server-derived. Audit failure rolls back the mutation; denied/failed requests follow the existing security-log rules.

Design decision D-84 (Interim K8 dependency for Movie archive/restore): Recorded on 20 October 2026 for A-01. Developer B (thegrimbee) chose this option (option (a) in `logs/2026-10-20-b6-readiness-merge-and-renumbering.md`) and assigned the number. Approved by both developers (Lim-ZY and thegrimbee) on 20 October 2026; Lim-ZY's approval is recorded as reported by Developer B. Numbering note: `feat/ai-summary-core` also uses D-84 for a different decision; that branch's D-80–D-88 already collide with this branch's D-79–D-83, and the clash must be reconciled at merge.
- **Dependency:** the archive/restore orchestrator (P-12, `src/server/services/catalogue-archive/`) depends on a structural interface `ReviewsOfMovieLock` that it declares itself. The interface has exactly the K8 `lockReviewsOfMovie(tx, movie: MovieUpdateLock)` signature in contracts §11. No K8 signature, lock order (D-20) or Reviews ownership changes. Developer A's U-02 still provides the only production implementation.
- **Until U-02 merges:** the composition root leaves the orchestrator unwired, so DELETE `/admin/movies/:id` and POST `/admin/movies/:id/restore` return 503 `service_unavailable`. Developer B's code does not lock or query Review rows in production.
- **Tests:** isolated orchestration unit tests use fakes. API integration tests inject the orchestrator with a test-only PostgreSQL stand-in in `tests/support/` that takes the contracted locks (Reviews of the Movie `FOR UPDATE`, ascending id). The stand-in is not production code and is not evidence for U-02's K8.
- **Exit:** when U-02 is on `master`, wire the orchestrator with the real K8, remove the stand-in and the test injection, rerun the A-01 suites against the real K8, and add the archive-versus-review-submission race test (verification §11.3). A-01 is not complete before this.

Design decision D-85 (U-04 ownership exception): Recorded by thegrimbee on 21 October 2026. Approved by both developers (Lim-ZY and thegrimbee) on 20 October 2026; Lim-ZY's approval is recorded as reported by Developer B. First drafted as D-79 on the unmerged `feat/ai-summary-core` branch, which is being discarded; D-79 on `master` is the U-01 public read decision.
- U-04 (public review summary: FR-08, AI-01) moves from Developer A to Developer B, as B#13 and B#14 in `workflow/COMMIT-PLAN.md` (formerly A#9 and A#10). Developer A reviews both PRs.
- This is the only exception to the rule in "Team ownership" that a role's features are not split between developers. All other User features stay with Developer A.
- Summary paths (`src/server/services/ai/summary/`, `/internal/cron/summaries`, `/movies/:id/summary` and its UI) are owned by Developer B. Shared UI in `src/components/` and layouts remain Developer A's hotspot, and the Review eligibility predicate stays with its current owner.
- Ownership of the R-01 summary evaluation fixtures is not changed by this decision.

Design decision D-86 (summary input preparation): Recorded by thegrimbee on 21 October 2026 from the U-04a analyst preflight; Developer B delegated the choices to the agent's recommendations. Approval by Developer A (Lim-ZY) is pending. Implements AI-01 items 2–5 and AI-04.
- **Consistent read:** one SQL statement reads the Movie's `archived_at` and `reviews_revision`, whether a ReviewSummary exists at that revision (D-88), and every eligible Review's `id`, `version`, `content_revision`, `rating` and `body`, in ascending `id` order. Under READ COMMITTED (O-01) one statement sees one snapshot, so the revision always matches the Review set. No row lock is taken, so review writes are never blocked. A missing or archived Movie gives `unavailable`.
- **Eligibility predicate:** the data-model.md definition, written as `moderation_state = 'cleared' AND deleted_at IS NULL AND hidden_at IS NULL` on a Movie with `archived_at IS NULL`. A body edit or resubmission resets `moderation_state` to `pending` in the same transaction (data-model.md), so `cleared` means cleared for the current `content_revision`. The predicate keeps its current owner (D-85): U-04 restates it in its own read-only query repository (O-23) and does not create a shared file in Developer A's paths. A PostgreSQL integration test seeds the same Reviews in every eligibility state and asserts that the U-04 eligible count equals the U-01 public `reviewCount`, so the two copies cannot drift unnoticed. If Developer A later extracts a shared predicate, U-04 switches to it.
- **Fewer than 3 eligible:** `insufficient_reviews`, with no K10 call, no AIJob and no write.
- **Sample size:** `AI_SUMMARY_SAMPLE_SIZE` accepts 3–20 (default 20). Below 3 no sample could be published, so a smaller value is invalid AI configuration and disables AI (D-28, D-37).
- **Sampling (`summary-sample-v1`):**
  - Candidates are the eligible Reviews in ascending `id` order. Let `n` be their number and `s = min(n, AI_SUMMARY_SAMPLE_SIZE)`.
  - Each generation attempt draws a fresh seed: 32 bytes from `node:crypto` `randomBytes`, recorded as lowercase hex. The seed source is a constructor dependency, so tests can fix it.
  - Random stream: SHA-256 of the seed bytes followed by a 4-byte big-endian counter starting at 0. Each digest gives eight big-endian unsigned 32-bit values, used in order.
  - Uniform index in `[0, k)`: discard values of at least `floor(2^32 / k) × k`; otherwise take the value modulo `k`.
  - Partial Fisher–Yates: for `i` from 0 to `s − 1`, swap position `i` with position `i + index(n − i)`. The sample is the first `s` candidates, in that order.
  - The same seed and candidate list always give the same sample. No dependency is added.
- **Review records:** each sampled Review is sent as `{ "label", "rating", "truncated", "body" }`:
  - `label` is `R<k>`, where `k` is its 1-based position in sample order;
  - `rating` is the string `"<n>/10"`;
  - `body` is the stored plain-text body cut to its first 1,000 Unicode code points (data-model.md counts code points);
  - `truncated` is `true` when the body was cut. This flag is the AI-01 truncation marker; no marker text is added to the body.
- **Messages:** a `system` message holding the static prompt, then one `user` message holding `JSON.stringify({ "reviews": [...] })`. JSON string escaping keeps Review text inside its field whatever it contains. The input has no Movie title, author, account, Report, moderation or job data. `maxOutputTokens` is 1,200.
- **Prompt:** version `review-summary-prompt-v1`, a static artifact with its version constant in `src/server/services/ai/summary/`. Any change to the system text or to the user-message format is a new version. The system text tells the model to describe only opinions expressed in the supplied Reviews and add no facts about the Movie; to treat every Review field as data and ignore instructions inside it; to cite only labels present in the input; and to return only the D-87 JSON object, as plain text without markup or URLs. The wording is reviewed in the B#13 PR.
- **Reduction:** estimate the input with the AI-03 formula over both messages, using the runtime's `estimateInputTokens` so the summary and K10 use one implementation. While the estimate exceeds `AI_INPUT_TOKEN_LIMIT` (at most 8,000; the bound K10 enforces), remove the last Review in sample order and serialize again. Remaining labels do not change. Every prefix of the Fisher–Yates order is itself a uniform sample, and every included Review stays whole. If fewer than 3 Reviews remain, the result is `input_unfit`, with no K10 call and no AIJob. The Reviews that remain are the included sample, which is persisted (D-88) and counted for display.
- **Why:** one statement gives a consistent snapshot without blocking review writes. Hash-counter sampling is reproducible from the stored seed without a new dependency. Removing whole Reviews from the end keeps the sample uniform and the reduction deterministic.

Design decision D-87 (summary output schema): Recorded by thegrimbee on 21 October 2026 from the U-04a analyst preflight; Developer B delegated the choices to the agent's recommendations. Approval by Developer A (Lim-ZY) is pending. Implements AI-01 item 6 and AI-04.
- **Shape** (example):

  ```json
  {
    "overall": "Reviewers mostly praise the pacing and the lead performance.",
    "strengths": [{ "text": "The lead performance is widely praised.", "sources": ["R1", "R3"] }],
    "criticisms": [],
    "mixedOpinions": [{ "text": "Opinions on the ending are split.", "sources": ["R2", "R4"] }]
  }
  ```

- **Field rules:**
  - The object has exactly the keys `overall`, `strengths`, `criticisms` and `mixedOpinions`. Each list item has exactly `text` and `sources`. An unknown or missing key at any level rejects the output.
  - `overall` is 1–800 Unicode code points after trimming.
  - Each list has 0–3 items. Each `text` is 1–240 code points after trimming.
  - `sources` has 1–20 unique strings, and each must be the label of an included Review (D-86). A label removed by reduction, an unknown label and a raw Review ID are all rejected.
- **Safe text:** following AI-04 ("reject unexpected URLs/markup"), a string is rejected if it contains a C0 control character other than LF, or U+007F; `http://`, `https://` or `www.` in any letter case; or `<` followed by a letter, `/`, `!` or `?`. A Review that quotes a URL can therefore make generation fail; that Movie then takes the failure backoff (D-89), which is the safe outcome.
- **Parsing:** trim the content. If it starts and ends with a triple-backtick fence (optionally tagged `json`), strip that one outer fence. Then `JSON.parse` it; the result must be an object. Any failure gives `invalid_output` (O-27: no JSON response mode is relied on).
- **Validator:** a strict zod schema (D-22) plus the label and safe-text checks. The validated output, with trimmed strings and labels as given, is stored as `output_json`. It is rendered only as escaped plain text.
- **Marker fake:** the `summary` outcome of `MarkerFakeLlmProvider` (D-57) returns a constant that is valid under this schema and cites only `R1`–`R3`. Every published sample includes at least those labels, so the fixed fake never invents a source. B#13 adds the constant and its D-70 conformance test; the `summary` marker no longer fails closed.
- **Why:** short position labels cost fewer tokens than UUIDs and are harder to miscopy, keep Review IDs out of the prompt, and let a fixed fake output stay valid.

Design decision D-88 (summary provenance and result reuse): Recorded by thegrimbee on 21 October 2026 from the U-04a analyst preflight; Developer B delegated the choices to the agent's recommendations. Approval by Developer A (Lim-ZY) is pending. Implements AI-01 items 4 and 6 without a migration.
- **`sampled_review_ids_and_versions`:** `{ "algorithm": "summary-sample-v1", "seed": "<64 hex>", "sampledCount": s, "reviews": [{ "reviewId", "version", "contentRevision", "truncated" }] }`.
  - `reviews` lists the included Reviews in label order (`R1` first), so label `R<k>` maps to `reviews[k − 1]`.
  - `sampledCount` is `s` before reduction, so a replay from the seed can confirm that the included Reviews are its prefix.
  - "IDs/versions" (AI-01 item 4) means both `Review.version` and `content_revision`.
- **Other columns:** `eligible_count` is the count in the D-86 read; `generated_at` is the publish transaction's `now()`. Model and prompt versions are reached through `job_id` (`ai_job.model_id`, `ai_job.prompt_version`), which K10 writes. The included count is the length of `reviews`; the truncation notice is shown when any included Review has `truncated` set.
- **`BoundedInput.snapshot`** (`bounded_input_snapshot`, D-64): `{ movieId, reviewsRevision, eligibleCount, sample }`, where `sample` is the object above. It holds no Review text; `input_hash` identifies the messages.
- **Reusing a valid result (AI-01 item 4):** a running job with the same Movie, revision, model and prompt version is reused through K10's dedup key (`duplicate`). A ReviewSummary at the Movie's current `reviews_revision` is a valid result: when the D-86 read finds one, generation returns `current` with no K10 call. Publication clears pending only at its exact revision and only `markReviewsChanged` sets it again, by advancing the revision, so this case is normally unreachable; the check is defensive. A summary stays current while its revision equals the Movie's, whatever model or prompt version produced it. A new model or prompt version applies from the next generation and never by itself triggers regeneration, consistent with "unchanged content never causes regeneration merely because time passed".
- **Model ID:** the summary service does not need it. K10 adds the provider's model to the dedup key and the AIJob row.

Design decision D-89 (summary outcomes and sweep scheduling): Recorded by thegrimbee on 21 October 2026 from the U-04a analyst preflight; Developer B delegated the choices to the agent's recommendations. Approval by Developer A (Lim-ZY) is pending. Implements AI-01 "Scheduling and load" and DEP-09.
- **Generation (B#13):** one service operation generates the summary for one Movie ID. It is called with no Tx open. It returns `unavailable`, `insufficient_reviews`, `input_unfit` (D-86) or `current` (D-88), or else the K10 `AiExecutionOutcome` unchanged. It never throws for an expected outcome and never writes schedule columns.
- **Selection (B#14):** one statement selects at most `AI_SUMMARY_MAX_MOVIES_PER_RUN` (1) Movie that:
  - is active, has `summary_pending_since` set, and has `summary_next_attempt_at` null or not after now;
  - has `summary_last_success_at` null, or not after now minus `AI_SUMMARY_INTERVAL_DAYS` days;
  - has at least 3 eligible Reviews under the D-86 predicate.

  Order: `summary_last_attempt_at` ascending with nulls first (never-attempted first), then `summary_pending_since`, then `id`. Times come from the database clock. A Movie with fewer than 3 eligible Reviews is never selected, so it cannot hold the single slot every run and starve others (AT-07: the sweep skips fewer-than-3-review Movies). It keeps its marker and becomes selectable once it has 3 (AI-01 item 3).
- **Attempt record (B#14), each step in its own short Tx and never during the provider call:**
  1. Before generating: K7 `lockActiveMovieForUpdate`, then `recordSummaryAttempt` with the next attempt 1 day later. This commits before the provider call, so a crash keeps the backoff and the Movie moves behind the others. A Movie that is no longer active counts as `skipped`, with nothing more.
  2. After `deferred`, `disabled` or `duplicate`: K7 `lockActiveMovieForUpdate`, then `recordSummaryAttempt` with the next attempt now. The Movie stays behind the others, but capacity limits do not impose the failure backoff (AI-01: deferral keeps the marker). If the Movie was archived meanwhile, nothing is written.
- **Outcome mapping:**

  | Outcome | Cron count | Schedule after the attempt |
  | --- | --- | --- |
  | `published` | processed | Step 1 values; `recordSummaryPublished` cleared pending, and the interval then governs |
  | `current`, `insufficient_reviews`, `unavailable` (races after selection) | skipped | Step 1 values |
  | `duplicate` | skipped | Step 2 |
  | `deferred`, `disabled` | deferred | Step 2 |
  | `input_unfit`, `input_too_large`, `failed`, `stale` | failed | Step 1 values: the 1-day backoff |

- **Backoff and retries:** the backoff is exactly 1 day after the attempt; Vercel Hobby cron timing is approximate, so a retry can slip to the following run, which is accepted (DEP-09: timing is not a deadline). AI-01 sets no maximum failure count for summaries (AI-02's limit of 3 applies only to moderation). Retries stay bounded at one attempt per Movie per day and one Movie per run, and a failing Movie moves behind the others after each attempt.
- **Interval values:** `AI_SUMMARY_INTERVAL_DAYS` accepts only 1 (default) or 7, the two values deployment.md supports. Any other value is invalid AI configuration and disables AI (D-37).
- **Response:** `200 { processed, skipped, deferred, failed }`, integers summing to at most `AI_SUMMARY_MAX_MOVIES_PER_RUN`. All four are 0, with no writes, when the `summary_sweep` lease is held by another run, when no Movie is due, or when `schedulerLeases` is null because the D-52 controller stub is wired.
- **Why:** filtering by eligible count prevents starvation, recording the attempt first covers crashes, and only failures and stale results take the backoff, as AI-01 requires.

Design decision D-90 (public summary projection): Recorded by thegrimbee on 21 October 2026 from the U-04a analyst preflight; Developer B delegated the choices to the agent's recommendations. Approval by Developer A (Lim-ZY) is pending. Fills the api.md `summary?` field and the AI-01 UI metadata.
- **Response:** `GET /api/v1/movies/:id/summary` returns 200, for example:

  ```json
  {
    "status": "ready",
    "eligibleCount": 12,
    "summary": {
      "overall": "Reviewers mostly praise the pacing and the lead performance.",
      "strengths": [{ "text": "The lead performance is widely praised." }],
      "criticisms": [],
      "mixedOpinions": [{ "text": "Opinions on the ending are split." }],
      "includedCount": 9,
      "truncated": true,
      "generatedAt": "2026-10-20T00:00:05.000Z"
    }
  }
  ```

  `summary` is present only when `status` is `ready`. `eligibleCount` is the current eligible count under the D-86 predicate. `includedCount` and `truncated` come from D-88; `generatedAt` is ISO 8601 UTC.
- **Precedence:** one statement computes the state, in this order:
  1. An unknown, malformed or archived Movie ID returns 404 (O-09).
  2. Fewer than 3 eligible Reviews gives `insufficient_reviews`.
  3. A ReviewSummary at the Movie's current `reviews_revision` gives `ready`, whatever model or prompt version produced it (D-88).
  4. Any older ReviewSummary for the Movie gives `stale`.
  5. Otherwise the state is `missing`.
- **Not exposed:** source labels, sampled IDs and versions, the seed, job, model and prompt fields, and any text from a non-current summary.
- **UI:** `stale` and `missing` both show the AI-01 "awaiting scheduled update" state with no generation or retry control; `insufficient_reviews` shows insufficient reviews; `ready` shows the fixed AI-01 label, the generation time, included and eligible counts, and the truncation notice when `truncated` is true.
- **Caching:** dynamic rendering and `no-store` (P-06). The read never calls K10 and writes nothing.

Design decision D-91 (U-04 sequencing against U-02): Recorded by thegrimbee on 21 October 2026 from the U-04a analyst preflight; Developer B delegated the choice to the agent's recommendation. Approval by Developer A (Lim-ZY) is pending. Resolves the conflict between `workflow/PLAN.md` (U-04 depends on U-02 and S-06) and `workflow/COMMIT-PLAN.md` (B#13 needs B#5 or the B#4 fake; SP-2 unblocks "U-04 dev against fakes").
- **Rule:** B#13 (U-04a) and B#14 (U-04b) may be implemented and merged before U-02. Their runtime dependencies are K7 (B#4, merged in PR #11) and K10 (S-06, merged in PR #12). U-02 is an acceptance dependency of U-04, not a merge dependency.
- **Stand-in for U-02:** U-04 reads Reviews through its own read-only query repository (D-86, O-23), not through K8 or a U-02 service, so no U-02 fake is needed. Tests seed synthetic Review rows directly in the disposable PostgreSQL database (D-10) and advance the revision through the real K7 `markReviewsChanged`. This stand-in is test-only and is not evidence for U-02.
- **Deferred to U-02:** AT-08 and INV-09 through real review create, edit, delete, hide and restore. U-04 is not accepted (not `Done`) until U-02 is on `master` and those cases pass against real review writes. Neither B#13 nor B#14 may claim them from synthetic fixtures.
- **Why:** U-04 never writes Reviews, and the eligibility it reads is defined by stored columns (data-model.md), so a database fixture exercises the same reads that U-02 rows will. This mirrors the D-84 interim pattern.

Design decision D-92 (B#13 paths): Recorded by thegrimbee on 21 October 2026 from the U-04a analyst preflight. Developer B owns every path below. Approval by Developer A (Lim-ZY) is pending for the specification and contract text. The architect preflight may narrow these paths but not widen them.
- **New:**
  - `src/server/services/ai/summary/`: generation service, prompt and its version, sampling, input preparation, output schema and the publish callback;
  - `src/server/repositories/summary/`: the D-86 consistent read and the ReviewSummary insert. B#14 adds selection and the public read here. D-71 keeps `src/server/repositories/ai/` for the AI runtime.
- **Existing, limited changes:**
  - `src/server/composition.ts`: summary service wiring only;
  - `src/server/adapters/soc-llm/marker-fake-provider.ts`: the `summary` constant and outcome (D-87);
  - `src/server/services/ai/runtime/index.ts`: export `estimateInputTokens` (D-86);
  - `src/server/config/ai.ts`: `AI_SUMMARY_SAMPLE_SIZE` minimum 3 (D-86) and `AI_SUMMARY_INTERVAL_DAYS` limited to 1 or 7 (D-89).
- **Tests:** new tests under `tests/unit/ai/summary/` and `tests/integration/ai/summary/`, including the D-70 conformance test for the `summary` constant and the D-86 eligibility parity test; updates to `tests/unit/ai/marker-fake-provider.test.ts` (the `summary` marker now succeeds) and `tests/unit/config/parse-config.test.ts` (new bounds).
- **Not in B#13:** Route Handlers, UI, migrations, dependency or lockfile changes, K3, K7 or K10 internals, and any Developer A path, including U-01's public read repository.

## 15. References

- [Selected stack assessment and platform references](tech-stack.md), checked 8 October 2026; account allocations and plan limits must be rechecked before deployment.
- User's project proposal and requested 15-section structure, supplied in this conversation on 8 October 2026.
- [SoC LLM guide](https://dochub.comp.nus.edu.sg/cf/guides/soclaas/start): referenced by the brief. Its access, API, quickstart, usage-limits, models, GUI and project-ideas pages were saved locally (not committed) and checked on 16 October 2026 (D-48). Retention and permitted data are not covered; no further verification is needed (D-48).
- Repository README: project identifier CS3227-2610-MP3.
