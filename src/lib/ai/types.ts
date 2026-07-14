// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic' | 'google'

export type CaptureBuiltinKey = 'name' | 'email' | 'company'

/** One field the AI should fill on the contact (lead capture).
 *  `optional: true` = extract it when the customer mentions it, but
 *  never gate the qualification-complete reply/deal on it. */
export type CaptureFieldTarget =
  | { kind: 'builtin'; key: CaptureBuiltinKey; optional?: boolean }
  | { kind: 'custom'; id: string; optional?: boolean }

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
  /** Lead capture: extract customer-stated facts into contact fields. */
  captureEnabled: boolean
  captureFields: CaptureFieldTarget[]
  /** Sent once when capture fills the last empty target field; the
   *  conversation is then paused + handed off. Null = feature off. */
  captureCompleteReply: string | null
  /** Stage a deal is created in when the lead qualifies (the stage
   *  implies the pipeline). Null = don't create deals. */
  captureDealStageId: string | null
  /** Custom field holding the agreed site-visit slot; when capture
   *  fills it, the contact's open deal moves to `captureVisitStageId`.
   *  Both null = feature off. */
  captureVisitFieldId: string | null
  captureVisitStageId: string | null
  /** Preset the config was created from ('real_estate', …); null =
   *  hand-built. Informational — behaviour lives in the columns above. */
  agentCategory: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel and send markers stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
  /** Raw `[[SEND:…]]` attachment keys the model requested. The caller
   *  validates them against the catalog it offered (see
   *  `resolveAttachmentKeys`); empty on handoff turns. */
  attachmentKeys: string[]
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
