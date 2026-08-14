-- ============================================================
-- 040_ai_provider_google.sql — allow Google as an AI provider
--
-- Adds 'google' (Gemini API — serves Gemini and Gemma models via an
-- OpenAI-compatible endpoint) to the ai_configs provider check that
-- migration 029 pinned to openai/anthropic. App-side counterpart:
-- src/lib/ai/providers/google.ts.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'google'));
