# S-04 Auth UI — Increment 3

- [x] Implement registration submission and UI handling for the approved Increment 3 behavior.
  - Behavioral test: `../../../tests/unit/auth/register-client.test.ts`
  - Validation: focused registration tests, full unit suite, lint, type-check, and diff review.

Scope confirmed by the human request: add `submitRegistration` in `../../../src/components/auth-client.ts` and wire `src/app/(public)/register/page.tsx`; preserve existing Increment 1–2 and unrelated `.codex` changes; do not modify server/auth API code, sign-in behavior, or dependencies.
