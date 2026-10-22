# A-03 implementation handoff: automatic profanity moderation (B#7)

- **Task:** A-03, PR B#7 on `feat/ai-review-moderation`. Commits: `feat(ai): profanity screening input and output validation (AI-02)`, `feat(ai): durable work, retries and manual-review routing`, `feat(ai): review-moderation recovery sweep (DEP-10)`, `feat(ai): admin job status read`, preceded by two `docs(spec)` commits recording the decisions.
- **Requirements:** FR-09, AI-02, AI-03, AI-04, SEC-08, SEC-09, DEP-10, AT-09, AT-10, AT-21, AT-24. Decisions D-45, D-47, D-49, D-50, D-54, D-55, D-56, D-58, D-61, D-64, D-73, D-74, D-77 and the new D-99–D-102; amendments AM-27–AM-29 (contracts §29).
- **Source revision:** base `f9756a1` (`master`); head after the four feature commits `916d1ed`; head after the review fixes, refactor and independent tests `12ff308`.
- **Authorization:** the human (thegrimbee, Developer B) asked the agent to implement every B#7 commit, to resolve blockers and missing decisions as it recommends, and allowed splitting the work into several commits. No push or PR.
- **Blockers resolved by recorded decisions:** OQ-04 (policy text and contested-decision process) by D-99; the D-77 open point (recovering `running` work left by a crashed execution) by D-101. D-100 and D-102 fill the input/output and job-read gaps.
- **Permitted paths used:** the D-101 "B#7 paths". No Developer A file changed. `src/server/services/ai/summary/output-schema.ts` (Developer B) changed only to import the shared safe-text helpers (D-100).

## Changed files

Specification and workflow:

| Path | Change |
| --- | --- |
| `spec/governance.md` | OQ-04 marked resolved; D-99, D-100, D-101, D-102; D-101 steps 1 and 5 tightened against sweep-slot starvation; D-103 from the independent review |
| `workflow/contracts.md` | §29: AM-27 (B-internal `attemptFromSweep`), AM-28 (claim/publish/settle locking), AM-29 (job read) |
| `workflow/PLAN.md` | A-03 in progress; B8 (OQ-04) resolved |

Commit 1 (screening input and output):

| Path | Change |
| --- | --- |
| `src/server/services/ai/moderation/policy/text.ts`, `policy/version.ts` | `PROFANITY_POLICY_TEXT`; version `profanity-policy-v1`; `UNREVIEWED_PROFANITY_POLICY_VERSION` for D-56 |
| `src/server/services/ai/moderation/prompt.ts` | Static screening instructions with the policy; output cap 1,000 |
| `src/server/services/ai/moderation/input.ts` | `buildModerationInput`: system + one JSON user message `{ reviewId, contentRevision, body }`; AI-03 estimate; `input_too_large` instead of truncation; text-free snapshot |
| `src/server/services/ai/moderation/output-schema.ts` | Strict AI-02 schema; exact-substring quotes; safe text outside quotes |
| `src/server/services/ai/output-text.ts` | D-87 safe-text and parse helpers moved unchanged from the summary schema |
| `tests/unit/ai/moderation/screening-input.test.ts`, `output-schema.test.ts` | New, including the D-70 marker-fake conformance tests |
| `tests/unit/ai/moderation-stub-and-versions.test.ts` | v1 and policy-text checks |

Commit 2 (dispatcher):

| Path | Change |
| --- | --- |
| `src/server/services/ai/moderation/dispatcher.ts` | Real K9 dispatcher plus `attemptFromSweep`: claim Tx, K10 call with no Tx, publish callback, settlement Tx, never throws |
| `src/server/services/ai/moderation/wiring.ts` | `requiresDispatcherStub` (D-56) and its `config.issue` log line |
| `src/server/services/ai/moderation/types.ts`, `deferred-dispatcher.ts`, `index.ts` | `ModerationRecovery`; stub header; exports |
| `src/server/repositories/ai/moderation-work-repository.ts` | Dispatcher statements (lock revision, supersede, claim, settle) |
| `src/server/repositories/ai/review-moderation-repository.ts` | New: ReviewModeration insert |
| `src/server/repositories/ai/moderation-review-read-repository.ts` | New: Review author read |
| `src/server/composition.ts` | Real dispatcher or stub (AI disabled, no real controller, D-56) |
| `tests/integration/ai/moderation/dispatcher.test.ts` | New, 28 tests against PostgreSQL with real K8, K5, K10 |
| `tests/unit/ai/moderation/dispatcher-wiring.test.ts` | New: D-56 choice, log line, timings, containment imports |

Commit 3 (recovery sweep):

| Path | Change |
| --- | --- |
| `src/server/services/ai/moderation/sweep.ts` | Sweep inside `review_moderation_sweep`; counts; `review_moderation.sweep` log line; disabled sweep |
| `src/server/repositories/ai/moderation-review-read-repository.ts` | `selectDue` |
| `src/app/api/v1/internal/cron/review-moderation/route.ts` | New: `GET`, `maxDuration = 120`, `connection()`, K3 cron guard, K6 purge once, counts only |
| `src/server/composition.ts` | `moderationSweep` |
| `tests/integration/ai/moderation/fixtures.ts`, `sweep.test.ts` | Shared fixtures; selection order and filters, crash recovery, lease overlap |
| `tests/unit/ai/moderation/sweep.test.ts` | New: count mapping, lease and fault phases, log |
| `tests/integration/api/cron/review-moderation-cron.test.ts` | New: 401/503 paths, purge, end-to-end screening, hidden-Review slot |

Commit 4 (Admin job read):

| Path | Change |
| --- | --- |
| `src/server/repositories/ai/moderation-job-read-repository.ts` | New: one read, review-moderation jobs only |
| `src/server/services/ai/moderation/job-read.ts` | New: D-102 projection |
| `src/app/api/v1/ai/jobs/[id]/route.ts` | New: `requireActiveAdmin`, 404 for malformed/unknown/summary |
| `src/server/composition.ts` | `moderationJobReadService` |
| `tests/integration/api/ai/job-status.test.ts`, `tests/unit/ai/moderation/job-read.test.ts` | New |

## Post-implementation review (Q-1, Q-2)

| Round | Result | Disposition |
| --- | --- | --- |
| Q-2 reviewer-tester at `916d1ed` (read-only) | FAIL on two Medium governance items; no Critical or High code defect. M1: automatic audit entries use a generated request ID, against D-46. M2: no `logs/` summary yet. L1: a lone-surrogate quote passed validation and failed storage. L2: a stale result on an archived Movie left `last_attempt_at` unset. L3: after a version rollback, leftover other-version work could hold the sweep slot. L4, L5: edge risks. I1: api.md's 202 wording | D-103 records M1 (amends D-46), L1–L3 fixes, L4 and L5 as accepted risks, and the I1 clarification. Fixed in `4df2f84` with regression tests. M2: this session's log |
| Q-1 code-quality-test-generator at `916d1ed` | Added 77 independent tests in 3 files. 2 failed at `916d1ed` (L1, L2), and both pass after `4df2f84`. Quality notes: stamp coupling of the claim record, an author read the sweep discards, a mutable `Set`, a duplicated 120-second constant, and the published-assessment holder | Tests committed in `12ff308`. Refactor in `c42297a` (narrow handles, requester read as a function, frozen list). The 120-second constant stays: Next.js needs a literal `maxDuration`, and a unit test pins both. The holder stays; it is documented and K10 runs `publish` before `run` resolves |

## Checks (at `12ff308`, local PostgreSQL 17 container on a loopback port)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS (0 problems) |
| `npm run test:unit` | PASS, 86 files, 1,644 tests (baseline on `f9756a1`: 80 files, 1,557) |
| `npm run test:integration` | PASS three times in a row, 42 files, 763 tests (baseline: 36 files, 646). Q-1 saw one unexplained failure of the cron end-to-end test in a run that overlapped a source edit; it was not reproduced |
| `npm run build` | PASS; both new routes are dynamic (`ƒ`) |
| `npm run test:e2e`, `npm run check:secrets` | Not run in this session |

## Known gaps and follow-ups

- **Developer A decision approval:** the human confirmed on 21 October 2026 that Lim-ZY approved D-99 through D-103, including the amendment to D-46 (audit request IDs). The underlying decisions for AM-27 through AM-29 are approved; this records decision approval, not merge approval. Passing the request ID through K9 remains a possible contract follow-up. Evidence: `logs/2026-10-21-a03-decision-approvals.md`.
- **Policy text:** the D-99 text is the agent's recommendation. A human should read `policy/text.ts` before production enablement; D-16 still keeps production `AI_ENABLED=false`.
- **A-04 obligations:** approve/hide/restore must supersede, cancel or reactivate ModerationWork under the Review lock (D-55, D-58). Until A-04 lands, the dispatcher's claim and stale settlement supersede or cancel work themselves.
- **`vercel.json`:** the review-moderation cron schedule is R-04's.
- **Live SoC:** no live call was made; screening quality is unevaluated (R-01).
- **Rating-only edit during a provider call:** the attempt is stale and the work waits for the next sweep, because a rating-only edit does not dispatch (D-101 stale row).
