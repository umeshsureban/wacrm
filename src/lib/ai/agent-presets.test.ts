import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AGENT_PRESETS,
  applyPresetCaptureFields,
  getAgentPreset,
} from './agent-presets'

const PRESET = AGENT_PRESETS[0] // real_estate

// Minimal in-memory custom_fields table.
function fakeDb(rows: { id: string; field_name: string }[]) {
  let nextId = 100
  const inserted: Record<string, unknown>[] = []
  const db = {
    from: (table: string) => {
      if (table !== 'custom_fields') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: rows, error: null }),
        }),
        insert: (payload: Record<string, unknown>) => {
          inserted.push(payload)
          const row = { id: `cf-${nextId++}`, field_name: payload.field_name as string }
          rows.push(row)
          return {
            select: () => ({
              single: () => Promise.resolve({ data: row, error: null }),
            }),
          }
        },
      }
    },
  }
  return { db: db as unknown as SupabaseClient, inserted, rows }
}

describe('getAgentPreset', () => {
  it('resolves known ids and rejects everything else', () => {
    expect(getAgentPreset('real_estate')?.name).toBe('Real Estate')
    expect(getAgentPreset('nope')).toBeNull()
    expect(getAgentPreset(null)).toBeNull()
    expect(getAgentPreset(42)).toBeNull()
  })
})

describe('applyPresetCaptureFields', () => {
  let ctx: ReturnType<typeof fakeDb>

  beforeEach(() => {
    ctx = fakeDb([])
  })

  it('creates every missing custom field and returns builtins first', async () => {
    const targets = await applyPresetCaptureFields(ctx.db, 'acct-1', 'user-1', PRESET)
    expect(ctx.inserted).toHaveLength(PRESET.captureCustomFields.length)
    expect(ctx.inserted[0]).toMatchObject({
      account_id: 'acct-1',
      user_id: 'user-1',
      field_name: 'Budget',
    })
    expect(targets.slice(0, PRESET.captureBuiltins.length)).toEqual(
      PRESET.captureBuiltins.map((b) => ({
        kind: 'builtin',
        key: b.key,
        ...(b.optional && { optional: true }),
      })),
    )
    expect(targets).toHaveLength(
      PRESET.captureBuiltins.length + PRESET.captureCustomFields.length,
    )
  })

  it('reuses existing fields case-insensitively instead of duplicating', async () => {
    ctx = fakeDb([{ id: 'cf-existing', field_name: 'budget' }])
    const targets = await applyPresetCaptureFields(ctx.db, 'acct-1', 'user-1', PRESET)
    expect(ctx.inserted.map((r) => r.field_name)).not.toContain('Budget')
    expect(targets).toContainEqual({ kind: 'custom', id: 'cf-existing' })
  })

  it('is idempotent — a second apply creates nothing new', async () => {
    const first = await applyPresetCaptureFields(ctx.db, 'acct-1', 'user-1', PRESET)
    const insertedAfterFirst = ctx.inserted.length
    const second = await applyPresetCaptureFields(ctx.db, 'acct-1', 'user-1', PRESET)
    expect(ctx.inserted).toHaveLength(insertedAfterFirst)
    expect(second).toEqual(first)
  })
})
