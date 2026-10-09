# Project Specification — Architecture

## 6. Technical Architecture

### 6.1 System Context

Selected stack: Next.js App Router with React/TypeScript for the frontend and Next.js Route Handlers (Node.js runtime) for the backend, hosted together on Vercel Hobby. PostgreSQL is hosted in Supabase Free. See [tech-stack.md](tech-stack.md) for free-tier constraints. This is a modular application with no separate backend service or persistent AI worker.

Browser → HTTPS Next.js on Vercel → Supabase PostgreSQL transaction pooler.
Next.js AI Route Handler → persisted execution record + SoC LLM → validated result.
Team CI/CD → separate development and production deployments.
GitHub Pages hosts the product information website and links to the deployed application.

### 6.2 Components / Services

| Component | Responsibility |
| --- | --- |
| Community UI | Listings, details, reviews, reports, summaries, announcements |
| Admin UI | Catalogue, reports, announcements and AI review profanity checks |
| Identity module | Accounts, sessions, role/status enforcement |
| Catalogue module | Movie metadata, archive state |
| Reviews module | Reviews, visibility, aggregates and content revision |
| Moderation module | Reports, evidence snapshots, decisions and account actions |
| Announcements module | Draft/published content |
| AI orchestration module | Scheduled summaries, profanity checks, jobs, quotas, provenance and validation |
| SoC adapter | Provider authentication, request translation and error mapping |
| Audit module | Security and administrative mutation history |

### 6.3 Service Boundaries

HTTP handlers validate transport inputs and delegate to domain services. Domain services enforce invariants transactionally. AI orchestration prepares bounded input and validates output; a fixed server-side clearance rule applies clean/flagged status to the matching Review version. The model has no tool access and cannot choose arbitrary mutations, accept Reports or change accounts. Admin approval/hide actions use normal authorized services.

### 6.4 Data Ownership

Each module owns writes to its tables. Cross-module operations use explicit services and one transaction where consistency is required. Moderation may call review-visibility and account-status services; it must not duplicate their logic. The database is shared infrastructure with migrations, constraints and indexes, not separate per-role storage.

### 6.5 Communication

Browser/API use versioned JSON over HTTPS, same origin in production. Public summary GETs only read stored output. Daily cron generates changed-Movie summaries. Every review submission/body edit saves durable moderation work and automatically attempts screening inside its mutation handler; another daily cron recovers deferred checks. Each invocation awaits bounded work, without detached continuation. Admins read results and resolve held content; no AI-request endpoint exists. No persistent worker or external broker is required.

Use Supabase's shared transaction pooler for runtime database connections, with TLS and a small per-instance pool (initially 1 connection). Disable named prepared statements where required by the chosen driver; parameterized SQL remains mandatory. Do not hold a database transaction open during an LLM network call. Use a direct or session-pooled connection for migrations. Connection details and rationale: [Supabase guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

### 6.6 Dependency Rules

UI cannot access the database or SoC LLM directly. Routes depend on services; services depend on repositories and defined adapters. Shared validation schemas and DTOs contain no credentials or ORM-private fields. Place pages and Route Handlers in src/app, reusable UI in src/components, and server-only services/repositories/adapters in src/server. Server Components may call authorized services directly; Client Components use the HTTP API. Role checks belong in services and handlers, not only navigation or middleware. The provider adapter must be replaceable by a deterministic fake for testing. User and Admin features share identity, storage and AI infrastructure without sharing privileged views.

## 9. Non-Functional Requirements

### 9.1 Performance

Proposed acceptance workload: 1,000 Movies, 10,000 Reviews, 1,000 Reports and 20 concurrent sessions on the documented deployment environment. Non-AI reads target p95 ≤ 500 ms and writes p95 ≤ 1 s, measured server-side over five minutes after warmup. Lists default to 20 items and cap at 100. Search, foreign keys and queue filters require relevant indexes.

Public summary reads and moderation-status reads target at most 1 second. Review submission/body edits may take up to the 75-second AI deadline, an explicit exception to the ordinary write target. Persist pending text first and show a saving/checking state; after deferral, show saved and awaiting moderation. Clients allow more than 75 seconds and reconnect through own-review reads rather than blindly resubmitting. Configure maxDuration = 120 with Fluid compute on review mutation and AI cron handlers. Measure held-review age and summary backlog; no unsupported completion time is promised.

### 9.2 Reliability

Database commits precede success responses. LLM failure cannot undo a saved Review or publish unchecked text. Persist pending work, expire abandoned leases and reject late output. Daily sweeps recover summary and review moderation work with bounded retries; manual approval remains available for outages. Document backlog/capacity validation before release. Health endpoints distinguish liveness/readiness. Back up daily with proposed RPO 24 hours/RTO 4 hours and demonstrate restoration; free-host pauses require recovery procedures. See [deployment.md](deployment.md).

### 9.3 Security

Enforce least privilege, authentication, ownership, role checks, input validation, AI containment and auditable administrative changes. [security.md](security.md) defines acceptance controls.

### 9.4 Privacy

Expose public display names but not emails, sessions, report evidence history or administrative notes. Send only bounded task-relevant text and pseudonymous IDs to SoC LLM. [security.md](security.md) defines retention and provider-data questions.

### 9.5 Observability

Structured logs contain request/job correlation ID, event, outcome, duration and redacted error category. Capture auth failures, denied access, admin actions, execution age, retries, provider 429s, token usage where available, schema-validation failures and cache hits. Never log credentials or raw review/report prompts by default. Admin-visible infrastructure errors must not leak secrets. Alerts or a documented operator check must cover sustained provider failure and abandoned running jobs past their 75-second deadline.

### 9.6 Scalability

Keep Vercel function instances stateless apart from database-backed sessions, pending work and executions. PostgreSQL coordinates quotas, deduplication and leases. Initially share one active AI execution per environment; defer summaries and review checks when busy, keeping pending Reviews unpublished. Recovery throughput must be validated against the submission rate before release. Coordinate environment allocations within the actual SoC quota.
