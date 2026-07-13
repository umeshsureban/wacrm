import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  state: {
    contact: null as Record<string, unknown> | null,
    customFieldDefs: [] as Record<string, unknown>[],
    existingValues: [] as Record<string, unknown>[],
    contactUpdate: null as Record<string, unknown> | null,
    upsertRows: null as Record<string, unknown>[] | null,
    conversation: null as Record<string, unknown> | null,
    conversationUpdate: null as Record<string, unknown> | null,
    // Rows the qualification claim UPDATE returns: non-empty = won.
    claimRows: [] as Record<string, unknown>[],
    claimAttempted: false,
    existingDeals: [] as Record<string, unknown>[],
    dealInsert: null as Record<string, unknown> | null,
    dealInsertError: null as { message: string } | null,
    stageRow: null as Record<string, unknown> | null,
  },
}))

vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  loadAiConfig: h.loadAiConfig,
}))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
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
            // The qualification-complete claim vs. the field write.
            if ('ai_qualified_at' in payload) {
              h.state.claimAttempted = true
              return {
                eq: () => ({
                  is: () => ({
                    select: () =>
                      Promise.resolve({ data: h.state.claimRows, error: null }),
                  }),
                }),
              }
            }
            h.state.contactUpdate = payload
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.state.conversation, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            h.state.conversationUpdate = payload
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === 'deals') {
        return {
          select: () => ({
            eq: () => ({
              limit: () =>
                Promise.resolve({ data: h.state.existingDeals, error: null }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => {
            h.state.dealInsert = payload
            return Promise.resolve({ error: h.state.dealInsertError })
          },
        }
      }
      if (table === 'pipeline_stages') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.state.stageRow, error: null }),
            }),
          }),
        }
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { default_currency: 'INR' }, error: null }),
            }),
          }),
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

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function captureConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    captureEnabled: true,
    captureFields: [
      { kind: 'builtin', key: 'name' },
      { kind: 'custom', id: 'cf-1' },
    ],
    captureCompleteReply: null,
    agentCategory: null,
    captureDealStageId: null,
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
  h.state.conversation = { assigned_agent_id: null }
  h.state.conversationUpdate = null
  h.state.claimRows = [{ id: 'contact-1' }]
  h.state.claimAttempted = false
  h.state.existingDeals = []
  h.state.dealInsert = null
  h.state.dealInsertError = null
  h.state.stageRow = {
    id: 'stage-1',
    pipeline_id: 'pipe-1',
    pipelines: { id: 'pipe-1', name: 'Govind Enclave', account_id: 'acct-1' },
  }
  h.engineSendText.mockReset()
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid.1' })
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

describe('qualification-complete reply', () => {
  const REPLY = 'Our team has your details — we will reach out shortly.'

  beforeEach(() => {
    h.loadAiConfig.mockResolvedValue(
      captureConfig({ captureCompleteReply: REPLY }),
    )
    // Default extraction fills BOTH targets (name + BHK) → transition.
  })

  it('sends once, pauses the AI, and leaves a handoff note when the last field fills', async () => {
    await dispatchLeadCapture(ARGS)
    expect(h.state.claimAttempted).toBe(true)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      text: REPLY,
      aiGenerated: false,
    })
    expect(h.state.conversationUpdate).toMatchObject({
      ai_autoreply_disabled: true,
    })
    expect(h.state.conversationUpdate).not.toHaveProperty('assigned_agent_id')
  })

  it('assigns the configured handoff agent when the thread is unowned', async () => {
    h.loadAiConfig.mockResolvedValue(
      captureConfig({ captureCompleteReply: REPLY, handoffAgentId: 'agent-7' }),
    )
    await dispatchLeadCapture(ARGS)
    expect(h.state.conversationUpdate).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  it('does not fire while target fields remain empty', async () => {
    // Model finds only the name; the custom field stays empty.
    h.generateReply.mockResolvedValue({ text: '{"name":"Ravi"}', handoff: false })
    await dispatchLeadCapture(ARGS)
    expect(h.state.claimAttempted).toBe(false)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.conversationUpdate).toBeNull()
  })

  it('does nothing when no completion reply is configured', async () => {
    h.loadAiConfig.mockResolvedValue(captureConfig())
    await dispatchLeadCapture(ARGS)
    expect(h.state.claimAttempted).toBe(false)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('never double-sends when the claim was already taken', async () => {
    h.state.claimRows = [] // another inbound won the race
    await dispatchLeadCapture(ARGS)
    expect(h.state.claimAttempted).toBe(true)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.conversationUpdate).toBeNull()
  })

  it('skips the send but still pauses the AI when a human owns the thread', async () => {
    h.state.conversation = { assigned_agent_id: 'human-1' }
    h.loadAiConfig.mockResolvedValue(
      captureConfig({ captureCompleteReply: REPLY, handoffAgentId: 'agent-7' }),
    )
    await dispatchLeadCapture(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.conversationUpdate).toMatchObject({
      ai_autoreply_disabled: true,
    })
    // Never stomps the existing human assignment.
    expect(h.state.conversationUpdate).not.toHaveProperty('assigned_agent_id')
  })

  it('stays silent (no throw) when the send fails after the claim', async () => {
    h.engineSendText.mockRejectedValue(new Error('meta down'))
    await expect(dispatchLeadCapture(ARGS)).resolves.toBeUndefined()
    // The thread was still handed off before the send attempt.
    expect(h.state.conversationUpdate).toMatchObject({
      ai_autoreply_disabled: true,
    })
  })
})

describe('deal on qualification', () => {
  const REPLY = 'Our team has your details.'

  beforeEach(() => {
    h.loadAiConfig.mockResolvedValue(
      captureConfig({ captureCompleteReply: REPLY, captureDealStageId: 'stage-1' }),
    )
  })

  it('creates the deal in the configured stage and still sends the reply', async () => {
    await dispatchLeadCapture(ARGS)
    expect(h.state.dealInsert).toMatchObject({
      account_id: 'acct-1',
      user_id: 'user-1',
      pipeline_id: 'pipe-1',
      stage_id: 'stage-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      title: 'Lead — Govind Enclave',
      currency: 'INR',
      status: 'open',
    })
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('puts the captured facts in the deal notes', async () => {
    // BHK was captured on an earlier pass; only the name fills now.
    h.state.existingValues = [{ custom_field_id: 'cf-1', value: '3 BHK' }]
    h.generateReply.mockResolvedValue({ text: '{"name":"Ravi"}', handoff: false })
    await dispatchLeadCapture(ARGS)
    expect(h.state.dealInsert?.notes).toBe('BHK: 3 BHK')
  })

  it('skips contacts that already have a deal, reply still sent', async () => {
    h.state.existingDeals = [{ id: 'deal-1' }]
    await dispatchLeadCapture(ARGS)
    expect(h.state.dealInsert).toBeNull()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it("skips (warns) when the stage isn't this account's", async () => {
    h.state.stageRow = {
      id: 'stage-1',
      pipeline_id: 'pipe-x',
      pipelines: { id: 'pipe-x', name: 'Other', account_id: 'acct-OTHER' },
    }
    await dispatchLeadCapture(ARGS)
    expect(h.state.dealInsert).toBeNull()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('deal-only config creates the deal silently — no send, no AI pause', async () => {
    h.loadAiConfig.mockResolvedValue(
      captureConfig({ captureDealStageId: 'stage-1' }),
    )
    await dispatchLeadCapture(ARGS)
    expect(h.state.claimAttempted).toBe(true)
    expect(h.state.dealInsert).not.toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.conversationUpdate).toBeNull()
  })

  it('a deals insert failure never blocks the reply', async () => {
    h.state.dealInsertError = { message: 'RLS says no' }
    await dispatchLeadCapture(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.state.conversationUpdate).toMatchObject({
      ai_autoreply_disabled: true,
    })
  })
})
