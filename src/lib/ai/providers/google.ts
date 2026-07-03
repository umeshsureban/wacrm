import { AiError } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
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
}

/**
 * Call the Gemini API (OpenAI-compat layer) with the caller's own key.
 * Returns the raw assistant text (handoff parsing happens in
 * `generateReply`).
 */
export async function generateGoogle(args: ProviderArgs): Promise<string> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(GOOGLE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        // The compat layer documents `max_tokens` (not OpenAI's newer
        // `max_completion_tokens`).
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Google', res)
  }

  const data = (await res.json().catch(() => null)) as GoogleResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Google returned an empty response.', {
      code: 'empty_response',
    })
  }
  return text
}
