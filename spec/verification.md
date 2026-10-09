# Project Specification — Verification

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

- AT-23 (FR-03, FR-09): rating-only edits retain clearance but never clear pending/flagged states. Body edits to published Reviews remove old public eligibility immediately. Clearance updates rating aggregates and summary revision atomically. Approval does not undo author deletion/admin hiding; restoring hidden content does not bypass screening. Duplicate dispatches deduplicate by content revision, and human approval wins over an in-flight AI result.
- AT-24 (AI-02, DEP-10): simulate a crash after saving pending work but before dispatch, then recover automatically. Verify backoff, maximum 3 failed executions, no attempt charge for capacity deferral, secret-authenticated recovery, fair pending order and no lost work. Measure recovery backlog after an outage under the expected submission workload.

- AT-25 (FR-06, SEC-01): Admin can find a USER and manually suspend them with zero Reports, then unsuspend them. Check reason, CSRF and If-Match enforcement, non-Admin/ADMIN-target rejection, atomic session revocation/audit, fresh-login requirement, same-status no-op, cycle advancement only on reinstatement and serialization with concurrent Report acceptance.
- AT-26 (health contract): anonymous monitors reach both health endpoints without login redirects. Database outage leaves live at 200 and ready at 503; missing core configuration fails readiness, while AI outage alone does not. Verify generic exact response shapes, no-store, 2-second database timeout, no sensitive details or side effects, and no provider calls.
