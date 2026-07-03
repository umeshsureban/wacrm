# AI Lead Capture — Design

Date: 2026-07-03
Status: Approved (implementation deferred until Google-provider testing completes)

## Problem

Businesses qualifying leads over WhatsApp (e.g. real estate: name, BHK,
budget, location, timeline, loan) currently re-type what customers say
into contact fields. The user's previous bot embedded a `<<STATE:{...}>>`
block in replies for an external parser — that pattern leaks internal
state to customers and is brittle. We want the AI assistant to capture
these fields automatically and safely.

## Decisions (confirmed with user)

1. **Fields**: admin-configurable — built-in contact fields (name, email,
   company) via toggles, plus a multi-select of the account's existing
   `custom_fields`. No hardcoded field set.
2. **Trigger**: after every inbound customer message (webhook `after()`
   block, alongside the auto-reply dispatch), regardless of whether AI or
   a human is answering. Skip the AI call entirely when every target
   field on the contact is already filled.
3. **Overwrite policy**: fill empty fields only. Existing values — human
   or AI written — are never overwritten.

## Approach

A **separate structured-output extraction call**, not a state block in
the reply. The reply path stays untouched; extraction sends the recent
conversation (reuse `buildConversationContext`) to the account's
configured provider/model with a strict "return only JSON, null for
anything not stated" prompt, then parses defensively.

Rejected alternative: piggyback a state marker on the auto-reply call —
one fewer API call, but pollutes reply quality, risks leaking to
customers (observed in practice), and can't capture on human-handled
threads.

## Components

- **Migration 032** (`032_ai_lead_capture.sql`): add to `ai_configs`:
  - `capture_enabled boolean NOT NULL DEFAULT false`
  - `capture_fields jsonb NOT NULL DEFAULT '[]'` — array of
    `{"kind":"builtin","key":"name"|"email"|"company"}` or
    `{"kind":"custom","id":"<custom_field_id>"}`
- **`src/lib/ai/capture.ts`**:
  - `dispatchLeadCapture({ accountId, conversationId, contactId })` —
    service-role, fire-and-forget, never throws (mirrors
    `dispatchInboundToAiReply` in `auto-reply.ts`).
  - Gates: AI `is_active`, `capture_enabled`, non-empty `capture_fields`,
    at least one target field empty on the contact.
  - Extraction prompt lists each target field with its type/options
    (from `custom_fields.field_type` / `field_options`).
  - JSON parsing: strip markdown code fences, `JSON.parse` in try/catch,
    accept string/number values only, treat `null`/`""`/missing as
    absent, ignore unknown keys.
  - Writes: `contacts.name/email/company` when empty; upsert
    `contact_custom_values` rows where missing/empty.
- **Webhook** (`api/whatsapp/webhook/route.ts`): call
  `dispatchLeadCapture` from the same `after()` block as the auto-reply
  dispatch (runs even when a human is assigned or auto-reply is off).
- **Settings UI** (`ai-config.tsx`, new "Lead capture" card): enable
  switch; name/email/company checkboxes; multi-select of the account's
  custom fields; hint pointing to Settings → Fields & tags to create
  fields. Persisted through the existing `/api/ai/config` route
  (extend payload validation).

## Error handling

- Extraction failures (provider error, malformed JSON) log and no-op;
  the webhook's 200 to Meta is never affected.
- Reuses provider adapters, so Google transient-5xx retry and Gemma
  `<thought>` stripping apply automatically.

## Testing

Vitest, following existing `src/lib/ai/*.test.ts` patterns (mocked
fetch / db):
- JSON parse robustness (fences, malformed, nulls, wrong types)
- fill-empty-only merge (existing values untouched)
- skip gate (no call when all targets filled; no call when disabled)
- prompt includes field types/options

## Out of scope (deferred)

- AI-written contact note summarizing the lead
- Updating AI-written values on later messages (needs provenance
  tracking)
- Capture from outbound/agent messages
