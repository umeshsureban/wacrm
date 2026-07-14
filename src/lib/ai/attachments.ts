import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// AI attachment library: files (images / PDFs) the auto-reply agent
// may send alongside its text reply.
//
// The catalog is listed in the system prompt as `[A1] name — when to
// send it`; the model requests a send by appending `[[SEND:A1]]` to
// its reply (same inline-sentinel pattern as HANDOFF_SENTINEL).
// Keys are positional (`A1` = catalog[0]) and only meaningful within
// one generation: the same loaded array builds the prompt and
// resolves the reply, so a key can never reference a file the model
// wasn't offered — prompt-injected keys resolve against the
// account's own catalog or not at all.
// ============================================================

/** Prompt-size guard: how many library entries the model is offered. */
export const MAX_ATTACHMENT_CATALOG = 20

/** How many attachments one reply may send (extra keys are dropped). */
export const MAX_ATTACHMENTS_PER_REPLY = 2

export interface AiAttachment {
  id: string
  name: string
  description: string
  kind: 'image' | 'document'
  /** Public URL Meta fetches at send time. */
  url: string
  /** Document-only display filename on WhatsApp; null for images. */
  filename: string | null
}

/** Catalog key for position `i`: A1, A2, … */
export function attachmentKey(i: number): string {
  return `A${i + 1}`
}

/**
 * Load the account's attachment catalog, oldest first (so keys stay
 * stable as new files are added). Best-effort like `retrieveKnowledge`:
 * any failure logs and returns [] — an unreadable catalog must never
 * break the auto-reply path.
 */
export async function loadAttachmentCatalog(
  db: SupabaseClient,
  accountId: string,
): Promise<AiAttachment[]> {
  try {
    const { data, error } = await db
      .from('ai_attachments')
      .select('id, name, description, kind, url, filename')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(MAX_ATTACHMENT_CATALOG)
    if (error) {
      console.error('[ai attachments] catalog load failed:', error)
      return []
    }
    return (data ?? []) as AiAttachment[]
  } catch (err) {
    console.error('[ai attachments] catalog load failed:', err)
    return []
  }
}

/**
 * The system-prompt section offering the catalog to the model.
 * Caller only invokes this with a non-empty catalog.
 */
export function buildAttachmentCatalogSection(items: AiAttachment[]): string {
  const lines = items
    .map((a, i) => `[${attachmentKey(i)}] ${a.name} — ${a.description}`)
    .join('\n')
  return (
    'Attachment library — files you may send to the customer alongside your reply. ' +
    'Each entry is `[key] name — when to send it`:\n\n' +
    lines +
    '\n\n' +
    `To send one, append the marker [[SEND:A1]] (with the right key) on its own line at the end of your reply — at most ${MAX_ATTACHMENTS_PER_REPLY} markers. ` +
    'Only send an attachment when its description clearly matches what the customer needs or they explicitly ask for it. ' +
    'Never use a key that is not listed above. The markers are removed from the text the customer sees.'
  )
}

/** All accepted marker spellings: `[[SEND:A1]]`, `[[SEND: a1, A2 ]]`, … */
const SEND_MARKER_RE = /\[\[SEND:\s*([A-Za-z0-9,\s]*)\]\]/g

/**
 * Extract `[[SEND:…]]` markers from raw model output. Returns the text
 * with every marker stripped (they must never reach a customer, in any
 * mode) plus the requested keys, normalized to uppercase. Defensive
 * like `parseCaptureJson`: malformed markers are stripped and ignored,
 * never thrown on.
 */
export function parseAttachmentMarkers(raw: string): {
  text: string
  keys: string[]
} {
  const keys: string[] = []
  const text = raw
    .replace(SEND_MARKER_RE, (_m, inner: string) => {
      for (const part of inner.split(',')) {
        const key = part.trim().toUpperCase()
        if (key) keys.push(key)
      }
      return ''
    })
    .trim()
  return { text, keys }
}

/**
 * Resolve requested keys against the catalog the model was shown.
 * Unknown keys are dropped silently (a hallucinated or injected key is
 * not an error worth surfacing), duplicates collapse, and the result is
 * capped at MAX_ATTACHMENTS_PER_REPLY.
 */
export function resolveAttachmentKeys(
  keys: string[],
  catalog: AiAttachment[],
): AiAttachment[] {
  const picked = new Map<string, AiAttachment>() // id → item, dedupes
  for (const key of keys) {
    if (picked.size >= MAX_ATTACHMENTS_PER_REPLY) break
    const m = /^A(\d+)$/.exec(key)
    if (!m) continue
    const item = catalog[Number(m[1]) - 1]
    if (item) picked.set(item.id, item)
  }
  return Array.from(picked.values())
}
