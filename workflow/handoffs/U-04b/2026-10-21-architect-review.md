# U-04b architect review handoff

- **Task:** U-04b, PR B#14 (formerly A#10, D-85).
- **Reviewed revision:** `2629bcc` on `feat/ai-summary-cron-ui`, with the analyst preflight (`2026-10-21-analyst-preflight.md`).
- **Resolution:** D-98 in `spec/governance.md` and AM-26 in `workflow/contracts.md` §28, recorded in the working tree.
- **Authorization:** the human (thegrimbee, Developer B) instructed the agent to resolve every blocker and missing decision as the agent recommends, then implement both B#14 commits. The architect was read-only and approved nothing.
- **Approval state:** recorded by Developer B. **Developer A's approval is pending** for AM-26 (K3), the public API items and the `page.tsx` mount lines.

## Verified boundary findings

1. C-1 is real: with `CRON_SECRET` unset the composition root passes `""`, and `requireCronCaller` accepts an empty credential.
2. K1 forbids nested transactions and every query needs an open Tx, so the public read is one statement in its own Tx and the sweep never calls generation or K10 inside a Tx callback.
3. K7 `recordSummaryAttempt` sets `summary_last_attempt_at = now()` itself; reading `now()` and `now() + 1 day` in the same Tx makes the backoff exactly one day.
4. K2 `runRoute` maps `TransactionConflict` to 409 and other throws to 500, so the sweep must return a typed `unavailable` result for D-94's 503 phases.
5. `summaryLimits` lacks the interval and per-run maximum; those come from `config.ai`.
6. The D-96 F3 fragment returns `EXISTS`, while the public read needs the rows; the fragment is refactored.
7. Lock order: steps 1 and 2 lock only the Movie; selection takes no lock; an archive between selection and step 1 rolls back and counts `skipped`.
8. Containment: stored output is revalidated at read time and rendered as React-escaped text only; logs carry IDs, counts and outcome kinds.
9. Under `cacheComponents` the cron route must call `connection()` before any work.

## Findings and resolutions

| Finding | Resolution (D-98 unless noted) |
| --- | --- |
| C-1 cron guard fails open with no secret | Fail closed in `requireCronCaller` (AM-26); paths widened by `guards.ts` and its unit test |
| C-2 U-02a tracker rows lag `master` | Not changed; Developer A's rows. Does not block B#14 |
| C-3 / MD-7 mount breaks page tests | Self-fetching async content inside `<Suspense>`; page tests unchanged |
| MD-1 `authGuards` null | 503 before the secret check |
| MD-2 / MD-3 UI strings and time format | Exact strings recorded |
| MD-4 summary read fails on the page | Null renders nothing; fault renders the unavailable line |
| MD-5 database fault on the public read | 500 as U-01; null service 503 |
| MD-6 invalid stored row | Skip to next valid current row; none valid but any row gives `stale`; strict sample schema |
| MD-8 HEAD runs GET | Accepted |
| MD-9 405/OPTIONS | D-38 exception extended |
| MD-10 logging | One `summary.sweep` line; `summary.read.invalid_stored_output` |
| MD-11 / MD-12 wiring | Settings from `config.ai`; public read wired with the database |
| MD-13 shared fragment | FROM/JOIN/WHERE text with `EXISTS` and retired checks built from it |
| MD-14 `maxDuration` | 120 for cron, 15 for the summary GET |
| MD-15 rate limit | None |
| MD-16 Vercel header | R-04 verifies |
| MD-17 (new) null pending order | `summary_pending_since` ascending, nulls last |

## Allowed paths

- **K3 check (D-98):** `src/server/services/identity/guards.ts`, `tests/unit/identity/authorization-and-status.test.ts`.
- **Commit 1:** `src/server/services/ai/summary/sweep.ts` (and its log), `src/server/repositories/summary/summary-selection-repository.ts`, `src/server/repositories/summary/current-summary.ts`, both summary `index.ts` files, `src/app/api/v1/internal/cron/summaries/route.ts`, `src/server/composition.ts` (sweep wiring), tests under `tests/unit/ai/summary/`, `tests/integration/ai/summary/`, `tests/integration/api/`.
- **Commit 2:** `src/server/services/ai/summary/public-read.ts`, `src/server/repositories/summary/public-summary-read-repository.ts`, both `index.ts` files, `src/app/api/v1/movies/[id]/summary/route.ts`, `src/app/(public)/movies/[id]/_components/review-summary.tsx`, `src/server/composition.ts` (read wiring), `src/app/(public)/movies/[id]/page.tsx` (one import, one element), same test directories.
- **Excluded:** migrations, `vercel.json`, dependencies and lockfile, K7/K10 internals, `src/server/http/`, `src/components/`, `tests/support/`, Developer A's page tests.

## Accepted risks and gaps

- Brief `reviewCount` / `eligibleCount` mismatch on the page (two statements).
- Not claimed by B#14: D-95 index migration and measurements; R-04 deployment checks; AT-08 and INV-09 through real hide/restore and clearance; D-84 archive/restore; AT-20 retention (OQ-05); R-01 and R-02.

## Next action

Implement commit 1, then commit 2, within these paths.
