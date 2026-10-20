# FreshApples Implementation Plan

Status: **approved; S-02 is merged to `master`; S-07/A#2 is implemented on `feat/ui-shell` and awaiting human review**. Planning date: 12 October 2026 (SGT). S-01 merged to `master` in PR #5 (`9f77b53`, 15 Oct); S-03 merged to `master` in PR #6 (`ee62bd1`, 16 Oct); S-02 merged to `master` in PR #8 (`315ef06`, 17 Oct) from `feat/http-api-kernel` through `c51c92e`.

This is the L7 "Plan" artifact: it breaks the approved specifications in `spec/` into tasks, each with dependencies, scope, acceptance criteria and progress tracking. It adds no product behaviour. If this plan and `spec/` disagree, `spec/` wins and the conflict goes to a human (see `AGENTS.md`).

Task IDs (`S-xx`, `U-xx`, `A-xx`, `R-xx`) are **planning IDs only**. They are not requirement IDs. Commit messages cite requirement IDs copied from `spec/` (FR-, INV-, SEC-, AI-, DEP-, AT-), never task IDs. Task IDs go in branch descriptions, PR bodies and handoffs.

Companion document: [COMMIT-PLAN.md](COMMIT-PLAN.md), the per-developer PR and commit sequence for independent work.

---

## 1. Progress tracker

States: `Blocked` → `Draft` → `Spec review` → `Ready` → `Implementing` → `Verification` → `Human review` → `Merged`. Only a human may set `Ready` (spec approved) or `Merged`.

| Task | Owner | Title | Depends on | Target | State |
| --- | --- | --- | --- | --- | --- |
| S-00 | Both (human) | Resolve blocking decisions and freeze contracts (decisions and contracts approved; implementation tasks unblocked) | — | 12 Oct | Merged (spec/contract approval recorded) |
| S-01 | B | Config, database access, migrations, initial schema, Vitest harness | S-00 | 13 Oct | Merged (PR #5, `9f77b53`) |
| S-02 | A | HTTP/API kernel (errors, validation, pagination, If-Match, no-store) | S-00 | 13 Oct | Merged (PR #8, `315ef06`) |
| S-03 | B | Playwright, CI checks, health endpoints | S-01 | 14 Oct | Merged (PR #6, `ee62bd1`) |
| S-04 | A | Identity: accounts, sessions, CSRF, guards, login throttling, admin provisioning | S-01, S-02 | 14 Oct | Backend handoff ready; FR-01/AT-01 and operator evidence pending |
| S-05 | B | Audit and shared rate-limit primitives (decisions D-43–D-47 recorded 16 Oct) | S-01 | 14 Oct | Merged (PR #9, `56314c3`) |
| S-06 | B | AI runtime: SoC adapter, deterministic fake, execution controller, quotas, leases | S-01, S-05 | 15 Oct | Ready |
| S-07 | A | Shared UI shell and components (`/app`, `/admin` navigation split) | S-00 | 14 Oct | Human review (implemented on `feat/ui-shell`) |
| U-01 | A | Public catalogue, search, details, public announcements | S-02, S-07 | 15 Oct | Blocked |
| U-02 | A | Review lifecycle, visibility transitions, aggregates, moderation hook | S-04, S-05, S-06 (interface) | 17 Oct | Blocked |
| U-03 | A | Report submission and reporter-only history | U-02 | 18 Oct | Blocked |
| U-04 | A | Scheduled public review summary (AI-01) | U-02, S-06 | 19 Oct | Blocked |
| A-01 | B | Admin movie CRUD, archive and restore | S-04, S-05, S-07 | 15 Oct | In progress: API (B#6 commit 1, `740533a`) done; UI (commit 3) pending; archive/restore wiring waits on U-02 (D-84) |
| A-02 | B | Admin announcements | A-01 | 16 Oct | In progress: API (B#6 commit 2) implemented, awaiting review; UI (commit 3) pending; public checks wait on U-01 |
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
- Commands available now: `npm ci`, `npm run dev`, `npm run build`, `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration` and `npm run db:migrate` (added in S-01). S-03 adds `npm run test:e2e` (D-42) and `npm run check:secrets` (D-41).
- Git: branches `feat/<module>-<slug>`, `fix/…`, `chore/…` off `master`. Conventional Commits scoped to the module. Humans commit, push and open PRs (`AGENTS.md` § Git).
- Ownership of shared hotspots (migrations, `package.json`, root layout, shared contracts) is set in [COMMIT-PLAN.md §2](COMMIT-PLAN.md#2-rules-that-make-independent-work-possible).

---

## 3. Blocking decisions and conflicts found while planning

Under `AGENTS.md` § Ambiguity, nobody resolves these by inference. Each one blocks the tasks listed. Agree all of them in **S-00** and record them in `spec/` (the human assigns any decision IDs).

**Status (12 Oct 2026):** the human adopted a recommended option for every item. The outcomes are recorded as D-08–D-21 in `spec/governance.md` and applied across `spec/`. Decision IDs are confirmed by the human. The session log `logs/2026-10-12-blocking-decisions-spec-update.md` awaits human verification. The Resolution column below summarises each outcome; `spec/` is authoritative.

| # | Item | Why it blocks | Blocks | Resolution |
| --- | --- | --- | --- | --- |
| B1 | **Migration tool not selected** (D-07 leaves it open) | No schema can be created or versioned | S-01 and everything after | **Resolved:** D-08 node-pg-migrate, timestamped SQL files |
| B2 | **Test frameworks not selected** (unit/integration, E2E). `AGENTS.md` forbids inventing a test command | No task can meet the Completion Criteria | S-03 and every task's tests | **Resolved:** D-09 Vitest + Playwright (commands added in S-03) |
| B3 | **Local/test PostgreSQL approach** (container vs local install; `spec/deployment.md` 10.1 requires disposable local PostgreSQL) | Integration tests need an isolated DB per developer | S-01, S-03 | **Resolved:** D-10 `postgres:17` container (native PG 17 fallback), fresh migrated DB per run, truncation between files |
| B4 | **Auth and password-hashing library** (DEP-04 needs a maintained library; SEC-02 needs Argon2id) | Identity cannot start | S-04 | **Resolved:** D-11 `@node-rs/argon2` + in-repo opaque sessions |
| B5 | **Data-model gaps.** `spec/data-model.md` has no storage for (a) login-failure throttling (SEC-06), (b) per-User review/report rate limits with "shared enforcement" (`spec/security.md`), (c) AI token-budget reservations (AI-03 "PostgreSQL reservations"), or (d) CSRF token binding (SEC-04) | The initial schema migration would have to guess tables | S-01, S-04, S-05, S-06 | **Resolved:** (a)(b) D-12 RateLimitWindow; (c) D-13 `ai_execution` lease + AIBudgetDay/AIBudgetReservation, UTC days; (d) D-14 stateless HMAC CSRF token, no table |
| B6 | **Env-var naming conflict.** `.env.example` uses `SOCLAAS_BASE_URL/API_KEY/MODEL`, but `spec/deployment.md` 10.3 uses `SOC_LLM_BASE_URL/API_KEY/MODEL` | The config contract is ambiguous | S-01 config, S-06 | **Resolved:** D-15 `SOC_LLM_*`; `.env.example` updated. `/v1` base-URL convention resolved by D-24 (contracts O-27: base URL excludes `/v1`) |
| B7 | **OQ-01: SoC models and quotas.** The API guide confirms an OpenAI-compatible gateway, `GET /v1/models`, and 429 for both rate and budget limits. Numeric RPM/TPM/budget and the permitted model were unverified | `SOC_LLM_REQUESTS_PER_MINUTE`, `AI_DAILY_TOKEN_BUDGET` and the input-token cap cannot be set | S-06 live config; real AI in R-01/R-04 (fake-based work can proceed) | **Resolved (16 Oct, D-48):** 90 RPM; USD 80/day and USD 800/month, in microdollars (OQ-01). D-16 interim posture remains. D-25: budget in microdollars, prod 2/3 (60 RPM, 53,333,333 µ$/day), dev 1/3 (30 RPM, 26,666,666 µ$/day). D-48 (16 Oct): limits are SoCLaaS per-key defaults; no TPM limit exists, so `SOC_LLM_TOKENS_PER_MINUTE` and `soc_tokens` are removed; model `default` alias (then `qwen3.6:35b`; 262,144 context; 411,810/1,456,571 µ$ per Mtok from `GET /v1/models`). Open for S-06: whether the adapter sends `reasoning_effort`. Retention and permitted data: not covered by the guides; no further verification needed. D-16 posture stays until a human ends it |
| B8 | **OQ-04: profanity policy text and version** | AI-02 says to review and version the policy before enabling screening | A-03 acceptance | **Partly resolved:** D-17 versioned static policy file in source, English only. Policy text still open (OQ-04); owner Developer B (thegrimbee), before A-03 acceptance (target 17 Oct) |
| B9 | **OQ-06: developer names and final ownership** | Ownership and handoffs need names | All tasks (assignment) | **Resolved:** A = Lim-ZY, B = thegrimbee. Tester accounts still open (OQ-06) |
| B10 | **Deployment mode.** Vercel Git integration (confirmed working) vs the DEP-02 GitHub Actions pipeline. Should automatic production deploys be disabled? | Release gate design | R-04 | **Resolved:** D-18 Vercel Git integration, Actions as required checks, branch protection on `master`; DEP-02 revised |
| B11 | **Default branch.** `origin/HEAD` points to `main` (one commit), while work and D-06 use `master` | Grading pulls `master`; PR targets must be unambiguous | Repository setting (human) | **Resolved:** D-19 `master`. GitHub default-branch setting and `main` retirement are human actions |
| B12 | **Shared contract ownership.** Who owns the account-status transition (lock, version, sessions, `strike_cycle`): identity (A) or moderation (B)? Lock order for Account/Movie/Review | `spec/architecture.md` 6.4 forbids duplicated logic. Concurrency tests need one lock order | S-04, U-02, A-05, A-06 | **Resolved:** D-20 Identity (A) owns Account writes; lock order Account → Movie → Review → Report |
| B13 | **Page route map** for public, `/app` and `/admin` pages (spec fixes only the `/app` and `/admin` split) | UI tasks would otherwise invent URLs | S-07, U-01, A-01 | **Resolved:** D-21 public pages at root, `/app`, `/admin` |

Minor inconsistencies to note but not to block on:

- `package.json` devDependencies use caret ranges (`^4`, `^5`, …) although `AGENTS.md` asks for pinned versions. S-01 should pin them, and the lockfile already exists.
- `AGENTS.md` lists 8 workflow steps (including the code-quality/test agent). `spec/governance.md` listed 7. **Resolved 13 Oct:** governance now lists the same 8 steps.

**S-01 analysis (13 Oct 2026).** The analyst found 15 blocking items and 10 plan/contract conflicts for S-01. Developer B delegated every choice to the agent's recommendation. The outcomes are recorded as D-30–D-37 in `spec/governance.md` and as contract amendments AM-01–AM-05 in `contracts.md` §17; AM-01–AM-05 still need Developer A's approval. This plan now reflects them: S-01 scope, S-03 harness split, seed moved to R-04, watchlist excluded. Log: `logs/2026-10-13-s01-analysis-decisions.md`.

**S-03 analysis (15 Oct 2026).** S-01 is merged (PR #5, `9f77b53`). The analyst found 15 gaps and 10 plan/contract conflicts for S-03.
- **Decided by Developer B:** while A#1 (K2) is unmerged, the health handlers set `Cache-Control: no-store` directly and the PR says so.
- **Delegated to the agent:** the other spec gaps, recorded as D-38–D-42 in `spec/governance.md` and amendment AM-06 in `contracts.md` §18. AM-06 was approved by Developer A (Lim-ZY) on 15 Oct.
- **Reflected in this plan:** the S-03 scope, requirements, allowed paths and acceptance criteria.
- **Follow-up (15 Oct, delegated by Developer B to the agent):** a second analyst pass found gaps, now recorded as edits to D-31 and D-38 to D-42 and a clarification of AM-06:
  - negative-path CI evidence comes from a throwaway PR;
  - E2E uses a per-run login role that inherits `app_runtime`, a wrapper-managed lifecycle and its own build;
  - the local `check:secrets` range is `origin/master..HEAD`;
  - readiness input is a two-variant value;
  - HEAD, OPTIONS and 405 behaviour is recorded;
  - CI jobs run in parallel;
  - the K2 envelope exemption is permanent, while setting headers directly is interim.

  Developer B then set S-03 `Ready` and approved the GHSA-vfj7-8cjw-p6xm exception on the agent's recommendation (governance §14). D-40 now checks `npm audit --json` against `audit-exceptions.json`. Log: `logs/2026-10-15-s03-analysis-decisions.md` (follow-up addendum).

Log: `logs/2026-10-15-s03-analysis-decisions.md`.

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
| K3 | Auth guards (`active USER`, `active ADMIN`, recheck status every request), CSRF/Origin checks, cron-secret guard, acting-User share lock. Session revocation is exposed only through K4 (contracts P-11) | A → B | SEC-01, SEC-03, SEC-04, FR-01 |
| K4 | Account-status transition (lock, version check, sessions, `strike_cycle`), Identity-owned per D-20 | A → B | FR-06, AT-25 |
| K5 | Audit `record(tx, entry)` | B → A | security.md audit rules |
| K6 | Shared rate limiter `consume(key, policy, units)` and `check` (signatures in `contracts.md` §9) | B → A | SEC-06, SEC-11 |
| K7 | Catalogue core: Movie lock functions, `markReviewsChanged` (bumps `reviews_revision`, sets `summary_pending_since`) and summary-schedule writes (contracts O-20) | B → A | INV-05, INV-09, data-model |
| K8 | Review transitions: automatic clearance (version-guarded), approve, hide, restore, read-for-moderation | A → B | FR-03, FR-09, arch 6.4 |
| K9 | Moderation work: `enqueue(tx, reviewId, contentRevision)` and `cancelForDeletedReview(tx, reviewId)` inside the review transaction; `attemptAfterCommit(reviewId, contentRevision)` bounded (`contracts.md` §12) | B → A | AI-02 dispatch |
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
- [x] B1–B6, B9–B13 recorded in `spec/` with human approval. B7/B8 have an owner and a dated resolution plan. *(D-08–D-25 recorded and confirmed 12 Oct; B7/B8 owners and deadlines recorded; session log verified.)*
- [x] `workflow/contracts.md` lists K1–K12 with provider, consumer, approved signature and lock order. *(Approved by both developers, 12 Oct.)*
- [x] `AGENTS.md` Commands section names the selected test commands. *(Vitest recorded in S-01; Playwright and CI commands recorded in S-03.)*
- [x] This plan's tracker is updated to reflect the approved and merged foundations and the remaining dependency-blocked tasks.

### Task S-01: Config, database access, migrations, initial schema

**Owner:** B. **Depends on:** S-00 (B1, B3, B5, B6); S-01 decisions D-30–D-37 (13 Oct). **Reqs:** spec/data-model.md §7, tech-stack.md "Database driver", deployment.md 10.3, SEC-05, SEC-07, DEP-03, D-08, D-10, D-22, D-23, D-26–D-28, D-30–D-37.
**Allowed paths:**
- `src/server/config/`
- `src/server/db/` (migrations in `src/server/db/migrations/`, D-26)
- `src/server/shared/`: `Tx`, `Result`, branded IDs and `TransactionConflict` (contracts §2, O-34)
- `src/server/composition.ts`: config and pool only (D-23)
- `tests/integration/database/`, `tests/unit/config/`, `tests/support/`
- `vitest.config.ts`
- `.env.example`
- `package.json`/lockfile
- the `AGENTS.md` Commands section

**Description:**
- **Config validator** (zod, D-37). Invalid core config per D-28 prevents readiness. Invalid or missing AI config disables AI.
- **`pg` pool:**
  - 1 connection
  - CA-verified TLS, or loopback without TLS in local/test (D-30)
  - `date` as string and `bigint` as safe number, both per pool
  - 5 s statement and acquire timeouts
  - no query names
- **K1:** `withTransaction`, `withTransactionResult`, `probe()` and `TransactionConflict` (D-36).
- **Migration runner:** node-pg-migrate over `MIGRATION_DATABASE_URL` with the same TLS rule, bookkeeping table in `app`.
- **One initial migration:**
  - covers the whole data model **except the optional WatchlistEntry (D-34)**, including the B5 additions
  - all structural constraints (D-33), partial unique indexes and listed indexes
  - everything in the `app` schema (D-27)
  - revokes from `anon`, `authenticated` and `public`, and applies the `app_runtime` grants (D-32)
  - creates no roles (D-31)
- **Vitest harness:**
  - a fresh database per run with the D-31 synthetic roles, and truncation between files (D-10)
  - an `npm` test script, recorded in `AGENTS.md` Commands
- **Dependencies:** add every package selected in `spec/governance.md` in one lockfile commit: node-pg-migrate (D-08), vitest and @playwright/test (D-09), zod (D-22) and @node-rs/argon2 (D-11). Pin them and the existing caret devDependencies exactly. S-03 and S-04 then use these pins and change no lockfile. The D-08 TLS check for the pinned node-pg-migrate version is recorded in the handoff. *(Revised 13 Oct: Playwright and argon2 moved here from S-03/S-04.)*
- **No seed script:** it moves to R-04 (D-35).
**Acceptance Criteria:**
- [x] Migration applies cleanly to an empty local PostgreSQL and is re-runnable without drift.
- [x] Integration tests check: unique `(movie_id, author_id)`; rating 1–10 check; partial unique open report per `(reporter_id, review_id)`; unique `(target_user_id, review_id)` strike; unique `ModerationWork` revision key.
- [x] Integration tests also check: `ON DELETE RESTRICT`; AIBudgetDay budget CHECK; `NULLS NOT DISTINCT` on a null `model_id`.
- [x] K1 tests cover:
  - commit, rollback on throw and on an error Result
  - nested call throws immediately
  - stale `Tx` throws
  - no query `name` sent
  - `date` string and per-pool types
  - statement timeout
  - deadlock → `TransactionConflict`
  - `probe()` 2 s limit
- [x] Config unit tests cover each D-37 rule, and no secret value appears in error output.
- [x] Runtime role has exactly the D-32 privileges: no UPDATE or DELETE on AuditEntry, no DDL, no access to bookkeeping. The `anon`/`authenticated` roles cannot read app tables (local test).
- [x] AT-18 direct-access check on the Supabase development project is human-run when the initial migration is applied there, and recorded in the S-01 handoff.
- [x] No secrets in the repo. `.env.example` has placeholders for every new variable.
- [x] `AGENTS.md` Commands names the Vitest command(s).

### Task S-02: HTTP/API kernel

**Owner:** A. **Depends on:** S-00. **Reqs:** api.md 8.1, SEC-05, AGENTS.md API rules.
**Allowed paths:** `src/server/http/`, `tests/unit/http/`.
**Description:** Provide contract K2: error envelope `{ error: { code, message, fieldErrors?, requestId } }` without stack traces; JSON body cap of 32 KiB and content-type check; strict mutation-field validation (unknown fields → 400/422 as specified); Unicode code-point length counting after trim; page/pageSize parsing (default 20, cap 100); `If-Match` (absent → 428, mismatch → 409) and `ETag`; `no-store` helper.
**Acceptance Criteria:**
- [ ] Unit tests cover every status mapping in api.md 8.1, unknown fields, oversize bodies, code-point lengths with emoji and combining characters, and pagination bounds.
- [ ] No module in `src/server/http/` imports a repository or adapter.

### Task S-03: Test harness, CI checks, health endpoints

**Owner:** B. **Depends on:** S-01 (merged), S-00 (B2). **Reqs:** DEP-02 (checks portion), SEC-07, AT-26, api.md 8.4 health contract, verification.md 11.1, D-18, D-28, D-29, D-36, D-38–D-42, governance §14 approved exceptions. Contract amendment AM-06 (contracts §18) is approved by both developers.
**Allowed paths:**
- `.github/workflows/ci.yml` (do not modify `deploy-markbind.yml`)
- `.gitleaks.toml`, `scripts/check-bundle-canary.mjs`
- `audit-exceptions.json`, `scripts/check-audit.mjs` (D-40)
- `playwright.config.ts`, `tests/e2e/`
- `src/app/api/v1/health/`, `src/server/services/health/`
- `src/server/composition.ts`: readiness wiring only (D-38)
- `tests/unit/health/`, `tests/unit/ci/` (`check-audit.mjs`), `tests/integration/api/health/`
- `tests/setup/`: the e2e wrapper (D-42), plus moving shared loopback and role code out of the integration harness without changing its behaviour
- `package.json` scripts only (no lockfile change)
- the `AGENTS.md` Commands section
**Description:** The Vitest unit and PostgreSQL-integration harness landed in S-01. S-03 has three parts:
- **Playwright (D-42).** Configure Playwright (package pinned in S-01; Chromium only) with a health smoke spec.
- **CI (D-40, D-41).** Add `ci.yml` with the jobs `lint-typecheck`, `unit`, `integration`, `e2e`, `build-secret-scan` and `dependency-audit`. Every job exits nonzero on failure. Jobs use only synthetic values and contain no deploy or provider secrets.
- **Health endpoints (D-38, D-39).** Add `GET /health/live` and `/health/ready` exactly as in api.md. Health never uses the K2 error envelope (api.md 8.4, AM-06). A#1 (K2) is not merged, so as an interim measure both handlers set `Cache-Control: no-store` and `X-Request-Id` directly, and the PR says so.
- **Dependency audit (D-40).** `scripts/check-audit.mjs` checks `npm audit --json` against `audit-exceptions.json`, which mirrors governance §14. It starts with one entry, GHSA-vfj7-8cjw-p6xm, reviewed by 2026-11-15.
**Acceptance Criteria:**
- [ ] AT-26, live: live returns 200 `{"status":"ok"}` without importing the composition root or touching the database, including when core config is invalid.
- [ ] AT-26, ready: ready returns 503 `{"status":"unavailable"}`:
  - when the probe rejects;
  - when the probe exceeds 2 s;
  - when core config is missing or invalid, without opening a connection;
  - when the database is reachable but no Admin exists, even if bootstrap
    configuration is valid;
  - on an unexpected throw.

  After an Admin exists, ready returns 200 `{"status":"ready"}` when AI is
  disabled or misconfigured, or when `CRON_SECRET` is missing.
- [ ] Both health responses:
  - carry `no-store` and a server-generated `X-Request-Id`, with no `Set-Cookie`;
  - ignore an inbound `X-Request-Id`;
  - have bodies with exactly the documented keys;
  - contain no hostnames, error text or stack;
  - are reached anonymously without redirects;
  - make no provider call and no write.
- [ ] Each 503 logs one D-39 line with no values or error text. Both handlers run at request time (D-38), shown by a test or by the build output.
- [ ] CI runs on PRs to `master`. A throwaway branch off the S-03 branch, with a PR that is closed unmerged, shows CI failing once on a deliberately failing test and once on a synthetic secret (D-41). The S-03 PR links both runs, and its own history contains neither. gitleaks checksum verification fails closed on a mismatch.
- [ ] The e2e wrapper drops its database and login role even when a test fails, and the integration harness behaves as before (D-31, D-42).
- [ ] `dependency-audit` passes with the GHSA-vfj7-8cjw-p6xm entry. Tests of `check-audit.mjs` show it fails on an unlisted high or critical advisory, on an entry past `reviewBy`, and on a stale entry.
- [ ] HEAD on a health route returns the GET headers. The framework's OPTIONS and 405 responses are not asserted on (D-38).
- [ ] `AGENTS.md` Commands lists `npm run test:e2e` and `npm run check:secrets`. Readiness uses K1 `probe()` (D-36).

### Task S-04: Identity

**Owner:** A. **Depends on:** S-01, S-02 (S-05 limiter interface for throttling). **Reqs:** FR-01, INV-01, SEC-01–04, SEC-06, DEP-04, AT-01.
**Allowed paths:** `src/server/{services,repositories}/identity/`, `src/app/api/v1/auth/`, admin provisioning and verification scripts, matching tests. Public auth pages are deferred to the immediate follow-up below.
**Description:** Registration always creates USER (rejects injected role/status with error 422). Argon2id hashing with passwords of 12–128 characters, at least one number and one special character, and no truncation. Opaque random session tokens stored hashed; cookie HttpOnly/Secure/SameSite=Lax with 8 h absolute expiry. Logout. `GET /auth/me`. CSRF token plus same-origin check on unsafe browser methods. Login throttle of 5 failures per 15 min per normalized email and per IP, with generic errors (including for suspended accounts). Guards K3 recheck status on every request. Session revocation in the caller's `Tx`. First-Admin provisioning uses a dedicated Vercel server function invoked with the deployment-only `ADMIN_BOOTSTRAP_SECRET` and sensitive bootstrap variables; it must not run during build or ordinary function startup. That operator POST is the sole D-14/SEC-04 exception, ignores browser cookies/identity/Origin/CSRF and relies only on the constant-time-compared deployment secret. It reuses private registration primitives through a separate named Identity operation and serializes on the Account table as recorded in D-83.
**Acceptance Criteria:**
- [ ] AT-01 cases: supplied `role` or `status` registration fields → 422 `validation_failed` with no account created; registration without those fields persists USER/active; USER calls to an admin endpoint stub → 403 with no mutation; logout invalidates; suspended accounts cannot log in and get a generic error; forged cross-origin POST fails.
- [x] Duplicate normalized email → safe 409. Throttling and enumeration tests pass.
- [x] Unknown email, invalid password and correct-but-suspended account attempts return the same generic credential error and consume one unit from both login-failure limits; a suspended account never receives a session. Pre-throttled attempts return 429 without password verification or an additional increment; successful active-account login consumes nothing. Counters expire naturally and are not reset by reinstatement.
- [x] Session token never stored or logged in plaintext.
- [x] Emails should be normalised according to the policy in `governance.md`
- [x] CSRF wire cases pass: `/auth/csrf` returns the versioned HMAC token; missing/expired/malformed/wrong-session tokens and Origin mismatches return 403 `csrf_failed`; hosted cookie attributes and the 30-minute pre-session lifetime are correct; login clears the pre-session binding; logout, expiry, suspension and revocation invalidate the binding.
- [ ] The deployment configuration contract is followed: `.env.example` contains placeholders only; Preview and Production use separate environment values; server-only secrets are not exposed to clients or logs; `TEST_DATABASE_URL` and `MIGRATION_DATABASE_URL` are not application runtime configuration on Vercel.
- [ ] If first-Admin bootstrap is enabled, the dedicated Vercel server function requires the deployment-only `ADMIN_BOOTSTRAP_SECRET`, ignores browser authority/CSRF/Origin, creates exactly one Admin only when none exists, serializes concurrent attempts through the Account table, uses the Identity transaction and audit path, never logs credentials or the secret, does not execute during build or ordinary function startup, and is idempotent after success. All bootstrap variables are removed after successful provisioning; readiness remains unavailable whenever no Admin exists, regardless of bootstrap configuration.

**Human sequencing decision (17 October 2026):** public sign-in and registration pages and post-authentication role routing are deferred to the immediate task after S-04. That follow-up retains FR-01, D-21 and AT-01 traceability, must use the S-04 HTTP APIs, and must route active USER accounts to `/app` and active ADMIN accounts to `/admin`. S-04 may hand off its backend Identity scope before those pages land, but neither FR-01 nor system-level AT-01 may be reported complete until the follow-up and its E2E evidence pass. The follow-up task ID remains for the human to assign; no requirement or task ID is invented here.

**Human Gate-B decision (17 October 2026):** U-03 owns reporter-filtered
`GET /me/reports` and `GET /me/reports/:id`, including a guessed target or
unrelated User report ID returning `404`. R-02 owns the complete two-user,
two-role access matrix and the final system-level AT-01 evidence. S-04 may
close its backend Identity scope with that dependency explicitly outstanding,
but AT-01 remains partial until both U-03 and R-02 pass.

### Task S-05: Audit and shared rate limiter

**Owner:** B. **Depends on:** S-01. **Reqs:** security.md audit and limits, SEC-06, SEC-10 (audit part), SEC-11 (throttle and quota counters only; bounded concurrency and retries are S-06), D-12, D-43–D-47.
**Allowed paths:** `src/server/services/{audit,rate-limit}/`, `src/server/repositories/{audit,rate-limit}/`, K5/K6/security-log wiring in `src/server/composition.ts`, `tests/support/fakes/`, matching unit and integration tests. No migration: the tables, index and grants exist (S-01). The K2 client-IP helper (AM-08) and the event emission in K2 and Identity (AM-10) belong to S-02 and S-04.
**Description:**
- K5 `audit.record(tx, …)` stores actor, target, action, result, minimal metadata and request ID, with no API to read, edit or delete entries. It validates each entry under D-46: no passwords, session tokens, report explanations or snapshots, review bodies, or provider prompts or responses.
- `SecurityLog` with a console implementation (D-47).
- K6 limiter backed by PostgreSQL (RateLimitWindow, D-12): windows and admission (D-43), keys and fixed policies (D-44), `purgeExpired()` (D-45). It returns `retryAfterSeconds` for `Retry-After`.
- Fakes and contract suites for K5, K6 and `SecurityLog` (contracts §1 rules 6–7).
**Acceptance Criteria:**
- [ ] Audit write rolls back with its transaction (integration test). `app_runtime` cannot UPDATE or DELETE `app.audit_entry`.
- [ ] K5 rejects an unknown action, a non-UUID id, nested or oversized metadata and each forbidden key name, and the transaction rolls back (D-46).
- [ ] Limiter is correct under concurrent calls from two connections: 2N calls admit exactly N, and it returns a retry time.
- [ ] The limit-th call is admitted and the next is rejected. A rejected `consume` does not increment. `check` creates no row. `units > limit` throws (D-43).
- [ ] `retryAfterSeconds` is at least 1 and does not exceed the time to the window end. A new window admits again (D-43).
- [ ] No stored `bucket_key` contains a raw email or IP, and a different secret gives a different key (D-44).
- [ ] A database failure makes `consume` and `check` throw, never admit (P-10).
- [ ] `purgeExpired()` deletes only rows older than the longest window, and at most 1,000 per call (D-45).
- [ ] Security log lines contain only the D-47 fields, and the K6 fake fails closed.

### Task S-06: AI runtime (shared)

**Owner:** B. **Depends on:** S-01, S-05, B#4 (D-52, D-53); live values from D-48. **Reqs:** AI-03, AI-04, SEC-08, SEC-11, CON-02, api.md 8.2/8.4; decisions D-56, D-57, D-59–D-71, D-73–D-78.
**Allowed paths (D-71):** `src/server/adapters/soc-llm/`, `src/server/services/ai/runtime/`, `src/server/repositories/ai/` (runtime repositories only), `src/server/config/ai.ts` (D-65 maxima, D-76 and D-78 minima only), `src/server/composition.ts` (AI runtime wiring only), tests.
**Description:** `LlmProvider` interface (bounded messages, model, output-token cap, deadline → content + safe usage, or typed error). Real SoC adapter (OpenAI-compatible gateway; maps 429/5xx/timeout to typed errors; never surfaces raw errors). The scripted fake already exists (B#4, D-53); S-06 adds the stateless `MarkerFakeLlmProvider` for running servers (D-57, D-70). Execution controller: `AI_ENABLED` gate, 1 active execution per environment, cost-budget reservation in microdollars (D-25) and conservative reconciliation, AIJob lease and dedup key, 30 s/attempt, at most 2 attempts with jitter honouring `Retry-After`, 75 s deadline, and no DB transaction held during a provider call. Scheduler-lease helper.
**Acceptance Criteria:**
- [ ] Unit/integration tests: second concurrent execution is deferred; budget exhaustion defers without losing work; expired lease rejects late publish; unknown usage charged conservatively; retries stop at the deadline.
- [ ] Missing quota/budget config → AI disabled, core unaffected.
- [ ] PostgreSQL integration tests: expiry racing a late settlement, expiry racing a publish, and a reservation left `reserved` after a committed publish are each settled once (D-73).
- [ ] The adapter is imported only by `services/ai/runtime/`, `composition.ts` and `tests/`, and the scripted fake by no `src/` module outside the adapter (test; AM-18, D-71).

### Task S-07: Shared UI shell and components

**Owner:** A. **Depends on:** S-00 (B13). **Reqs:** product 5.2, 5.3.
**Allowed paths:** `src/components/`, `src/app/layout.tsx`, route-group layouts.
**Description:** Root layout and separate `/app` and `/admin` navigation shells. K12 primitives with labelled inputs, field-associated errors, visible focus, status not shown by colour alone, a polite live region, and a confirmation dialog that names its target. Rating display `8/10` and aggregate `8.3/10`.
**Acceptance Criteria:**
- [ ] Components are keyboard-operable (manual checklist recorded) and do not import `src/server`.
- [x] B has reviewed the component API before A-01 starts.

### Task U-01: Public catalogue, details, announcements (read)

**Owner:** A. **Depends on:** S-02, S-07 (S-01 schema; test fixtures, since the seed script lands in R-04 per D-35). **Reqs:** FR-02, FR-07 (public read), INV-02, INV-05, CON-01, AT-02 (public half), AT-06 (public half).
**Description:** `GET /movies` (q ≤ 200 case-insensitive, `release_desc`/`title_asc` with ID tie-break), `GET /movies/:id` with aggregate over eligible reviews only, `GET /announcements` (published, by publication time), and the corresponding pages with loading, empty and error states. Archived/unknown → 404. No image fields anywhere.
**Acceptance Criteria:**
- [ ] Stable pagination with ties; empty search; unknown release date; duplicate titles distinguished by ID.
- [ ] Aggregate null/0 with no eligible reviews; pending/flagged/hidden/deleted excluded (fixture-based).
- [ ] Draft announcements never returned.

### Task U-02: Review lifecycle and visibility transitions

**Owner:** A. **Depends on:** S-04, S-05, K7 and K9 interfaces from B. **Reqs:** FR-03, INV-02, INV-03, INV-09, AI-02 (dispatch side), AT-03, AT-21, AT-23, AT-24 (crash-before-dispatch).
**Description:** `POST /movies/:id/reviews`, `PATCH/DELETE /reviews/:id`, `GET /me/reviews`, `GET /movies/:id/reviews`. Rating 1–10 integers; body 10–2,000 code points. A create, resubmission or body edit atomically sets `pending` (a resubmission or body edit increments `content_revision`; a create starts it at 1), calls K9 `enqueue`, and calls K7 `markReviewsChanged` when the set of eligible Reviews changes or the rating or body of a previously eligible Review changes (D-51, contracts AM-13). A rating-only edit keeps clearance, and on an eligible Review it advances `reviews_revision`. After commit, call K9 `attemptAfterCommit` and return 201/200 with `moderationState`. `maxDuration = 120`. Rate limit 10/min. Exposes K8 transitions (version-guarded clearance, approve, hide, restore) for B.
**Acceptance Criteria:**
- [ ] Reference cases: provider down → 201 pending, not public; another User → 404/403 without mutation; body edit of published review removes it from public view and aggregates atomically; rating-only edit cannot clear pending/flagged; resubmission after delete reuses the ID and re-screens; author cannot undo an admin hide, and an edit of a hidden Review keeps it hidden while still calling `enqueue` (D-54); stale `If-Match` → 409; concurrent creates keep uniqueness.
- [ ] A rating-only edit of an eligible Review updates the aggregate and advances `reviews_revision` in the same transaction. A rating-only edit of a pending or flagged Review, or a mutation that changes nothing, does not advance it (D-51).
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
**Decision resolution (19 Oct):** D-79–D-81 define repeated actions, no-op/version behavior, input defaults/clearing, ordering and bodyless DELETE ETags. Actual archive/restore alone advances `reviews_revision`; no-ops preserve markers and timestamps. Shared-contract cross-review is complete: Lim-ZY approved D-79–D-81 on 20 Oct. The archive/restore implementation also requires the real K8 `lockReviewsOfMovie` from U-02 (a fake suffices only for isolated orchestration tests). **Interim (D-84, 20 Oct):** the orchestrator depends on a B-side structural `ReviewsOfMovieLock` type; archive/restore stay unwired (503) until U-02 merges, and API tests use a test-only PostgreSQL stand-in.
**Readiness evidence (20 Oct):** S-04 is merged (PR #13). The K3 Admin guards and CSRF that A-01 consumes pass S04-AC-01 (`tests/integration/api/auth/admin-guard-consumer.test.ts`, recorded in `workflow/handoffs/s04-release-evidence.md`). S-04's open AT-01 E2E and Vercel operator evidence do not affect A-01; they stay tracked under S-04, R-02 and R-04. S-07 is merged (PR #10) and B reviewed the K12 component API on 20 Oct (S-07 acceptance). S-05 is merged (PR #9).
**Acceptance Criteria:**
- [ ] AT-02 round trip with U-01 public views. Derived/actor fields rejected. Stale write → 409 with no change. USER → 403.
- [ ] D-79–D-81 acceptance examples in spec/verification.md: repeated actions, normalized no-ops, clearing, stable list ordering, DELETE ETag, restore response and atomic audit/revision behavior.

**Progress (20 Oct):** B#6 commit 1 (Admin Movie API) is in `740533a`. Evidence: `workflow/handoffs/A-01-A-02/2026-10-20-a01-admin-movie-api.md`. Both criteria above stay open until these items land:
- **Admin UI:** B#6 commit 3 is implemented in the working tree and awaits review (`workflow/handoffs/A-01-A-02/2026-10-20-a01-a02-admin-ui.md`). Its e2e asserts archive's interim 503; restore is not exercised until K8 is wired.
- **AT-02 public round trip:** blocked on U-01 (Developer A). When U-01 merges, replace the `archived_at` column assertion in `tests/integration/api/admin/admin-movies.test.ts` with a public GET /movies check, and cover the UI round trip in commit 3.
- **Archive vs review-submission race (verification §11.3) and archive/restore in deployed builds:** blocked on U-02. These currently return 503 (D-84). Wire the real K8 and add the race test together, at the D-84 exit.

### Task A-02: Admin announcements

**Owner:** B. **Depends on:** A-01. **Reqs:** FR-07, AT-06.
**Description:** `/admin/announcements` create (draft), edit, publish/unpublish (republish sets a new `published_at`), soft delete, audited. Archived Movie reference keeps the announcement but omits the public link.
**Decision resolution (19 Oct):** D-79–D-81 make deletion terminal, allow current archived Movie references, define immediate publication of edits, timestamp transitions, PATCH/default/clearing rules, ordering and one-entry audit selection. Shared-contract cross-review is complete (Lim-ZY approved D-79–D-81 on 20 Oct). A-01 was set Ready on 20 Oct. Only a human sets A-02 Ready; this entry does not.
**Readiness (20 Oct):** Developer B set A-02 Ready. A-02 needs only A-01's Admin guards and Movie rows; both are on `feat/admin-catalogue` (`740533a`). A-01's open items (UI, U-01 round trip, K8 wiring) do not affect A-02. The API is B#6 commit 2 on the same branch. Developer B's choices, as for A-01: the Admin Announcement projection is `id, title, body, movieId, state, publishedAt, authorId, version, createdAt, updatedAt`; GET /admin/announcements returns every state with no filter parameter; an empty or non-object PATCH body reports under the key `request`. U-01 is not merged, so the "drafts never appear through U-01 endpoints" criterion and AT-06's public half stay open until it merges; until then the tests assert the stored state.
**Acceptance Criteria:**
- [ ] AT-06; empty/oversize content rejected; drafts never appear through U-01 endpoints.
- [ ] D-79–D-81 acceptance examples in spec/verification.md: terminal deletion, repeated DELETE, publication timestamps, mixed PATCH audit selection, references and field errors.

**Progress (20 Oct):** B#6 commit 2 (Admin Announcement API) is implemented in the working tree and awaits review. Evidence: `workflow/handoffs/A-01-A-02/2026-10-20-a02-admin-announcement-api.md`. Both criteria above stay open until these items land:
- **Admin UI:** B#6 commit 3 is implemented in the working tree and awaits review (`workflow/handoffs/A-01-A-02/2026-10-20-a01-a02-admin-ui.md`). It covers create (draft), edit, publish and unpublish. Its prompt did not name delete, so there is no Admin UI delete control yet; Developer B decides whether to add one.
- **AT-06 public half:** blocked on U-01 (Developer A). When U-01 merges, add public GET /announcements checks to `tests/integration/api/admin/admin-announcements.test.ts`: drafts and deleted rows never appear, publish/unpublish/delete change the public list, ordering is published_at DESC, id ASC, and an archived Movie reference has no link.

### Task A-03: Automatic profanity moderation

**Owner:** B. **Depends on:** S-06, U-02 K8 interface, OQ-04 policy for acceptance. **Reqs:** FR-09, AI-02, AI-04, SEC-08, SEC-09, DEP-10, AT-09, AT-10, AT-21, AT-24.
**Description:** Implement K9: durable `ModerationWork`, bounded post-commit attempt, input (pseudonymous ID + full body + versioned policy; too long → manual review, never a fragment), output validation (enums, exact-substring quotes, field caps, no unknown fields), fixed clearance rule via K8 with revision/version/lease guards, retry/backoff, 3 failed executions → `needs_manual_review`, supersession on new revision. Hidden or deleted Reviews are never sent to the provider; their work is cancelled at dispatch and skipped by the sweep (D-54). Every ModerationWork write holds the Review lock (D-58). With `soc_llm`, the v0 policy wires the dispatcher stub (D-56). `GET /internal/cron/review-moderation` (secret, own lease, one review per run). `GET /ai/jobs/:id` (Admin only, safe fields).
**Acceptance Criteria:**
- [ ] AT-09/21/24 with the fake: clean → cleared; suspected/uncertain → flagged; invented quote → rejected → manual review; crash after commit → recovered by sweep; capacity deferral does not consume attempts; deleted/hidden cancels work.
- [ ] No endpoint or UI requests or retries AI. AI cannot create reports, strikes or account changes (test asserts no such calls).

### Task A-04: Admin review queue

**Owner:** B. **Depends on:** A-03, U-02. **Reqs:** FR-09 (admin side), SEC-09, AT-21, AT-23.
**Description:** `GET /admin/reviews` (filters including unchecked/failed/hidden/deleted with an "all reviews" reset), `GET /admin/reviews/:id`, and `POST …/approve|hide|restore` with reason and If-Match, all through K8. Escaped source text shown beside the labelled AI assessment.
**Acceptance Criteria:**
- [ ] Approval during an in-flight AI execution wins; restore never grants clearance and reactivates the current `cancelled` row in place, or inserts one (D-55); approval does not undo author deletion.

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

**Owner:** B (A reviews and approves the release). **Depends on:** S-03, B10; S-04 and A-01 for the seed script. **Reqs:** DEP-01–DEP-10, AT-13, AT-17, AT-19.
**Description:**
- Synthetic seed script through the owning services (D-35). It refuses `APP_ENV=production` and is ready before peer testing on 21 Oct.
- Operator `app_runtime` provisioning procedure (D-31) in the developer guide.
- Separate Preview/Production env scopes; `vercel.json` crons (summaries 00:00 UTC, review moderation 01:00 UTC); Fluid compute with `maxDuration` verified on the deployed Hobby project; controlled migration step with pre-migration encrypted backup; restore and rollback rehearsal; production smoke.
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
