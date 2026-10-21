# U-04a commit 1 handoff: summary sampling and input bounding

- **Task:** U-04a, PR B#13 (formerly A#9, D-85), commit 1 `feat(ai): summary sampling and input bounding (AI-01)` as listed in `workflow/COMMIT-PLAN.md`.
- **Requirements:** AI-01 items 2–5, AI-04 (input containment), AT-07 (fewer than three Reviews), using AI-03's estimate through K10's implementation. Decisions implemented: D-86, D-88 (sample and snapshot shape), D-93 (prompt-version currency, "no execution record", reduction against the controller's limit, parity test design).
- **Source revision:** working tree on `feat/ai-summary-core` at `db2d4cb`, uncommitted.
- **Authorization:** the human (thegrimbee, Developer B) instructed the implementation agent to implement commit 1. The PLAN and COMMIT-PLAN state columns still read `Spec review`, not `Ready`. The agent treated the instruction as the go-ahead and did not edit the trackers.
- **Permitted paths used (D-92, D-93):** `src/server/services/ai/summary/`, `src/server/repositories/summary/`, `src/server/services/ai/runtime/index.ts` (export only), `src/server/config/ai.ts` (sample-size minimum only), `tests/unit/ai/summary/`, `tests/integration/ai/summary/`, `tests/unit/config/parse-config.test.ts`.

## Changed files

| Path | Change |
| --- | --- |
| `src/server/repositories/summary/summary-input-repository.ts` | New. One SQL statement reads the active Movie's `reviews_revision`, whether a ReviewSummary exists at that revision from a job with the given prompt version, and every eligible Review (`id`, `version`, `content_revision`, `rating`, `body`) in ascending `id` order. Missing or archived gives `null`. No lock. Predicate restated from U-01. |
| `src/server/repositories/summary/index.ts` | New barrel. |
| `src/server/services/ai/summary/sampling.ts` | New. `summary-sample-v1`: SHA-256 counter stream, rejection-sampled index, partial Fisher–Yates; `systemSeedSource` (32 bytes from `randomBytes`). |
| `src/server/services/ai/summary/prompt.ts` | New. `review-summary-prompt-v1`, the static system prompt, and the 1,200-token output cap. |
| `src/server/services/ai/summary/input-preparation.ts` | New. Pure `prepareSummaryInput` (thresholds, `current`, sampling, 1,000-code-point bodies with the `truncated` flag, `R<k>` labels, `"<n>/10"` ratings, JSON user message, reduction from the end, `input_unfit`, D-88 sample and K10 snapshot) and `createSummaryInputPreparation` (one short read Tx, then preparation; no writes, no K10). |
| `src/server/services/ai/summary/index.ts` | New barrel. |
| `src/server/services/ai/runtime/index.ts` | Exports `estimateInputTokens` (AM-23). |
| `src/server/config/ai.ts` | `AI_SUMMARY_SAMPLE_SIZE` accepts 3–20 (D-86). |
| `tests/unit/ai/summary/sampling.test.ts` | New. Fixed vectors, rejection boundary, Fisher–Yates swaps, uniqueness for n = 0–50, replay, seed source, fixed-seed frequency check. |
| `tests/unit/ai/summary/input-preparation.test.ts` | New. 0/1/2/3/20/21/57 eligible, ordering of `insufficient_reviews` and `current`, provenance, replay, messages, hostile text, Unicode and truncation, token-cap boundaries, reduction, `input_unfit`, service wiring. |
| `tests/integration/ai/summary/summary-input-read.test.ts` | New. Missing/archived, ordering and fields, per-Movie scoping, D-86 parity with U-01 `reviewCount` (power-of-two counts per state), prompt-version and revision currency, a one-snapshot read while a K7 review change is uncommitted (and no wait on the held Movie lock), and service outcomes writing no AIJob, reservation, summary or Movie change. |
| `tests/unit/config/parse-config.test.ts` | Sample size 2 is rejected and 3 is accepted. |

## How uniform selection is established

The test does not assert anything statistical that could fail at random:

1. Fixed vectors in `sampling.test.ts` were computed by a separate Python implementation written from the D-86 text. The TypeScript code must reproduce them.
2. Scripted-source tests pin the rejection threshold `floor(2^32 / k) × k` and the swap positions. These two properties make partial Fisher–Yates a uniform sample without replacement.
3. A frequency check over 2,000 fixed seeds uses ±15% bounds. It is deterministic and only catches gross errors.

## Interpretations made (for review)

- **Outcome order:** `insufficient_reviews` is checked before `current`, as in the D-90 precedence. D-89 lists the outcomes but not their order. The two cannot both apply in practice, because losing eligible Reviews advances the revision.
- **Reduction stop:** the loop stops once fewer than 3 Reviews remain, rather than emptying the list.
- **Prompt wording:** D-86 sets only the outline, and the exact text is to be decided in the B#13 PR review. The rules in the text mirror D-87.
- **Seed draw:** a seed is drawn on each `prepare` call that reaches the snapshot, including calls that end as `insufficient_reviews` or `current`. Nothing is persisted in those cases.

## Checks

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npm run lint` | pass |
| `npm run test:unit` | 1,022 passed |
| `npm run test:integration` (local PostgreSQL 17 in Docker, loopback port 55432 because 5432 was blocked on this host) | First full run: 1 failure in another file, not identified because the output was not kept. Next four full runs: 542/542 passed. The summary file passed 10 consecutive runs. |
| Mutation check: `hidden_at` condition removed from the summary predicate | The parity test and one service test failed as expected; file restored. |
| `npm run build` | pass |

## Known gaps and next action

- Not in this commit: the output schema and validator, publish callback, generation service, `summaryLimits` on `AiRuntime`, composition wiring, the marker-fake `summary` constant and its D-70 conformance test, and the `AI_SUMMARY_INTERVAL_DAYS` 1-or-7 bound. All belong to commit 2 under D-92 and D-93.
- Real U-02 review writes are not tested; the stand-in is synthetic rows and K7 `markReviewsChanged` (D-91).
- One intermittent failure in the first full integration run is unexplained.
- Next: the human reviews the diff and decides whether to commit. Then commit 2.
