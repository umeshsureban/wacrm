-- ============================================================
-- 041_ai_capture_visit.sql — auto-move the deal when a site
-- visit is booked
--
-- `capture_visit_field_id`: the custom field that holds the agreed
-- visit slot. When lead capture fills it (any pass — even after the
-- AI handed the thread to a human), the contact's open deal is moved
-- to `capture_visit_stage_id` and the slot is appended to the deal
-- notes (capture.ts). Both null = feature off.
--
-- Also from this version, `capture_fields` jsonb entries may carry
-- `"optional": true` — optional fields are extracted when mentioned
-- but never gate the qualification-complete reply/deal.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS capture_visit_field_id uuid REFERENCES custom_fields(id) ON DELETE SET NULL;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS capture_visit_stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL;
