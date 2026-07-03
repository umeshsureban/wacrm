import type { CaptureBuiltinKey } from './types'

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
