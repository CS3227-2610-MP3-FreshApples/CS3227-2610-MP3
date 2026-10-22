# Normal-user logout implementation plan

## Confirmed requirement

Implement the normal User logout experience on branch `feat/user-logout`.
The existing API contract is authoritative: an authenticated browser must
obtain a session-bound CSRF token, send an exact same-origin `POST` to
`/api/v1/auth/logout`, and, on success, receive the cleared session cookie and
lose access to the previous session. The User shell must expose only the
authenticated display name and a clearly labelled `Sign out` control; it must
not expose email, session details, reports, or moderation data.

The proposed successful-navigation behavior is to return the user to the
public home page (`/`). This is called out for human approval because the
specification defines logout and routing but does not explicitly prescribe the
post-logout UI destination.

## Scope boundaries

- Reuse the existing `/api/v1/auth/csrf`, `/api/v1/auth/logout`, and
  `/api/v1/auth/me` contracts; do not change database schema or session
  semantics.
- Add the smallest client-side auth helper/component changes needed by the
  normal User shell and focused behavioral tests.
- Keep Admin navigation and public anonymous navigation unchanged.
- Do not add dependencies, alter migrations, commit, push, or deploy.

## Implementation checklist

- [x] Add the normal-user sign-out control and client behavior: verify the
  authenticated projection before rendering private account controls, prepare
  CSRF with `no-store` and same-origin credentials, submit logout with the
  CSRF header and same-origin credentials, prevent duplicate submissions, and
  navigate to `/` only after a successful 204 response. Add focused behavioral
  tests for the request sequence, safe failure handling, and User-shell
  rendering. Validate with the focused tests, full unit suite, lint, type-check,
  build if available, `git diff --check`, the repository-required visual diff,
  and the iterative-TDD grader.

## Human approval gate

Before application-code edits, approve this checklist and the proposed `/`
post-logout destination, or specify a different destination/behavior.
