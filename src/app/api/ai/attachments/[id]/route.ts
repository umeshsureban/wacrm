import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/ai/attachments/[id]  (admin+)
 *
 * Update name/description only — the file itself is immutable
 * (replacing it = delete + re-upload, which keeps url/storage_path/kind
 * consistent with what's actually in the bucket).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-attachments:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined
    const description =
      typeof body?.description === 'string' ? body.description.trim() : undefined
    if (name === undefined && description === undefined) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    if (name !== undefined && (!name || name.length > 80)) {
      return NextResponse.json(
        { error: 'name must be 1–80 characters' },
        { status: 400 },
      )
    }
    if (description !== undefined && (!description || description.length > 200)) {
      return NextResponse.json(
        { error: 'description must be 1–200 characters' },
        { status: 400 },
      )
    }

    const update: Record<string, string> = {}
    if (name !== undefined) update.name = name
    if (description !== undefined) update.description = description

    const { data: updated, error } = await supabase
      .from('ai_attachments')
      .update(update)
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/attachments/[id] PATCH] error:', error)
      return NextResponse.json(
        { error: 'Failed to update attachment' },
        { status: 500 },
      )
    }
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/attachments/[id]  (admin+)
 *
 * Remove the row, then best-effort remove the storage object (the
 * bucket's account-scoped RLS lets a member delete only their own
 * account's folder). An orphaned object is a storage nit, not worth
 * failing the request over.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const { data: row, error: rowErr } = await supabase
      .from('ai_attachments')
      .select('id, storage_path')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (rowErr) {
      console.error('[ai/attachments/[id] DELETE] lookup error:', rowErr)
      return NextResponse.json(
        { error: 'Failed to delete attachment' },
        { status: 500 },
      )
    }
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { error } = await supabase
      .from('ai_attachments')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
    if (error) {
      console.error('[ai/attachments/[id] DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete attachment' },
        { status: 500 },
      )
    }

    const { error: storageErr } = await supabase.storage
      .from('chat-media')
      .remove([row.storage_path])
    if (storageErr) {
      console.error('[ai/attachments/[id] DELETE] storage GC failed:', storageErr)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
