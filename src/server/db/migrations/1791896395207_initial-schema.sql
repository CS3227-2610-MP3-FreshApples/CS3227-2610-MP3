-- Initial application schema: every entity in spec/data-model.md except the optional WatchlistEntry (D-34).
--
-- Everything lives in schema `app` and every name is schema-qualified (D-27); nothing is created in `public`.
-- The migration runner creates `app` and keeps node-pg-migrate's bookkeeping table there.
--
-- Conventions (D-33): uuid ids defaulting to gen_random_uuid(); timestamptz (UTC); closed vocabularies are text
-- with CHECKs, not enum types; numeric ranges and array cardinality are CHECKs. Every foreign key is ON DELETE
-- RESTRICT, so evidence-bearing records cannot be hard-deleted from under their references.
--
-- Text length limits are deliberately absent. They count Unicode code points after trimming, which the owning
-- services' zod schemas enforce (D-22, D-33). SQL char_length() counts code points but cannot apply the
-- trimming rule, and the same limits enforced in two places would drift. The same applies to the per-element
-- lengths of movie genres (1-40) and cast names (1-100).
--
-- Roles are provisioned outside migrations (D-31). `app_runtime`, `anon` and `authenticated` must already exist,
-- or the GRANT/REVOKE statements below fail and the whole migration rolls back. No login role or password is
-- created here; see docs/DeveloperGuide.md for the operator step.
--
-- Irreversible by design: there is no down section. Roll back by restoring the pre-migration backup (DEP-03).

-- Up Migration

CREATE TABLE app.account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  strike_cycle integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_normalized_email_key UNIQUE (normalized_email),
  CONSTRAINT account_role_check CHECK (role IN ('USER', 'ADMIN')),
  CONSTRAINT account_status_check CHECK (status IN ('active', 'suspended')),
  CONSTRAINT account_strike_cycle_check CHECK (strike_cycle >= 0),
  CONSTRAINT account_version_check CHECK (version >= 1)
);

-- Stores only a hash of the session secret (SEC-03).
CREATE TABLE app.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hashed_token bytea NOT NULL,
  account_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_hashed_token_key UNIQUE (hashed_token),
  CONSTRAINT session_account_id_fkey FOREIGN KEY (account_id) REFERENCES app.account (id) ON DELETE RESTRICT
);

-- "cast" is a reserved word and must stay double-quoted in every statement.
CREATE TABLE app.movie (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  synopsis text NOT NULL,
  release_date date,
  genres text[] NOT NULL DEFAULT '{}',
  director text NOT NULL,
  "cast" text[] NOT NULL DEFAULT '{}',
  runtime_minutes integer,
  archived_at timestamptz,
  reviews_revision integer NOT NULL DEFAULT 0,
  summary_pending_since timestamptz,
  summary_next_attempt_at timestamptz,
  summary_last_attempt_at timestamptz,
  summary_last_success_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movie_genres_check CHECK (cardinality(genres) <= 10),
  CONSTRAINT movie_cast_check CHECK (cardinality("cast") <= 30),
  CONSTRAINT movie_runtime_minutes_check CHECK (runtime_minutes BETWEEN 1 AND 1000),
  CONSTRAINT movie_reviews_revision_check CHECK (reviews_revision >= 0),
  CONSTRAINT movie_version_check CHECK (version >= 1)
);

CREATE TABLE app.review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id uuid NOT NULL,
  author_id uuid NOT NULL,
  rating integer NOT NULL,
  body text NOT NULL,
  deleted_at timestamptz,
  hidden_at timestamptz,
  moderation_state text NOT NULL,
  content_revision integer NOT NULL DEFAULT 1,
  clearance_source text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_movie_id_fkey FOREIGN KEY (movie_id) REFERENCES app.movie (id) ON DELETE RESTRICT,
  CONSTRAINT review_author_id_fkey FOREIGN KEY (author_id) REFERENCES app.account (id) ON DELETE RESTRICT,
  CONSTRAINT review_movie_id_author_id_key UNIQUE (movie_id, author_id),
  CONSTRAINT review_rating_check CHECK (rating BETWEEN 1 AND 10),
  CONSTRAINT review_moderation_state_check CHECK (moderation_state IN ('pending', 'flagged', 'cleared')),
  CONSTRAINT review_content_revision_check CHECK (content_revision >= 1),
  CONSTRAINT review_clearance_source_check CHECK (clearance_source IN ('ai', 'admin')),
  CONSTRAINT review_version_check CHECK (version >= 1)
);

CREATE TABLE app.report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  review_id uuid NOT NULL,
  category text NOT NULL,
  explanation text NOT NULL,
  evidence_snapshot jsonb NOT NULL,
  evidence_version integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES app.account (id) ON DELETE RESTRICT,
  CONSTRAINT report_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES app.account (id) ON DELETE RESTRICT,
  CONSTRAINT report_review_id_fkey FOREIGN KEY (review_id) REFERENCES app.review (id) ON DELETE RESTRICT,
  CONSTRAINT report_category_check CHECK (category IN ('profanity', 'harassment', 'hate', 'spam', 'other')),
  CONSTRAINT report_evidence_version_check CHECK (evidence_version >= 1),
  CONSTRAINT report_status_check CHECK (status IN ('open', 'dismissed', 'accepted')),
  CONSTRAINT report_version_check CHECK (version >= 1)
);

CREATE TABLE app.moderation_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  admin_id uuid NOT NULL,
  disposition text NOT NULL,
  actions text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_decision_report_id_fkey FOREIGN KEY (report_id) REFERENCES app.report (id) ON DELETE RESTRICT,
  CONSTRAINT moderation_decision_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES app.account (id) ON DELETE RESTRICT,
  CONSTRAINT moderation_decision_report_id_key UNIQUE (report_id),
  CONSTRAINT moderation_decision_disposition_check CHECK (disposition IN ('accepted', 'dismissed')),
  CONSTRAINT moderation_decision_actions_check CHECK (actions <@ ARRAY['hide_review']::text[]),
  CONSTRAINT moderation_decision_dismissed_actions_check CHECK (disposition <> 'dismissed' OR cardinality(actions) = 0)
);

CREATE TABLE app.announcement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  movie_id uuid,
  state text NOT NULL,
  published_at timestamptz,
  author_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_movie_id_fkey FOREIGN KEY (movie_id) REFERENCES app.movie (id) ON DELETE RESTRICT,
  CONSTRAINT announcement_author_id_fkey FOREIGN KEY (author_id) REFERENCES app.account (id) ON DELETE RESTRICT,
  CONSTRAINT announcement_state_check CHECK (state IN ('draft', 'published', 'deleted')),
  CONSTRAINT announcement_version_check CHECK (version >= 1)
);

-- subject_id is polymorphic (a Movie or a Review) and has no foreign key (D-33). policy_version is null for
-- summary jobs; bounded_input_snapshot is cleared by retention; error_code is set only on failure.
CREATE TABLE app.ai_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  trigger text NOT NULL,
  requester_id uuid,
  subject_id uuid NOT NULL,
  input_revision integer NOT NULL,
  dedup_key text NOT NULL,
  status text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_until timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  model_id text NOT NULL,
  prompt_version text NOT NULL,
  policy_version text,
  input_hash text NOT NULL,
  bounded_input_snapshot jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_job_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES app.account (id) ON DELETE RESTRICT,
  CONSTRAINT ai_job_type_check CHECK (type IN ('summary', 'review_moderation')),
  CONSTRAINT ai_job_trigger_check CHECK (trigger IN ('scheduler', 'review_write')),
  CONSTRAINT ai_job_input_revision_check CHECK (input_revision >= 0),
  CONSTRAINT ai_job_status_check CHECK (status IN ('running', 'succeeded', 'failed', 'stale')),
  CONSTRAINT ai_job_attempt_count_check CHECK (attempt_count >= 0)
);

CREATE TABLE app.review_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  movie_id uuid NOT NULL,
  reviews_revision integer NOT NULL,
  sampled_review_ids_and_versions jsonb NOT NULL,
  eligible_count integer NOT NULL,
  output_json jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  CONSTRAINT review_summary_job_id_fkey FOREIGN KEY (job_id) REFERENCES app.ai_job (id) ON DELETE RESTRICT,
  CONSTRAINT review_summary_movie_id_fkey FOREIGN KEY (movie_id) REFERENCES app.movie (id) ON DELETE RESTRICT,
  CONSTRAINT review_summary_job_id_key UNIQUE (job_id),
  CONSTRAINT review_summary_reviews_revision_check CHECK (reviews_revision >= 0),
  CONSTRAINT review_summary_eligible_count_check CHECK (eligible_count >= 0)
);

CREATE TABLE app.review_moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  review_id uuid NOT NULL,
  content_revision integer NOT NULL,
  captured_review_version integer NOT NULL,
  model_id text NOT NULL,
  prompt_version text NOT NULL,
  policy_version text NOT NULL,
  output_json jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  CONSTRAINT review_moderation_job_id_fkey FOREIGN KEY (job_id) REFERENCES app.ai_job (id) ON DELETE RESTRICT,
  CONSTRAINT review_moderation_review_id_fkey FOREIGN KEY (review_id) REFERENCES app.review (id) ON DELETE RESTRICT,
  CONSTRAINT review_moderation_job_id_key UNIQUE (job_id),
  CONSTRAINT review_moderation_content_revision_check CHECK (content_revision >= 1),
  CONSTRAINT review_moderation_captured_review_version_check CHECK (captured_review_version >= 1)
);

-- model_id is null until first dispatch when no model is configured; NULLS NOT DISTINCT keeps such work unique.
CREATE TABLE app.moderation_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL,
  content_revision integer NOT NULL,
  model_id text,
  prompt_version text NOT NULL,
  policy_version text NOT NULL,
  status text NOT NULL,
  execution_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_work_review_id_fkey FOREIGN KEY (review_id) REFERENCES app.review (id) ON DELETE RESTRICT,
  CONSTRAINT moderation_work_revision_key
    UNIQUE NULLS NOT DISTINCT (review_id, content_revision, model_id, prompt_version, policy_version),
  CONSTRAINT moderation_work_content_revision_check CHECK (content_revision >= 1),
  CONSTRAINT moderation_work_status_check CHECK (
    status IN ('pending', 'running', 'completed', 'needs_manual_review', 'superseded', 'cancelled')
  ),
  CONSTRAINT moderation_work_execution_count_check CHECK (execution_count >= 0)
);

-- target/review uniqueness spans every strike cycle, so one incident can never be penalized twice (D-05).
CREATE TABLE app.moderation_strike (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  review_id uuid NOT NULL,
  accepted_report_id uuid NOT NULL,
  strike_cycle integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_strike_target_user_id_fkey
    FOREIGN KEY (target_user_id) REFERENCES app.account (id) ON DELETE RESTRICT,
  CONSTRAINT moderation_strike_review_id_fkey FOREIGN KEY (review_id) REFERENCES app.review (id) ON DELETE RESTRICT,
  CONSTRAINT moderation_strike_accepted_report_id_fkey
    FOREIGN KEY (accepted_report_id) REFERENCES app.report (id) ON DELETE RESTRICT,
  CONSTRAINT moderation_strike_target_user_id_review_id_key UNIQUE (target_user_id, review_id),
  CONSTRAINT moderation_strike_accepted_report_id_key UNIQUE (accepted_report_id),
  CONSTRAINT moderation_strike_strike_cycle_check CHECK (strike_cycle >= 0)
);

CREATE TABLE app.scheduler_lease (
  name text PRIMARY KEY,
  lease_token uuid NOT NULL,
  lease_until timestamptz NOT NULL
);

-- bucket_key never holds a raw email or IP, only an HMAC of it (D-12).
CREATE TABLE app.rate_limit_window (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  CONSTRAINT rate_limit_window_pkey PRIMARY KEY (bucket_key, window_start),
  CONSTRAINT rate_limit_window_count_check CHECK (count >= 0)
);

CREATE TABLE app.ai_budget_day (
  budget_day date PRIMARY KEY,
  budget_microdollars bigint NOT NULL,
  reserved_microdollars bigint NOT NULL DEFAULT 0,
  consumed_microdollars bigint NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT ai_budget_day_budget_microdollars_check CHECK (budget_microdollars > 0),
  CONSTRAINT ai_budget_day_reserved_microdollars_check CHECK (reserved_microdollars >= 0),
  CONSTRAINT ai_budget_day_consumed_microdollars_check CHECK (consumed_microdollars >= 0),
  CONSTRAINT ai_budget_day_within_budget_check
    CHECK (reserved_microdollars + consumed_microdollars <= budget_microdollars),
  CONSTRAINT ai_budget_day_version_check CHECK (version >= 1)
);

-- actual_microdollars null means unknown usage, charged conservatively at the reserved amount (D-13).
CREATE TABLE app.ai_budget_reservation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_job_id uuid NOT NULL,
  budget_day date NOT NULL,
  reserved_microdollars bigint NOT NULL,
  input_tokens integer,
  output_tokens integer,
  actual_microdollars bigint,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  CONSTRAINT ai_budget_reservation_ai_job_id_fkey FOREIGN KEY (ai_job_id) REFERENCES app.ai_job (id) ON DELETE RESTRICT,
  CONSTRAINT ai_budget_reservation_budget_day_fkey
    FOREIGN KEY (budget_day) REFERENCES app.ai_budget_day (budget_day) ON DELETE RESTRICT,
  CONSTRAINT ai_budget_reservation_ai_job_id_key UNIQUE (ai_job_id),
  CONSTRAINT ai_budget_reservation_reserved_microdollars_check CHECK (reserved_microdollars > 0),
  CONSTRAINT ai_budget_reservation_input_tokens_check CHECK (input_tokens >= 0),
  CONSTRAINT ai_budget_reservation_output_tokens_check CHECK (output_tokens >= 0),
  CONSTRAINT ai_budget_reservation_actual_microdollars_check CHECK (actual_microdollars >= 0),
  CONSTRAINT ai_budget_reservation_status_check CHECK (status IN ('reserved', 'reconciled', 'released'))
);

-- Append-only for the runtime role (no UPDATE or DELETE grant). target_id is polymorphic with no foreign key;
-- action and target_type are open vocabularies (D-33). actor_id is null for system actions.
CREATE TABLE app.audit_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  result text NOT NULL,
  before_after_metadata jsonb NOT NULL DEFAULT '{}',
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_entry_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES app.account (id) ON DELETE RESTRICT,
  CONSTRAINT audit_entry_result_check CHECK (result IN ('applied', 'no_op'))
);

-- Indexes (data-model.md "Indexes"). Account normalized email, ModerationWork revision uniqueness, lifetime
-- ModerationStrike target/review uniqueness and the AIJob, ReviewSummary and ReviewModeration job keys are
-- the unique constraints above.

CREATE INDEX movie_archived_at_title_idx ON app.movie (archived_at, title, id);
CREATE INDEX movie_archived_at_release_date_idx ON app.movie (archived_at, release_date, id);
CREATE INDEX movie_summary_pending_idx ON app.movie (summary_pending_since, summary_next_attempt_at);

CREATE INDEX review_movie_visibility_idx ON app.review (movie_id, deleted_at, hidden_at, moderation_state, created_at);
CREATE INDEX review_author_id_created_at_idx ON app.review (author_id, created_at);

CREATE INDEX moderation_work_status_next_attempt_at_idx ON app.moderation_work (status, next_attempt_at);

CREATE INDEX report_status_created_at_idx ON app.report (status, created_at);
CREATE INDEX report_target_user_id_created_at_idx ON app.report (target_user_id, created_at);
CREATE INDEX report_reporter_id_created_at_idx ON app.report (reporter_id, created_at);
CREATE UNIQUE INDEX report_open_reporter_id_review_id_key ON app.report (reporter_id, review_id)
  WHERE status = 'open';

CREATE INDEX moderation_strike_target_user_id_strike_cycle_idx ON app.moderation_strike (target_user_id, strike_cycle);

CREATE INDEX announcement_state_published_at_idx ON app.announcement (state, published_at);

CREATE INDEX ai_job_status_lease_until_idx ON app.ai_job (status, lease_until);
CREATE UNIQUE INDEX ai_job_running_dedup_key_key ON app.ai_job (dedup_key) WHERE status = 'running';

CREATE INDEX audit_entry_target_created_at_idx ON app.audit_entry (target_type, target_id, created_at);

CREATE INDEX rate_limit_window_window_start_idx ON app.rate_limit_window (window_start);

CREATE INDEX ai_budget_reservation_budget_day_status_idx ON app.ai_budget_reservation (budget_day, status);

-- Privileges (D-27, D-32). Revoke everything first, including on node-pg-migrate's bookkeeping table and its
-- sequence, then grant app_runtime exactly the table DML listed in data-model.md "Runtime privileges". No
-- default privileges are used: every later migration that adds a table grants its privileges explicitly.

REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated, app_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC, anon, authenticated, app_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC, anon, authenticated, app_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated, app_runtime;

GRANT USAGE ON SCHEMA app TO app_runtime;

GRANT SELECT, INSERT, UPDATE ON
  app.account,
  app.movie,
  app.review,
  app.report,
  app.announcement,
  app.ai_job,
  app.moderation_work,
  app.scheduler_lease,
  app.ai_budget_day,
  app.ai_budget_reservation
TO app_runtime;

GRANT SELECT, INSERT, DELETE ON app.session TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.rate_limit_window TO app_runtime;

GRANT SELECT, INSERT ON
  app.moderation_decision,
  app.review_summary,
  app.review_moderation,
  app.moderation_strike,
  app.audit_entry
TO app_runtime;
