# Project Specification — Verification

## 11. Verification Requirements

### 11.1 Required test levels

- Unit: domain validation, permissions, sampling, invalidation, moderation transitions, schemas, token budgeting and quota calculations.
- Database integration: uniqueness, foreign keys, soft deletion, transaction boundaries, invocation leases, revision guards and competing writes against PostgreSQL.
- API integration: complete access matrix, request validation, pagination, safe projections, CSRF, sessions and rate limits.
- End-to-end: one complete User journey and one complete Admin journey, including both AI features and failure UI using a deterministic provider fake.
- AI evaluation/security: versioned representative and adversarial fixtures, expected safe behaviour and actual results; one controlled SoC smoke test per role before release.
- Deployment: production build, health checks, environment isolation, clean migration, backup/restore and rollback rehearsal.
- Manual UX/accessibility: keyboard-only core flows, focus/errors, responsive views and clear AI uncertainty.

Mock-based tests demonstrate orchestration, not real model quality. Live AI results must be reviewed for grounding and useful uncertainty; do not assert exact prose. Proposed release bar: at least 10 benign and 10 adversarial cases per AI feature, all hard containment/authorization checks passing and at least 90% of benign outputs judged grounded and useful by a recorded human rubric. Fix or document remaining quality weaknesses; security failures cannot be waived silently.

### 11.2 System acceptance criteria

| Test ID | Requirement | Observable pass condition |
| --- | --- | --- |
| AT-01 | FR-01, INV-01, SEC-01–04 | Registration creates USER; User cannot call admin APIs; guessed IDs cannot expose another User's report; logout/suspension revoke sessions; forged cross-origin writes fail |
| AT-02 | FR-02, FR-05 | Admin creates/edits/archives/restores text Movie; public lists/search/detail track state and contain no image fields |
| AT-03 | FR-03, INV-02–03 | User review CRUD updates aggregate; ratings 1 and 10 accepted; 0, 11 and fractional ratings rejected; simultaneous creates cannot duplicate; admin-hidden row cannot be restored by author |
| AT-04 | FR-04, INV-04, INV-07 | Self/duplicate reports fail; valid report is queued immediately; later Review edit/delete leaves original evidence intact |
| AT-05 | FR-06, INV-06, SEC-09–10 | Admin action atomically closes Report, changes visibility/status and records audit; competing decision returns conflict |
| AT-06 | FR-07 | Drafts remain private; publish/unpublish/delete update public announcements correctly |
| AT-07 | FR-08, AI-01 | 2 Reviews cause no provider call; 25 eligible Reviews yield at most 20 unique sampled IDs; actual included count disclosed; repeated requests deduplicate/cache |
| AT-08 | FR-08, INV-09 | Review edit/hide/delete during generation prevents stale publication; cached output disappears immediately when revision changes |
| AT-09 | FR-09, AI-02 | Analysis uses only bounded target history and permitted evidence; dismissed reports are not treated as established misconduct; all Reports remain reachable |
| AT-10 | AI-03, SEC-11 | Shared limit holds across simultaneous Vercel invocations; excess work returns 429 without an LLM call; retry/deadline bounds hold; terminated invocation expires and late output is rejected; core flows remain available |
| AT-11 | SEC-05, SEC-08 | Malicious review/report instructions cannot obtain secrets, invoke actions or render executable markup; invalid output/source IDs fail safely |
| AT-12 | SEC-07, SEC-12 | No secrets in repo, logs or browser bundle; workflow handoffs and agent permissions reviewed |
| AT-13 | Sections 9–10 | Documented workload meets targets; development cannot access production storage; app is online and restore/rollback evidence exists |
| AT-14 | Course constraints | Role ownership, workflow artifacts, guides, reflection, reviewed logs, GitHub Pages website and current master branch are present |
| AT-15 | FR-10, if selected | Watchlist add/remove idempotent; another User cannot access private entries |
| AT-16 | FR-06 | Restore does not undo author deletion; unsuspension permits new login without reviving revoked sessions; historical Decision preserved |
| AT-17 | Stack, DEP-06 | Next.js API reaches SoC LLM from Vercel with synthetic data; pooled database access works under concurrency; deployed AI function duration is verified |
| AT-18 | Supabase/Next.js controls | Direct Supabase API cannot bypass app permissions; no database secrets in client assets; private caches do not leak between Users; Preview cannot read production data |
| AT-19 | Free-tier operations | Deployment from the actual team repository succeeds within Hobby eligibility; two Supabase projects fit existing allocation; backup export/restore and paused-project recovery are documented |

Security fixtures must include "ignore previous instructions" in reviews, forged system-message delimiters, requests for credentials/private reports, fabricated source IDs, HTML/script payloads, malicious report explanations, attempts to bypass human moderation and quota flooding. Cover both User and Admin AI contexts.

For each release, record test command, source revision, environment, pass/fail result and evidence path. Track requirement → implementation task → automated/manual test → result. Mark unimplemented, untested and deferred items explicitly; do not present this starting specification as evidence of implementation.
