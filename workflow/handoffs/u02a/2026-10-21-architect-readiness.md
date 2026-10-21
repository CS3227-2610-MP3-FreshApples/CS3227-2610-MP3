# U-02a Architect Readiness Handoff

## Assignment

| Field | Value |
| --- | --- |
| Task | U-02a / A#5 — review core lifecycle |
| Role | Architect (read-only assessment) |
| Source revision | `6269f63` (`master`, 21 October 2026) |
| Permitted paths/actions | Inspect approved specifications, contracts, code and tests; identify boundary/threat risks; no implementation or approval |
| Files changed by architect | None |

## Boundary and contract assessment

U-02a can proceed after the human implementation gate. The planned Reviews service/repository and `/api/v1` handlers stay within the topology in `spec/architecture.md`. UI work must consume the HTTP contract and must not access PostgreSQL or the SoC adapter. A owns Review writes and K8; B remains the owner of K7 and K9. U-02a may consume K7/K9 but must not duplicate their logic or implement K8 early.

The approved review-write sequence is implementable: active-user guard, K6 rate-limit admission in its own transaction, Account share lock, K7 active Movie update lock, Review lock/unique insert, Review mutation, K9 queue write, conditional K7 marker, commit, then K9 `attemptAfterCommit` with no transaction held. This preserves Account → Movie → Review ordering and the no-LLM-in-transaction rule. K9 failures must not turn a committed Review into a lost write; the durable queue remains the recovery boundary.

## Threat and verification findings

- Enforce authentication, active status, ownership, CSRF/Origin and rate limiting at the handler/service boundary; do not rely on `/app` navigation.
- Treat body text as plain text and untrusted input. Use parameterized repository queries and safe DTO projections; never expose AI assessment, received reports, email, or session data in User responses.
- Lock and re-verify Movie/Review relationships and versions before writes. Preserve the unique `(movie_id, author_id)` invariant under concurrent creates.
- Keep `GET /movies/:id/reviews` limited to eligible Reviews on active Movies and keep `GET /me/reviews` private with safe moderation state only.
- Test rollback/atomicity for Review mutation, K9 enqueue and K7 revision marker; test stale late writes and archived-Movie races. Verify the D-81 bodyless DELETE response/ETag rule while implementing the Review DELETE route.

## Unresolved risks and next action

No new contract or architecture decision is required for U-02a. K8 transition work, automatic clearance/flagging, post-commit dispatch wiring, and User pending/held UI remain later slices (A#6/A#7). The human developer should approve the bounded scope and start implementation; any discovered conflict must stop the affected slice and be recorded in `spec/`.

