# S-02 HTTP/API kernel implementation checklist

Status: All three implementation increments complete; reviewer/tester follow-up complete.
Task: S-02
Owner: Developer A (Lim-ZY)
Source revision: current working tree based on `master`, with S-02 marked `Ready`.

## Confirmed scope

Implement contract K2 in `../../../src/server/http` with unit tests in `../../../tests/unit/http`.
The authoritative behavior is `../../../spec/api.md` §8.1, `../../../spec/security.md` SEC-05,
`../../contracts.md` §5 and AM-01/AM-05, and `../../PLAN.md` S-02.
Unknown or invalid JSON fields return 422; malformed JSON returns 400.

## Increments

- [x] **Increment 1 — response/request identity and error mapping.**
  - Tests: generated request IDs ignore inbound IDs; error envelopes contain the
    documented code/message/requestId shape; status/code mappings cover 400,
    401, 403, 404, 409, 413, 415, 422, 428, 429 and 503; unexpected errors
    become 500 `internal_error`; `TransactionConflict` becomes 409 `conflict`.
  - Checks: focused HTTP unit tests, then `npm run test:unit`, lint and type-check.

- [x] **Increment 2 — JSON body and strict validation helpers.**
  - Tests: JSON content type, malformed JSON, 32 KiB limit, unsupported media
    type, unknown fields, field errors, and trimmed Unicode code-point lengths
    including emoji and combining characters.
  - Checks: focused HTTP unit tests, then the repository checks applicable to the
    changed scope.

- [x] **Increment 3 — pagination, IDs and optimistic concurrency.**
  - Tests: page/pageSize defaults and bounds, malformed UUID IDs, If-Match
    parsing, missing/stale validators, quoted ETags, list responses, and 204
    no-content responses.
  - Checks: focused HTTP unit tests, then the repository checks applicable to the
    changed scope.

## Constraints

- No repository, database, adapter or provider imports from `../../../src/server/http`.
- No changes outside the approved S-02 paths except ignored `_temp/` evidence.
- No commit, push or pull request is authorized by this checklist.
- The implementation must follow the current Next.js 16 route-handler guidance;
  K2 itself is framework-independent and contains no Route Handler.

## Human gate

Implementation may begin only after the human explicitly approves this
checklist. Only one increment will be implemented per approval cycle; after each
handoff the agent stops and waits for continuation approval.

## Open contract clarification

`../../../spec/api.md` §8.1 requires `X-Request-Id` on every response, while
`../../contracts.md` §5 gives successful-response helpers no request-ID
parameter. Record one of these decisions in the contract/spec before approval:

1. `runRoute` decorates every returned response with its generated request ID;
   or
2. successful-response helpers receive the request ID explicitly and set it.
