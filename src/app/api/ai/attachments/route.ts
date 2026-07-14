import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { MAX_ATTACHMENT_CATALOG } from '@/lib/ai/attachments'

/** Caps mirror what the model is shown — a name is one catalog line. */
const MAX_NAME_LEN = 80
const MAX_DESCRIPTION_LEN = 200

/**
 * GET /api/ai/attachments
 *
 * List the account's AI attachment library (any member).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_attachments')
      .select('id, name, description, kind, url, filename, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[ai/attachments GET] error:', error)
      return NextResponse.json(
        { error: 'Failed to load attachments' },
        { status: 500 },
      )
    }
    return NextResponse.json({ attachments: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/attachments  (admin+)
 *
 * Register an uploaded file in the library. The file itself was already
 * uploaded client-side to the `chat-media` bucket via
 * `uploadAccountMedia` (same flow as the inbox composer); this endpoint
 * only stores the metadata. The storage path / URL are validated to
 * point inside THIS account's folder of `chat-media`, so an admin can't
 * register a foreign account's object or an arbitrary external URL for
 * the bot to send.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-attachments:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const description =
      typeof body?.description === 'string' ? body.description.trim() : ''
    const kind = body?.kind
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    const storagePath =
      typeof body?.storagePath === 'string' ? body.storagePath.trim() : ''
    const filename =
      typeof body?.filename === 'string' && body.filename.trim()
        ? body.filename.trim()
        : null

    if (!name || !description) {
      return NextResponse.json(
        { error: 'name and description are required' },
        { status: 400 },
      )
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `name must be at most ${MAX_NAME_LEN} characters` },
        { status: 400 },
      )
    }
    if (description.length > MAX_DESCRIPTION_LEN) {
      return NextResponse.json(
        { error: `description must be at most ${MAX_DESCRIPTION_LEN} characters` },
        { status: 400 },
      )
    }
    if (kind !== 'image' && kind !== 'document') {
      return NextResponse.json(
        { error: "kind must be 'image' or 'document'" },
        { status: 400 },
      )
    }
    if (
      !storagePath.startsWith(`account-${accountId}/`) ||
      !url.endsWith(`/chat-media/${storagePath}`)
    ) {
      return NextResponse.json(
        { error: 'url/storagePath must reference this account’s chat-media upload' },
        { status: 400 },
      )
    }

    // The model is only ever offered MAX_ATTACHMENT_CATALOG entries, so
    // reject additions past the cap instead of silently hiding them.
    const { count, error: countErr } = await supabase
      .from('ai_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (countErr) {
      console.error('[ai/attachments POST] count error:', countErr)
      return NextResponse.json(
        { error: 'Failed to save attachment' },
        { status: 500 },
      )
    }
    if ((count ?? 0) >= MAX_ATTACHMENT_CATALOG) {
      return NextResponse.json(
        {
          error: `Attachment library is full (${MAX_ATTACHMENT_CATALOG} max). Delete one to add another.`,
        },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('ai_attachments')
      .insert({
        account_id: accountId,
        created_by: userId,
        name,
        description,
        kind,
        url,
        storage_path: storagePath,
        filename,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error('[ai/attachments POST] insert error:', error)
      return NextResponse.json(
        { error: 'Failed to save attachment' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
