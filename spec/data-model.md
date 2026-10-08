# Project Specification — Data Model

## 7. Data Model

Use PostgreSQL hosted in Supabase, with separate development and production projects and versioned migrations. Supabase is used as a database host; its Auth/Storage/Realtime services are outside the initial selection. IDs are opaque UUIDs; timestamps are UTC; release_date is a calendar date. Mutable records have integer version fields for optimistic concurrency. Text is stored as plain text, never trusted HTML. Character limits count Unicode code points after trimming.

| Entity | Principal fields and constraints |
| --- | --- |
| Account | id, normalized_email (unique, max 254), password_hash, display_name (1–60), role USER/ADMIN, status active/suspended, moderation_revision, version, timestamps |
| Session | hashed_token (unique), account_id FK, expires_at, created_at; store no plaintext session secret |
| Movie | id, title (1–200), synopsis (1–5,000), release_date nullable, genres (≤10 strings, each 1–40), director (≤200), cast (≤30 names, each 1–100), runtime_minutes nullable integer 1–1,000, archived_at nullable, reviews_revision, version, timestamps |
| Review | id, movie_id FK, author_id FK, rating integer 1–10, body (10–2,000), deleted_at nullable, hidden_at nullable, version, timestamps; unique(movie_id, author_id) |
| Report | id, reporter_id FK, target_user_id FK, review_id FK, category, explanation (10–1,000), evidence_snapshot, evidence_version, status open/dismissed/action_taken, version, timestamps |
| ModerationDecision | id, report_id FK unique, admin_id FK, disposition, actions array, reason (10–1,000), created_at |
| Announcement | id, title (1–200), body (1–5,000), movie_id FK nullable, state draft/published/deleted, published_at nullable, author_id FK, version, timestamps |
| AIJob | id, type summary/report_analysis, requester_id FK, subject_id, input_revision, dedup_key, status, attempt_count, lease_until, expires_at, model_id, prompt_version, policy_version, input_hash, bounded_input_snapshot, error_code, timestamps |
| ReviewSummary | id, job_id FK unique, movie_id FK, reviews_revision, sampled_review_ids_and_versions, eligible_count, output_json, generated_at, expires_at |
| ReportAnalysis | id, job_id FK unique, report_id FK, history_revision, source_ids_and_versions, output_json, generated_at |
| AuditEntry | id, actor_id nullable, action, target_type, target_id, before_after_metadata, request_id, created_at |
| WatchlistEntry (optional) | user_id FK, movie_id FK, created_at; composite primary key(user_id, movie_id) |

An eligible public Review has neither deleted_at nor hidden_at and belongs to an active Movie. Hidden and deleted flags are independent: restoring a hidden Review does not undo its author's deletion.

Report evidence_snapshot stores review ID/version, author ID, Movie ID/title, body and rating as observed at submission. It is immutable and private. Report authorship/target consistency must be checked in the submission transaction. A partial unique index prevents duplicate open reports for (reporter_id, review_id).

Use foreign keys with restricted hard deletion for evidence-bearing records. Initial release has no public hard account deletion; final retention/purge design remains a release question. Soft deletion must not expose records through list, search, aggregate or AI endpoints.

Increment Movie.reviews_revision in the same transaction for review creation, edit, deletion, hide/restore and Movie archive/restore. Summary publication compares its captured revision with the current value; mismatches become stale, never current.

Increment Account.moderation_revision when a new Report, final Decision, relevant Review mutation or account moderation change affects that User's analysis context. Report analysis captures this revision plus report version; compare both before publication and return stale if either changed.

AI jobs are request-driven execution records with running, succeeded, failed or stale status; there is no queued status or independent consumer. Insufficient reviews and insufficient capacity are preflight outcomes. Atomically reserve capacity and insert a running job with a unique active dedup key and lease expiry. Publish only while the job still holds its lease and its input revision matches. A function crash leaves a record that is marked failed/expired on the next status/read/create request; only an explicit later POST starts new work. A unique result per job and guarded terminal transitions prevent late/duplicate writes. Release concurrency capacity on completion or lease expiry; retain conservative provider usage charges when call usage is unknown.

Indexes: normalized email; Movie archive/title/release date; Review movie/visibility/time and author/time; Report status/time, target/time and partial open uniqueness; Announcement state/publication; AIJob status/lease_until and dedup; AuditEntry target/time.

Aggregate rating is computed from all eligible Reviews, not the AI sample. Round to one decimal for display only and label the result out of 10. Queries must consistently apply visibility predicates; denormalized counters are optional only with transactional maintenance and reconciliation tests.

Retention proposal: succeeded-job input snapshots expire after 7 days; generated output/provenance after 30 days; moderation snapshots and audit records after 90 days following report closure. Records required by open Reports remain retained. These are provisional project defaults pending course/provider/privacy review, not claims of legal compliance. Cleanup must invalidate derived results and respect references.
