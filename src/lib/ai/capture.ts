import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig, CaptureBuiltinKey } from './types'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { generateReply } from './generate'
import { engineSendText } from '@/lib/flows/meta-send'

// ============================================================
// AI lead capture — extract customer-stated facts into contact
// fields. Pure prompt/parse helpers up top; `dispatchLeadCapture`
// wires them to the DB and the account's provider.
// ============================================================

export interface ResolvedTarget {
  /** Key the model must use in its JSON output. */
  jsonKey: string
  kind: 'builtin' | 'custom'
  builtinKey?: CaptureBuiltinKey
  customFieldId?: string
  label: string
  fieldType: string
  options: string[]
}

const BUILTIN_DESCRIPTION: Record<CaptureBuiltinKey, string> = {
  name: "the customer's own name (never the business's or the agent's)",
  email: "the customer's email address",
  company: "the customer's company or organization name",
}

/**
 * Strict data-extraction system prompt. The conversation itself is
 * passed as the normal message turns; this prompt defines the output
 * contract. Everything not explicitly stated by the customer must be
 * null — fill-empty-only semantics start with a conservative extractor.
 */
export function buildCapturePrompt(targets: ResolvedTarget[]): string {
  const fieldLines = targets.map((t) => {
    if (t.kind === 'builtin' && t.builtinKey) {
      return `- "${t.jsonKey}": ${BUILTIN_DESCRIPTION[t.builtinKey]}`
    }
    const opts =
      t.options.length > 0
        ? ` — must be exactly one of: ${t.options.join(', ')}`
        : ''
    return `- "${t.jsonKey}": the customer's ${t.label} (${t.fieldType})${opts}`
  })

  return [
    'You are a data-extraction engine for a WhatsApp CRM. You are shown a conversation between a business (assistant) and a customer (user).',
    'Extract ONLY facts the CUSTOMER explicitly stated about themselves or their requirements. Never infer, never guess, and never use information the business said.',
    'Return a single JSON object with exactly these keys:',
    fieldLines.join('\n'),
    'Rules: use null for anything the customer has not clearly stated; every value must be a short plain string; output ONLY the JSON object — no markdown fences, no commentary, no extra keys.',
  ].join('\n\n')
}

const MEANINGLESS = new Set([
  '',
  'null',
  'none',
  'unknown',
  'n/a',
  'na',
  'not provided',
  'not mentioned',
  'not stated',
])
const MAX_VALUE_LENGTH = 500

/**
 * Defensive parse of the model's output into clean string values.
 * Tolerates markdown fences and surrounding prose; drops nulls,
 * placeholder strings, and non-scalar values. Never throws.
 */
export function parseCaptureJson(raw: string): Record<string, string> {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    let str: string | null = null
    if (typeof value === 'string') str = value.trim()
    else if (typeof value === 'number' && Number.isFinite(value)) str = String(value)
    if (str === null || MEANINGLESS.has(str.toLowerCase())) continue
    out[key] = str.slice(0, MAX_VALUE_LENGTH)
  }
  return out
}

interface DispatchCaptureArgs {
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner — audit columns on the
   *  qualification-complete send (same role as in the auto-reply
   *  dispatch). */
  configOwnerUserId: string
}

/**
 * Extract customer-stated facts from the conversation into empty
 * contact fields. Invoked from the webhook's `after()` block for every
 * inbound text message — independent of auto-reply, so capture works on
 * human-handled threads too. Mirrors `dispatchInboundToAiReply`'s
 * contract: owns its try/catch and NEVER throws.
 *
 * Fill-empty-only: only fields that are currently empty are targeted
 * (and therefore ever written); when nothing is empty, no AI call is
 * made at all, so a fully-qualified lead costs nothing per message.
 */
export async function dispatchLeadCapture(args: DispatchCaptureArgs): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.captureEnabled || config.captureFields.length === 0) return

    // ---- Resolve targets and find which are still empty ----
    const builtinTargets = config.captureFields.filter(
      (f): f is { kind: 'builtin'; key: CaptureBuiltinKey } => f.kind === 'builtin',
    )
    const customTargets = config.captureFields.filter(
      (f): f is { kind: 'custom'; id: string } => f.kind === 'custom',
    )

    const { data: contact, error: contactErr } = await db
      .from('contacts')
      .select('name, email, company')
      .eq('id', contactId)
      .maybeSingle()
    if (contactErr || !contact) return

    const emptyTargets: ResolvedTarget[] = []
    const usedKeys = new Set<string>()

    for (const t of builtinTargets) {
      const current = (contact as Record<string, unknown>)[t.key]
      if (typeof current === 'string' && current.trim()) continue
      emptyTargets.push({
        jsonKey: t.key,
        kind: 'builtin',
        builtinKey: t.key,
        label: t.key,
        fieldType: 'text',
        options: [],
      })
      usedKeys.add(t.key)
    }

    if (customTargets.length > 0) {
      const ids = customTargets.map((t) => t.id)
      const { data: defs } = await db
        .from('custom_fields')
        .select('id, field_name, field_type, field_options')
        .eq('account_id', accountId)
        .in('id', ids)
      const { data: existing } = await db
        .from('contact_custom_values')
        .select('custom_field_id, value')
        .eq('contact_id', contactId)
        .in('custom_field_id', ids)
      const filled = new Set(
        (existing ?? [])
          .filter((v) => typeof v.value === 'string' && v.value.trim())
          .map((v) => v.custom_field_id),
      )
      for (const def of defs ?? []) {
        if (filled.has(def.id)) continue
        // De-dupe JSON keys against builtins and other custom fields.
        let key = String(def.field_name ?? '').trim()
        if (!key) continue
        if (usedKeys.has(key)) key = `${key} (${def.id.slice(0, 4)})`
        usedKeys.add(key)
        const rawOptions = (def.field_options as { options?: unknown } | null)?.options
        emptyTargets.push({
          jsonKey: key,
          kind: 'custom',
          customFieldId: def.id,
          label: String(def.field_name),
          fieldType: String(def.field_type ?? 'text'),
          options: Array.isArray(rawOptions) ? rawOptions.map(String) : [],
        })
      }
    }

    if (emptyTargets.length === 0) return // fully qualified — free

    // ---- One extraction call ----
    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    const { text } = await generateReply({
      config,
      systemPrompt: buildCapturePrompt(emptyTargets),
      messages,
    })
    const values = parseCaptureJson(text)
    if (Object.keys(values).length === 0) return

    // ---- Write, empty targets only ----
    const contactUpdate: Record<string, string> = {}
    const customRows: { contact_id: string; custom_field_id: string; value: string }[] = []
    for (const t of emptyTargets) {
      const value = values[t.jsonKey]
      if (!value) continue
      if (t.kind === 'builtin' && t.builtinKey) contactUpdate[t.builtinKey] = value
      if (t.kind === 'custom' && t.customFieldId) {
        customRows.push({ contact_id: contactId, custom_field_id: t.customFieldId, value })
      }
    }

    if (Object.keys(contactUpdate).length > 0) {
      await db.from('contacts').update(contactUpdate).eq('id', contactId)
    }
    if (customRows.length > 0) {
      await db
        .from('contact_custom_values')
        .upsert(customRows, { onConflict: 'contact_id,custom_field_id' })
    }

    // ---- Qualification-complete reply ----
    // Fires only on the transition: this pass had empty targets and the
    // extraction just filled every one of them. Contacts that were fully
    // qualified before the feature shipped never trip this (they exit at
    // the `emptyTargets.length === 0` early-return above).
    const remaining = emptyTargets.filter((t) => !values[t.jsonKey])
    if (remaining.length === 0 && config.captureCompleteReply) {
      await sendQualificationCompleteReply(db, {
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        config,
      })
    }
  } catch (err) {
    console.error('[ai lead-capture] dispatch failed:', err)
  }
}

/**
 * Send the account's "we have your details" acknowledgment once, then
 * pause the AI on this conversation and hand it to the team — the
 * message promises a human follow-up, so the bot must stop talking.
 *
 * Order matters for failure safety: claim → pause/handoff → send. If
 * the send throws after the claim, the thread is already routed to a
 * human who sees the qualified lead — we under-message rather than
 * risk the bot carrying on after promising a callback.
 */
async function sendQualificationCompleteReply(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    configOwnerUserId: string
    config: AiConfig
  },
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId, config } = args

  // Atomic send-once claim: only the winner of a concurrent-inbound race
  // gets rows back. The flag lives on the contact — qualification is a
  // property of the lead, not of one conversation.
  const { data: claimed, error: claimErr } = await db
    .from('contacts')
    .update({ ai_qualified_at: new Date().toISOString() })
    .eq('id', contactId)
    .is('ai_qualified_at', null)
    .select('id')
  if (claimErr) {
    console.error('[ai lead-capture] qualification claim failed:', claimErr)
    return
  }
  if (!claimed || claimed.length === 0) return // already sent / lost the race

  const { data: conv } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('id', conversationId)
    .maybeSingle()
  const assignedAgentId = conv?.assigned_agent_id ?? null

  // Pause + handoff, mirroring the auto-reply handoff block: sticky
  // until re-enabled, never stomps an existing human assignment.
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: '🤖 Lead qualified — all capture fields collected.',
  }
  if (config.handoffAgentId && !assignedAgentId) {
    update.assigned_agent_id = config.handoffAgentId
  }
  await db.from('conversations').update(update).eq('id', conversationId)

  // A human already owning the thread makes the canned "we'll reach
  // out" ack noise — skip the send, keep the pause.
  if (assignedAgentId) return

  await engineSendText({
    accountId,
    userId: configOwnerUserId,
    conversationId,
    contactId,
    text: config.captureCompleteReply!,
    aiGenerated: false,
  })
}
