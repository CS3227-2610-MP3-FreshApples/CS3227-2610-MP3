# U-02a reviewer_tester validation

| Field | Value |
| --- | --- |
| Task | U-02a / A#5 |
| Branch | `feat/reviews-core` |
| Reviewer | reviewer_tester agent |
| Mode | Independent, read-only |
| Verdict | FAIL; not complete/merge-ready |

## Positive evidence

- USER-only authentication, CSRF and same-origin checks, ownership checks, and safe projections are wired.
- SQL access is parameterized.
- Account → Movie → Review lock ordering is followed.
- Moderation enqueue is transactional; post-commit dispatch is outside the transaction and safely contained.
- Hidden reviews remain hidden after author edits; stale If-Match and soft deletion are implemented.

## Findings

- Review create/edit responses omit the safe saved/pending message required by `spec/api.md:111`.
- Required behavior lacks verification for concurrent creates, archived-Movie rejection, CSRF/authorization negatives, rate limiting, queue rollback, dispatcher failure, archive/create serialization, and aggregate/revision changes.
- Review routes do not declare `maxDuration = 120`; the reviewer recorded this as deferred because the commit plan assigns it to later U-02c/A#7 work.

## Checks reported

- `npm run test:unit`: PASS, 57 files / 980 tests.
- `npm run lint`: PASS.
- `npx tsc --noEmit`: PASS.
- `git diff --check`: PASS.
- Integration and build checks were not successfully run by the validator because its environment lacked `TEST_DATABASE_URL` and Docker access.

## Next action

Resolve the response-contract omission, add the missing negative/concurrency/aggregate/transaction tests, and rerun validation before marking U-02a complete.
