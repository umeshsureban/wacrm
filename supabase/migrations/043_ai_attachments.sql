-- ============================================================
-- 043_ai_attachments.sql — AI attachment library
--
-- Files (PDFs / images) the AI auto-reply agent may send to a
-- customer alongside its text reply. Admins upload each file to the
-- existing public `chat-media` bucket (migration 023 — Meta fetches
-- send links unauthenticated, and its MIME allow-list already covers
-- application/pdf + png/jpeg/webp) and describe WHEN to send it; the
-- catalog is listed in the auto-reply system prompt and the model
-- requests a send with an inline `[[SEND:A1]]` marker.
--
-- RLS: settings-class, mirroring ai_knowledge_documents (030) — any
-- member may read, only admin+ may change. The auto-reply bot reads
-- the catalog under the service-role client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name         text NOT NULL,
  -- "Send when…" guidance shown to the model in the catalog listing.
  description  text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('image', 'document')),
  -- Public chat-media URL Meta fetches at send time.
  url          text NOT NULL,
  -- account-<id>/<ts>-<name>.<ext> inside the chat-media bucket, kept
  -- so DELETE can also remove the storage object.
  storage_path text NOT NULL,
  -- Document-only display filename on WhatsApp; null for images.
  filename     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_attachments_account_id_idx
  ON ai_attachments (account_id);

ALTER TABLE ai_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_attachments_select ON ai_attachments;
CREATE POLICY ai_attachments_select ON ai_attachments FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_attachments_insert ON ai_attachments;
CREATE POLICY ai_attachments_insert ON ai_attachments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_attachments_update ON ai_attachments;
CREATE POLICY ai_attachments_update ON ai_attachments FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_attachments_delete ON ai_attachments;
CREATE POLICY ai_attachments_delete ON ai_attachments FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_attachments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_attachments_updated_at ON ai_attachments;
CREATE TRIGGER ai_attachments_updated_at
  BEFORE UPDATE ON ai_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_attachments_updated_at();
