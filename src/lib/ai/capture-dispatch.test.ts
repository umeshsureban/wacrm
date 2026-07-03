import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
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
              maybeSingle: () =>
                Promise.resolve({ data: h.state.contact, error: null }),
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
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    embeddingsApiKey: null,
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
    {
      id: 'cf-1',
      field_name: 'BHK',
      field_type: 'select',
      field_options: { options: ['2 BHK', '3 BHK'] },
    },
  ]
  h.state.existingValues = []
  h.state.contactUpdate = null
  h.state.upsertRows = null
  h.loadAiConfig.mockResolvedValue(captureConfig())
  h.buildConversationContext.mockResolvedValue([
    { role: 'user', content: 'I am Ravi, want 3 BHK' },
  ])
  h.generateReply.mockResolvedValue({
    text: '{"name":"Ravi","BHK":"3 BHK"}',
    handoff: false,
  })
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
    expect(h.state.contactUpdate).toBeNull()
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
