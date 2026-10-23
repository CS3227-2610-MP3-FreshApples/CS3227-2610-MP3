-- Permit provenance for explicit Admin summary requests while preserving the existing trigger values.

-- Up Migration

ALTER TABLE app.ai_job DROP CONSTRAINT ai_job_trigger_check;
ALTER TABLE app.ai_job ADD CONSTRAINT ai_job_trigger_check
  CHECK (trigger IN ('scheduler', 'review_write', 'admin_request'));

-- Down Migration

ALTER TABLE app.ai_job DROP CONSTRAINT ai_job_trigger_check;
ALTER TABLE app.ai_job ADD CONSTRAINT ai_job_trigger_check
  CHECK (trigger IN ('scheduler', 'review_write'));
