# U-04a commit 2 handoff: summary output validation and guarded publish

- **Task:** U-04a, PR B#13 (formerly A#9, D-85), commit 2 `feat(ai): summary output validation and guarded publish` as listed in `references/DEV-A-COMMIT-PLAN.md`.
- **Requirements:** AI-01 items 4, 6 and 7, AI-04 (output containment), AT-07, AT-08 (synthetic only, D-91), INV-09 (synthetic only). Decisions implemented: D-87, D-88 (provenance columns and reuse), D-89 (generation operation only), D-92, D-93 (`summaryLimits`, prompt-version currency, duplicate guard, test requirements), D-70 (summary conformance test). Contract amendments: AM-23, AM-25.
- **Source revision:** working tree on `feat/ai-summary-core` at `6389fcc` (commit 1), uncommitted.
- **Authorization:** the human (thegrimbee, Developer B) instructed the implementation agent to implement commit 2. Path and owner approval for the marker fake, composition and `create-ai-runtime.ts` comes from D-92 and D-93, both approved by the two developers. The PLAN and COMMIT-PLAN trackers were not edited.
- **Permitted paths used (D-92, D-93):** `src/server/services/ai/summary/`, `src/server/repositories/summary/`, `src/server/composition.ts` (summary wiring only), `src/server/adapters/soc-llm/marker-fake-provider.ts` (`summary` constant and outcome only), `src/server/services/ai/runtime/create-ai-runtime.ts` (`summaryLimits` only), `src/server/config/ai.ts` (interval bound only), `tests/unit/ai/summary/`, `tests/integration/ai/summary/`, `tests/unit/ai/marker-fake-provider.test.ts`, `tests/unit/ai/create-ai-runtime.test.ts`, `tests/unit/config/parse-config.test.ts`.

## Changed files

| Path | Change |
| --- | --- |
| `src/server/services/ai/summary/output-schema.ts` | New. D-87 strict zod schema at both levels; trimmed lengths in code points (800 and 240); at most 3 items per list; 1–20 unique sources; safe-text check (C0 controls other than LF, DEL, `http://`, `https://`, `www.` in any case, `<` followed by a letter, `/`, `!` or `?`); one outer fence stripped (untagged or `json`); label membership against the included labels. `parseSummaryOutput` (K10 `validate`) and `validateSummaryOutput` (an already-parsed value, for B#14's D-94 stored-output read). Never throws. |
| `src/server/services/ai/summary/publication.ts` | New. The K10 `publish` callback body: K7 `lockActiveMovieForUpdate` (unavailable gives `stale`), the captured-revision comparison, the D-93 duplicate guard, the ReviewSummary insert, then K7 `recordSummaryPublished` (its `stale` passes through). |
| `src/server/services/ai/summary/generation.ts` | New. `createSummaryGeneration(...).generate(movieId)`: input preparation, then one K10 `run` with the `summary` descriptor, `review-summary-prompt-v1` and 1,200 output tokens. Returns `unavailable`, `insufficient_reviews`, `input_unfit` and `current` without K10, else the K10 outcome unchanged (D-89). Imports no adapter. |
| `src/server/services/ai/summary/index.ts` | Exports the above. |
| `src/server/repositories/summary/review-summary-repository.ts` | New. `existsCurrent` (ReviewSummary at the revision from a job with the given prompt version) and `insert` (`generated_at = now()`, parameterized, schema-qualified). |
| `src/server/repositories/summary/index.ts` | Exports the above. |
| `src/server/services/ai/runtime/create-ai-runtime.ts` | `AiRuntime.summaryLimits`: `{ sampleSize, inputTokenLimit }` from the same `AiSettings` as the real controller; `null` with the D-52 stub. |
| `src/server/composition.ts` | `summaryGeneration`: built only when `database`, K7 and `summaryLimits` are non-null; otherwise `null`. No consumer until B#14. |
| `src/server/adapters/soc-llm/marker-fake-provider.ts` | `MARKER_FAKE_SUMMARY_OUTPUT`, valid under D-87 and citing only `R1`–`R3`; the `summary` marker now succeeds. |
| `src/server/config/ai.ts` | `AI_SUMMARY_INTERVAL_DAYS` accepts only 1 or 7 (D-89). The commit 1 handoff deferred this to commit 2. |
| `tests/unit/ai/summary/output-schema.test.ts` | New. 96 cases: parsing and fences, missing/extra/renamed keys at both levels, own `__proto__` key, wrong types, code-point boundaries (including astral characters), trimming, item and source counts, duplicate sources, invented/removed/raw-ID/case-variant labels, safe-text rejects and accepts. |
| `tests/unit/ai/summary/marker-fake-summary.test.ts` | New. D-70 conformance: the constant passes D-87 for 3–20 labels and cites only `R1`–`R3`; with three fixed seeds and 3/4/20/25 marked Reviews, and with reduction to exactly 3, prepared input → marker fake → validator succeeds. |
| `tests/unit/ai/summary/generation.test.ts` | New. Pre-K10 outcomes make no K10 call; request shape; validation uses only the included labels; every `AiExecutionOutcome` kind passes through unchanged; publish callback order and every `stale` branch against the K7 fake. |
| `tests/integration/ai/summary/summary-generation.test.ts` | New. Real controller, real K7, marker fake, a login role with `app_runtime` privileges. See the coverage list below. |
| `tests/unit/ai/marker-fake-provider.test.ts` | `summary` marker now succeeds; a wrongly cased `Summary` stays `unavailable`. |
| `tests/unit/ai/create-ai-runtime.test.ts` | `summaryLimits` is null with the stub and taken from the settings with the real controller. |
| `tests/unit/config/parse-config.test.ts` | Interval values 2, 6, 8 and 14 disable AI. |

## Integration coverage (PostgreSQL 17)

- `published`: ReviewSummary columns, D-88 sample (seed, `sampledCount`, IDs, versions), AIJob `succeeded` with the summary prompt version, snapshot without Review text, pending cleared, attempt columns untouched. No transaction is open during the provider call (D-93).
- The composition-shaped path: `createAiRuntime` with the marker fake, using its own `summaryLimits`.
- `insufficient_reviews`, `unavailable`, `current` and `input_unfit` create no AIJob or reservation (D-93 L5).
- Races during the provider call, each rolling back: a committed K7 `markReviewsChanged` from another instance (`stale`, revision +1, pending kept); archive (`stale`); lease loss before the P-08 check (`stale lease_expired`, with the inserted row and the K7 publication rolled back); a competing summary at the same revision and prompt version (`stale`, only the competitor's row).
- An older-prompt summary at the same revision neither counts as current nor blocks publication (D-93).
- Publishing twice at one revision: the second run is `current`. A running job with the same dedup key gives `duplicate` with no new job.
- `failed invalid_output` with nothing published for: non-JSON, extra or missing fields, oversized text, 4 items, invented label, duplicate source, no sources, URL, markup, raw Review ID, and a label removed by reduction. A fenced valid reply publishes.
- Provider failures: `rejected`, `unavailable`, `timeout` (`failed`) and `rate_limited` (`deferred`) publish nothing and keep the Movie pending; a held `ai_execution` slot defers with no job.

## Interpretations made (for review)

- **Safe text is checked after trimming.** D-87 stores trimmed strings, so the check applies to the stored value. A leading or trailing tab or CR is trimmed away rather than rejected.
- **Sources are checked by label membership, not by the safe-text rule.** Membership is stricter.
- **Fence tag:** only lowercase `json` is accepted, and no newline is required after it. `JSON`, other tags, nested fences and prose around a fence are rejected.
- **"Older-prompt cases roll back" (D-93):** read as "an older-prompt summary is not current and does not trigger the guard". The test therefore expects `published`. If D-93 meant something else, this test and possibly the guard need a decision.
- **The revision comparison duplicates K7's check:** `recordSummaryPublished` also rejects a moved revision. A mutation that removed the comparison was caught by the unit tests, but not by the PostgreSQL tests, because K7 still rolled the publication back.
- **Prompt text unchanged** from commit 1 (`review-summary-prompt-v1`); the wording is still decided in B#13 PR review (D-86).

## Checks

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npm run lint` | pass |
| `npm run test:unit` | 61 files, 1,172 passed |
| `npm run test:integration` (disposable PostgreSQL 17 in Docker, loopback port 55432, per-run password) | 26 files, 575 passed. The summary directory passed 10 consecutive runs (46 tests each). |
| Mutation checks: duplicate guard removed; label check removed; revision comparison removed | Caught by 4, 19 and 2 failing tests respectively; files restored and re-verified |
| `npm run build` | pass |
| `git diff --check` | pass |
| `npm run check:secrets` | not run: gitleaks is not installed on this host, and nothing is committed yet |

## Known gaps and next action

- Real U-02 review writes are not tested (D-91). The race tests use synthetic Review rows, real K7 `markReviewsChanged` and direct SQL for archive and lease expiry.
- Not in B#13: the sweep, the public read, Route Handlers and UI (B#14); the D-95 summary index migration; R-01 fixtures; prompt wording review.
- `summaryGeneration` in the composition root has no consumer until B#14.
- Q-1 (code quality/tests) and Q-2 (independent review) have not run.
- Next: the human reviews the diff and decides whether to commit. Then run Q-1 and Q-2 for B#13.
