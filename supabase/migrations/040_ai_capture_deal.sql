-- ============================================================
-- 040_ai_capture_deal.sql — create a pipeline deal on lead
-- qualification
--
-- When AI lead capture fills the last target field, a deal is
-- created for the contact in this stage (the stage implies the
-- pipeline). Null = feature off. One deal per contact — contacts
-- that already have a deal are skipped (capture.ts).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS capture_deal_stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL;
