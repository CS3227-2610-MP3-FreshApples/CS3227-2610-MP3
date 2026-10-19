# Agentic SE Session Summary

## 1. Session Metadata

| Field | Value |
| --- | --- |
| Date and timezone | 2026-10-19, Asia/Singapore |
| Task | S-06 commit 2: K10 execution controller, runtime repositories, AI limits and wiring |
| Chat/session ID | Not recorded |
| Human owner/reviewer | thegrimbee (Developer B) |
| Branch | `feat/ai-runtime` |
| Starting revision | `c1b94d3` |
| Participating agent roles | Implementation agent |
| Verification status | awaiting human verification |

## 2. Goal and Approved Scope

- Replace the always-on controller stub with the real `AiExecutionController.run`, add repositories over SchedulerLease, AIBudgetDay, AIBudgetReservation and AIJob, enforce the AI limits in configuration, and wire the runtime in the composition root.
- Applicable recorded requirement IDs: AI-03, AI-04, SEC-11; D-13, D-25, D-48, D-52, D-61–D-69, D-71, D-73–D-78; contracts §3.1–§3.3 (P-04, P-08, P-13), §9 (K6), §13 (K10), §24 AM-19, AM-20, §25 AM-21, AM-22.
- Permitted paths/actions: D-71 — `src/server/services/ai/runtime/`, `src/server/repositories/ai/` (new runtime repositories only), `src/server/config/ai.ts` (D-65 maxima, D-76 and D-78 minima only), `src/server/composition.ts` (AI runtime wiring only), `tests/`.
- Explicit exclusions: the ModerationWork repository (A-03); the D-71 import-boundary test update and the two-pool D-73 race tests (commit 3); the real dispatcher and the D-56 log line (A-03).
- Human approval gates: none were triggered (no conflict with `spec/` was found); the agent choices in §5 need review.

## 3. Sources Consulted

| Source | Authority or reference | How it was used |
| --- | --- | --- |
| `spec/governance.md` D-61–D-69, D-71, D-73–D-78 | Human-approved decisions | Step order, outcomes, charges, guards, timing, config, wiring |
| `workflow/contracts.md` §1, §3, §4, §9, §13, §24, §25 | Approved contracts | Signatures, lock order, own-Tx rules, K6 usage |
| `spec/ai.md` AI-03; `spec/data-model.md`; `spec/deployment.md` 10.3 | Specification | Estimate and reservation formula, columns, privileges, variable limits |
| Initial migration `1791896395207_initial-schema.sql` | Shipped schema (unchanged) | Constraints, `ai_job_running_dedup_key_key`, column types |

## 4. Interaction Timeline

| Seq. | Actor/agent | Summarized request or assignment | Action/result | Approval or handoff evidence |
| ---: | --- | --- | --- | --- |
| 1 | Human | Pasted the B#5 commit 2 prompt | Agent read the contracts, decisions, schema and existing runtime code; found no conflict with `spec/` | — |
| 2 | Implementation agent | Wrote tests first (unit: pricing, settlement, config, wiring; integration: controller, sweep leases) | New tests failed as expected | Terminal output |
| 3 | Implementation agent | Implemented repositories, controller, sweep leases, config limits and wiring | Two test mistakes found and fixed (a Retry-After that does fit; an unreachable budget case); all suites pass | §8 |
| 4 | Implementation agent | Mutation-checked the P-08 lease guard and the 429 zero charge | Both mutations were caught by the tests; sources restored | Terminal output |

## 5. Decisions, Assumptions, and Conflicts

| Item | Source/decision-maker | Status | Rationale | Affected artifacts |
| --- | --- | --- | --- | --- |
| `withSweepLease` implemented in commit 2 (the plan put it in commit 3) | Implementation agent | proposed | The prompt asks commit 2 to wire `SchedulerLeases`; commit 3 keeps the two-pool concurrency tests | `scheduler-leases.ts` |
| Wiring choice lives in `createAiRuntime` (runtime module), called by `composition.ts` | Implementation agent | proposed | Makes each configuration's choice unit-testable; `composition.ts` does not import the adapter, so the current boundary test still passes unchanged until commit 3 updates it per D-71 | `create-ai-runtime.ts`, `composition.ts` |
| `schedulerLeases` is `null` whenever the stub is wired | D-71 reading | proposed | D-71 lists SchedulerLeases only in the AI-enabled branch | `composition.ts` |
| AI-03 estimate counts the UTF-8 bytes of message `content` only (not `role`), summed across messages before rounding | O-26 reading | **needs human confirmation** | O-26 says "ceil(UTF-8 bytes ÷ 3) + 16 per message"; the 16 per message is read as covering role overhead | `pricing.ts` |
| Caller's `estimatedInputTokens` is rounded up; NaN or infinity gives `input_too_large` | Implementation agent | proposed | Fails closed on a caller bug without throwing (D-75 allows only the output-cap throw) | `execution-controller.ts` |
| Step 1 captures one `clock_timestamp()` cutoff and uses it for the day locks, abandoned reservations and lapsed jobs | D-73 reading | proposed | Keeps the three sets consistent so no budget day is locked out of P-13 order | `ai-budget-repository.ts`, `ai-job-repository.ts` |
| Lapsed jobs are locked with an ordered `FOR NO KEY UPDATE` CTE before the UPDATE | D-66 + D-73 reading | **needs human confirmation** | D-66 asks for ascending ID order; D-73 forbids `SELECT … FOR UPDATE` because of the FK key-share conflict. `FOR NO KEY UPDATE` is the lock UPDATE itself takes, so it satisfies both | `ai-job-repository.ts` |
| Several abandoned reservations on one day are capped at the headroom in aggregate | Implementation agent | proposed | Equal to or more conservative than capping one at a time; the check constraint holds | `ai-budget-repository.ts` |
| A failing or throwing second-attempt quota consume means no second attempt | D-62/D-75 reading | proposed | D-62 covers a denial; treating a fault the same way is the fail-closed choice | `execution-controller.ts` |
| Token sums above the `integer` range record null tokens but keep `actual_microdollars` | Implementation agent | proposed | The charge is known exactly; only the token columns cannot hold it | `settlement.ts` |
| A missing lease row is inserted with `lease_until = 'epoch'`; release sets `lease_until = least(lease_until, clock_timestamp())` | D-66 reading | proposed | "Inserting it first with an expired lease"; release never extends a lease | `scheduler-lease-repository.ts` |
| An unrepresentable reservation returns `deferred` (null) | Implementation agent | proposed | Unreachable with validated config (D-78 budget minimum) | `execution-controller.ts` |
| Budget minimum computed with BigInt; `tsconfig` target (ES2017) unchanged, so `BigInt(…)` calls replace literals | Implementation agent | proposed | Exact for any configured price; no shared config change | `config/ai.ts`, `pricing.ts` |

## 6. Agent Assignments and Handoffs

| Role | Bounded assignment | Permissions/tools used | Evidence returned | Risks/gaps | Receiver |
| --- | --- | --- | --- | --- | --- |
| Implementation agent | S-06 commit 2 in D-71 paths | Read, Edit, Write, Bash (tests, lint, tsc, build, e2e, a disposable local PostgreSQL container) | This summary | §10 | thegrimbee |

Handoff: task S-06 commit 2; requirements in §2; source revision `c1b94d3` plus the uncommitted working tree; changed files in §7; tests in §8; known gaps in §10. Next action: human review of the §5 proposals, then commit 3.

## 7. Changes and Reuse

### Changed or generated files

| Path | Change and rationale |
| --- | --- |
| `src/server/repositories/ai/scheduler-lease-repository.ts` | New: peek, lock-or-insert, take and token-guarded release, compared with `clock_timestamp()` (D-66, D-73, D-77) |
| `src/server/repositories/ai/ai-budget-repository.ts` | New: UTC budget day in SQL, ordered day locks, configured-budget update, abandoned-reservation settlement, reserve, and settle-once (D-63, D-66, D-73, D-78) |
| `src/server/repositories/ai/ai-job-repository.ts` | New: running-job insert with dedup conflict, lapsed-job expiry, P-08 guarded success, running-only final status (D-64, D-66, D-73) |
| `src/server/repositories/ai/index.ts` | Exports the three repositories; the ModerationWork repository is unchanged |
| `src/server/services/ai/runtime/execution-controller.ts` | New: `createAiExecutionController`, steps 0–6 of contracts §13 as amended |
| `src/server/services/ai/runtime/pricing.ts` | New: AI-03 estimate and exact cost |
| `src/server/services/ai/runtime/settlement.ts` | New: per-attempt charges and reconciled/released plan (D-63, D-74, D-75) |
| `src/server/services/ai/runtime/job-record.ts` | New: D-64 columns, dedup key and input hash |
| `src/server/services/ai/runtime/scheduler-leases.ts` | New: `withSweepLease` with 150 s leases (D-66, O-29) |
| `src/server/services/ai/runtime/system-time.ts` | New: real random, monotonic clock and cancellable sleep (D-69) |
| `src/server/services/ai/runtime/create-ai-runtime.ts` | New: the D-71/D-78 wiring choice |
| `src/server/services/ai/runtime/index.ts` | Exports the new runtime API |
| `src/server/services/ai/runtime/disabled-controller.ts` | Header comment: the stub now serves the disabled paths |
| `src/server/config/ai.ts` | D-65 maxima, the 15,000 ms deadline minimum (D-76) and the budget minimum (D-78) |
| `src/server/composition.ts` | Wires `aiExecutionController` and the new `schedulerLeases` through `createAiRuntime` |
| `tests/unit/ai/execution-pricing.test.ts` | New: estimate, cost, attempt charges, settlement plans |
| `tests/unit/ai/create-ai-runtime.test.ts` | New: wiring choice for each configuration |
| `tests/unit/config/parse-config.test.ts` | Adds the limit and budget-minimum cases |
| `tests/integration/ai/execution-controller.test.ts` | New: 51 PostgreSQL tests as the runtime role (outcomes, charges, slot, budget, expiry, deadline, quota, faults, no Tx during `complete()`) |
| `tests/integration/ai/scheduler-leases.test.ts` | New: sweep-lease acquire, held, takeover, release on throw, token guard |
| `tests/support/fakes/manual-time.ts` | New: deterministic clock, sleep and random |
| `tests/support/instrumented-database.ts` | New: open-Tx counter and injected Tx fault |

- Dependencies added or changed: none.
- Generated artifacts: none committed (`.next/` from the build is gitignored).
- Reused ideas, code, or documentation and attribution: repository and test structure follow the existing rate-limiter and moderation-work modules.
- Unrelated files changed: no.

## 8. Verification Evidence

| Command/check | Environment | Result | Evidence/path |
| --- | --- | --- | --- |
| `npm run test:unit` | Windows 11, Node, local | PASS (29 files, 592 tests) | Terminal output |
| `npm run test:integration` | Local PostgreSQL 17 in Docker on loopback port 55432 (5432 is reserved on this host) | PASS (11 files, 393 tests) | Terminal output |
| `npx vitest run --project integration tests/integration/ai` after the final lint fixes | Same | PASS (3 files, 82 tests) | Terminal output |
| `npx tsc --noEmit` | Local | PASS | Terminal output |
| `npm run lint` | Local | PASS | Terminal output |
| `npm run build` | Local | PASS | Terminal output |
| `npm run test:e2e` | Local, Chromium | PASS (2 tests) | Terminal output |
| Mutation checks: P-08 lease guard removed; 429 charged as unknown | Local | Caught (1 and 2 failing tests); sources restored | Terminal output |
| `npm run check:secrets` | — | NOT RUN: gitleaks is not on PATH | — |
| Real SoC gateway call | — | NOT RUN: out of scope; D-59 provider validation precedes `AI_ENABLED=true` | deployment.md 10.3 |

## 9. Security and Responsible-AI Review

- Sensitive data handled: none. Tests use synthetic keys, a per-run login role with `app_runtime` privileges, and generated passwords that are never recorded.
- Untrusted input: provider content reaches only the caller's `validate`; the controller never logs prompts, content or provider errors (tested with console spies). Error codes are fixed strings.
- Containment: no Tx is open during `complete()` (tested with an instrumented pool); publication commits only with the P-08 lease guard; the controller never touches ModerationWork.
- Secret exposure: the API key stays inside the adapter; `composition.ts` passes only the global `fetch`.
- SoC quota/resource: one `soc_requests` unit per request; tests make no network call.
- Security findings and disposition: none open.

## 10. Gaps, Failures, and Next Actions

| Gap/failure/unverified claim | Impact | Owner | Next action or approval required |
| --- | --- | --- | --- |
| The two §5 rows marked "needs human confirmation" (estimate bytes; ordered `FOR NO KEY UPDATE`) | Interpretations of recorded decisions | thegrimbee | Confirm, or record a decision |
| D-73 two-pool races (expiry vs late settlement, expiry vs publish) and sweep-lease contention across pools | Covered here only on one pool plus a held-lease takeover | thegrimbee | Commit 3 |
| `tests/unit/ai/llm-fake-boundary.test.ts` still says the composition root constructs no provider | Description stale; assertions still pass | thegrimbee | Commit 3 (D-71 rule) |
| Secret scan not run | Unverified locally | thegrimbee | Run `npm run check:secrets` with gitleaks, or rely on CI |
| Behaviour against the real gateway | Unverified | thegrimbee | D-59 provider validation |

## 11. Reflection Notes

- AI Security: the instrumented pool and console spies turn "no Tx during the provider call" and "never logs content" from review claims into tests.
- Spec-Driven Development: the decisions specified nearly every branch. The remaining choices are SQL-level readings, which are listed in §5 instead of being left implicit.
- Basic Multi-Agent SE: no subagents were used.

## 12. Human Verification

- [x] Summary matches the actual interaction and outcomes.
- [x] Requirement IDs and decisions are traceable to recorded sources.
- [x] Changed files and command results match the working tree and evidence.
- [x] Secrets, credentials, personal data, and raw production data are absent.
- [x] Agent proposals and unresolved questions are labelled accurately.

Reviewer: Gabriel
Verification date: 19 Oct 2026
Corrections or notes: NIL
