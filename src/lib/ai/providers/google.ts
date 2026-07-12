import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

// Gemini API's OpenAI-compatible endpoint. One AI Studio key serves
// both Gemini and Gemma model families through this URL, so the
// request/response shape mirrors the OpenAI adapter.
const GOOGLE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

interface GoogleResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

// Gemini returns intermittent 500/503 INTERNAL errors under load
// (especially on recently launched Gemma models); Google's guidance is
// to retry with backoff. Two quick retries ride out the blips without
// stretching the auto-reply path when the outage is real.
const TRANSIENT_STATUSES = new Set([500, 503])
const RETRY_DELAYS_MS = [500, 1500]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Gemma 4 is a thinking model and leaks its reasoning into the content
 * as `<thought>…</thought>` blocks. We ask for minimal thinking in the
 * request, but the API is known to ignore thinking flags for Gemma
 * (google-gemini/cookbook#1198), so strip any blocks that get through.
 * An unclosed `<thought>` means the reply was cut off mid-reasoning —
 * drop everything from it onward rather than show half a chain of
 * thought to a customer.
 */
export function stripThoughts(text: string): string {
  let out = text.replace(/<thought>[\s\S]*?<\/thought>/g, '')
  const dangling = out.indexOf('<thought>')
  if (dangling !== -1) out = out.slice(0, dangling)
  return out.trim()
}

/**
 * Call the Gemini API (OpenAI-compat layer) with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateGoogle(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...mergeConsecutive(messages),
    ],
    // The compat layer documents `max_tokens` (not OpenAI's newer
    // `max_completion_tokens`).
    max_tokens: MAX_OUTPUT_TOKENS,
    // Keep replies fast and free of chain-of-thought: minimal thinking
    // budget, no thought parts. `include_thoughts` alone is a no-op on
    // Gemma 4, hence the thinking level + stripThoughts() belt-and-braces.
    extra_body: {
      google: {
        thinking_config: {
          thinking_level: 'minimal',
          include_thoughts: false,
        },
      },
    },
  })

  let res: Response
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(GOOGLE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (res.ok) break
    if (
      !TRANSIENT_STATUSES.has(res.status) ||
      attempt >= RETRY_DELAYS_MS.length
    ) {
      throw await providerHttpError('Google', res)
    }
    await sleep(RETRY_DELAYS_MS[attempt])
  }

  const data = (await res.json().catch(() => null)) as GoogleResponse | null
  const raw = data?.choices?.[0]?.message?.content
  const text = typeof raw === 'string' ? stripThoughts(raw) : ''
  if (!text) {
    throw new AiError('Google returned an empty response.', {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}
