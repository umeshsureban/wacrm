-- ============================================================
-- 039_ai_capture_complete_reply.sql — qualification-complete reply
-- + agent category presets
--
-- `capture_complete_reply`: message sent ONCE when lead capture fills
-- the last remaining target field (null = feature off). After sending,
-- the conversation is paused + handed off (capture.ts).
--
-- `agent_category`: id of the preset template the config was created
-- from (e.g. 'real_estate'); null = custom/hand-built. Informational —
-- behaviour is driven entirely by the concrete config columns.
--
-- `contacts.ai_qualified_at`: send-once guard for the completion
-- reply. Claimed atomically (UPDATE ... WHERE ai_qualified_at IS NULL)
-- so concurrent inbounds can never double-send.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS capture_complete_reply text;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS agent_category text;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ai_qualified_at timestamptz;
