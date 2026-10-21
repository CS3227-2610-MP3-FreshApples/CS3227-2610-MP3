# U-04b implementation handoff: summary sweep, public read and UI

- **Task:** U-04b, PR B#14 (formerly A#10, D-85). Commit 1 `feat(ai): secret-authenticated summary sweep (DEP-09)`; commit 2 `feat(catalogue): read-only summary endpoint and UI (FR-08)`.
- **Requirements:** FR-08, AI-01, AI-04, DEP-09, AT-07, AT-08 (synthetic only, D-91), AT-20 (in part), INV-09 (synthetic only). Decisions D-28, D-89, D-90, D-93, D-94, D-96 F3, D-98; amendments AM-24, AM-26.
- **Source revision:** base `2629bcc` on `feat/ai-summary-cron-ui`; committed as four commits on top.
- **Authorization:** the human (thegrimbee, Developer B) instructed the agent to implement both B#14 commits after resolving the preflight findings as recommended (D-98), and allowed splitting the work into several commits. No push or PR.
- **Permitted paths used:** D-94 and D-98 (see the architect handoff). The only Developer A files changed are `guards.ts` and its unit test (the AM-26 check) and the two mount lines in `page.tsx`; D-98 and AM-26, approved by both developers on 21 October 2026, cover all three.

## Changed files

Specification and workflow (recorded before code):

| Path | Change |
| --- | --- |
| `spec/governance.md` | D-98 |
| `workflow/contracts.md` | §28, AM-26 |
| `spec/api.md` | Scheduler contract references D-98 |
| `workflow/COMMIT-PLAN.md` | B#14 row names the D-98 K3 path |
| `workflow/handoffs/U-04b/` | Analyst, architect and this handoff |

K3 check (AM-26; may become its own commit or PR):

| Path | Change |
| --- | --- |
| `src/server/services/identity/guards.ts` | `requireCronCaller` returns `unauthenticated` when the configured secret is empty |
| `tests/unit/identity/authorization-and-status.test.ts` | Five unset-secret cases (no header, `Bearer `, `Bearer`, `Basic `, `Bearer x`) |

Commit 1 (sweep and cron route):

| Path | Change |
| --- | --- |
| `src/server/repositories/summary/current-summary.ts` | `currentSummaryRows` (FROM/JOIN/WHERE), with `currentSummaryExists` and the new `retiredSummaryExists` built on the same rule (D-96 F3, D-98) |
| `src/server/repositories/summary/summary-selection-repository.ts` | New. `selectDue` (D-89 filters, D-94 1-hour tolerance, retired-prompt branch, eligible subquery stopping at 3, D-98 order) and `readScheduleClock` (database `now()` and `now() + 1 day`) |
| `src/server/services/ai/summary/sweep.ts` | New. `createSummarySweep`: lease, selection Tx, step 1 Tx, generation with no Tx, exhaustive D-89 mapping, step 2 Tx; lease/selection/step-1 faults (including `TransactionConflict`) give `unavailable`; generation and step-2 faults handled per D-94 M8. `createDisabledSummarySweep`, `createConsoleSummarySweepLog` (`summary.sweep` lines) |
| `src/app/api/v1/internal/cron/summaries/route.ts` | New. `GET` only, `maxDuration = 120`, `connection()` first; 503 with no guard or sweep; 401 plus `access.denied` on a failed secret; 200 with exactly four counts or 503 |
| `src/server/composition.ts` | `summarySweep` (null with no database; disabled sweep without generation, leases, K7 or AI configuration) |
| `src/server/{repositories,services/ai}/summary/index.ts` | Exports |
| `tests/unit/ai/summary/sweep.test.ts` | New, 26 tests |
| `tests/integration/ai/summary/summary-sweep.test.ts` | New, 19 tests |
| `tests/integration/api/cron/summary-cron.test.ts` | New, 13 tests |

Commit 2 (public read, route and UI):

| Path | Change |
| --- | --- |
| `src/server/repositories/summary/public-summary-read-repository.ts` | New. One statement: eligible count, current rows latest first (`generated_at DESC, id DESC`, UTC `to_char`), any-summary flag; null for missing or archived |
| `src/server/services/ai/summary/public-read.ts` | New. Strict stored-sample schema, D-87 output check against `R1`–`Rn`, D-90 precedence with D-98 fallback, field-by-field projection, `summary.read.invalid_stored_output` log |
| `src/app/api/v1/movies/[id]/summary/route.ts` | New. `GET` only, `maxDuration = 15`; 404 malformed/unknown/archived, 503 null service, 200 D-90 view |
| `src/app/(public)/movies/[id]/_components/review-summary.tsx` | New. `ReviewSummarySection` (Suspense around a self-fetching async component that never throws), `ReviewSummaryView` with the D-98 strings |
| `src/app/(public)/movies/[id]/page.tsx` | One import and `<ReviewSummarySection movieId={movie.id} />` (approved under D-98) |
| `src/server/composition.ts` | `publicSummaryReadService` (null exactly when `database` is) |
| `src/server/{repositories,services/ai}/summary/index.ts` | Exports |
| `tests/unit/ai/summary/public-read.test.ts` | New, 25 tests |
| `tests/unit/ai/summary/review-summary-ui.test.ts` | New, 11 tests |
| `tests/integration/ai/summary/public-summary-read.test.ts` | New, 10 tests |
| `tests/integration/api/summary/summary-read.test.ts` | New, 7 tests |

`composition.ts` and both `index.ts` files hold hunks for both commits, so splitting needs `git add -p`.

## Checks

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npm run lint` | pass |
| `npm run test:unit` | 69 files, 1,503 passed |
| `npm run test:integration` (disposable PostgreSQL 17 in Docker, loopback port 55432, per-run password) | 35 files, 640 passed. The first full run had one failure in a new test (two Movies with near-equal pending times asserted in a fixed order); the assertion now compares the set. The summary, cron and summary-route files then passed 5 consecutive runs (104 tests each) |
| Developer A's `tests/unit/catalogue/` page tests, unchanged | 8 files, 94 passed |
| Mutation: AM-26 check removed | 4 unit cases and 3 API cases fail (even a bare `Bearer` passed before the fix) |
| `npm run build` | pass; both new routes are dynamic (ƒ) |
| `npm run test:e2e` | 8 passed; no existing spec opens the public movie page |
| `git diff --check` | pass |
| `npm run check:secrets` | not run: gitleaks is not installed on this host |

## Interpretations made (for review)

- The cron route's 503 for invalid core configuration also covers a null `summarySweep`, which happens exactly then.
- A generation fault logs `outcomeKind: null`; the count is `failed`.
- The `summary.sweep` line names the last attempted Movie. `AI_SUMMARY_MAX_MOVIES_PER_RUN` is fixed at 1, so this is the only one.
- The AI-01 label is plain text, not `role="status"`; the state lines use `role="status"`.
- When the read returns null, the whole section, including its heading, renders nothing.

## Known gaps

- **Approvals:** D-98 and AM-26 (including the `guards.ts` change, the `page.tsx` mount lines and the public API items) were approved by both developers on 21 October 2026; Lim-ZY's approval is recorded as reported by Developer B. Code review of the PR is still required.
- **Not claimed:** AT-08 and INV-09 through real review writes (D-91); U-02b hide/restore and real clearance (A-03, A-04); D-84 archive/restore; the D-95 index migration and R-04 measurements; `vercel.json`, Fluid compute and the Vercel bearer header (R-04); AT-20 retention cleanup (OQ-05); R-01 fixtures and R-02 journeys.
- No Playwright check of the summary on the movie page (`tests/e2e/` is outside D-98's paths); manual keyboard and screen-reader inspection not done.
- The Admin-cookie-only 401 case uses a synthetic cookie; the guard never reads cookies.
- The U-02a tracker rows still lag `master` (Developer A).
- Q-1 (code quality/tests) and Q-2 (independent review) have not run.

## Next action

The human reviews the four commits. Then Q-1 and Q-2; Developer A reviews the PR.
