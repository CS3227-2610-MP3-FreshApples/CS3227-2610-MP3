# S-04 password-policy correction

## Scope

Before Increment 2, the human requested verification of the updated
`spec/security.md` password requirement: passwords must contain at least one
number and one special character in addition to the existing 12–128 character
range and no-truncation rule.

## Findings and correction

The Increment 1 validator enforced only the length range. A focused test was
added first and failed for the expected reason. The validator now requires a
Unicode number (`\\p{N}`) and a non-letter/non-number/non-whitespace special
character, and its validation message reflects the policy. Boundary tests and
the S-04 plan were updated.

## Validation

- Focused identity tests: 4 passed.
- Full unit suite: 337 passed.
- Type-check: passed.
- Lint: passed.
- Iteration visual diff refreshed at `_temp/visual-diff.html`.
- Deterministic evidence manifest refreshed at `_temp/s04-increment1-evidence.json`.

No dependencies or commits were added. Increment 2 remains paused pending
human review of this correction.
