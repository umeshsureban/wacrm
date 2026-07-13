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
  /** Optional fields are extracted when mentioned but never gate the
   *  qualification-complete reply/deal. */
  optional: boolean
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
      (f): f is { kind: 'builtin'; key: CaptureBuiltinKey; optional?: boolean } =>
        f.kind === 'builtin',
    )
    const customTargets = config.captureFields.filter(
      (f): f is { kind: 'custom'; id: string; optional?: boolean } => f.kind === 'custom',
    )
    const customOptional = new Map(customTargets.map((t) => [t.id, t.optional === true]))

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
        optional: t.optional === true,
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
          optional: customOptional.get(def.id) === true,
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

    // ---- Qualification complete ----
    // Fires only on the transition: this pass had empty REQUIRED targets
    // and the extraction just filled the last of them. Optional fields
    // (email, visit slot, …) keep capturing but never gate this.
    // Contacts fully qualified before the feature shipped never trip it
    // (they exit at the `emptyTargets.length === 0` early-return above,
    // and the ai_qualified_at claim guards the rest).
    const remaining = emptyTargets.filter((t) => !t.optional && !values[t.jsonKey])
    const requiredWereMissing = emptyTargets.some((t) => !t.optional)
    if (
      requiredWereMissing &&
      remaining.length === 0 &&
      (config.captureCompleteReply || config.captureDealStageId)
    ) {
      await handleQualificationComplete(db, {
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        config,
      })
    }

    // ---- Site visit booked ----
    // Runs after the completion block so a deal created this very pass
    // is moved too. Fires whenever capture fills the configured visit
    // field — including after handoff, from the customer's own words.
    if (config.captureVisitFieldId && config.captureVisitStageId) {
      const visitRow = customRows.find(
        (r) => r.custom_field_id === config.captureVisitFieldId,
      )
      if (visitRow) {
        try {
          await moveDealOnVisitBooked(db, {
            accountId,
            contactId,
            config,
            slot: visitRow.value,
          })
        } catch (err) {
          console.error('[ai lead-capture] visit-stage move failed:', err)
        }
      }
    }
  } catch (err) {
    console.error('[ai lead-capture] dispatch failed:', err)
  }
}

/**
 * The lead just became fully qualified: create its pipeline deal (when
 * a target stage is configured), then send the account's "we have your
 * details" acknowledgment and pause the AI on this conversation — the
 * message promises a human follow-up, so the bot must stop talking.
 *
 * Order matters for failure safety: claim → deal → pause/handoff →
 * send. The deal is best-effort (its failure never blocks the reply),
 * and if the send throws after the claim, the thread is already routed
 * to a human who sees the qualified lead — we under-message rather
 * than risk the bot carrying on after promising a callback.
 */
async function handleQualificationComplete(
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

  // Atomic once-only claim: only the winner of a concurrent-inbound race
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
  if (!claimed || claimed.length === 0) return // already handled / lost the race

  if (config.captureDealStageId) {
    try {
      await createQualificationDeal(db, args)
    } catch (err) {
      // Best-effort: a broken pipeline config must not cost the
      // customer their acknowledgment message.
      console.error('[ai lead-capture] deal creation failed:', err)
    }
  }

  if (!config.captureCompleteReply) return // deal-only config: stay silent

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
    text: config.captureCompleteReply,
    aiGenerated: false,
  })
}

/**
 * One deal per contact, in the configured stage, titled
 * "{name or phone} — {pipeline}" with the captured facts as notes.
 * Mirrors the automations engine's `create_deal` step (currency from
 * the account default) minus the LLM lead-scoring the old external
 * qualifier did — the team drags cards onward from the landing stage.
 */
async function createQualificationDeal(
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

  // Skip contacts that already have a deal (e.g. created manually or by
  // an automation) — never duplicate a card on the board.
  const { data: existingDeals } = await db
    .from('deals')
    .select('id')
    .eq('contact_id', contactId)
    .limit(1)
  if (existingDeals && existingDeals.length > 0) return

  // Resolve the stage → pipeline, scoped to the account (a stale id
  // after a pipeline was deleted/rebuilt just warns and skips).
  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id, pipeline_id, pipelines!inner(id, name, account_id)')
    .eq('id', config.captureDealStageId!)
    .maybeSingle()
  const pipeline = stage?.pipelines as
    | { id: string; name: string; account_id: string }
    | null
    | undefined
  if (!stage || !pipeline || pipeline.account_id !== accountId) {
    console.warn(
      `[ai lead-capture] configured deal stage ${config.captureDealStageId} not found for account ${accountId} — skipping deal.`,
    )
    return
  }

  const { data: contact } = await db
    .from('contacts')
    .select('name, phone')
    .eq('id', contactId)
    .maybeSingle()
  const who = contact?.name?.trim() || contact?.phone || 'Lead'

  const { data: acct } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', accountId)
    .maybeSingle()

  const notes = await buildDealNotes(db, accountId, contactId, config)

  const { error: insErr } = await db.from('deals').insert({
    account_id: accountId,
    user_id: configOwnerUserId,
    pipeline_id: pipeline.id,
    stage_id: stage.id,
    contact_id: contactId,
    conversation_id: conversationId,
    title: `${who} — ${pipeline.name}`,
    value: 0,
    currency: acct?.default_currency ?? 'USD',
    notes,
    status: 'open',
  })
  if (insErr) throw insErr
}

/**
 * The customer just agreed a site-visit slot: move their open deal to
 * the configured stage and stamp the slot into the deal notes. Only
 * moves an existing deal — if none exists yet (visit volunteered
 * before qualification), the deal will be created at qualification
 * with the slot already in its notes via `buildDealNotes`.
 */
async function moveDealOnVisitBooked(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    config: AiConfig
    slot: string
  },
): Promise<void> {
  const { accountId, contactId, config, slot } = args

  // Stage must still belong to this account (same guard as creation).
  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id, pipelines!inner(account_id)')
    .eq('id', config.captureVisitStageId!)
    .maybeSingle()
  const pipeline = stage?.pipelines as { account_id: string } | null | undefined
  if (!stage || !pipeline || pipeline.account_id !== accountId) {
    console.warn(
      `[ai lead-capture] configured visit stage ${config.captureVisitStageId} not found for account ${accountId} — skipping move.`,
    )
    return
  }

  const { data: deals } = await db
    .from('deals')
    .select('id, notes, stage_id')
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
  const deal = deals?.[0]
  if (!deal) return // nothing on the board yet

  const line = `Site visit: ${slot}`
  const notes =
    deal.notes && String(deal.notes).includes(line)
      ? deal.notes
      : deal.notes
        ? `${deal.notes}\n${line}`
        : line

  await db
    .from('deals')
    .update({ stage_id: stage.id, notes, updated_at: new Date().toISOString() })
    .eq('id', deal.id)
}

/**
 * "Label: value" lines for every configured capture target that has a
 * value — the whole qualification picture, not just the final pass.
 * Best-effort: any lookup miss just yields fewer lines.
 */
async function buildDealNotes(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  config: AiConfig,
): Promise<string | null> {
  const lines: string[] = []

  const builtinKeys = config.captureFields
    .filter((f): f is { kind: 'builtin'; key: CaptureBuiltinKey } => f.kind === 'builtin')
    .map((f) => f.key)
  if (builtinKeys.length > 0) {
    const { data: contact } = await db
      .from('contacts')
      .select('name, email, company')
      .eq('id', contactId)
      .maybeSingle()
    for (const key of builtinKeys) {
      const value = (contact as Record<string, unknown> | null)?.[key]
      if (typeof value === 'string' && value.trim()) lines.push(`${key}: ${value.trim()}`)
    }
  }

  const customIds = config.captureFields
    .filter((f): f is { kind: 'custom'; id: string } => f.kind === 'custom')
    .map((f) => f.id)
  if (customIds.length > 0) {
    const { data: defs } = await db
      .from('custom_fields')
      .select('id, field_name')
      .eq('account_id', accountId)
      .in('id', customIds)
    const { data: vals } = await db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contactId)
      .in('custom_field_id', customIds)
    const byId = new Map((vals ?? []).map((v) => [v.custom_field_id, v.value]))
    for (const def of defs ?? []) {
      const value = byId.get(def.id)
      if (typeof value === 'string' && value.trim()) {
        lines.push(`${def.field_name}: ${value.trim()}`)
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : null
}
