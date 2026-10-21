# U-04a Q-1 resolutions handoff (D-96)

- **Task:** U-04a, PR B#13. This handoff resolves Q-1 findings F1–F5 from `2026-10-21-q1-code-quality-tests.md`.
- **Decision:** D-96 in `spec/governance.md`, recorded by thegrimbee (Developer B) after the agent's recommendations were delegated to him. Approved by both developers on 21 October 2026; Lim-ZY's approval is recorded as reported by Developer B. D-96 amends D-87.
- **Source revision:** `92ee236` on `feat/ai-summary-core`, plus the uncommitted Q-1 tests.
- **Authorization:** the human instructed "resolve F1–F5 as you recommend, then run Q2". The spec was changed before the code. No commit, push or tracker edit was made.
- **Paths:** `spec/governance.md`; `src/server/services/ai/summary/` and `src/server/repositories/summary/` (D-92 paths); tests under `tests/unit/ai/summary/` and `tests/integration/ai/summary/`. No path was widened. `create-ai-runtime.ts` was not touched.

## Resolutions

| Finding | Resolution | Files |
| --- | --- | --- |
| F1: lone surrogates passed validation and then failed the insert as `storage_failed` | D-87 safe text now rejects any unpaired surrogate, so the result is `invalid_output` | `output-schema.ts`; tests in `output-schema-edge.test.ts` and `summary-publication-concurrency.test.ts`, which now asserts `invalid_output` |
| F2: "a letter" after `<` | Recorded as ASCII A–Z and a–z, the HTML tag-open set; the code is unchanged apart from a comment | `output-schema.ts`; tests pin `<é`, `<ж` and `<良` as accepted and `<a`, `<Z`, `</`, `<!`, `<?` as rejected |
| F3: the D-93 currency rule was written twice | New `currentSummaryExists` SQL fragment, used by the D-86 read and the D-93 guard. Its arguments are static SQL expressions (columns or `$n`); values stay parameterized | `current-summary.ts` (new), `summary-input-repository.ts`, `review-summary-repository.ts` |
| F4: duplicated `SummaryLimits` shape | `SummaryLimits = NonNullable<AiRuntime["summaryLimits"]>` | `input-preparation.ts` |
| F5: the publisher took `AiJobRef` | It now takes `jobId: AiJobId`, and generation passes `job.jobId`. The K10 callback signature is unchanged | `publication.ts`, `generation.ts`, `generation.test.ts` (call sites) |

## Checks

| Command | Result |
| --- | --- |
| `npx tsc --noEmit`, `npm run lint` | pass |
| `npm run test:unit` | 64 files, 1,421 passed |
| `npm run test:integration` (disposable PostgreSQL 17, loopback 55432) | 27 files, 584 passed |
| `tests/integration/ai/summary/`, 10 consecutive runs | 10/10 |
| `npm run build`, `git diff --check` | pass |

## Next action

Q-2 review results are recorded in `2026-10-21-q2-review.md`. D-96 is approved. The human reviews the diff and decides whether to commit.
