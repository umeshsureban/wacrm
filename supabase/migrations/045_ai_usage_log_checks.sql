-- ============================================================
-- 045_ai_usage_log_checks.sql — fix usage logging for Google +
-- lead capture
--
-- Migration 033 pinned ai_usage_log's provider CHECK to
-- openai/anthropic; 037 added 'google' to ai_configs but forgot this
-- table, so every usage insert from a Google-provider account failed
-- silently and the Usage tab stayed empty. Also widens `mode` for the
-- new lead-capture logging (capture.ts).
--
-- Postgres auto-names inline column CHECKs <table>_<column>_check.
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'google'));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'lead_capture'));
