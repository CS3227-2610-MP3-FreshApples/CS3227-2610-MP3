# Project Specification — Data Model

## 7. Data Model

Use PostgreSQL hosted in Supabase, with separate development and production projects and versioned migrations. Supabase is used as a database host; its Auth/Storage/Realtime services are outside the initial selection. IDs are opaque UUIDs; timestamps are UTC; release_date is a calendar date. Mutable records have integer version fields for optimistic concurrency. Text is stored as plain text, never trusted HTML. Character limits count Unicode code points after trimming.

| Entity | Principal fields and constraints |
| --- | --- |
| Account | id, normalized_email (unique, max 254), password_hash, display_name (1–60), role USER/ADMIN, status active/suspended, strike_cycle (integer, initially 0), version, timestamps |
| Session | hashed_token (unique), account_id FK, expires_at, created_at; store no plaintext session secret |
| Movie | id, title (1–200), synopsis (1–5,000), release_date nullable, genres (≤10 strings, each 1–40), director (≤200), cast (≤30 names, each 1–100), runtime_minutes nullable integer 1–1,000, archived_at nullable, reviews_revision, summary_pending_since nullable, summary_next_attempt_at nullable, summary_last_attempt_at nullable, summary_last_success_at nullable, version, timestamps |
| Review | id, movie_id FK, author_id FK, rating integer 1–10, body (10–2,000), deleted_at nullable, hidden_at nullable, moderation_state pending/flagged/cleared, content_revision, clearance_source ai/admin nullable, version, timestamps; unique(movie_id, author_id) |
| Report | id, reporter_id FK, target_user_id FK, review_id FK, category, explanation (10–1,000), evidence_snapshot, evidence_version, status open/dismissed/accepted, version, timestamps |
| ModerationDecision | id, report_id FK unique, admin_id FK, disposition, actions array, reason (10–1,000), created_at |
| Announcement | id, title (1–200), body (1–5,000), movie_id FK nullable, state draft/published/deleted, published_at nullable, author_id FK, version, timestamps |
| AIJob | id, type summary/review_moderation, trigger scheduler/review_write, requester_id FK nullable (null for scheduler), subject_id, input_revision, dedup_key, status, attempt_count, lease_until, expires_at, model_id, prompt_version, policy_version, input_hash, bounded_input_snapshot, error_code, timestamps |
| ReviewSummary | id, job_id FK unique, movie_id FK, reviews_revision, sampled_review_ids_and_versions, eligible_count, output_json, generated_at; valid until source invalidation, not daily expiry |
| ReviewModeration | id, job_id FK unique, review_id FK, content_revision, captured_review_version, model/prompt/policy versions, output_json, generated_at |
| ModerationWork | id, review_id FK, content_revision, model/prompt/policy versions, status pending/running/completed/needs_manual_review/superseded, execution_count, next_attempt_at, last_attempt_at, timestamps; unique(review_id, content_revision, model_id, prompt_version, policy_version) |
| ModerationStrike | id, target_user_id FK, review_id FK, accepted_report_id FK unique, strike_cycle, created_at; unique(target_user_id, review_id) across all cycles |
| SchedulerLease | name primary key, lease_token, lease_until; guarded acquisition/release for summary sweep |
| AuditEntry | id, actor_id nullable, action, target_type, target_id, before_after_metadata, request_id, created_at |
| WatchlistEntry (optional) | user_id FK, movie_id FK, created_at; composite primary key(user_id, movie_id) |

An eligible public Review is cleared for its current content_revision, has neither deleted_at nor hidden_at and belongs to an active Movie. Hidden and deleted flags are independent: restoring a hidden Review does not undo its author's deletion.

Report evidence_snapshot stores review ID/version, author ID, Movie ID/title, body and rating as observed at submission. It is immutable and private. Report authorship/target consistency must be checked in the submission transaction. A partial unique index prevents duplicate open reports for (reporter_id, review_id).

Use foreign keys with restricted hard deletion for evidence-bearing records. Initial release has no public hard account deletion; final retention/purge design remains a release question. Soft deletion must not expose records through list, search, aggregate or AI endpoints.

Increment Movie.reviews_revision for eligible review creation, edit, deletion, hide/restore and Movie archive/restore in the same transaction; set summary_pending_since if absent, preserving oldest pending time. No-op mutations do not advance it. Publication checks the captured revision and clears pending state only for that exact revision. Inactive Movies are skipped; restored Movies become pending.

ReviewModeration captures content_revision, Review.version at dispatch and model/prompt/policy versions. Increment content_revision on body edits/resubmission; atomically reset clearance to pending and create ModerationWork. Row version also advances on rating, visibility or clearance changes. Completion requires matching content and row versions and lease; never overwrite a human decision. Rating-only edits retain existing clearance; stale pending checks remain eligible for recovery. Approval/automatic clearance and changes in public eligibility update Movie revisions and audit atomically. ModerationStrike creation and Report closure still lock the target Account and apply threshold suspension atomically. Only a suspended-to-active reinstatement advances strike_cycle; same-status updates never do. Manual suspension/reinstatement shares the account lock and audited transaction with report-based status changes. Lifetime incident uniqueness remains enforced.

AI jobs record scheduler/review-write executions with running, succeeded, failed or stale status. Pending Movie markers are durable scheduling state, not running jobs. Atomically reserve capacity and create a running job with unique active dedup key and lease. Publish only with a valid lease and matching input version. Later access/sweeps expire abandoned jobs; subsequent sweeps retry pending summaries and ModerationWork automatically with backoff and AI-02 execution limits. Unique results and guarded transitions reject duplicate/late writes. Release capacity on completion/expiry and conservatively retain unknown usage charges.

Indexes: normalized email; Movie archive/title/release date and pending/next-attempt; Review movie/visibility/moderation-state/time and author/time; ModerationWork status/next-attempt and revision uniqueness; Report status/time, target/time and partial open uniqueness; ModerationStrike target/cycle and lifetime target/review uniqueness; Announcement state/publication; AIJob status/lease_until and dedup; AuditEntry target/time.

Aggregate rating is computed from all eligible Reviews, not the AI sample. Round to one decimal for display only and label the result out of 10. Queries must consistently apply visibility predicates; denormalized counters are optional only with transactional maintenance and reconciliation tests.

Retention proposal: succeeded-job input snapshots expire after 7 days; superseded generated output/provenance after 30 days (retain current valid summaries and their minimal provenance); moderation snapshots and audit records after 90 days following report closure. Records required by open Reports remain retained. These are provisional project defaults pending course/provider/privacy review, not claims of legal compliance. Cleanup must invalidate derived results and respect references.

Strike-ledger identifiers and cycle membership must remain while the account exists so retention cannot reset counts or permit duplicate penalties. Purge old report text only under an approved retention process that preserves referenced decision/incident metadata. Generic job cleanup must not cascade-delete a current summary or its provenance.

Keep active ModerationWork until completed, superseded or explicitly resolved by an Admin. Preserve minimal current clearance provenance independently of expiring job payloads; cleanup cannot publish held content or erase unresolved work. Pending new content does not change public aggregates until cleared; edits removing previously published content invalidate summaries immediately.
