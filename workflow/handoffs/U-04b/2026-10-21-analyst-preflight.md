# U-04b analyst preflight handoff

- **Task:** U-04b, PR B#14 (formerly A#10, D-85), branch `feat/ai-summary-cron-ui`.
- **Source revision:** `2629bcc` (`origin/master` after PR #18 merged B#13), clean.
- **Requirements:** FR-08, AI-01, AI-04, INV-09, DEP-09, AT-07, AT-08, AT-20 (`workflow/PLAN.md` U-04). AI-03 through K10 (`maxDuration = 120`, awaited execution). Decisions D-85–D-97 (mainly D-89 as amended by D-94, D-90 as amended by D-93 and D-94, D-91, D-95, D-96 F3) and D-28. Amendments AM-23–AM-25.
- **Authorization:** the human (thegrimbee, Developer B) asked for the P-1 preflight, P-2 and both B#14 commits, with every blocker and missing decision resolved as the agent recommends. The analyst was read-only.

## Conflicts

| # | Finding | Evidence |
| --- | --- | --- |
| C-1 | **Security.** With `CRON_SECRET` unset, `composition.ts` passes `cronSecret: ""` and `requireCronCaller` compares two empty buffers, so a request with no `Authorization` header, or `Bearer ` with nothing after it, passes. Contradicts D-28, deployment.md and `config/types.ts` ("both cron routes reject every request with 401"). No test covers it. K3 is outside D-94's B#14 paths. | `guards.ts:69-79`, `composition.ts:260`, `tests/unit/identity/authorization-and-status.test.ts:82-89` |
| C-2 | U-02a code is on `master` (`998dd90`, PR #17) while `PLAN.md` and `COMMIT-PLAN.md` still describe it as awaiting merge review. | `src/server/services/reviews/`, `composition.ts:203-220` |
| C-3 | Mounting the summary component breaks Developer A's page tests, which mock the composition root with only the U-01 services and render synchronously with `renderToStaticMarkup`. Those test files are outside B#14's test paths. | `tests/unit/catalogue/public-pages.test.ts:6-9`, `public-pages-unavailable.test.ts:6-9` |

## Missing decisions

| # | Gap |
| --- | --- |
| MD-1 | Cron route status when `authGuards` is null (invalid core configuration) |
| MD-2 | Exact UI strings: awaiting, insufficient reviews, truncation notice, counts, headings, empty lists |
| MD-3 | Generation-time display format |
| MD-4 | Page behaviour when the summary read throws or returns 404 after the Movie read succeeded |
| MD-5 | Public summary read on a database fault mid-request (500 from `runRoute` versus 503) |
| MD-6 | Fallback for an invalid stored row: next row at the same step or the next step; malformed sample JSON |
| MD-7 | Mount design and Developer A's test files (C-3) |
| MD-8 | HEAD on the cron route runs GET in Next.js, so a HEAD with the secret would run the sweep |
| MD-9 | 405 and OPTIONS responses for the new routes lack `X-Request-Id` and the envelope |
| MD-10 | Log line event name, sink, and which paths log |
| MD-11 | Where the sweep gets `AI_SUMMARY_INTERVAL_DAYS` and the per-run maximum |
| MD-12 | Whether the public read is wired when AI is disabled |
| MD-13 | D-96 F3 helper returns `EXISTS`, but D-90 step 3 needs the matching row |
| MD-14 | `maxDuration` for the summary GET |
| MD-15 | Rate limiting on the public read |
| MD-16 | How Vercel cron sends the bearer secret (R-04) |

## Acceptance examples (summary)

- **Commit 1:** 401 for missing, wrong, `Basic`, Admin-cookie-only and unset-secret calls, with no writes; zero counts for AI disabled, lease held and nothing due; concurrent calls give at most one job; publish path schedule values; fewer-than-3 Movies untouched; ordering and fairness after failure; 1-hour tolerance boundaries for both intervals; unchanged Movies not selected; retired-prompt selection; deferral keeps pending with next attempt now; failure takes the 1-day backoff; generation throwing after step 1 counts `failed` with 200; archived-meanwhile is `skipped`; lease, selection or step 1 faults give 503; one log line without content.
- **Commit 2:** 404 for unknown, malformed and archived IDs; `insufficient_reviews` for 0–2 eligible even with a summary row; `ready` with exactly the D-90 keys and no sources, IDs, seed, job, model or prompt; `stale` for older revision or older prompt with no old text; `missing`; tie-break; invalid stored output never shown and never 500; no side effects for any caller; no POST and no UI control; UI strings and escaping; eligibility parity with U-01, selection and the U-02 listing.

## Readiness

- **Isolated development:** every runtime dependency is on `master` (K3, K7, K10, B#13, U-01 page, U-02a). Blocked only by C-1, C-3/MD-7 and the missing decisions above.
- **Full U-04 acceptance (not claimed by B#14):** AT-08 and INV-09 through real hide/restore (U-02b, A-04) and real clearance (A-03; the dispatcher stub keeps real Reviews `pending`); real archive/restore (D-84); D-95 index migration and R-04 measurements; `vercel.json` cron and Fluid compute (R-04); R-01 fixtures and R-02 journeys; AT-20 retention cleanup (OQ-05).

## Next action

Architect preflight (P-2), then a human records the decisions.
