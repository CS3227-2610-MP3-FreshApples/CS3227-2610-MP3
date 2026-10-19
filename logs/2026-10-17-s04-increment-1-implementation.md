# S-04 Increment 1 implementation session

## Scope

Implemented only the human-approved S-04 Increment 1 identity primitives and account service. No session, CSRF, authentication handlers, guards, or bootstrap work was started.

## Changes

- Added FreshApples email normalization and strict registration validation.
- Added Argon2id password hashing and verification with 12–128 character limits and no truncation.
- Added the Identity account repository/service, duplicate-email conflict mapping, forced `USER`/`active` persistence, and safe account projection.
- Added focused behavioral tests for injection rejection, normalization, password boundaries, verification, persistence input, and projection privacy.

## Validation

- Focused unit test: passed, 4 tests.
- Full unit suite: passed, 19 files / 337 tests.
- Type-check: passed.
- Lint: passed.
- Iteration visual diff: `_temp/visual-diff.html`, generated against external baseline commit `1ae091d73297233fc24458147c0dff97346deb21`.

## Disclosure and gaps

This session used Codex assistance for implementation and tests; the changes require human review. The existing working tree contained unrelated human edits, which were preserved. `git diff --check` was not clean because of pre-existing trailing whitespace in `spec/governance.md` lines 355–356; those lines were not changed in this session. Database integration tests were not run because this increment's focused tests are unit-level and no database container was started.

## Next action

Human review of this increment, then explicit approval is required before any later S-04 increment. Increment 2 remains the next planned scope.
