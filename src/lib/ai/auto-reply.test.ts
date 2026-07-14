import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  loadAttachmentCatalog: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendMedia: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
// Partial mock: the catalog load is stubbed, but key resolution stays
// real so these tests cover the marker → catalog → send pipeline.
vi.mock('./attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./attachments')>()
  return { ...actual, loadAttachmentCatalog: h.loadAttachmentCatalog }
})
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendMedia: h.engineSendMedia,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    captureEnabled: false,
    captureFields: [],
    captureCompleteReply: null,
    agentCategory: null,
    captureDealStageId: null,
    captureVisitFieldId: null,
    captureVisitStageId: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.loadAttachmentCatalog.mockResolvedValue([])
  h.generateReply.mockResolvedValue({
    text: 'Hello!',
    handoff: false,
    attachmentKeys: [],
  })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.engineSendMedia.mockResolvedValue({ whatsapp_message_id: 'm2' })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — attachments', () => {
  const catalog = [
    {
      id: 'att-1',
      name: 'Price list',
      description: 'Send when asked about prices',
      kind: 'document' as const,
      url: 'https://cdn.example.com/prices.pdf',
      filename: 'prices.pdf',
    },
    {
      id: 'att-2',
      name: 'Showroom photo',
      description: 'Send when asked to see the place',
      kind: 'image' as const,
      url: 'https://cdn.example.com/showroom.jpg',
      filename: null,
    },
  ]

  it('offers the catalog in the system prompt', async () => {
    h.loadAttachmentCatalog.mockResolvedValue(catalog)
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('[A1] Price list — Send when asked about prices')
    expect(systemPrompt).toContain('[[SEND:')
  })

  it('sends requested attachments after the text, flagged ai_generated', async () => {
    h.loadAttachmentCatalog.mockResolvedValue(catalog)
    h.generateReply.mockResolvedValue({
      text: 'Here you go!',
      handoff: false,
      attachmentKeys: ['A1', 'A2'],
    })
    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendMedia).toHaveBeenCalledTimes(2)
    expect(h.engineSendMedia).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        conversationId: 'conv-1',
        kind: 'document',
        link: 'https://cdn.example.com/prices.pdf',
        filename: 'prices.pdf',
        aiGenerated: true,
      }),
    )
    expect(h.engineSendMedia).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: 'image',
        link: 'https://cdn.example.com/showroom.jpg',
        filename: undefined,
        aiGenerated: true,
      }),
    )
    // Text sends before any media.
    expect(h.engineSendText.mock.invocationCallOrder[0]).toBeLessThan(
      h.engineSendMedia.mock.invocationCallOrder[0],
    )
    // One logical reply → exactly one claimed slot.
    expect(h.state.rpcCalls).toHaveLength(1)
  })

  it('survives a failed media send without throwing', async () => {
    h.loadAttachmentCatalog.mockResolvedValue(catalog)
    h.generateReply.mockResolvedValue({
      text: 'Here you go!',
      handoff: false,
      attachmentKeys: ['A1', 'A2'],
    })
    h.engineSendMedia.mockRejectedValueOnce(new Error('meta 400'))
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    // The second attachment is still attempted after the first fails.
    expect(h.engineSendMedia).toHaveBeenCalledTimes(2)
  })

  it('ignores hallucinated keys when the catalog is empty', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Sending it now!',
      handoff: false,
      attachmentKeys: ['A1'],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })

  it('ignores keys outside the catalog', async () => {
    h.loadAttachmentCatalog.mockResolvedValue(catalog)
    h.generateReply.mockResolvedValue({
      text: 'Sure!',
      handoff: false,
      attachmentKeys: ['A9', 'B1'],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})
