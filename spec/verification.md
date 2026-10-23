# Project Specification — Verification

> Admin summary requests: the [23 October 2026 amendment](admin-summary-regeneration.md) supersedes the earlier scheduled-only restrictions and defines the approved manual regeneration contract.

## 11. Verification Requirements

### 11.1 Required test levels

- Unit: domain validation, permissions, sampling, invalidation, moderation transitions, schemas, token budgeting and quota calculations.
- Database integration: uniqueness, foreign keys, soft deletion, transaction boundaries, invocation leases, revision guards and competing writes against PostgreSQL.
- API integration: complete access matrix, request validation, pagination, safe projections, CSRF, sessions and rate limits.
- End-to-end: one complete User journey and one complete Admin journey, including both AI features and failure UI using a deterministic provider fake.
- AI evaluation/security: versioned representative and adversarial fixtures, expected safe behaviour and actual results; one controlled SoC smoke test per AI feature before release.
- Deployment: production build, health checks, environment isolation, clean migration, backup/restore and rollback rehearsal.
- Manual UX/accessibility: keyboard-only core flows, focus/errors, responsive views and clear AI uncertainty.

Mock-based tests demonstrate orchestration, not real model quality. Live AI results must be reviewed for grounding and useful uncertainty; do not assert exact prose. Proposed release bar: at least 10 benign and 10 adversarial cases per AI feature, all hard containment/authorization checks passing and at least 90% of benign outputs judged grounded and useful by a recorded human rubric. Fix or document remaining quality weaknesses; security failures cannot be waived silently.

### 11.2 System acceptance criteria

AT-01 Admin browser access clarification (21 October 2026, human delegated the choice
to the agent's recommendation in the CI repair session): an anonymous visit to
`/admin/movies` redirects to `/sign-in` and displays the sign-in form without Admin
table data. Verify the settled destination rather than a transient resource error.
Service and handler authorization requirements remain unchanged.

| Test ID | Requirement | Observable pass condition |
| --- | --- | --- |
| AT-01 | FR-01, INV-01, SEC-01–04 | Registration creates USER; User cannot call admin APIs; guessed IDs cannot expose another User's report; logout/suspension revoke sessions; forged cross-origin writes fail |
| AT-02 | FR-02, FR-05 | Admin creates/edits/archives/restores text Movie; public lists/search/detail track state and contain no image fields |
| AT-03 | FR-03, INV-02-03 | Every new Review/resubmission/body edit automatically queues screening; rating validation and uniqueness hold; pending/flagged content excluded from public reads/aggregates/summaries; author cannot clear admin hide |
| AT-04 | FR-04, INV-04, INV-07 | Self/duplicate open reports fail; evidence survives edits/deletion; reporters see only submissions; targets cannot discover received reports/counts through IDs, notifications or account projections |
| AT-05 | FR-06, INV-06, SEC-09-10 | Acceptance records one distinct strike; third current-cycle incident suspends and revokes sessions atomically; pending/dismissed/AI flags do not count; concurrent decisions preserve counts; repeat decisions conflict |
| AT-06 | FR-07 | Drafts remain private; publish/unpublish/delete update public announcements correctly |
| AT-07 | FR-08, AI-01 | Anonymous summary reads succeed without provider calls; no summary POST/UI control exists; daily sweep skips unchanged or fewer-than-3-review Movies; at most 20 unique Reviews sampled; duplicate sweeps deduplicate |
| AT-08 | FR-08, INV-09 | Review edit/hide/delete during generation prevents stale publication; cached output disappears immediately when revision changes |
| AT-09 | FR-09, AI-02 | Automatic screening uses complete current text/policy only; exact quotes validated; clean publishes, suspected/uncertain stays flagged; no AI-request endpoint/UI; all held Reviews remain in admin queue |
| AT-10 | AI-03, SEC-11 | Shared quota holds across review writes and cron; contention/failure leaves saved pending text and durable work; recovery runs without Admin input; retry bounds hold; expired/late output cannot publish |
| AT-11 | SEC-05, SEC-08 | Malicious review/report instructions cannot obtain secrets, invoke actions or render executable markup; invalid output/source IDs fail safely |
| AT-12 | SEC-07, SEC-12 | No secrets in repo, logs or browser bundle; workflow handoffs and agent permissions reviewed |
| AT-13 | Sections 9–10 | Documented workload meets targets; development cannot access production storage; app is online and restore/rollback evidence exists |
| AT-14 | Course constraints | Role ownership, workflow artifacts, guides, reflection, reviewed logs, GitHub Pages website and current master branch are present |
| AT-15 | FR-10, if selected | Watchlist add/remove idempotent; another User cannot access private entries |
| AT-16 | FR-06 | Restore preserves author deletion; reinstatement advances strike cycle without restoring sessions or erasing history; old incidents cannot count again; three new distinct incidents re-suspend; acceptance below threshold may have no hide action |
| AT-17 | Stack, DEP-06 | Next.js API reaches SoC LLM from Vercel with synthetic data; pooled database access works under concurrency; deployed AI function duration is verified |
| AT-18 | Supabase/Next.js controls | Direct Supabase API cannot bypass app permissions; no database secrets in client assets; private caches do not leak between Users; Preview cannot read production data |
| AT-19 | Free-tier operations | Deployment from the actual team repository succeeds within Hobby eligibility; two Supabase projects fit existing allocation; backup export/restore and paused-project recovery are documented |

Additional acceptance cases:

- AT-20 (FR-08, AI-01, DEP-09): reject invalid cron secrets including Admin-cookie-only calls; recover pending changes after missed runs, quota deferrals and crashes without needing a new update. Unchanged valid summaries survive multiple days and retention cleanup. Weekly interval and fair pending ordering/backoff work; track backlog under the documented workload.
- AT-21 (FR-09, AI-02): submission, resubmission and body edits trigger automatic moderation with no Report/Admin request. AI outage/disabled/quota exhaustion returns saved pending state, never publishes or loses text. Recovery retries automatically, then routes exhausted/invalid checks to manual review. Concurrent edits/deletion/hiding/approval prevent stale publication. Admin approval requires reason and If-Match; AI flags never create strikes.
- AT-22 (FR-06): multiple reporters and edited versions of one Review yield one lifetime strike; reinstatement cannot recycle it. Simultaneous acceptances across different Reviews cause exactly one transition at threshold. Retention preserves necessary strike metadata. Targets see generic status only, never why/how many Reports were received.

Security fixtures must include "ignore previous instructions" in reviews, forged system-message delimiters, requests for credentials/private reports, fabricated source IDs, HTML/script payloads, malicious report explanations, attempts to bypass human moderation and quota flooding. Cover public scheduled summaries and Admin review checks.

For each release, record test command, source revision, environment, pass/fail result and evidence path. Track requirement → implementation task → automated/manual test → result. Mark unimplemented, untested and deferred items explicitly; do not present this starting specification as evidence of implementation.

The local S-04 Identity mapping is recorded in
`workflow/handoffs/s04-release-evidence.md`. It intentionally leaves FR-01 and
AT-01 partial pending the deferred public authentication pages and U-03/R-02,
and leaves Preview/Production separation, deployed bootstrap/removal, deployed
health and Vercel secret configuration as operator-required evidence.

- AT-23 (FR-03, FR-09): rating-only edits retain clearance but never clear pending/flagged states. Body edits to published Reviews remove old public eligibility immediately. Clearance updates rating aggregates and summary revision atomically. Approval does not undo author deletion/admin hiding; restoring hidden content does not bypass screening. Duplicate dispatches deduplicate by content revision, and human approval wins over an in-flight AI result.
- AT-24 (AI-02, DEP-10): simulate a crash after saving pending work but before dispatch, then recover automatically. Verify backoff, maximum 3 failed executions, no attempt charge for capacity deferral, secret-authenticated recovery, fair pending order and no lost work. Measure recovery backlog after an outage under the expected submission workload.

- AT-25 (FR-06, SEC-01): Admin can find a USER and manually suspend them with zero Reports, then unsuspend them. Check reason, CSRF and If-Match enforcement, non-Admin/ADMIN-target rejection, atomic session revocation/audit, fresh-login requirement, same-status no-op, cycle advancement only on reinstatement and serialization with concurrent Report acceptance.
- AT-26 (health contract): anonymous monitors reach both health endpoints without login redirects. Database outage leaves live at 200 and ready at 503; missing core configuration fails readiness; zero Admins fails readiness even with valid bootstrap configuration; after first-Admin commit readiness succeeds; AI outage alone does not fail readiness. Verify generic exact response shapes, no-store, the 2-second database-probe timeout, no sensitive details or side effects, and no provider calls.

### 11.3 A-01/A-02 decision acceptance examples

These refine AT-02 and AT-06 under FR-05, FR-07, INV-05, INV-09 and D-79–D-81; they are not new requirement IDs. They are specified expectations, not evidence that implementation tests have run. Each authorized mutation below assumes a valid active Admin session, Origin and CSRF token unless the case states otherwise.

| Given | When | Then |
| --- | --- | --- |
| A Movie with no Reviews and version 1 | Archive with If-Match "1", then restore with the returned version | Each actual transition advances Movie.version and reviews_revision once, preserves the oldest pending time, and commits one applied audit; archive is 204 with ETag/no body, restore is 200 Movie/version/ETag |
| An already-archived Movie, active Movie or deleted Announcement | Repeat respectively archive, restore or delete with the current version | Succeed with the operation's normal status, unchanged ETag/version/timestamps/summary markers, and one no_op audit |
| Any of those already-achieved states | Repeat with a stale version or omit If-Match | Return 409 stale_version or 428 precondition_required; no resource or audit write |
| A Movie with eligible, pending, flagged, hidden and author-deleted Reviews | Archive and restore | Lock Movie then all Reviews ascending ID for actual transitions; retain history and all Review flags; restore only eligible visibility and invalidate old summary revision atomically |
| Review submission racing Movie archive | Execute on competing PostgreSQL connections | Serialize: review first may save before archive hides it; archive first makes submission fail 404; no visibility/invariant violation |
| A non-deleted Movie or Announcement | PATCH an empty object, then a separately tested normalized same-value payload | Empty object is 422; same-value payload is 200 with unchanged version/timestamps and one no_op audit |
| A deleted Announcement | PATCH valid content/state with current version; separately test stale version | Current version returns 409 conflict; stale returns 409 stale_version; neither edits nor republishes |
| A draft with published_at null | Publish, edit its text while published, unpublish, publish again | First publish sets timestamp; edit is immediately public without resetting it; unpublish hides content and retains timestamp; republication replaces it |
| A published Announcement | PATCH state=published only; separately PATCH state=published plus changed body | First is update/no_op; second is update/applied, increments version once and preserves published_at |
| A draft Announcement | PATCH changed content and state=published together | Increment version once; insert exactly one announcement.publish/applied audit with scalar changed-field markers and no content text |
| Movie create/PATCH inputs | Omit optional fields on create or explicitly clear them on PATCH | Defaults/clearing are null for releaseDate/runtimeMinutes, [] for genres/cast and empty string for director; PATCH omission retains the old value |
| Invalid input | Supply null director/arrays, impossible releaseDate, empty/oversized required text, derived/actor fields or unknown fields | Return 422 with fieldErrors; no mutation; preserve entered UI text on recoverable errors |
| An Announcement Movie reference | Assign an existing archived Movie, then restore/archive the Movie later | Accept reference; public announcement persists; link eligibility tracks current Movie state at read time |
| A malformed or nonexistent movieId in an Announcement body | Create or PATCH | Return 422 validation_failed with movieId field error; a malformed path ID instead returns 404 not_found |
| Equal updated_at values or equal publication timestamps | Read adjacent list pages without intervening writes | Admin lists use updated_at DESC/id ASC; public announcements use published_at DESC/id ASC; no tie duplicates/omissions; drafts/deleted never leak |
| Pagination requests | Request a positive page beyond total; separately use page=0, pageSize=101 or a fractional value | Beyond-total is 200 with empty items and correct total; invalid values are 422, never clamped |
| Anonymous, USER or failed CSRF/Origin request | Call an Admin endpoint, including a would-be no-op | Return applicable 401/403 before mutation; no state or audit changes |
| An otherwise valid mutation | Audit insertion fails | Roll back content/state/version/review markers together; safe error envelope/request ID and no raw database error |
| A malicious text payload within valid bounds | Save and render Movie/Announcement text | Render inert plain text, never executable markup; audit contains no copied content |

Implementation verification must cover unit validation/state transitions, PostgreSQL locks/rollback/races, API responses/access/pagination and the AT-02/AT-06 UI round trips. Manual keyboard, field-error, confirmation and recoverable-form-state checks remain required. Check the owning Review DELETE path for D-81's bodyless ETag rule without changing Review lifecycle behavior.
