# B#9 / A-05 architect readiness

## Scope

Read-only architecture assessment of developer B's B#9 (report decisions, strikes and threshold suspension) against the repository at `master` HEAD `0fccd911e1bfa8e2e5cbb0219d9ddd9a80ba6ed4`.

## Verdict

**BLOCKED.** The architecture is viable and dependencies are merged, but implementation must stop until the missing A-05 API/projection decisions are recorded in the authoritative specification/contract artifacts.

## Unresolved decisions

1. Exact `/admin/reports` list projection, ordering and status/category filter semantics, including the “All reports” reset.
2. Exact detail projection fields and privacy boundary for immutable evidence, live state, strike count and projected threshold effect.
3. Decision endpoint wire contract: `If-Match`, reason validation bounds, response shape beyond `strikeAdded` and `accountStatus`, and exact stale/repeated-decision error mapping.

The architect explicitly did not infer these from A-04 conventions.

## Architectural conditions after resolution

- Use K3 Admin authorization plus CSRF/same-origin checks for unsafe mutations.
- Use K4 for all account status and session changes; do not write Account directly.
- Preserve Account → Movie → Review → Report locking and re-check report version/status/target/review after locks.
- Use K8 for accepted-report hiding and cancel related moderation work in the same Review-locked transaction.
- Use K11 for evidence parsing/projection; do not expose snapshots or reasons to target Users.
- Commit decision, strike, optional hide, suspension and audit atomically; audit failure rolls back all effects.
- Keep AI outside report acceptance.

## Required verification

Cover access/CSRF/input failures, filters and stable pagination, private no-store responses, snapshot immutability and escaping, accepted/dismissed decisions, repeated and stale decisions, one lifetime strike for multiple reporters, threshold concurrency, reinstatement/strike-cycle behavior, races with A-04 and A-06, and audit/K4/K8/K11 rollback/contract cases.

## Changes and checks

No files were changed by the architect. No tests were run.
