# Normal-user review submission UI plan

Branch: `feat/user-review-ui` from the current `master`

Source of truth: existing review API contract, current public movie detail page, existing authenticated navigation, existing review client patterns, and the recorded review validation rules.

## Confirmed scope

Add a normal-user review submission experience to the public movie details page. Authenticated users can enter a rating from 1–10 and a plain-text review body, submit through the existing CSRF-protected `POST /api/v1/movies/[id]/reviews` endpoint, and receive pending/validation/error feedback. Unauthenticated visitors should be directed to sign in. Do not change the API, database, moderation workflow, public review projection, or authentication contracts.

## Checklist

- [ ] Increment 1 — Review submission client, form, movie-page integration, and tests
  - Behaviour: authenticated user sees an accessible form; unauthenticated visitor sees a sign-in path; valid submissions use CSRF-aware HTTP and show the API’s moderation result; invalid/error responses preserve user input and show safe feedback.
  - Tests: focused client/form rendering and API-helper tests; movie-page integration checks; existing review and public-page tests.
  - Checks: focused tests, full unit suite, lint, type-check, build/e2e when the required environment is available.

## Explicit exclusions

- No API, schema, server-service, moderation, report, or authentication changes.
- No editing/deleting own reviews in this increment.
- No optimistic insertion into public reviews; pending reviews are not public until moderation clears them.
- No raw API/provider errors or sensitive account data in the UI.

## Approval gate

Application code will not be edited until the human approves this checklist. After approval, one increment will be implemented and handed off for review.
