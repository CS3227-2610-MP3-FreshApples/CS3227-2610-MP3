# FreshApples Commit Plan (two developers)

Status: **approved; S-01–S-07 and U-01/A#4 are merged; U-02a/A#5 is merged in PR #17 (`998dd90`); U-02b/A#6 has analyst/architect approval to proceed after the human implementation gate**. Companion to [PLAN.md](PLAN.md). S-01 merged in PR #5 (`9f77b53`); S-03 merged in PR #6 (`ee62bd1`); S-02 merged in PR #8 (`315ef06`) from `feat/http-api-kernel` through `c51c92e`; S-05 merged in PR #9 (`56314c3`); B#4 contract stubs merged in PR #11 (`7f76f0b`); S-06 merged in PR #12 (`47751ab`); S-07 merged in PR #10 (`54e5883`); S-04 in PRs #13 and #14; U-01/A#4 merged in PR #16 (`6269f63`); and U-02a/A#5 merged in PR #17 (`998dd90`).

This plan sets the order in which each developer opens PRs, which files each PR may touch, and which **sync points** require something to be on `master` first. Commit messages below are templates: humans make the commits (`AGENTS.md` § Git). Requirement IDs in messages are copied from `spec/`. Task IDs appear only in PR titles and bodies.

## 1. Why a commit plan helps here

It is worth having, kept at PR granularity, not every commit:

- **The spec forces shared code.** Cross-module transactions (arch 6.4), shared AI runtime (AI-03) and shared review visibility (INV-09) mean A's and B's features meet in a few files. Planned ownership of those files prevents merge conflicts and duplicated logic.
- **Interfaces can land before implementations.** If each provider merges a typed interface plus a fail-closed fake first, the consumer never waits for the real implementation.
- **It shows the role split.** The course requires each developer to complete one role's features plus shared work. A per-developer PR list is direct evidence of that.
- **Risk:** a commit plan goes stale quickly. Keep the PR list here, update its state column, and do not over-specify individual commits.

## 2. Rules that make independent work possible

| Hotspot | Single owner | Rule for the other developer |
| --- | --- | --- |
| Migrations directory (`src/server/db/migrations/`, D-26) | B | The initial migration covers the **entire** data model except the optional WatchlistEntry (D-34), so later changes are rare. A requests a change in a short PR that adds a **new** migration file. Never edit a merged migration (`AGENTS.md` rule 4). Use timestamp-prefixed filenames (node-pg-migrate, D-08) so parallel branches cannot collide |
| `package.json`, `package-lock.json` | B | S-01 adds every dependency selected in `spec/governance.md` (node-pg-migrate, zod, vitest, @playwright/test, `@node-rs/argon2`) in one lockfile commit and pins the existing caret devDependencies, so S-03 and S-04 need no lockfile change. Any later addition is a separate one-commit PR by B (or by A with B's review). Never mix lockfile changes into feature PRs |
| `src/app/layout.tsx`, route-group layouts, `src/components/` | A | B uses components as they are, or opens a small PR that A reviews |
| `src/server/http/` (K2), `src/server/{services,repositories}/identity/` (K3) | A | B consumes only |
| `src/server/db/`, `src/server/config/`, audit, limiter, AI runtime, SoC adapter (K1, K5, K6, K9, K10) | B | A consumes only |
| `src/server/services/reviews/` transitions (K8) | A | B calls them from moderation/admin services; no copied visibility rules |
| Catalogue write service and `markReviewsChanged` (K7) | B | A calls it inside the review transaction |
| `spec/`, `AGENTS.md`, `workflow/contracts.md` | Both | Spec-only PR, approved by **both** developers before dependent code |
| `.github/workflows/`, `vercel.json` | B | A reviews; changes to CI/agent config always need human review (SEC-12) |

Working rules:

1. **Interface-first PRs.** For each contract K1–K12 the provider merges the types, a fail-closed fake or stub, and a contract test before or alongside the real code.
2. **Small PRs.** One PR is one reviewable slice (aim for under ~400 changed lines excluding lockfile and tests). Rebase on `master` daily.
3. **Separate local databases and worktrees.** Each developer uses their own disposable PostgreSQL. Neither runs destructive tests against the shared Supabase development project.
4. **Cross-owner review.** Every PR is reviewed by the other developer. A PR touching a hotspot owned by the reviewer needs their explicit approval.
5. **No reliance on unmerged code.** A branch builds only on `master` plus its own commits. If a dependency is not merged, code against the contract fake.

## 3. Sync points

Merge everything listed for a sync point to `master` before the dependent PRs that use it.

| SP | Must be on `master` | Unblocks | Target |
| --- | --- | --- | --- |
| SP-0 | S-00 spec decisions + `workflow/contracts.md` | Everything | 12 Oct |
| SP-1 | B#1 (config, pool, tx, schema), A#1 (API kernel) | All route and service work | 13 Oct |
| SP-2 | A#3 (identity guards), B#3 (audit, limiter), B#4 (K7/K9/K10 stubs) | U-02, A-01, U-04 dev against fakes | 14 Oct |
| SP-3 | A#6 (K8 review-transition interface + fake) | A-03, A-04 | 16 Oct |
| SP-4 | A#7, B#7 (real review dispatch + screening) | End-to-end checkpoint | 17 Oct |
| SP-5 | A#8 (report submission) | A-05 | 18 Oct |
| SP-6 | All feature PRs | Feature freeze, R-tasks | 19 Oct |

## 4. Developer A: User role + identity, API kernel, shared UI

| # | Task | Branch | Commit message templates | Paths | Needs | State |
| --- | --- | --- | --- | --- | --- | --- |
| A#0 | S-00 | `chore/spec-decisions` (joint) | `docs(spec): record migration, test, auth and data-model decisions` | `spec/`, `AGENTS.md`, `workflow/contracts.md` | — | Completed (decisions/contracts approved) |
| A#1 | S-02 | `feat/http-api-kernel` | `docs(http): clarify request identity contract (SEC-05)` · `feat(http): add API kernel primitives (SEC-05)` · `test(http): cover API boundary cases (SEC-05)` | `src/server/http/`, `tests/unit/http/` | SP-0 | Merged (PR #8, `315ef06`) |
| A#2 | S-07 | `feat/ui-shell` | `feat(ui): add /app and /admin layout shells` · `feat(ui): add accessible form, table, pagination, confirm dialog` | `src/components/`, `src/app/layout.tsx`, group layouts | SP-0 | Merged (PR #10, `54e5883`) |
| A#3 | S-04 | `feat/identity-sessions` | `feat(identity): register and login with Argon2id (FR-01, SEC-02)` · `feat(identity): hashed sessions, logout and me (SEC-03)` · `feat(identity): CSRF and same-origin checks (SEC-04)` · `feat(identity): role/status guards and session revocation (SEC-01)` · `feat(identity): login throttling (SEC-06)` · `chore(identity): admin provisioning command (DEP-04)` | identity services/repos, `src/app/api/v1/auth/`, auth pages, tests | SP-1, B#3 limiter | Merged (PR #13 backend; PR #14 auth UI) |
| A#4 | U-01 | `feat/catalogue-public` | `feat(catalogue): public movie list, search and detail (FR-02)` · `feat(announcements): public published list (FR-07)` · `feat(ui): movie browse and detail pages` | catalogue read queries, `src/app/api/v1/movies/` (GET), `…/announcements/` (GET), pages | SP-1 | Merged (PR #16, `6269f63`) |
| A#5 | U-02a | `feat/reviews-core` | `feat(reviews): create/edit/delete own review (FR-03, INV-03)` · `feat(reviews): eligibility, aggregates and revision bump (INV-02, INV-09)` · `test(reviews): concurrency and stale If-Match` | reviews services/repos, review routes, tests | SP-2 | Merged (PR #17, `998dd90`); archive/create race continues with K8 |
| A#6 | U-02b | `feat/reviews-transitions` | `feat(reviews): version-guarded clearance, approve, hide, restore interface (FR-09)` · `test(reviews): K8 contract tests and fake` | reviews transitions + fake | A#5 | Analyst/architect: proceed after human implementation gate; not yet human `Ready` (**SP-3**) |
| A#7 | U-02c | `feat/reviews-moderation-hook` | `feat(reviews): enqueue moderation in-transaction and attempt after commit (AI-02)` · `feat(ui): my reviews with pending/held/published state` | review routes (`maxDuration`), `/me/reviews`, pages | A#6, B#4 | Planned (**SP-4**) |
| A#8 | U-03 | `feat/moderation-report-submission` | `feat(moderation): submit report with evidence snapshot (FR-04, INV-04, INV-07)` · `feat(moderation): reporter-only report history` · `feat(ui): report user flow` | report-submission service, `/reports`, `/me/reports`, pages | A#7 | Planned (**SP-5**) |
| A#9 | U-04a | `feat/ai-summary-core` | `feat(ai): summary sampling and input bounding (AI-01)` · `feat(ai): summary output validation and guarded publish` | `src/server/services/ai/summary/`, tests | B#5 (or B#4 fake) | Planned |
| A#10 | U-04b | `feat/ai-summary-cron-ui` | `feat(ai): secret-authenticated summary sweep (DEP-09)` · `feat(catalogue): read-only summary endpoint and UI (FR-08)` | `/internal/cron/summaries`, `/movies/:id/summary`, UI | A#9 | Planned |
| A#11 | R-01/R-02 | `test/user-security-e2e` | `test(ai): summary benign and adversarial fixtures (AT-11)` · `test(e2e): user journey` · `test(api): user access matrix (AT-01, AT-04)` | `tests/` | SP-6 | Planned |
| A#12 | R-05 | `docs/user-guide-site` | `docs: user guide and product site for release` | `docs/UserGuide.md`, `docs/*.md` (site) | SP-6 | Planned |

## 5. Developer B: Admin role + database, CI/deploy, audit, AI infrastructure

| # | Task | Branch | Commit message templates | Paths | Needs | State |
| --- | --- | --- | --- | --- | --- | --- |
| B#0 | S-00 | (joint with A#0) | — | — | — | Completed (decisions/contracts approved) |
| B#1 | S-01 | `feat/db-foundation` | `chore(deps): pin dependencies and add selected tools` · `feat(config): validate server configuration` · `feat(db): pg pool and transaction helper` · `test: configure unit and PostgreSQL integration runners` · `feat(db): initial schema migration` | `src/server/{config,db,shared}/`, `src/server/composition.ts`, migrations, Vitest config and database tests, `.env.example`, `package*.json`, `AGENTS.md` Commands | SP-0 | Merged (PR #5, `9f77b53`) (**SP-1**, B half) |
| B#2 | S-03 | `chore/ci-test-harness` | `ci: lint, typecheck, test, build and secret scan (DEP-02)` · `feat(health): liveness and readiness endpoints (AT-26)` · `test(e2e): configure Playwright with health smoke spec` | `.github/workflows/ci.yml`, `.gitleaks.toml`, `scripts/check-bundle-canary.mjs`, `audit-exceptions.json`, `scripts/check-audit.mjs`, `playwright.config.ts`, `tests/e2e/`, the e2e wrapper in `tests/setup/` (D-42), `src/app/api/v1/health/`, `src/server/services/health/`, readiness wiring in `composition.ts`, health tests, `package.json` scripts, `AGENTS.md` Commands. Health handlers set `no-store` directly while A#1 is unmerged (AM-06). `dependency-audit` allows only the governance §14 approved exceptions, through `audit-exceptions.json` (D-40) | B#1 | Merged (PR #6, `96b9a9d`) |
| B#3 | S-05 | `feat/audit-ratelimit` | `feat(audit): transactional audit entries` · `feat(security): shared PostgreSQL rate limiter (SEC-11)` | `src/server/services/{audit,rate-limit}/`, `src/server/repositories/{audit,rate-limit}/`, wiring in `composition.ts`, `tests/support/fakes/`, tests (D-43–D-48; contracts §19, §20 AM-11: no `soc_tokens`) | B#1 | Merged (PR #9, `56314c3`) (**SP-2**) |
| B#4 | K7/K9/K10 stubs | `feat/ai-catalogue-contracts` | `feat(catalogue): movie active check and reviews-changed marker (INV-09)` · `feat(ai): moderation work enqueue/attempt interface with fail-closed fake` · `feat(ai): LLM provider interface and deterministic fake` | `src/server/services/catalogue/` (core), `src/server/repositories/catalogue/`, `src/server/services/ai/{moderation,runtime}/` (K9 queue real, dispatcher and controller stubs, prompt version constant in `moderation/` and policy version constant in `moderation/policy/` per D-49), `src/server/repositories/ai/`, `src/server/adapters/soc-llm/` (interface and fake), wiring in `composition.ts`, `tests/support/fakes/`, `tests/support/contracts/`, unit and integration tests. No migration (D-49–D-53, D-58; contracts §22 AM-13–AM-16, §23 AM-17) | B#1 | Merged (PR #11, `f53e0ae`) (**SP-2**) |
| B#5 | S-06 | `feat/ai-runtime` | `feat(ai): SoC adapter with typed errors (CON-02)` · `feat(ai): execution controller, leases and cost budget (AI-03)` · `test(ai): concurrency, deadline and late-write rejection` | D-71: `src/server/{adapters/soc-llm,services/ai/runtime,repositories/ai}/`, `config/ai.ts` (D-65 maxima, D-76 and D-78 minima), AI runtime wiring in `composition.ts`, tests | B#4, D-59–D-71, D-73–D-78 | Merged (PR #12, `639473e`) |
| B#6 | A-01, A-02 | `feat/admin-catalogue-announcements` | `feat(catalogue): admin movie CRUD, archive and restore (FR-05)` · `feat(announcements): admin drafts, publish and delete (FR-07)` · `feat(admin-ui): movie and announcement screens` | `/admin/movies`, `/admin/announcements`, admin pages | SP-2 | Planned |
| B#7 | A-03 | `feat/ai-review-moderation` | `feat(ai): profanity screening input and output validation (AI-02)` · `feat(ai): durable work, retries and manual-review routing` · `feat(ai): review-moderation recovery sweep (DEP-10)` · `feat(ai): admin job status read` | `src/server/services/ai/moderation/`, `/internal/cron/review-moderation`, `/ai/jobs/:id` | B#5, A#6, OQ-04 | Planned (**SP-4**) |
| B#8 | A-04 | `feat/admin-review-queue` | `feat(moderation): admin review list, approve, hide and restore (FR-09)` · `feat(admin-ui): review queue with approve, hide and restore` | `/admin/reviews*`, admin pages | B#7 | Planned |
| B#9 | A-05 | `feat/moderation-decisions` | `feat(moderation): report decisions with unique strikes (FR-06, SEC-10)` · `feat(moderation): threshold suspension with session revocation` · `feat(admin-ui): report queue with effect preview` | decision service, `/admin/reports*`, pages | A#8, A#3 | Planned |
| B#10 | A-06 | `feat/admin-user-status` | `feat(moderation): manual suspend and unsuspend (FR-06)` · `feat(admin-ui): user management screen` | `/admin/users*`, pages | B#9 | Planned |
| B#11 | R-04 | `chore/deploy-release` | `chore(db): operator migration and backup scripts (DEP-03, DEP-08)` · `chore(db): synthetic seed script (DEP-04)` · `chore: daily cron configuration (DEP-09, DEP-10)` · `docs: backup, restore and rollback procedure (DEP-08)` | `package.json` scripts, `vercel.json`, seed script, `docs/DeveloperGuide.md` | B#2, A#3, B#6 | Planned |
| B#12 | R-01/R-02 | `test/admin-security-e2e` | `test(ai): moderation benign and adversarial fixtures (AT-11)` · `test(e2e): admin journey` · `test(api): admin access matrix and concurrency (AT-05, AT-25)` | `tests/` | SP-6 | Planned |

## 6. Joint PRs (both review, one author each)

| PR | Author | Content |
| --- | --- | --- |
| `docs/reflections-logs` | Both (each their own sections) | `docs/Reflections.md`, log verification ticks, `workflow/traceability` |
| `chore/agent-rehearsal` (R-03) | Both | `workflow/evaluations/agent-cases/` and results |
| Any `spec/` change | Proposer | Must merge before code that depends on it |

## 7. When the plan breaks

- **Merge conflict in a hotspot:** the hotspot owner resolves it. The other developer rebases.
- **Need to change a contract:** stop, open a spec/contract PR, and get the other developer's approval before changing code (`AGENTS.md` § Purpose: name the conflict, present alternatives).
- **Dependency late:** keep building against the fake, and record the gap in the PR. Never merge a consumer that ships the fake in production.
- **Behind schedule at SP-4 (17 Oct):** apply the checkpoint rule in [PLAN.md §7](PLAN.md#7-calendar-1223-october-2026-sgt).
