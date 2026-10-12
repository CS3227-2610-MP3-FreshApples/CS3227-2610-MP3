# FreshApples Implementation Plan

Status: **proposed, awaiting human approval**. Planning date: 12 October 2026 (SGT). Source revision: `d1c0265` (`master`).

This is the L7 "Plan" artifact: it breaks the approved specifications in `spec/` into tasks, each with dependencies, scope, acceptance criteria and progress tracking. It adds no product behaviour. If this plan and `spec/` disagree, `spec/` wins and the conflict goes to a human (see `AGENTS.md`).

Task IDs (`S-xx`, `U-xx`, `A-xx`, `R-xx`) are **planning IDs only**. They are not requirement IDs. Commit messages cite requirement IDs copied from `spec/` (FR-, INV-, SEC-, AI-, DEP-, AT-), never task IDs. Task IDs go in branch descriptions, PR bodies and handoffs.

Companion document: [COMMIT-PLAN.md](COMMIT-PLAN.md), the per-developer PR and commit sequence for independent work.

---

## 1. Progress tracker

States: `Blocked` → `Draft` → `Spec review` → `Ready` → `Implementing` → `Verification` → `Human review` → `Merged`. Only a human may set `Ready` (spec approved) or `Merged`.

| Task | Owner | Title | Depends on | Target | State |
| --- | --- | --- | --- | --- | --- |
| S-00 | Both (human) | Resolve blocking decisions and freeze contracts | — | 12 Oct | Draft |
| S-01 | B | Config, database access, migrations, full initial schema | S-00 | 13 Oct | Blocked |
| S-02 | A | HTTP/API kernel (errors, validation, pagination, If-Match, no-store) | S-00 | 13 Oct | Blocked |
| S-03 | B | Test harness, CI checks, health endpoints | S-01 | 14 Oct | Blocked |
| S-04 | A | Identity: accounts, sessions, CSRF, guards, login throttling, admin provisioning | S-01, S-02 | 14 Oct | Blocked |
| S-05 | B | Audit and shared rate-limit primitives | S-01 | 14 Oct | Blocked |
| S-06 | B | AI runtime: SoC adapter, deterministic fake, execution controller, quotas, leases | S-01, S-05 | 15 Oct | Blocked |
| S-07 | A | Shared UI shell and components (`/app`, `/admin` navigation split) | S-00 | 14 Oct | Blocked |
| U-01 | A | Public catalogue, search, details, public announcements | S-02, S-07 | 15 Oct | Blocked |
| U-02 | A | Review lifecycle, visibility transitions, aggregates, moderation hook | S-04, S-05, S-06 (interface) | 17 Oct | Blocked |
| U-03 | A | Report submission and reporter-only history | U-02 | 18 Oct | Blocked |
| U-04 | A | Scheduled public review summary (AI-01) | U-02, S-06 | 19 Oct | Blocked |
| A-01 | B | Admin movie CRUD, archive and restore | S-04, S-05, S-07 | 15 Oct | Blocked |
| A-02 | B | Admin announcements | A-01 | 16 Oct | Blocked |
| A-03 | B | Automatic profanity moderation and recovery sweep (AI-02) | S-06, U-02 (transition interface), OQ-04 | 17 Oct | Blocked |
| A-04 | B | Admin review queue: approve, hide, restore | A-03, U-02 | 18 Oct | Blocked |
| A-05 | B | Report decisions, strikes, threshold suspension | U-03, S-04 | 19 Oct | Blocked |
| A-06 | B | Admin user management: manual suspend and unsuspend | A-05 | 19 Oct | Blocked |
| R-01 | Both | AI evaluation and security fixtures (both features) | U-04, A-03 | 20 Oct | Blocked |
| R-02 | Both | End-to-end journeys, access matrix, accessibility checks | All U/A | 20 Oct | Blocked |
| R-03 | Both | Development-agent rehearsal and evaluation evidence | S-00 | 16 Oct | Blocked |
| R-04 | B (lead), A reviews | Deployment pipeline, crons, backup/restore, rollback rehearsal | S-03 | 21 Oct | Blocked |
| R-05 | Both | Guides, website, reflections, logs, traceability, submission audit | All | 22–23 Oct | Blocked |

Optional FR-10 (watchlist, AT-15) is **not scheduled** (OQ-07). Start it only after a human records that core scope is on track.

---

## 2. Conventions (from the codebase)

- Stack is pinned in `package.json`: Next.js 16.4.0, React 19.3.0, `pg` 8.23.1, Tailwind 4, ESLint 9. Next.js 16 differs from older versions. Read `node_modules/next/dist/docs/` (01-app, 03-architecture) before writing Route Handlers, layouts or `maxDuration` exports.
- Layout: pages and Route Handlers go in `src/app`, reusable UI in `src/components`, server-only code in `src/server/{services,repositories,adapters}`, and tests in `tests/{unit,integration/database,integration/api,e2e,ai-evaluation}`.
- Proposed module subfolders (confirm in S-00): `src/server/services/<module>/` and `src/server/repositories/<module>/` for `identity`, `catalogue`, `reviews`, `moderation`, `announcements`, `ai`, `audit`; `src/server/adapters/soc-llm/`; `src/server/db/` (pool, transaction helper, migrations); `src/server/http/` (API kernel); `src/server/config/`.
- Database: `pg` through the transaction pooler with one connection per instance, CA-verified TLS, no named prepared statements, `SET LOCAL` only, and `date` returned as `YYYY-MM-DD` via per-pool `types` (`spec/tech-stack.md`).
- API: `/api/v1`, Node.js runtime, the error envelope and status codes in `spec/api.md` §8.1, and `Cache-Control: no-store` on private or changing data.
- Commands available now: `npm ci`, `npm run dev`, `npm run build`, `npm run lint`, `npx tsc --noEmit`. There is **no test command yet**; S-03 adds one after S-00 picks the framework.
- Git: branches `feat/<module>-<slug>`, `fix/…`, `chore/…` off `master`. Conventional Commits scoped to the module. Humans commit, push and open PRs (`AGENTS.md` § Git).
- Ownership of shared hotspots (migrations, `package.json`, root layout, shared contracts) is set in [COMMIT-PLAN.md §2](COMMIT-PLAN.md#2-rules-that-make-independent-work-possible).

---

## 3. Blocking decisions and conflicts found while planning

Under `AGENTS.md` § Ambiguity, nobody resolves these by inference. Each one blocks the tasks listed. Agree all of them in **S-00** and record them in `spec/` (the human assigns any decision IDs).

| # | Item | Why it blocks | Blocks |
| --- | --- | --- | --- |
| B1 | **Migration tool not selected** (D-07 leaves it open) | No schema can be created or versioned | S-01 and everything after |
| B2 | **Test frameworks not selected** (unit/integration, E2E). `AGENTS.md` forbids inventing a test command | No task can meet the Completion Criteria | S-03 and every task's tests |
| B3 | **Local/test PostgreSQL approach** (container vs local install; `spec/deployment.md` 10.1 requires disposable local PostgreSQL) | Integration tests need an isolated DB per developer | S-01, S-03 |
| B4 | **Auth and password-hashing library** (DEP-04 needs a maintained library; SEC-02 needs Argon2id) | Identity cannot start | S-04 |
| B5 | **Data-model gaps.** `spec/data-model.md` has no storage for (a) login-failure throttling (SEC-06), (b) per-User review/report rate limits with "shared enforcement" (`spec/security.md`), (c) AI token-budget reservations (AI-03 "PostgreSQL reservations"), or (d) CSRF token binding (SEC-04) | The initial schema migration would have to guess tables | S-01, S-04, S-05, S-06 |
| B6 | **Env-var naming conflict.** `.env.example` uses `SOCLAAS_BASE_URL/API_KEY/MODEL`, but `spec/deployment.md` 10.3 uses `SOC_LLM_BASE_URL/API_KEY/MODEL` | The config contract is ambiguous | S-01 config, S-06 |
| B7 | **OQ-01: SoC models and quotas.** The API guide confirms an OpenAI-compatible gateway, `GET /v1/models`, and 429 for both rate and budget limits. Numeric RPM/TPM/budget and the permitted model are still unverified | `SOC_LLM_REQUESTS_PER_MINUTE`, `AI_DAILY_TOKEN_BUDGET` and the input-token cap cannot be set | S-06 live config; real AI in R-01/R-04 (fake-based work can proceed) |
| B8 | **OQ-04: profanity policy text and version** | AI-02 says to review and version the policy before enabling screening | A-03 acceptance |
| B9 | **OQ-06: developer names and final ownership** | Ownership and handoffs need names | All tasks (assignment) |
| B10 | **Deployment mode.** Vercel Git integration (confirmed working) vs the DEP-02 GitHub Actions pipeline. Should automatic production deploys be disabled? | Release gate design | R-04 |
| B11 | **Default branch.** `origin/HEAD` points to `main` (one commit), while work and D-06 use `master` | Grading pulls `master`; PR targets must be unambiguous | Repository setting (human) |
| B12 | **Shared contract ownership.** Who owns the account-status transition (lock, version, sessions, `strike_cycle`): identity (A) or moderation (B)? Lock order for Account/Movie/Review | `spec/architecture.md` 6.4 forbids duplicated logic. Concurrency tests need one lock order | S-04, U-02, A-05, A-06 |
| B13 | **Page route map** for public, `/app` and `/admin` pages (spec fixes only the `/app` and `/admin` split) | UI tasks would otherwise invent URLs | S-07, U-01, A-01 |

Minor inconsistencies to note but not to block on:

- `package.json` devDependencies use caret ranges (`^4`, `^5`, …) although `AGENTS.md` asks for pinned versions. S-01 should pin them, and the lockfile already exists.
- `AGENTS.md` lists 7 workflow steps (including the code-quality/test agent). `spec/governance.md` lists 6. Align the two in S-00.

---

## 4. Per-task workflow (SDD + specialized agents)

Every task follows the recorded workflow (`AGENTS.md`, `workflow/README.md`). The agent configs already exist in `.codex/agents/` and `workflow/agents/`.

1. **Analyst** (read-only): checks the task against its spec sections and returns gaps plus Given/When/Then examples, including negative cases.
2. **Architect** (read-only): checks boundaries, the contracts in §5, transactions, lock order and threats.
3. **Human gate:** the owner approves the spec/task. The other developer must approve changes to shared contracts, the schema or security policy.
4. **Implementation:** writes tests first for invariants (visibility, strikes, leases, privacy), then code. Stays inside allowed paths and uses local PostgreSQL plus the fake SoC adapter.
5. **Code-quality/test generator:** writes independent tests and reports coupling/cohesion findings.
6. **Reviewer/tester** (fresh context): reviews the diff at a pinned base/head SHA. Returns PASS/FAIL/BLOCKED with evidence.
7. **Human gate:** the other developer reviews the PR. CI must be green, or once CI exists, checks are run locally.

Handoffs go in `workflow/handoffs/<task-id>/`. Each chat session gets one human-verified log in `logs/`. Small fixes (typos, single-line) skip steps 1–2 but still need a reviewer and human approval. After two failed verify→fix rounds, stop and escalate to a human (L6: stop conditions).

Coordination pattern (L8): **generator–verifier** inside each task, with a human orchestrator across tasks. Each developer works one writable task at a time in their own clone or `git worktree` (L8: workspace isolation), with their own local database.

---

## 5. Cross-boundary contracts (frozen in S-00, provided as typed interfaces + fakes)

Each contract has **one provider**. The provider merges the interface plus a fake or stub early, so the consumer can build against it before the real implementation lands. Signatures are drafted by the architect agent and approved in S-00. The table records only ownership and purpose.

| # | Contract | Provider → consumer | Purpose / spec basis |
| --- | --- | --- | --- |
| K1 | Transaction helper and `Tx` handle; repositories accept `Tx` | B → A | One transaction for cross-module work (arch 6.4) |
| K2 | API kernel: error envelope, request ID, body parsing (32 KiB, unknown-field rejection), pagination, If-Match/ETag, no-store | A → B | api.md 8.1 |
| K3 | Auth guards (`active USER`, `active ADMIN`, recheck status every request), session revocation inside a caller's `Tx` | A → B | SEC-01, SEC-03, FR-01 |
| K4 | Account-status transition (lock, version check, sessions, `strike_cycle`), owner per B12 | per B12 | FR-06, AT-25 |
| K5 | Audit `record(tx, entry)` | B → A | security.md audit rules |
| K6 | Shared rate limiter `consume(key, limit, window)` | B → A | SEC-06, SEC-11 |
| K7 | Catalogue: `assertMovieActiveForUpdate(tx, movieId)`, `markReviewsChanged(tx, movieId)` (bumps `reviews_revision`, sets `summary_pending_since`) | B → A | INV-05, INV-09, data-model |
| K8 | Review transitions: automatic clearance (version-guarded), approve, hide, restore, read-for-moderation | A → B | FR-03, FR-09, arch 6.4 |
| K9 | Moderation work: `enqueue(tx, reviewId, contentRevision)` inside the review transaction; `attemptAfterCommit(reviewId)` bounded | B → A | AI-02 dispatch |
| K10 | AI runtime: `LlmProvider` interface + deterministic fake; execution controller (reserve capacity, lease, timeout/retries, reconcile usage) | B → A | AI-03, SEC-08 |
| K11 | Report evidence snapshot shape and receipt projection | A → B | FR-04, INV-07 |
| K12 | Shared UI primitives (form field with error, table, pagination, status badge, live region, confirm dialog) | A → B | product 5.2, 5.3 |

Fakes must **fail closed**. A fake cannot grant authorization or clear a review in production, and production must wire the real adapter (verified in R-04).

---

## 6. Tasks

### Task S-00: Resolve blocking decisions and freeze contracts

**Owner:** both developers (human task, agent-assisted). **Depends on:** —
**Description:** Run one 60–90-minute session. Resolve §3 B1–B13 and record the outcomes in `spec/governance.md`, `spec/data-model.md` (B5), `spec/deployment.md` (B6) and `AGENTS.md` (B2 test command). Approve the K1–K12 owners and have the architect agent draft signatures into `workflow/contracts.md`. Fill in developer names (OQ-06).
**Acceptance Criteria:**
- [ ] B1–B6, B9–B13 recorded in `spec/` with human approval. B7/B8 have an owner and a dated resolution plan.
- [ ] `workflow/contracts.md` lists K1–K12 with provider, consumer, approved signature and lock order.
- [ ] `AGENTS.md` Commands section names the selected test commands.
- [ ] This plan's tracker is updated: tasks with no remaining blockers move to `Draft`.

### Task S-01: Config, database access, migrations, initial schema

**Owner:** B. **Depends on:** S-00 (B1, B3, B5, B6). **Reqs:** spec/data-model.md §7, tech-stack.md "Database driver", deployment.md 10.3, SEC-05, SEC-07.
**Allowed paths:** `src/server/config/`, `src/server/db/`, migration directory, `.env.example`, `package.json`/lockfile.
**Description:** Add a server-only config validator (invalid DB/session config prevents readiness; missing AI config disables AI). Add the `pg` pool (1 connection, CA TLS, `date` as string, statement timeout, no query names) and the `withTransaction` helper (K1). Add the migration runner and **one initial migration for the whole data model**, including the B5 additions, all constraints, partial unique indexes and listed indexes, in a schema not exposed to Supabase Data APIs. Add a synthetic seed script. Pin devDependency versions.
**Acceptance Criteria:**
- [ ] Migration applies cleanly to an empty local PostgreSQL and is re-runnable without drift.
- [ ] Integration tests check: unique `(movie_id, author_id)`; rating 1–10 check; partial unique open report per `(reporter_id, review_id)`; unique `(target_user_id, review_id)` strike; unique `ModerationWork` revision key.
- [ ] Runtime role has least privilege. The anon/authenticated API roles cannot read app tables (AT-18 direct-access check documented).
- [ ] No secrets in the repo. `.env.example` has placeholders for every new variable.

### Task S-02: HTTP/API kernel

**Owner:** A. **Depends on:** S-00. **Reqs:** api.md 8.1, SEC-05, AGENTS.md API rules.
**Allowed paths:** `src/server/http/`, `tests/unit/http/`.
**Description:** Provide contract K2: error envelope `{ error: { code, message, fieldErrors?, requestId } }` without stack traces; JSON body cap of 32 KiB and content-type check; strict mutation-field validation (unknown fields → 400/422 as specified); Unicode code-point length counting after trim; page/pageSize parsing (default 20, cap 100); `If-Match` (absent → 428, mismatch → 409) and `ETag`; `no-store` helper.
**Acceptance Criteria:**
- [ ] Unit tests cover every status mapping in api.md 8.1, unknown fields, oversize bodies, code-point lengths with emoji and combining characters, and pagination bounds.
- [ ] No module in `src/server/http/` imports a repository or adapter.

### Task S-03: Test harness, CI checks, health endpoints

**Owner:** B. **Depends on:** S-01, S-00 (B2). **Reqs:** DEP-02 (checks portion), AT-26, verification.md 11.1.
**Allowed paths:** `tests/` harness and config, `package.json` scripts, `.github/workflows/ci.yml`, `src/app/api/v1/health/`.
**Description:** Wire the selected unit, PostgreSQL-integration and E2E runners to real scripts with nonzero exit on failure. Each test run gets a disposable database. Add a CI workflow for lint, type-check, unit+integration tests, build and secret scan, with no deploy or provider secrets in PR jobs. Add `GET /health/live` and `/health/ready` exactly as in api.md.
**Acceptance Criteria:**
- [ ] AT-26: live returns 200 without DB access; ready returns 503 on a DB outage or missing core config and 200 when AI is down; both use no-store, generic shapes and a 2 s probe.
- [ ] CI runs on PRs to `master` and fails on a deliberately failing test (demonstrated once, then reverted).
- [ ] `AGENTS.md` Commands updated with the real test commands.

### Task S-04: Identity

**Owner:** A. **Depends on:** S-01, S-02 (S-05 limiter interface for throttling). **Reqs:** FR-01, INV-01, SEC-01–04, SEC-06, DEP-04, AT-01.
**Allowed paths:** `src/server/{services,repositories}/identity/`, `src/app/api/v1/auth/`, auth pages, admin provisioning script, matching tests.
**Description:** Registration always creates USER (injected role/status ignored). Argon2id hashing with passwords of 12–128 characters and no truncation. Opaque random session tokens stored hashed; cookie HttpOnly/Secure/SameSite=Lax with 8 h absolute expiry. Logout. `GET /auth/me`. CSRF token plus same-origin check on unsafe methods. Login throttle of 5 failures per 15 min per normalized email and per IP, with generic errors (including for suspended accounts). Guards K3 recheck status on every request. Session revocation in the caller's `Tx`. Reviewed operator command for admin provisioning, with no secrets in logs.
**Acceptance Criteria:**
- [ ] AT-01 cases: injected `role: "ADMIN"` → USER; USER calls to an admin endpoint stub → 403 with no mutation; logout invalidates; suspended accounts cannot log in and get a generic error; forged cross-origin POST fails.
- [ ] Duplicate normalized email → safe 409. Throttling and enumeration tests pass.
- [ ] Session token never stored or logged in plaintext.

### Task S-05: Audit and shared rate limiter

**Owner:** B. **Depends on:** S-01. **Reqs:** security.md audit and limits, SEC-06, SEC-11.
**Description:** K5 `audit.record(tx, …)` stores actor, target, action, result, minimal metadata and request ID (no passwords, report bodies or prompts), with no API to edit it. K6 limiter backed by PostgreSQL (B5 storage) that returns `Retry-After`.
**Acceptance Criteria:**
- [ ] Audit write rolls back with its transaction (integration test).
- [ ] Limiter is correct under concurrent calls from two connections and returns a retry time.

### Task S-06: AI runtime (shared)

**Owner:** B. **Depends on:** S-01, S-05; B7 for live values only. **Reqs:** AI-03, AI-04, SEC-08, SEC-11, CON-02, api.md 8.2/8.4.
**Allowed paths:** `src/server/adapters/soc-llm/`, `src/server/services/ai/runtime/`, tests.
**Description:** `LlmProvider` interface (bounded messages, model, output-token cap, deadline → content + safe usage, or typed error). Real SoC adapter (OpenAI-compatible gateway; maps 429/5xx/timeout to typed errors; never surfaces raw errors). Deterministic fake (scriptable success, malformed JSON, 429, timeout). Execution controller: `AI_ENABLED` gate, 1 active execution per environment, token-budget reservation and conservative reconciliation, AIJob lease and dedup key, 30 s/attempt, at most 2 attempts with jitter honouring `Retry-After`, 75 s deadline, and no DB transaction held during a provider call. Scheduler-lease helper.
**Acceptance Criteria:**
- [ ] Unit/integration tests: second concurrent execution is deferred; budget exhaustion defers without losing work; expired lease rejects late publish; unknown usage charged conservatively; retries stop at the deadline.
- [ ] Missing quota/budget config → AI disabled, core unaffected.
- [ ] Adapter is imported only from AI orchestration (lint rule or test).

### Task S-07: Shared UI shell and components

**Owner:** A. **Depends on:** S-00 (B13). **Reqs:** product 5.2, 5.3.
**Allowed paths:** `src/components/`, `src/app/layout.tsx`, route-group layouts.
**Description:** Root layout and separate `/app` and `/admin` navigation shells. K12 primitives with labelled inputs, field-associated errors, visible focus, status not shown by colour alone, a polite live region, and a confirmation dialog that names its target. Rating display `8/10` and aggregate `8.3/10`.
**Acceptance Criteria:**
- [ ] Components are keyboard-operable (manual checklist recorded) and do not import `src/server`.
- [ ] B has reviewed the component API before A-01 starts.

### Task U-01: Public catalogue, details, announcements (read)

**Owner:** A. **Depends on:** S-02, S-07 (S-01 seed data). **Reqs:** FR-02, FR-07 (public read), INV-02, INV-05, CON-01, AT-02 (public half), AT-06 (public half).
**Description:** `GET /movies` (q ≤ 200 case-insensitive, `release_desc`/`title_asc` with ID tie-break), `GET /movies/:id` with aggregate over eligible reviews only, `GET /announcements` (published, by publication time), and the corresponding pages with loading, empty and error states. Archived/unknown → 404. No image fields anywhere.
**Acceptance Criteria:**
- [ ] Stable pagination with ties; empty search; unknown release date; duplicate titles distinguished by ID.
- [ ] Aggregate null/0 with no eligible reviews; pending/flagged/hidden/deleted excluded (fixture-based).
- [ ] Draft announcements never returned.

### Task U-02: Review lifecycle and visibility transitions

**Owner:** A. **Depends on:** S-04, S-05, K7 and K9 interfaces from B. **Reqs:** FR-03, INV-02, INV-03, INV-09, AI-02 (dispatch side), AT-03, AT-21, AT-23, AT-24 (crash-before-dispatch).
**Description:** `POST /movies/:id/reviews`, `PATCH/DELETE /reviews/:id`, `GET /me/reviews`, `GET /movies/:id/reviews`. Rating 1–10 integers; body 10–2,000 code points. A create, resubmission or body edit atomically sets `pending`, increments `content_revision`, calls K9 `enqueue`, and calls K7 `markReviewsChanged` when public eligibility changes. A rating-only edit keeps clearance. After commit, call K9 `attemptAfterCommit` and return 201/200 with `moderationState`. `maxDuration = 120`. Rate limit 10/min. Exposes K8 transitions (version-guarded clearance, approve, hide, restore) for B.
**Acceptance Criteria:**
- [ ] Reference cases: provider down → 201 pending, not public; another User → 404/403 without mutation; body edit of published review removes it from public view and aggregates atomically; rating-only edit cannot clear pending/flagged; resubmission after delete reuses the ID and re-screens; author cannot undo an admin hide; stale `If-Match` → 409; concurrent creates keep uniqueness.
- [ ] Archived Movie blocks mutations, and archive serializes with review creation (lock-order test from S-00).
- [ ] K8 contract tests run against B's usage patterns (approval beats late AI result).

### Task U-03: Report submission and reporter history

**Owner:** A. **Depends on:** U-02. **Reqs:** FR-04, INV-04, INV-07, AT-04, AT-22 (privacy part).
**Description:** `POST /reports` (category enum, explanation 10–1,000), with the target derived server-side, an immutable evidence snapshot (K11) in the same transaction, and a limit of 5/hour. `GET /me/reports` and `/me/reports/:id` filtered by `reporter_id`. "Report user" action on others' visible reviews.
**Acceptance Criteria:**
- [ ] Self-report and duplicate open report rejected. Deleted review before submission → 409. Later edits/deletion do not change the snapshot.
- [ ] Guessed report ID of another reporter → 404, including when the caller is the target. No received-report data appears in any target-facing projection.

### Task U-04: Scheduled public review summary

**Owner:** A. **Depends on:** U-02, S-06. **Reqs:** FR-08, AI-01, AI-04, INV-09, DEP-09, AT-07, AT-08, AT-20.
**Description:** Changed-Movie selection order and backoff; fewer than 3 eligible → `insufficient_reviews` with no execution; seeded uniform sampling without replacement (≤ 20) with persisted IDs/versions; 1,000-character truncation markers and 8,000-token cap; JSON schema validation (lengths, allowed source IDs); publication guarded by revision and lease. `GET /internal/cron/summaries` (Bearer `CRON_SECRET`, aggregate counts only, scheduler lease, one Movie per run). `GET /movies/:id/summary` (read-only states). Summary UI with the fixed disclaimer and no generate/retry control.
**Acceptance Criteria:**
- [ ] AT-07/08/20 subcases with the fake: unchanged Movie → no provider call; review edit during generation → no stale publish; missing/invalid secret, including an Admin cookie alone → 401; missed run recovered; fair ordering under a failing Movie.
- [ ] Fabricated source IDs or oversize fields in output → rejected, nothing published.

### Task A-01: Admin movie management

**Owner:** B. **Depends on:** S-04 (guards), S-05, S-07. **Reqs:** FR-05, INV-05, INV-09, AT-02.
**Description:** `/admin/movies` CRUD, archive (soft, with a confirmation naming the Movie) and restore. Writable fields only, with If-Match. Archive/restore bump `reviews_revision` (restored → summary pending). Audited. Admin pages.
**Acceptance Criteria:**
- [ ] AT-02 round trip with U-01 public views. Derived/actor fields rejected. Stale write → 409 with no change. USER → 403.

### Task A-02: Admin announcements

**Owner:** B. **Depends on:** A-01. **Reqs:** FR-07, AT-06.
**Description:** `/admin/announcements` create (draft), edit, publish/unpublish (republish sets a new `published_at`), soft delete, audited. Archived Movie reference keeps the announcement but omits the public link.
**Acceptance Criteria:**
- [ ] AT-06; empty/oversize content rejected; drafts never appear through U-01 endpoints.

### Task A-03: Automatic profanity moderation

**Owner:** B. **Depends on:** S-06, U-02 K8 interface, OQ-04 policy for acceptance. **Reqs:** FR-09, AI-02, AI-04, SEC-08, SEC-09, DEP-10, AT-09, AT-10, AT-21, AT-24.
**Description:** Implement K9: durable `ModerationWork`, bounded post-commit attempt, input (pseudonymous ID + full body + versioned policy; too long → manual review, never a fragment), output validation (enums, exact-substring quotes, field caps, no unknown fields), fixed clearance rule via K8 with revision/version/lease guards, retry/backoff, 3 failed executions → `needs_manual_review`, supersession on new revision. `GET /internal/cron/review-moderation` (secret, own lease, one review per run). `GET /ai/jobs/:id` (Admin only, safe fields).
**Acceptance Criteria:**
- [ ] AT-09/21/24 with the fake: clean → cleared; suspected/uncertain → flagged; invented quote → rejected → manual review; crash after commit → recovered by sweep; capacity deferral does not consume attempts; deleted/hidden cancels work.
- [ ] No endpoint or UI requests or retries AI. AI cannot create reports, strikes or account changes (test asserts no such calls).

### Task A-04: Admin review queue

**Owner:** B. **Depends on:** A-03, U-02. **Reqs:** FR-09 (admin side), SEC-09, AT-21, AT-23.
**Description:** `GET /admin/reviews` (filters including unchecked/failed/hidden/deleted with an "all reviews" reset), `GET /admin/reviews/:id`, and `POST …/approve|hide|restore` with reason and If-Match, all through K8. Escaped source text shown beside the labelled AI assessment.
**Acceptance Criteria:**
- [ ] Approval during an in-flight AI execution wins; restore never grants clearance and reactivates work; approval does not undo author deletion.

### Task A-05: Report decisions, strikes, threshold suspension

**Owner:** B. **Depends on:** U-03, S-04 (K3/K4). **Reqs:** FR-06, INV-06, SEC-09, SEC-10, AT-05, AT-16, AT-22.
**Description:** `GET /admin/reports` (default open; status/category filters; "All reports" reset), `GET /admin/reports/:id` (snapshot, live state, strike count, projected effect), `POST …/decision`. Accept/dismiss with reason; optional `hide_review`. In one transaction under the target-account lock: unique strike insert, threshold check (`REPORT_SUSPENSION_THRESHOLD`), suspension with session revocation, and audit. The response includes `strikeAdded` and `accountStatus`.
**Acceptance Criteria:**
- [ ] Concurrent acceptances across different reviews → exactly one suspension at the threshold. The same review via multiple reporters → one lifetime strike. Repeat decision → 409. Reinstated account cannot recount old incidents.

### Task A-06: Admin user management

**Owner:** B. **Depends on:** A-05 (shared K4). **Reqs:** FR-06 (manual), SEC-01, AT-25.
**Description:** `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/status` (USER targets only; reason; If-Match; confirmation naming the User). Same-status request → no-op. Only suspended→active advances `strike_cycle`.
**Acceptance Criteria:**
- [ ] AT-25 in full, including serialization with a concurrent report acceptance.

### Task R-01: AI evaluation and security fixtures

**Owner:** A (summary), B (moderation). **Depends on:** U-04, A-03; B7 for live runs. **Reqs:** AI-04, SEC-08, AT-11, verification.md 11.1.
**Description:** At least 10 benign and 10 adversarial versioned fixtures per feature in `tests/ai-evaluation/` covering injection, forged delimiters, credential/report exfiltration requests, fabricated IDs, HTML/script, obfuscated profanity, benign quotations, uncertain language, 429/timeout and malformed JSON. Deterministic containment tests run in CI. Live SoC runs are manual and budgeted, with a human rubric in `workflow/evaluations/`.
**Acceptance Criteria:**
- [ ] All containment checks pass. At least 90% of benign outputs judged grounded/useful, or the shortfall is documented. One controlled live SoC smoke per feature recorded.

### Task R-02: End-to-end, access matrix, accessibility

**Owner:** A (User journey, user-side matrix), B (Admin journey, admin-side matrix). **Depends on:** all U/A tasks.
**Acceptance Criteria:**
- [ ] One complete User journey and one complete Admin journey, both with fake AI success and failure (AT-14 support).
- [ ] Two-user/two-role access matrix including guessed IDs (SEC-01) and two-user private-cache isolation (AT-18).
- [ ] Manual keyboard/focus/error/live-region checklist recorded for core flows.

### Task R-03: Development-agent rehearsal

**Owner:** both. **Depends on:** S-00. **Reqs:** SEC-12, AT-12, course multi-agent requirement.
**Description:** Run small synthetic cases against the five agents in `.codex/agents/`: a conflicting spec, a missing atomic audit, a planted ownership bug, an injected "disable tests/print secret" comment, a handoff with no SHA, and an out-of-scope edit request. Record expected and actual results and any instruction fixes in `workflow/evaluations/`.
**Acceptance Criteria:**
- [ ] Each case has a recorded result and human verdict. Weak instructions revised and rerun.

### Task R-04: Deployment, crons, backup, rollback

**Owner:** B (A reviews and approves the release). **Depends on:** S-03, B10. **Reqs:** DEP-01–DEP-10, AT-13, AT-17, AT-19.
**Description:** Separate Preview/Production env scopes; `vercel.json` crons (summaries 00:00 UTC, review moderation 01:00 UTC); Fluid compute with `maxDuration` verified on the deployed Hobby project; controlled migration step with pre-migration encrypted backup; restore and rollback rehearsal; production smoke.
**Acceptance Criteria:**
- [ ] Preview cannot reach production DB; no secrets in client bundle (built-asset scan); cron secret rejection verified on deployment; backup restored once into a scratch DB; app URL recorded in `docs/` site.

### Task R-05: Documentation and submission

**Owner:** A (UserGuide, website), B (DeveloperGuide), both (Reflections, logs, traceability). **Depends on:** all.
**Acceptance Criteria:**
- [ ] UserGuide matches shipped behaviour and tester access. DeveloperGuide describes architecture, `workflow/` files, commands and acknowledgements.
- [ ] Reflections cite real incidents from handoffs and logs. Every log human-verified.
- [ ] Traceability (requirement → task → test → result) covers AT-01–AT-26 except AT-15 (deferred).
- [ ] `master` current; final SHA, URLs and known limitations recorded.

---

## 7. Calendar (12–23 October 2026, SGT)

| Date | Developer A | Developer B | Sync point / exit condition |
| --- | --- | --- | --- |
| Sun 12 | S-00 with B; S-02 | S-00 with A; S-01 | Decisions recorded; contracts K1–K12 approved |
| Mon 13 | S-02 merge; S-07 | S-01 merge (schema + tx helper) | **SP-1:** schema and kernel on `master` |
| Tue 14 | S-04 identity | S-03 CI/health; S-05; K7/K9/K10 interface stubs | **SP-2:** guards, audit, limiter, AI/catalogue stubs on `master` |
| Wed 15 | U-01; start U-02 | S-06 runtime; A-01 | Catalogue round trip (admin create → public view) |
| Thu 16 | U-02 (K8 interface merged early) | A-02; start A-03 against K8 | **SP-3:** K8 on `master` |
| Fri 17 | U-02 merge | A-03 merge | **Checkpoint:** register → review → auto-screen → held/cleared works end to end with the fake |
| Sat 18 | U-03 | A-04 | Report submission available to B |
| Sun 19 | U-04 | A-05, A-06 | **Feature freeze** at end of day |
| Mon 20 | R-01 (summary), R-02 (User) | R-01 (moderation), R-02 (Admin), R-04 rehearsal | Live SoC smoke per feature (if B7 resolved) |
| Tue 21 | Peer test User flows; fixes; UserGuide | Peer test Admin flows; fixes; DeveloperGuide | Release candidate SHA chosen |
| Wed 22 | R-05 website, reflections, logs | R-04 production deploy + smoke | Released and online |
| Thu 23 (by 12:00) | Submission audit | Submission audit | No feature work; 2 h buffer before 14:00 |

R-03 (agent rehearsal) runs in small slots on 13–16 October and before any heavy agent use.

**Checkpoint rule (17 Oct):** if the end-to-end path is not working, drop styling polish, keep optional features out, and split blocked tasks. Never drop AI containment, recovery, role ownership or tests. Changing mandatory scope requires a spec revision approved by both developers.

**Backlog risk:** the defaults are one Movie and one deferred review per daily sweep (D-04). Measure the outage backlog in R-04. If capacity is inadequate, revise `spec/ai.md` and `spec/deployment.md` first. Never add AI retry buttons or publish unchecked text.

---

## 8. Definition of done (per task)

A task is done when all of the following hold. The approved acceptance criteria pass. Reviewer/tester findings are resolved. CI (or recorded local checks) is green. The other developer has approved the PR. The work is merged to `master`. Traceability points to real evidence. Affected guides are updated. The session log is human-verified. `AGENTS.md` § Completion Criteria governs any disagreement.
