import type { SupabaseClient } from '@supabase/supabase-js'
import type { CaptureBuiltinKey, CaptureFieldTarget } from './types'

// ============================================================
// Agent category presets — ready-made agent templates the settings
// form offers ("Real Estate", …). Picking one prefills the system
// prompt, capture fields, and qualification-complete reply; everything
// stays editable afterwards. Adding a category = one more entry here,
// no schema change (`ai_configs.agent_category` just records the id).
// ============================================================

export interface PresetCustomField {
  /** Matched/created by name (per account) when the preset is applied. */
  name: string
  type: 'text' | 'number' | 'select' | 'date'
  options?: string[]
}

export interface AgentPreset {
  id: string
  name: string
  description: string
  systemPrompt: string
  /** `optional: true` = captured when mentioned, never gates completion. */
  captureBuiltins: { key: CaptureBuiltinKey; optional?: boolean }[]
  captureCustomFields: PresetCustomField[]
  completionReply: string
}

const REAL_ESTATE: AgentPreset = {
  id: 'real_estate',
  name: 'Real Estate',
  description:
    'Qualifies property leads: greets warmly, collects budget, configuration, location and visit timeline one question at a time, then hands off to sales.',
  systemPrompt: [
    'You are a warm, professional home advisor for a real-estate business, chatting with prospective buyers on WhatsApp.',
    'Your job is to qualify the lead: learn their name, email, budget, preferred configuration (e.g. 1/2/3 BHK), preferred location, and when they would like to visit.',
    'Ask for at most ONE missing detail per message, woven naturally into the conversation — never send a list of questions or an interrogation.',
    'At a natural moment, ask once for their email address (e.g. to send the brochure); if they decline or ignore it, move on and never insist.',
    'Answer questions about the property only from the business context and knowledge base below; never invent prices, availability, amenities, or offers.',
    'Keep replies short and friendly, suitable for WhatsApp, and reply in the language the customer writes in.',
  ].join(' '),
  captureBuiltins: [{ key: 'name' }, { key: 'email', optional: true }],
  captureCustomFields: [
    { name: 'Budget', type: 'text' },
    {
      name: 'Configuration',
      type: 'select',
      options: ['1 BHK', '2 BHK', '3 BHK', 'Other'],
    },
    { name: 'Preferred Location', type: 'text' },
    { name: 'Visit Timeline', type: 'text' },
  ],
  completionReply:
    'Hi! Our team has your details and will reach out to you shortly. For urgent queries, please call us. 😊',
}

export const AGENT_PRESETS: AgentPreset[] = [REAL_ESTATE]

export function getAgentPreset(id: unknown): AgentPreset | null {
  if (typeof id !== 'string') return null
  return AGENT_PRESETS.find((p) => p.id === id) ?? null
}

/**
 * Materialize a preset's capture targets for an account: match the
 * preset's custom fields by name (case-insensitive), create any that
 * are missing, and return the full target list (builtins first).
 * Idempotent — re-applying never duplicates fields.
 *
 * Server-only (takes a Supabase client); called from the config route
 * with the admin's RLS client, so custom-field inserts stay subject to
 * the account's admin policy.
 */
export async function applyPresetCaptureFields(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  preset: AgentPreset,
): Promise<CaptureFieldTarget[]> {
  const targets: CaptureFieldTarget[] = preset.captureBuiltins.map((b) => ({
    kind: 'builtin',
    key: b.key,
    ...(b.optional && { optional: true }),
  }))

  // Fetch all of the account's fields and match case-insensitively in
  // memory — accounts have a handful of fields, and `.in()` is
  // case-sensitive ("budget" must not spawn a duplicate "Budget").
  const { data: existing, error } = await db
    .from('custom_fields')
    .select('id, field_name')
    .eq('account_id', accountId)
  if (error) throw error

  const byName = new Map(
    (existing ?? []).map((f) => [String(f.field_name).toLowerCase(), String(f.id)]),
  )

  for (const field of preset.captureCustomFields) {
    let id = byName.get(field.name.toLowerCase())
    if (!id) {
      const { data: created, error: insErr } = await db
        .from('custom_fields')
        .insert({
          user_id: userId,
          account_id: accountId,
          field_name: field.name,
          field_type: field.type,
          field_options: field.options ? { options: field.options } : null,
        })
        .select('id')
        .single()
      if (insErr) throw insErr
      id = String(created.id)
    }
    targets.push({ kind: 'custom', id })
  }

  return targets
}
