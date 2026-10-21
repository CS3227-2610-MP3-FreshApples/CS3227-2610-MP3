# U-04a architect review handoff

- **Task:** U-04a, PR B#13 (and the B#14 items the review raised).
- **Reviewed revision:** `c7f29ed` on `feat/ai-summary-core` (D-86–D-92 and AM-23–AM-24 approved by both developers).
- **Resolutions:** `d72e8bb` (D-93, AM-25) and `1786886` (D-94, D-95, B#14 paths).
- **Authorization:** the human (thegrimbee, Developer B) ran the read-only architect preflight, then instructed the agent to resolve every blocker as the agent recommended, with multiple commits allowed. The work was limited to spec, contract and plan text: no code, tests, migrations, push or PR.
- **Approval state:** D-93–D-95 and AM-25 were recorded by Developer B and approved by both developers on 21 October 2026. Lim-ZY's approval is recorded as reported by Developer B.

## Findings and resolutions

| Finding | Blocks | Resolution |
| --- | --- | --- |
| M1: summary settings and wiring when AI is disabled | B#13 | D-93: `AiRuntime.summaryLimits`, null with the stub; the summary service is built only when it is non-null. D-92's paths widen by `create-ai-runtime.ts` (a human decision) |
| M2: "uniform" overstated after reduction | spec accuracy | D-93: algorithm kept; length bias disclosed and D-86 wording corrected |
| M3: count-only parity test | test design | D-93 (distinct counts per state), D-94 (B#14 copies), D-95 (drift risk; U-02 alignment) |
| M4: full-body read cost | acceptance | D-95: accepted risk; R-04 measures it against the 5-second timeout |
| M5: cron jitter versus 1-day checks | B#14 | D-94: 1-hour tolerance on both due checks |
| M6: no way to retire a bad prompt's output | acceptance | D-93: a summary is current only at the current prompt version; D-94 selects retired Movies; risk of a mass-retirement backlog accepted |
| M7: one Review can fail a Movie daily | acceptance | D-95: accepted risk with mitigations |
| M8: generation throws on an infrastructure fault | B#14 | D-94: counts as `failed`; 503 only if the lease, selection or step 1 throws |
| L1: duplicate summaries at one revision | B#13 / B#14 | D-93 guard in publish (AM-25); D-94 tie-break in reads |
| L2: no summary index | acceptance | D-95: new migration before acceptance |
| L3: safe-text gaps | acceptance | D-95: accepted; R-01 fixtures |
| L4: clock source | B#14 | D-94: database `now()` |
| L5: "no execution record" | interpretation | D-93: means AIJob and reservation |
| L6: `current` never clears pending | none | D-95: unreachable under D-51 |
| L7: stored output fails validation | B#14 | D-94: treated as absent and logged |
| L8: logging | B#14 | D-94: one structured line per sweep, without content |
| L9: marker order in fixtures | tests | D-93 (fixed seeds), D-95 (R-02 fixture note) |
| L10: `run` inside a Tx silently defers | tests | D-93: real-controller integration test |
| L11: selection cost | B#14 | D-94: bounded subquery stopping at 3 |
| L12: tiny input limit | none | D-95: fails safe |
| L13: backlog metric | acceptance | D-95: counts only Movies with at least 3 eligible Reviews |
| L14: B#14 paths | B#14 | D-94 and `COMMIT-PLAN.md` B#14 row |

## Checks

`git diff --check` passed before each commit. Line endings match each file. No lint, type-check or tests were run (documentation only).

## Next action

A human sets U-04a to `Ready` and gives the implementation agent D-86–D-93, AM-23 and AM-25, and the D-93 test requirements.
