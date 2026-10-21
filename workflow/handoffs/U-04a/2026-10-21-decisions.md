# U-04a specification decision handoff

- **Task:** U-04a, PR **B#13** (the requester called it "A#9"; `workflow/COMMIT-PLAN.md` records A#9 as moved to B#13 under D-85).
- **Source revision:** `83cce21` on `feat/ai-summary-core` (analyst preflight); decisions committed in `076e25d`, `de0d55b` and `f1867c2`.
- **Requirements:** FR-08, INV-09, AI-01, AI-04, DEP-09, AT-07, AT-08, AT-20; AT-11/SEC-08 in part. AI-03 is used through K10, not implemented. New records D-86–D-92 and AM-23–AM-24 are decision and amendment IDs, not requirement IDs.
- **Authorization:** the human (thegrimbee, Developer B) requested a read-only analyst preflight, then instructed the agent to resolve every reported conflict and missing decision as the agent recommended, and allowed multiple commits. The scope is specification, contract and plan text plus local commits: no code, tests, migrations, push or PR.
- **Permitted paths used:** `spec/`, `workflow/`, `logs/`.
- **Approval state:** recorded by Developer B under delegation. Developer A (Lim-ZY) approval is pending for all spec and contract text (`COMMIT-PLAN.md` §2). No both-developer approval is claimed.

## Findings and their resolutions

| Analyst finding | Resolution |
| --- | --- |
| C1: U-02 dependency (PLAN says Blocked on U-02; COMMIT-PLAN and SP-2 allow fakes) | D-91: U-02 is an acceptance dependency, not a merge dependency; synthetic Review rows plus real K7 are test-only stand-ins |
| C2: seed persistence vs schema | D-88: seed and provenance inside `sampled_review_ids_and_versions`; no migration |
| C3: marker-fake constant outside B#13 paths | D-92 widens B#13 to `marker-fake-provider.ts` (Developer B-owned) |
| C4: config accepts sample sizes 1–2 and any interval | D-86: sample size 3–20; D-89: interval 1 or 7 only |
| C5: contracts §2.2 still called O-12 unresolved | Wording corrected to point at §16 |
| M1: output field names and strictness | D-87 |
| M2: public DTO, `missing` vs `stale`, precedence | D-90 |
| M3: seed source, PRNG, ordering, IDs/versions | D-86 (sampling), D-88 (IDs/versions = `version` and `contentRevision`) |
| M4: where seed, included count and truncation live | D-88 |
| M5: reduction order, marker, message layout, which bound | D-86 |
| M6: summary prompt version and text | D-86 (`review-summary-prompt-v1`; wording reviewed in the B#13 PR) |
| M7: snapshot consistency | D-86 (one SQL statement under READ COMMITTED; no locks) |
| M8: eligibility predicate ownership | D-86 (restated in U-04's own read repository with a parity test against U-01; owner unchanged per D-85) |
| M9: outcome-to-schedule mapping and starvation | D-89 (selection requires ≥3 eligible; attempt recorded before generation; count table) |
| M10: fixed fake vs sample IDs | D-87 (position labels `R1`–`Rn`; the fake cites `R1`–`R3`) |
| M11: model ID source | D-88 (not needed by the summary service; K10 supplies it) |
| M12: B#13 paths | D-92 |

Correction to the analyst report: M8 said U-01's predicate has no deleted or hidden condition. `src/server/repositories/catalogue/public-movie-read-repository.ts` does include `deleted_at IS NULL AND hidden_at IS NULL`, so the U-01 and D-86 predicates are the same.

## Acceptance examples for B#13 (proposals; not executed)

1. **AI-01.3, AT-07.** Given an active Movie with 0, 1 or 2 eligible Reviews, when generation runs, then the result is `insufficient_reviews`, K10 is not called, and no AIJob, reservation or ReviewSummary row exists.
2. **AI-01.4, D-86.** Given 25 eligible Reviews and seed S, when sampling runs twice, then both runs choose the same 20 distinct Review IDs in the same order.
3. **AI-01.5, D-86.** Given a 1,500-code-point body, then the supplied body has 1,000 code points and `truncated: true`.
4. **AI-01.5, D-86.** Given an input estimate over `AI_INPUT_TOKEN_LIMIT`, then Reviews are removed from the end of the sample order until it fits. If fewer than 3 remain, the result is `input_unfit` with no K10 call.
5. **AI-01.6, D-87.** Given output with an unknown key, more than 3 items, an over-length string, a URL, a tag, a duplicate source, or a label outside the included sample, then `validate` returns `invalid_output`.
6. **AI-01.7, AT-08.** Given a job captured at revision r and a real K7 `markReviewsChanged` committed before publish, then the outcome is `stale`, no ReviewSummary is inserted and pending stays set.
7. **AI-01.7.** Given the Movie is archived before publish, then the outcome is `stale` and nothing is written.
8. **D-88.** Given a ReviewSummary already at the current revision, then generation returns `current` with no K10 call.
9. **D-86.** Given the same seeded Reviews in every eligibility state, then the U-04 eligible count equals the U-01 public `reviewCount`.
10. **D-70, D-87.** Given `[fake-llm:summary]`, then the marker fake's output passes the D-87 validator for any sample of at least 3.

## Known gaps

- Developer A approval of D-86–D-92 and AM-23–AM-24.
- An architect preflight has not reviewed these decisions yet. The next action is to run it.
- Acceptance through real U-02 review writes (D-91), U-04b (cron route, public read and UI), deployed cron (R-04), live SoC smoke and R-01 fixtures remain outstanding.
- The prompt wording is decided only in outline; the B#13 PR review decides the exact text.

## Next action

The human verifies the session log, asks Developer A to approve the decisions, and runs the architect preflight before setting U-04a to `Ready`.
