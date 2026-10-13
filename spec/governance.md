# Project Specification — Constraints and Decisions

## 12. Constraints

### 12.1 Technical

CON-01: Movie listings and details are text-only; no image storage pipeline.

CON-02: Use SoC LLM for both runtime AI features. Verify and enforce actual allocation constraints. No assumed provider compatibility or unrestricted retries.

CON-03: Use team-managed deployment with suitable automation; build-and-host environments offered by coding agents are prohibited.

CON-04: Perform SDD directly without an SDD toolkit. Maintain specifications in this directory, with stable requirement IDs and traceable acceptance evidence.

### 12.2 Regulatory / Course / Organisation

The following are requirements transcribed from [the project brief](../references/requirements.md), not optional product choices:

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
| Developer A (Lim-ZY) | User UI, discovery, reviews, reporting, summary, optional watchlist | Identity/session implementation, public API contracts, User security tests, user guide |
| Developer B (thegrimbee) | Admin UI, Movie CRUD, moderation, announcements, review profanity moderation | Database/migrations, deployment/CI, audit/job infrastructure, developer guide |
| Both | Cross-review and end-to-end integration | Architecture, provider adapter contract, threat model, acceptance tests, reflections, logs, product website and release |

The Developer A/Developer B split above is adopted (12 October 2026). Developer A is Lim-ZY and Developer B is thegrimbee (GitHub usernames); tester accounts remain open under OQ-06. Shared foundations must have clear owners without splitting a role's features between developers. D-20 assigns the account-status service to Identity (Developer A); Moderation (Developer B) calls it.

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
| OQ-01 | Verify models, context, quotas, retention and permitted data. Endpoint and API-key authentication from Vercel confirmed 11 October 2026 by a human-run smoke test. Verified team allocation, human-reported 12 October 2026: 90 requests per minute; budget 80,000,000 microdollars (USD 80) per day and 800,000,000 microdollars (USD 800) per month. Still unverified: permitted model and its per-token prices, context size, tokens per minute, retention and permitted data; owner Developer B (thegrimbee). Interim operating posture until verified: D-16 | Before provider integration and production enablement |
| OQ-02 | Verify regions and environment-specific SoC quota partitioning. Resolved 11 October 2026 (human-verified): Vercel Hobby eligibility, repository deployment including by non-owner contributors, Supabase two-project allocation, and SoC LLM and Supabase reachability from Vercel (see `logs/`). Stack selection is resolved | Before infrastructure implementation |
| OQ-03 | Confirm proposed account recovery scope; report privacy and anonymous summary access are resolved | Before respective product flows |
| OQ-04 | Finalize profanity policy text and contested-decision process; default three-incident suspension and reinstatement cycle are specified. Policy storage, versioning and initial language scope are resolved by D-17. Owner: Developer B (thegrimbee), target before A-03 acceptance | Before moderation/AI acceptance |
| OQ-05 | Confirm retention, operator deletion process and privacy notice | Before production |
| OQ-06 | Assign tester accounts. Developer names (Lim-ZY as A, thegrimbee as B) and the A/B ownership split are resolved (see Team ownership) | Before task allocation/release |
| OQ-07 | Select optional watchlist, spoiler handling, filters or admin statistics | Only after core scope is on track |
| OQ-08 | Confirm repo naming requirement and official deadline; the product name is resolved as FreshApples | Before release |
| OQ-09 | Verify host meets backup, restore and performance targets | Before production acceptance |

Approved exceptions: none.

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

Design decision D-13 (AI capacity and budget): The single active AI execution per environment (AI-03) is a SchedulerLease row named `ai_execution`. The daily budget uses the AIBudgetDay and AIBudgetReservation tables, in microdollars (D-25). Per-minute SoC request and token quotas use RateLimitWindow keys. Budget days are UTC calendar days.

Design decision D-14 (CSRF): SEC-04 uses a stateless HMAC token signed with `SESSION_SECRET` and bound to the session, plus an Origin/same-origin check on every unsafe method. Anonymous unsafe requests (`/auth/register`, `/auth/login`) use a signed pre-session token in a cookie. No CSRF table or Session column is added.

Design decision D-15 (provider configuration names): The SoC variables are the `SOC_LLM_*` names in [deployment.md](deployment.md) 10.3. `.env.example` lists every 10.3 variable with placeholders and no guessed model default.

Design decision D-16 (SoC interim posture): Until OQ-01 is resolved, development uses the deterministic fake adapter and production runs with `AI_ENABLED=false`. Obtain quota and budget figures from the SoC portal's budget-visibility interface and confirm retention with course staff. Development and production receive fixed sub-budgets whose sum fits the verified allocation (D-25); no cross-environment coordinator is built.

Design decision D-17 (profanity policy): The policy is a versioned static artifact in source under `src/server`, and its version identifier is the `policy_version` recorded by AI jobs and moderation results. It is not stored in or edited through the database. The initial supported language is English (ASM-08). The policy text and contested-decision process remain open under OQ-04.

Design decision D-18 (deployment mode): Vercel Git integration deploys Preview builds from branches and Production from `master`. GitHub Actions runs the release checks as required status checks, and branch protection on `master` requires a reviewed pull request with passing checks. No personal Vercel token is stored in CI. See DEP-02.

Design decision D-19 (default branch): `master` is the repository's default and graded branch. `main` is retired as a target; deleting it requires explicit human approval.

Design decision D-20 (account status and lock order): The Identity module owns every write to the Account row, including status, version, strike_cycle and session revocation, and exposes an account-status service that runs inside the caller's transaction. Moderation owns Reports, decisions and ModerationStrike, decides when a suspension or reinstatement is required, and calls the Identity service; it does not write Account directly. Transactions lock rows in the global order defined in [data-model.md](data-model.md).

Design decision D-21 (page routes): Public pages (home, movie list and detail, announcements, sign-in and registration) are served at the root. User-only pages are under `/app`, Admin pages under `/admin`. Next.js route groups may share layouts without changing these URLs. Role checks stay in services and handlers (architecture 6.6).

Design decision D-22 (validation): Validate request bodies, query parameters, stored JSON (evidence snapshots, AI outputs) and, per D-37, environment configuration with zod schemas in strict mode, pinned exactly. Schemas live with the server modules that own them and contain no credentials or ORM-private fields (architecture 6.6).

Design decision D-23 (composition root): The only module-level instances allowed in `src/server` are created in one composition root, `src/server/composition.ts`: the per-instance database pool and the service graph built from configuration. They are module-level constants created once per server instance; no other module holds shared mutable state, and every service receives its dependencies through its constructor. This is a recorded exception to the AGENTS.md rule against shared globals.

Design decision D-24 (contract open items): The open items O-01–O-34 and proposals P-01–P-13 in `workflow/contracts.md` were resolved on 12 October 2026. Behavioural outcomes are recorded in [api.md](api.md) (error codes, statuses, ETag, CSRF endpoint, no-op and archived-Movie rules, SoC base URL), [security.md](security.md) (CSRF names, client IP, limiter rules, audit results), [data-model.md](data-model.md) (ModerationWork cancellation and nullable model, evidence_version, lease names and durations, same-table lock order), [ai.md](ai.md) (token estimate, policy path), [deployment.md](deployment.md) (AI_PROVIDER, base URL) and [tech-stack.md](tech-stack.md) (isolation, timeouts, nested transactions). Module-structure outcomes are in `workflow/contracts.md` §16.

Design decision D-25 (SoC budget unit and partition): The application budget is money, matching the SoC allocation: AI_DAILY_BUDGET_MICRODOLLARS replaces the token budget, and cost is computed from token usage and the verified per-million-token prices of the configured model. Production receives two thirds and development one third of the allocation: 60 and 30 requests per minute, and 53,333,333 and 26,666,666 microdollars per UTC day. The USD 800 monthly cap is not enforced by the application; SoC 429 budget responses defer work (AI-03).

Design decision D-26 (migrations directory): node-pg-migrate migration files live in `src/server/db/migrations/`, owned by Developer B (database/migrations). Both the test harness and the operator release step pass this directory explicitly to node-pg-migrate. The directory holds migration SQL files only; it is never imported by application code.

Design decision D-27 (application schema): All application tables, types and indexes live in a PostgreSQL schema named `app`. Nothing is created in `public`. Supabase Data APIs expose only their default schemas, and `app` is never added to the exposed list. Migrations and repositories use schema-qualified names (`app.review`) and do not rely on `search_path`, which does not depend on the transaction pooler's session handling. node-pg-migrate keeps its bookkeeping table in `app`. Migrations revoke all privileges on `app` from `anon`, `authenticated` and `public`. The runtime role (`app_runtime`) receives `USAGE` on `app` and only the table-level DML it needs, with no DDL, no access to the migration bookkeeping table, and no UPDATE or DELETE on AuditEntry.

Design decision D-28 (core configuration): Readiness and core features require exactly these valid variables: `APP_ENV`, `PUBLIC_APP_URL` (needed by the SEC-04 Origin check), `DATABASE_URL`, `DATABASE_CA_CERT`, `SESSION_SECRET`, `RATE_LIMIT_KEY_SECRET` (needed by the SEC-06 login throttle), and, when set, valid values of the defaulted `SESSION_TTL_SECONDS` and `REPORT_SUSPENSION_THRESHOLD`. Invalid core configuration makes readiness return 503. `CRON_SECRET` is not core: when it is missing, both cron routes reject every request with 401 while user and admin features keep working. AI variables are never core (deployment.md 10.3). `PORT`, `LOG_LEVEL` and `MIGRATION_DATABASE_URL` are not runtime readiness inputs: `LOG_LEVEL` falls back to `info` when invalid.

Design decision D-29 (secret scanning): SEC-07 secret scanning uses the gitleaks CLI (MIT-licensed). CI downloads an exactly pinned release and verifies its SHA-256 checksum before running it. The `gitleaks-action` wrapper is not used because it requires a licence key for organization repositories. CI runs gitleaks over the pull request's commit range and over the built `.next/static` directory. A canary check also builds with distinctive synthetic values for every server-only secret and fails if any of them appears in `.next/static`. Findings fail the job. False positives are allowed only through a reviewed `.gitleaks.toml` allowlist entry with a justification comment (security.md "Development-process security"). Developers may run the same pinned CLI locally; it is not an npm dependency.

Design decision D-30 (local/test database TLS): Database TLS is either CA-verified or absent, never unverified. In `APP_ENV=local` or `test` only, `DATABASE_CA_CERT` may be omitted, and then the runtime pool and the migration runner connect without TLS, but only to a loopback host (`localhost`, `127.0.0.1` or `::1`). This covers the D-10 container and the GitHub Actions service container. In `development` and `production`, `DATABASE_CA_CERT` is required and a missing value is invalid core configuration. The migration runner verifies TLS against the same project CA in `DATABASE_CA_CERT`; no separate migration CA variable is added.

Design decision D-31 (database roles): Migrations never create login roles or set passwords. In each Supabase project an operator creates `app_runtime` (LOGIN, password entered outside the repository and logs) before the first migration; the procedure goes in the developer guide (R-04). The test harness creates `app_runtime`, `anon` and `authenticated` as synthetic roles in the disposable database before migrating, so the same migration files run unchanged locally, in CI and on Supabase, and fail loudly if a role is missing.

Design decision D-32 (runtime privileges): `app_runtime` receives `USAGE` on schema `app` and exactly the table privileges listed in [data-model.md](data-model.md) "Runtime privileges". It has no `TRUNCATE`, `REFERENCES`, `TRIGGER` or DDL rights. `DELETE` is granted only where a recorded behaviour needs it. Retention purges (OQ-05) add grants in a later migration when their design is approved. Every migration that adds a table grants its privileges explicitly; default privileges are not used.

Design decision D-33 (schema conventions): The database enforces structure (types, NOT NULL, keys, foreign keys, uniqueness, state vocabularies, numeric ranges and array cardinality). Text length and trimming rules (code points after trimming) are enforced by the owning service's zod schemas (D-22), not by database CHECKs. Closed state vocabularies use `text` columns with CHECK constraints, not PostgreSQL enum types. Open vocabularies that change through contract PRs (AuditEntry `action` and `target_type`, AIJob `error_code`) are unconstrained `text`. Column conventions are listed in [data-model.md](data-model.md) "Schema conventions".

Design decision D-34 (watchlist schema): The optional WatchlistEntry table is not created by the initial migration. If FR-10 is selected (OQ-07), it is added by a new migration.

Design decision D-35 (synthetic seed): The synthetic seed script (DEP-04) creates data only through the owning services wired by the composition root: Accounts through Identity (D-20), Movies and Announcements through Catalogue and Announcements, Reviews and Reports through their services. It refuses to run when `APP_ENV` is `production`, uses only synthetic values, and prints no credentials. It is built after S-04 and A-01, not in S-01.

Design decision D-36 (transaction conflicts and readiness probe): The transaction helper (K1) converts PostgreSQL deadlock (40P01) and serialization (40001) failures into a typed `TransactionConflict` error that carries no driver types. The API kernel (K2) maps it to 409 `conflict`; it is never retried automatically. K1 also exposes a separate `probe()` operation for readiness that runs a read-only query with a 2-second limit covering both connection acquisition and the query; ordinary transactions keep the 5-second limits.

Design decision D-37 (configuration validity): Configuration is validated with zod (D-22 extended to environment variables) once per server instance in the composition root. Validity rules are listed in [deployment.md](deployment.md) 10.3. AI configuration never makes core configuration invalid: invalid or incomplete AI settings, including `AI_PROVIDER=fake` when `APP_ENV=production`, disable AI and are reported by variable name in server logs. Validation messages name variables, never values.

Suggested enhancements, in priority order: private watchlist; spoiler controls; genre filters; admin report-age/AI-failure statistics. Each requires its own requirement and acceptance update before implementation.

## 15. References

- [Selected stack assessment and platform references](tech-stack.md), checked 8 October 2026; account allocations and plan limits must be rechecked before deployment.
- User's project proposal and requested 15-section structure, supplied in this conversation on 8 October 2026.
- [SoC LLM guide](https://dochub.comp.nus.edu.sg/cf/guides/soclaas/start): referenced by the brief; access attempt during drafting failed, so provider details remain unverified.
- Repository README: project identifier CS3227-2610-MP3.
