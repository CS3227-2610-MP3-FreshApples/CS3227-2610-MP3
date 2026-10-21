# U-04a Q-1 handoff: independent tests and code-quality findings

- **Task:** U-04a, PR B#13, Q-1 (code quality and test generation) for commits `6389fcc` and `92ee236`.
- **Requirements:** AI-01 items 3–7, AI-04, AT-07, AT-08 (synthetic only, D-91). Decisions checked: D-86–D-89, D-92, D-93, D-95; amendments AM-23, AM-25; `workflow/contracts.md` §3.3.
- **Source revision:** `92ee236` on `feat/ai-summary-core`, clean before this work.
- **Authorization:** the human (thegrimbee, Developer B) assigned the `code-quality-test-generator` role: add independent tests only under `tests/`, report coupling and cohesion findings, do not change `src/`, and run `npm run test:unit` and `npm run test:integration`.
- **Paths changed:** four new test files, this handoff, and the session log. No `src/`, spec, contract or tracker change.

## New tests and what each covers

| File | Cases | Coverage intent (gap in the existing suite) |
| --- | --- | --- |
| `tests/unit/ai/summary/sampling-exhaustive.test.ts` | 10 | Enumerates every draw sequence for (n, s) = (3,3), (4,2), (5,3), (6,1), (6,6) and checks that each ordered sample comes from exactly one sequence. With a uniform index, that one-to-one map makes partial Fisher–Yates uniform, so this checks D-86 uniformity without statistics. Also covers k = 1, the single rejected value for k = 3, repeated rejection, and an empty candidate list. |
| `tests/unit/ai/summary/input-preparation-invariants.test.ts` | 218 | The existing reduction tests use Reviews of equal length, so they cannot tell "remove the last in sample order" from "remove the longest". Two cases use mixed lengths: the last Review is the shortest, and a long first Review stays whole. 216 fixed cases (3 seeds × 6 eligible counts × 3 sample sizes × 4 limits) check D-86/D-88 invariants: counts, the K10 bound, contiguous `R1`–`Rm` labels, label `R<k>` = `reviews[k − 1]` with matching version, content revision, rating, cut body and `truncated`, the included Reviews as a prefix of the unreduced sample, that reduction stops as soon as the input fits, that `input_unfit` occurs only when 3 Reviews do not fit, and no Review text in the snapshot. |
| `tests/unit/ai/summary/output-schema-edge.test.ts` | 7 | Duplicate JSON keys: the kept (last) value is the one validated, and an earlier unsafe duplicate is never stored. Deeply nested and very long structures are rejected without throwing. |
| `tests/integration/ai/summary/summary-publication-concurrency.test.ts` | 9 | **Lock waits:** a publisher that is *waiting* on the Movie `FOR UPDATE` lock returns `stale` when the holder commits a current summary (D-93: the Movie lock serializes publishers), or when a real K7 `markReviewsChanged` holder commits a new revision. Each test asserts that the wait was actually seen in `pg_stat_activity`. The existing race tests commit before the publish Tx starts, so none of them exercises the wait. **Concurrency:** two instances run `generate` on one Movie at once (5 runs). Every run must publish exactly one ReviewSummary, return `duplicate`, `stale`, `current` or `deferred` for the other instance, clear pending, and leave no `running` job or `reserved` reservation. **Fidelity:** quotes, backslashes, tabs, U+2028/U+2029, combining marks, RTL text, astral characters, `</script>` and an injection attempt round-trip exactly through `json_agg`, ratings 1 and 10 come back as numbers, and the user message keeps the single key `reviews`. **Storage:** a reply that passes D-87 but contains a lone surrogate publishes nothing and keeps the Movie pending. |

No assertion depends on live-model prose. Fixtures are synthetic, and the login-role and database passwords are generated per run.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run test:unit` at `92ee236` (baseline) | 61 files, 1,172 passed |
| `npm run test:integration` at `92ee236` (baseline; disposable PostgreSQL 17 in Docker, `127.0.0.1:55432`) | 26 files, 575 passed |
| `npm run test:unit` with the new tests | exit 0; 64 files, 1,407 passed |
| `npm run test:integration` with the new tests | exit 0; 27 files, 584 passed |
| New integration file, 10 consecutive runs | 10/10 passed |
| `npx tsc --noEmit`, `npm run lint` | pass |

No mutation checks were run against `src/`, because this role may not change it.

## Code-quality findings (for the implementation agent; `src/` unchanged)

The checks AGENTS.md "Coding Conventions" names come back clean:

- **Control flags:** none. No summary function takes a boolean or mode argument that selects a branch. `hasCurrentSummary` (`summary-input-repository.ts:19`) is returned data, not a parameter.
- **Module-level state outside `composition.ts`:** none. The module-level values are frozen result constants (`output-schema.ts:29`, `publication.ts:34`), compiled regexps (`output-schema.ts:37-38`), string and number constants, and the stateless `systemSeedSource` (`sampling.ts:13`). The counter state in `seededUint32Source` (`sampling.ts:23-25`) is closure-local.
- **Vendor types crossing contracts:** none. zod stays inside `output-schema.ts`, and the schema objects are not exported. The interfaces use repository-owned `Sql`, `Database` and `Tx` and plain DTOs. The only platform type in a signature is Node's `Buffer` (`sampling.ts:11`, `input-preparation.ts:108`), a built-in rather than a vendor type.

Findings:

| # | Severity | Evidence | Finding |
| --- | --- | --- | --- |
| F1 | Low (robustness) | `output-schema.ts:47-55`; `review-summary-repository.ts:37-39` | `isSafeText` accepts lone UTF-16 surrogates (for example the JSON escape `\ud800`), which PostgreSQL `jsonb` rejects. The insert inside the publish Tx throws, and K10 records the job as `failed` / `transient` with `storage_failed`, so a provider-content fault is classified as an infrastructure fault. Seen in the new integration test: outcome `{"kind":"failed","cause":"transient"}`, job `error_code` `storage_failed`. Nothing unsafe is stored, and D-94 counts the Movie as `failed` either way, but `storage_failed` metrics and alerts would include provider faults. D-87 does not list this case, so a fix (rejecting lone surrogates as `invalid_output`) needs a human decision amending D-87. |
| F2 | Low (spec interpretation not recorded) | `output-schema.ts:38` | D-87 rejects "`<` followed by a letter". The code checks only ASCII letters (`[A-Za-z]`), so `<é` or `<ж` passes. That matches how HTML tokenizes tag names, but neither handoff records it as an interpretation. A human should confirm it or amend D-87. No test asserts either reading. |
| F3 | Low (cohesion, duplicated rule) | `summary-input-repository.ts:47-54`; `review-summary-repository.ts:26-34` | The D-93 rule for a current summary (same revision, joined `ai_job.prompt_version`) is written twice in SQL, and the B#14 public read (D-90 step 3) will add a third copy. This is the same drift risk D-95 accepts for the eligibility predicate, but nothing records it for this rule, and no single test pins the copies together. (The guard and the read are each tested separately.) Options for the human: a shared SQL fragment in `repositories/summary/`, or a parity test when B#14 lands. |
| F4 | Low (duplicated type) | `create-ai-runtime.ts:29`; `input-preparation.ts:22` | `AiRuntime.summaryLimits` declares its shape inline, structurally duplicating `SummaryLimits`. The duplicate is probably deliberate, because the runtime cannot import from `summary/` without a cycle. If either type gains a field, they can drift with no compiler error at the `composition.ts:176` boundary. Option: define the type in `runtime/` and re-export it from `summary/`. |
| F5 | Info (stamp coupling) | `publication.ts:30`, `publication.ts:53` | `SummaryPublisher.publish` takes the whole `AiJobRef` but uses only `jobId`. The cost is small, because K10's callback supplies `AiJobRef` (`generation.ts:43`). Passing `job.jobId` there would narrow the publisher's dependency on K10's type. |

Already recorded in the implementation handoffs and not repeated as findings: safe text checked after trimming, the lowercase-only `json` fence tag, the duplicated revision comparison in the publisher, and a seed drawn for outcomes that persist nothing.

## Known gaps and unverified items

- `composition.ts:176` (`summaryGeneration` is null when AI, the database or K7 is absent) has no direct test, because the composition root reads the environment when its module loads. The pieces it combines are tested (`create-ai-runtime.test.ts` for `summaryLimits`).
- The concurrency test checks invariants over uncontrolled interleavings. It does not force a specific loser outcome.
- Real U-02 review writes are still not tested (D-91). The lock-wait writer uses real K7 against synthetic Review rows.
- Mutation testing against `src/` was not run (out of scope for this role).

## Next action

A separate reviewer (Q-2) or a human reviews these tests and findings. The human decides F1 and F2 (possible D-87 amendments) and whether F3–F5 go to the implementation agent. The human also decides whether to commit the new tests.
