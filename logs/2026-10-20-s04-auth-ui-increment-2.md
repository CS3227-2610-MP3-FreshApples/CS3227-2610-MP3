# S-04 auth UI Increment 2 implementation session

## Scope

Implemented exactly Increment 2 of the approved public authentication UI plan:
sign-in CSRF preparation, credential submission, safe authentication feedback,
duplicate-submission prevention, and server-authoritative active-role routing.
Registration submission, server/auth API code, arbitrary return URLs, commits,
and unrelated existing worktree changes were out of scope.

## Changes

- Added `src/components/auth-client.ts`, a client-safe HTTP helper that obtains
  a no-store same-origin CSRF token, posts only email/password with the required
  CSRF header and same-origin credentials, validates the returned account
  projection, and maps authentication failures to safe UI messages.
- Updated `src/app/(public)/sign-in/page.tsx` as a Client Component with native
  form extraction, a submission-in-flight guard, disabled/loading feedback,
  polite accessible status feedback, and fixed `/app` or `/admin` navigation
  only for active server-provided USER or ADMIN roles.

## Validation

- Focused auth-client test: 3 passed.
- Full unit suite: 43 files, 690 tests passed.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- Next.js 16 Server/Client Component and App Router guidance was read before
  implementation.

## Disclosure and gaps

This session used Codex assistance for implementation and tests; human review
is required. No dependencies, migrations, server/auth API files, or git history
were changed. Browser/manual accessibility checks, production build, E2E
journey evidence, and live API verification were not run in this increment.

## Next action

Human review of this Increment 2 diff and explicit continuation approval are
required before starting Increment 3 registration behavior.
