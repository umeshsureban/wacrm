# AI Lead Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each inbound WhatsApp message, a separate AI extraction call fills empty contact fields (built-in name/email/company + admin-selected custom fields) from what the customer said.

**Architecture:** A new `src/lib/ai/capture.ts` module mirrors the auto-reply dispatcher (`auto-reply.ts`): service-role, fire-and-forget, never throws, invoked from the webhook's `after()` block. Config lives on two new `ai_configs` columns (migration 032) and is edited in a new "Lead capture" card on the AI Agents Setup tab.

**Tech Stack:** Next.js 16 App Router, Supabase (service-role writes), Vitest, existing AI provider adapters (`generateReply`).

**Spec:** `docs/superpowers/specs/2026-07-03-ai-lead-capture-design.md`

## Global Constraints

- Fill-empty-only: never overwrite an existing non-empty contact value.
- Never throw into the webhook; log with `[ai lead-capture]` prefix and no-op.
- Skip the AI call entirely when capture is disabled, no fields are configured, or no target field is empty.
- User-facing brand name is "Matu on Whatsapp" (not "wacrm").
- Follow existing file conventions (2-space indent, single quotes in `src/lib/ai/*`, semicolons in `src/components/*`).
- Run `npm run typecheck` and `npm run test` before every commit.

---

### Task 1: Types, migration 032, config loading

**Files:**
- Create: `supabase/migrations/032_ai_lead_capture.sql`
- Modify: `src/types/index.ts` (no change needed — AI types live in `src/lib/ai/types.ts`)
- Modify: `src/lib/ai/types.ts`
- Modify: `src/lib/ai/config.ts`
- Modify: `src/app/api/ai/config/route.ts` (AiConfig literal in `validateAiCredentials` call, ~line 141)
- Modify: `src/lib/ai/generate.test.ts` (`config()` helper), `src/lib/ai/auto-reply.test.ts` (`aiConfig()` helper), plus any other `AiConfig` literals found by `grep -rn "embeddingsApiKey:" src`
- Test: `src/lib/ai/config.test.ts`

**Interfaces:**
- Produces: `CaptureFieldTarget` union type, `AiConfig.captureEnabled: boolean`, `AiConfig.captureFields: CaptureFieldTarget[]`, `sanitizeCaptureFields(raw: unknown): CaptureFieldTarget[]` exported from `src/lib/ai/config.ts`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- 032_ai_lead_capture.sql — AI lead capture config
--
-- Lets the AI assistant extract facts the customer stated (name,
-- budget, etc.) into contact fields after each inbound message.
-- `capture_fields` is an array of targets:
--   {"kind":"builtin","key":"name"|"email"|"company"}
--   {"kind":"custom","id":"<custom_fields.id>"}
-- Fill-empty-only semantics are enforced app-side (capture.ts).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS capture_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS capture_fields jsonb NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: Add types to `src/lib/ai/types.ts`**

After the `AiProvider` line, add:

```ts
export type CaptureBuiltinKey = 'name' | 'email' | 'company'

/** One field the AI should fill on the contact. */
export type CaptureFieldTarget =
  | { kind: 'builtin'; key: CaptureBuiltinKey }
  | { kind: 'custom'; id: string }
```

Inside `interface AiConfig`, after `embeddingsApiKey`, add:

```ts
  /** Lead capture: extract customer-stated facts into contact fields. */
  captureEnabled: boolean
  captureFields: CaptureFieldTarget[]
```

- [ ] **Step 3: Write failing tests in `src/lib/ai/config.test.ts`**

Add to the existing file (it already mocks a Supabase row — extend the row object in the existing helper with `capture_enabled: true, capture_fields: [...]`; follow the file's current mock shape):

```ts
describe('sanitizeCaptureFields', () => {
  it('keeps valid builtin and custom targets, drops junk', () => {
    expect(
      sanitizeCaptureFields([
        { kind: 'builtin', key: 'name' },
        { kind: 'custom', id: 'cf-1' },
        { kind: 'builtin', key: 'phone' }, // invalid builtin
        { kind: 'custom' }, // missing id
        'nonsense',
        null,
      ]),
    ).toEqual([
      { kind: 'builtin', key: 'name' },
      { kind: 'custom', id: 'cf-1' },
    ])
  })

  it('returns [] for non-arrays', () => {
    expect(sanitizeCaptureFields(null)).toEqual([])
    expect(sanitizeCaptureFields('x')).toEqual([])
    expect(sanitizeCaptureFields({})).toEqual([])
  })
})
```

Also assert in the existing `loadAiConfig` happy-path test that `config!.captureEnabled` and `config!.captureFields` come through from the row.

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/lib/ai/config.test.ts`
Expected: FAIL — `sanitizeCaptureFields` is not exported.

- [ ] **Step 5: Implement in `src/lib/ai/config.ts`**

Extend `AiConfigRow` and `CONFIG_COLUMNS`:

```ts
interface AiConfigRow {
  provider: 'openai' | 'anthropic' | 'google'
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  embeddings_api_key: string | null
  capture_enabled: boolean | null
  capture_fields: unknown
}

const CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, embeddings_api_key, capture_enabled, capture_fields'
```

Add the sanitizer (exported — the POST route and capture module reuse it):

```ts
const CAPTURE_BUILTIN_KEYS = new Set(['name', 'email', 'company'])
const MAX_CAPTURE_FIELDS = 20

/** Validate a stored/submitted capture_fields payload into typed
 *  targets, silently dropping anything malformed. */
export function sanitizeCaptureFields(raw: unknown): CaptureFieldTarget[] {
  if (!Array.isArray(raw)) return []
  const out: CaptureFieldTarget[] = []
  for (const item of raw) {
    if (out.length >= MAX_CAPTURE_FIELDS) break
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (o.kind === 'builtin' && typeof o.key === 'string' && CAPTURE_BUILTIN_KEYS.has(o.key)) {
      out.push({ kind: 'builtin', key: o.key as CaptureBuiltinKey })
    } else if (o.kind === 'custom' && typeof o.id === 'string' && o.id) {
      out.push({ kind: 'custom', id: o.id })
    }
  }
  return out
}
```

(Import `CaptureFieldTarget, CaptureBuiltinKey` from `./types`.) In `loadAiConfig`'s returned object add:

```ts
    captureEnabled: row.capture_enabled === true,
    captureFields: sanitizeCaptureFields(row.capture_fields),
```

- [ ] **Step 6: Fix every `AiConfig` object literal**

Run: `grep -rn "embeddingsApiKey:" src` — every literal constructing an `AiConfig` (the `validateAiCredentials` call in `src/app/api/ai/config/route.ts` ~line 141, the `config()` helper in `generate.test.ts`, the `aiConfig()` helper in `auto-reply.test.ts`, and any in `knowledge.test.ts` / `src/app/api/ai/test/route.ts`) gets:

```ts
    captureEnabled: false,
    captureFields: [],
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npx vitest run src/lib/ai` — expected: PASS, all files.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ai): capture config columns + types for lead capture (migration 032)"
```

---

### Task 2: Extraction prompt + JSON parsing (pure functions)

**Files:**
- Create: `src/lib/ai/capture.ts`
- Test: `src/lib/ai/capture.test.ts`

**Interfaces:**
- Consumes: `CaptureFieldTarget` from `./types`.
- Produces:
  - `interface ResolvedTarget { jsonKey: string; kind: 'builtin' | 'custom'; builtinKey?: CaptureBuiltinKey; customFieldId?: string; label: string; fieldType: string; options: string[] }`
  - `buildCapturePrompt(targets: ResolvedTarget[]): string`
  - `parseCaptureJson(raw: string): Record<string, string>`

- [ ] **Step 1: Write failing tests (`src/lib/ai/capture.test.ts`)**

```ts
import { describe, it, expect } from 'vitest'
import { buildCapturePrompt, parseCaptureJson, type ResolvedTarget } from './capture'

const nameTarget: ResolvedTarget = {
  jsonKey: 'name', kind: 'builtin', builtinKey: 'name',
  label: 'name', fieldType: 'text', options: [],
}
const bhkTarget: ResolvedTarget = {
  jsonKey: 'BHK', kind: 'custom', customFieldId: 'cf-1',
  label: 'BHK', fieldType: 'select', options: ['2 BHK', '3 BHK'],
}

describe('buildCapturePrompt', () => {
  it('lists every target key and select options', () => {
    const p = buildCapturePrompt([nameTarget, bhkTarget])
    expect(p).toContain('"name"')
    expect(p).toContain('"BHK"')
    expect(p).toContain('2 BHK')
    expect(p).toContain('ONLY the JSON object')
  })
})

describe('parseCaptureJson', () => {
  it('parses a plain JSON object', () => {
    expect(parseCaptureJson('{"name":"Ravi","BHK":"3 BHK"}')).toEqual({
      name: 'Ravi', BHK: '3 BHK',
    })
  })

  it('strips markdown fences and surrounding prose', () => {
    expect(
      parseCaptureJson('Here you go:\n```json\n{"name":"Ravi"}\n```'),
    ).toEqual({ name: 'Ravi' })
  })

  it('drops nulls, empties, placeholders, and non-scalars', () => {
    expect(
      parseCaptureJson(
        '{"name":null,"email":"","budget":"unknown","BHK":{"a":1},"loan":"N/A","timeline":"3 months"}',
      ),
    ).toEqual({ timeline: '3 months' })
  })

  it('stringifies numbers', () => {
    expect(parseCaptureJson('{"budget":7500000}')).toEqual({ budget: '7500000' })
  })

  it('returns {} for malformed input', () => {
    expect(parseCaptureJson('not json at all')).toEqual({})
    expect(parseCaptureJson('[1,2,3]')).toEqual({})
    expect(parseCaptureJson('')).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/ai/capture.test.ts`
Expected: FAIL — module `./capture` does not exist.

- [ ] **Step 3: Implement the pure functions in `src/lib/ai/capture.ts`**

```ts
import type { CaptureBuiltinKey } from './types'

// ============================================================
// AI lead capture — extract customer-stated facts into contact
// fields. Pure prompt/parse helpers here; the dispatcher below
// (Task 3) wires them to the DB and provider.
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
  '', 'null', 'none', 'unknown', 'n/a', 'na', 'not provided', 'not mentioned', 'not stated',
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
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/lib/ai/capture.test.ts` — expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/capture.ts src/lib/ai/capture.test.ts
git commit -m "feat(ai): lead-capture extraction prompt + defensive JSON parsing"
```

---

### Task 3: `dispatchLeadCapture` orchestration

**Files:**
- Modify: `src/lib/ai/capture.ts` (append dispatcher)
- Test: `src/lib/ai/capture-dispatch.test.ts` (separate file so the pure-function tests don't need module mocks)

**Interfaces:**
- Consumes: `loadAiConfig` (`./config`), `buildConversationContext` (`./context`), `generateReply` (`./generate`), `supabaseAdmin` (`./admin-client`), plus Task 2's helpers.
- Produces: `dispatchLeadCapture(args: { accountId: string; conversationId: string; contactId: string }): Promise<void>` — never throws.

- [ ] **Step 1: Write failing tests (`src/lib/ai/capture-dispatch.test.ts`)**

Follow the `auto-reply.test.ts` hoisted-mock pattern exactly:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  generateReply: vi.fn(),
  state: {
    contact: null as Record<string, unknown> | null,
    customFieldDefs: [] as Record<string, unknown>[],
    existingValues: [] as Record<string, unknown>[],
    contactUpdate: null as Record<string, unknown> | null,
    upsertRows: null as Record<string, unknown>[] | null,
  },
}))

vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  loadAiConfig: h.loadAiConfig,
}))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: h.state.contact, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            h.state.contactUpdate = payload
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === 'custom_fields') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve({ data: h.state.customFieldDefs, error: null }),
        }
        return chain
      }
      // contact_custom_values
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: h.state.existingValues, error: null }),
        upsert: (rows: Record<string, unknown>[]) => {
          h.state.upsertRows = rows
          return Promise.resolve({ error: null })
        },
      }
      return chain
    },
  }),
}))

import { dispatchLeadCapture } from './capture'

const ARGS = { accountId: 'acct-1', conversationId: 'conv-1', contactId: 'contact-1' }

function captureConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai', model: 'gpt-test', apiKey: 'sk-test',
    systemPrompt: null, isActive: true, autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3, embeddingsApiKey: null,
    captureEnabled: true,
    captureFields: [
      { kind: 'builtin', key: 'name' },
      { kind: 'custom', id: 'cf-1' },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  h.state.contact = { name: null, email: null, company: null }
  h.state.customFieldDefs = [
    { id: 'cf-1', field_name: 'BHK', field_type: 'select', field_options: { options: ['2 BHK', '3 BHK'] } },
  ]
  h.state.existingValues = []
  h.state.contactUpdate = null
  h.state.upsertRows = null
  h.loadAiConfig.mockResolvedValue(captureConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'I am Ravi, want 3 BHK' }])
  h.generateReply.mockResolvedValue({ text: '{"name":"Ravi","BHK":"3 BHK"}', handoff: false })
})

describe('dispatchLeadCapture', () => {
  it('fills empty builtin and custom fields from the extraction', async () => {
    await dispatchLeadCapture(ARGS)
    expect(h.state.contactUpdate).toEqual({ name: 'Ravi' })
    expect(h.state.upsertRows).toEqual([
      { contact_id: 'contact-1', custom_field_id: 'cf-1', value: '3 BHK' },
    ])
  })

  it('no-ops when capture is disabled', async () => {
    h.loadAiConfig.mockResolvedValue(captureConfig({ captureEnabled: false }))
    await dispatchLeadCapture(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('skips the AI call when every target is already filled', async () => {
    h.state.contact = { name: 'Ravi', email: null, company: null }
    h.state.existingValues = [{ custom_field_id: 'cf-1', value: '2 BHK' }]
    await dispatchLeadCapture(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.contactUpdate).toBeNull()
  })

  it('never overwrites a filled field even if the model returns it', async () => {
    h.state.contact = { name: 'Existing Name', email: null, company: null }
    await dispatchLeadCapture(ARGS)
    expect(h.state.contactUpdate).toBeNull() // only name was builtin target, and it was filled
    expect(h.state.upsertRows).toEqual([
      { contact_id: 'contact-1', custom_field_id: 'cf-1', value: '3 BHK' },
    ])
  })

  it('swallows malformed model output without writing', async () => {
    h.generateReply.mockResolvedValue({ text: 'sorry, no json here', handoff: false })
    await dispatchLeadCapture(ARGS)
    expect(h.state.contactUpdate).toBeNull()
    expect(h.state.upsertRows).toBeNull()
  })

  it('never throws when the provider errors', async () => {
    h.generateReply.mockRejectedValue(new Error('provider down'))
    await expect(dispatchLeadCapture(ARGS)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/ai/capture-dispatch.test.ts`
Expected: FAIL — `dispatchLeadCapture` is not exported.

- [ ] **Step 3: Implement the dispatcher (append to `src/lib/ai/capture.ts`)**

Add imports at the top of the file:

```ts
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { generateReply } from './generate'
```

Append:

```ts
interface DispatchCaptureArgs {
  accountId: string
  conversationId: string
  contactId: string
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
  const { accountId, conversationId, contactId } = args

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
        jsonKey: t.key, kind: 'builtin', builtinKey: t.key,
        label: t.key, fieldType: 'text', options: [],
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
  } catch (err) {
    console.error('[ai lead-capture] dispatch failed:', err)
  }
}
```

(Also add `CaptureBuiltinKey` to the existing type import from `./types`.)

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/lib/ai` — expected: PASS, all AI tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/capture.ts src/lib/ai/capture-dispatch.test.ts
git commit -m "feat(ai): lead-capture dispatcher — fill empty contact fields from conversation"
```

---

### Task 4: Webhook hookup

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts` (import block ~line 10; inbound processing ~line 800, immediately after the `dispatchInboundToAiReply` block)

**Interfaces:**
- Consumes: `dispatchLeadCapture` from Task 3.

- [ ] **Step 1: Add the import**

Next to the existing `dispatchInboundToAiReply` import:

```ts
import { dispatchLeadCapture } from '@/lib/ai/capture'
```

- [ ] **Step 2: Dispatch after the auto-reply block (~line 800)**

Directly after the closing `}` of the `if (!flowConsumed && ...) { await dispatchInboundToAiReply(...) }` block, add:

```ts
  // AI lead capture. Independent of auto-reply — runs even when a human
  // owns the thread or a flow consumed the message, because customer
  // facts are worth capturing either way. Gated internally on
  // capture_enabled + at least one empty target field; never throws.
  if (inboundText.trim()) {
    await dispatchLeadCapture({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
    })
  }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/whatsapp/webhook/route.ts
git commit -m "feat(ai): dispatch lead capture from the inbound webhook"
```

---

### Task 5: Config API — persist and return capture settings

**Files:**
- Modify: `src/app/api/ai/config/route.ts` (GET select/response ~lines 32/50; POST body parsing ~line 91; `shared` payload ~line 181)

**Interfaces:**
- Consumes: `sanitizeCaptureFields` from `@/lib/ai/config` (Task 1).
- Produces: GET response gains `capture_enabled: boolean` and `capture_fields: CaptureFieldTarget[]`; POST accepts the same keys.

- [ ] **Step 1: GET — select and return the new columns**

Change the `.select(...)` string to append `, capture_enabled, capture_fields`. The `...safe` spread then returns them automatically — but sanitize on the way out. Replace the final `return NextResponse.json({...})` with:

```ts
    const { api_key, embeddings_api_key, capture_fields, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      capture_fields: sanitizeCaptureFields(capture_fields),
      ...safe,
    })
```

(Import `sanitizeCaptureFields` from `@/lib/ai/config`.)

- [ ] **Step 2: POST — parse and persist**

After the `autoReplyEnabled` line (~92), add:

```ts
    const captureEnabled = body.capture_enabled === true
    const captureFields = sanitizeCaptureFields(body.capture_fields)
```

In the `shared` object (~line 181), add:

```ts
      capture_enabled: captureEnabled,
      capture_fields: captureFields,
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run test` — expected: clean / all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/config/route.ts
git commit -m "feat(ai): persist lead-capture settings through the config API"
```

---

### Task 6: Settings UI — "Lead capture" card

**Files:**
- Modify: `src/components/settings/ai-config.tsx`

**Interfaces:**
- Consumes: GET/POST `/api/ai/config` `capture_enabled` / `capture_fields` (Task 5); `custom_fields` table via the browser Supabase client (`@/lib/supabase/client`, RLS-scoped — same pattern as `custom-field-manager.tsx`); `Checkbox` from `@/components/ui/checkbox`; `Switch` from `@/components/ui/switch` (both exist).

- [ ] **Step 1: State + load**

Add imports: `Checkbox`, `createClient` from `@/lib/supabase/client`, and `type CaptureFieldTarget` from `@/lib/ai/types`. Add state near the other config state:

```tsx
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [captureFields, setCaptureFields] = useState<CaptureFieldTarget[]>([]);
  const [customFields, setCustomFields] = useState<{ id: string; field_name: string }[]>([]);
```

In the existing config-load effect (where provider/model/etc. are set from the GET response), add:

```tsx
        setCaptureEnabled(data.capture_enabled === true);
        setCaptureFields(Array.isArray(data.capture_fields) ? data.capture_fields : []);
```

Add a one-shot effect to load the account's custom fields:

```tsx
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('custom_fields')
      .select('id, field_name')
      .order('created_at')
      .then(({ data }) => setCustomFields(data ?? []));
  }, []);
```

Helper toggles (place near `handleProviderChange`):

```tsx
  const captureHas = (t: CaptureFieldTarget) =>
    captureFields.some((f) =>
      f.kind === 'builtin' && t.kind === 'builtin'
        ? f.key === t.key
        : f.kind === 'custom' && t.kind === 'custom' && f.id === t.id,
    );
  const toggleCapture = (t: CaptureFieldTarget) =>
    setCaptureFields((prev) =>
      captureHas(t)
        ? prev.filter((f) =>
            f.kind === 'builtin' && t.kind === 'builtin'
              ? f.key !== t.key
              : !(f.kind === 'custom' && t.kind === 'custom' && f.id === t.id),
          )
        : [...prev, t],
    );
```

- [ ] **Step 2: Include in the save payload**

In `handleSave`'s POST body object, add:

```tsx
        capture_enabled: captureEnabled,
        capture_fields: captureFields,
```

- [ ] **Step 3: Render the card**

After the auto-reply card (before the knowledge card `<AiKnowledgeCard …/>`), add:

```tsx
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Lead capture</CardTitle>
                <CardDescription>
                  After each customer message, the AI fills empty contact
                  fields with facts the customer stated — it never overwrites
                  an existing value.
                </CardDescription>
              </div>
              <Switch
                checked={captureEnabled}
                onCheckedChange={setCaptureEnabled}
                disabled={disabled}
              />
            </div>
          </CardHeader>
          {captureEnabled && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Built-in fields</Label>
                <div className="flex flex-wrap gap-4">
                  {(['name', 'email', 'company'] as const).map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm capitalize">
                      <Checkbox
                        checked={captureHas({ kind: 'builtin', key })}
                        onCheckedChange={() => toggleCapture({ kind: 'builtin', key })}
                        disabled={disabled}
                      />
                      {key}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Custom fields</Label>
                {customFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No custom fields yet — create them under Settings → Fields
                    & tags (e.g. BHK, Budget, Location).
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {customFields.map((cf) => (
                      <label key={cf.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={captureHas({ kind: 'custom', id: cf.id })}
                          onCheckedChange={() => toggleCapture({ kind: 'custom', id: cf.id })}
                          disabled={disabled}
                        />
                        {cf.field_name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>
```

(Adapt `Checkbox`/`Switch` prop names to the actual component APIs in `src/components/ui/` — check them before wiring; Base UI variants may use `onCheckedChange` or `onChange`.)

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev -- -p 3001`, open `/agents` → Setup: card renders, toggles persist across save + reload.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ai-config.tsx
git commit -m "feat(ai): lead-capture settings card in AI Agents setup"
```

---

### Task 7: Full verification + push

- [ ] **Step 1:** `npm run typecheck && npm run test && npm run build` — all clean.
- [ ] **Step 2:** Remind the user to run migration `032_ai_lead_capture.sql` in the Supabase SQL editor before testing the save.
- [ ] **Step 3:** End-to-end check on the dev server: enable capture with name + a custom field, send an inbound WhatsApp message stating a name, confirm the contact panel shows it.
- [ ] **Step 4:** Push the branch:

```bash
git push -u origin feat/ai-lead-capture
```
