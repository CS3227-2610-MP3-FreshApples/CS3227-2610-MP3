# S-04 public authentication UI — iterative-TDD plan

## Confirmed scope

Implement the deferred public sign-in and registration UI against the existing
`/api/v1/auth/*` contracts. Preserve the server-authoritative account role and
status model, keep UI code on the HTTP boundary, reuse the existing public
shell and accessible form primitives, and add focused behavioral tests plus
the required User/Admin authentication journey evidence.

The read-only UI-designer handoff recommends a restrained single-column,
text-first layout at `/sign-in` and `/register`, with no imagery, role
selector, password recovery, or arbitrary return URL.

## Decisions requested before implementation

Please confirm these defaults, or revise them before approving the checklist:

- Public paths are `/sign-in` and `/register`.
- Registration succeeds in place and offers a link to `/sign-in`; it does not
  create a session.
- Visiting auth pages while already authenticated is not given special
  redirect behavior in this increment.
- The public shell always exposes `Sign in` and `Register` links.
- No password-visibility toggle or `next`/return-to query parameter is added.
- The designer's generic messages are acceptable, subject to the API's safe
  error contract.

## Increment checklist

- [x] Increment 1 — shared public auth shell and sign-in structure.
  - Behavioral tests: public auth routes render their headings and links;
    public navigation exposes auth links; the main landmark remains unique;
    sign-in controls have labels, autocomplete, and submit behavior.
  - Validation: focused unit/UI contract tests, `npm run lint`, and
    `npx tsc --noEmit`.

- [x] Increment 2 — sign-in behavior and role routing.
  - Behavioral tests: CSRF preparation uses `cache: no-store`; credentials
    post with the CSRF header; generic 401 and 429 handling preserves form
    state; active USER routes to `/app`; active ADMIN routes to `/admin`;
    duplicate submission is prevented.
  - Validation: focused tests, full unit suite, lint, and type-check.

- [x] Increment 3 — registration behavior and success/error states.
  - Behavioral tests: registration sends only the permitted fields; password
    policy guidance is visible; 422 field errors are associated with inputs;
    duplicate email is safe; success clears the password and offers sign-in;
    no session or direct `/app` navigation is assumed.
  - Validation: focused tests, full unit suite, lint, and type-check.

- [ ] Increment 4 — registration confirmation, outlined auth controls, journey,
  and accessibility evidence.
  - Behavioral tests: registration requires a repeat-password value matching
    the password and never sends that confirmation field to the API; both
    registration and sign-in controls render visible border outlines;
    registration → sign-in → `/app`, Admin sign-in → `/admin`, auth failure
    paths, and private route separation through the existing E2E harness where
    the disposable database supports it.
  - Validation: focused repeat-password/UI tests, applicable E2E checks, full
    unit suite, lint, type-check, build, and manual keyboard/focus/zoom review
    recorded in evidence.

Each increment requires a separate human continuation approval, an external
working-tree baseline, red test before production edits, green focused test,
repository checks, iteration-scoped visual diff, and deterministic iterative-
TDD grading. No commits are authorized by this plan.
