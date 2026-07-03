-- ============================================================
-- 032_ai_lead_capture.sql — AI lead capture config
--
-- Lets the AI assistant extract facts the customer stated (name,
-- budget, etc.) into contact fields after each inbound message.
-- `capture_fields` is an array of targets:
--   {"kind":"builtin","key":"name"|"email"|"company"}
--   {"kind":"custom","id":"<custom_fields.id>"}
-- Fill-empty-only semantics are enforced app-side (capture.ts).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS capture_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS capture_fields jsonb NOT NULL DEFAULT '[]';
