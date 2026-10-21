# U-03 Architect Readiness Handoff

- Task: U-03 — Report submission and reporter-only history
- Role: Architect, read-only
- Requirements: FR-04, INV-04, INV-07, AT-04, AT-22 privacy
- Source revision: `109fff4150e6ac73852e6b2e2b24c9cbcc3de1fa`
- Permitted actions: inspect specifications, contracts, source, tests and repository state; no edits or implementation
- Files changed by architect: none

## Readiness

U-03 can proceed after the human implementation gate. The existing K3, K6, K7 and K11 contracts, Report schema/constraints, rate-limit policy and U-02 Review lifecycle are compatible; no new architecture or contract decision is required.

## Required boundaries and threats

- Consume identity authorization, shared rate limiting and Movie/Review locks; do not duplicate them.
- Follow Account → Movie → Review lock order, re-verify visibility after locking, and derive `target_user_id` from the locked Review.
- Write the immutable K11 snapshot in the submission transaction; never call an AI/provider or hold a transaction open for unrelated work.
- Filter reporter history by `reporter_id` in SQL and return indistinguishable 404s for guessed IDs.
- Receipts and target-facing projections must exclude evidence, explanations, reporter/target details, decision reasons, strikes and counts; private responses require `no-store`.
- Handle concurrent duplicate submissions through the partial unique index and map the loser safely.

## Gaps and next action

No report service, repository, routes, UI flow, parser/projection implementation or focused tests exist. The human should approve A#8 and assign Developer A to the bounded submission/history scope. Require unit/API/integration privacy and concurrency evidence, then independent code-quality and reviewer/tester validation. AT-04 and AT-01 remain incomplete until R-02 supplies the full two-user/two-role evidence.

No files were changed by the architect.
