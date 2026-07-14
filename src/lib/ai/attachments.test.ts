import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  attachmentKey,
  buildAttachmentCatalogSection,
  loadAttachmentCatalog,
  parseAttachmentMarkers,
  resolveAttachmentKeys,
  MAX_ATTACHMENTS_PER_REPLY,
  type AiAttachment,
} from './attachments'

function item(id: string, overrides: Partial<AiAttachment> = {}): AiAttachment {
  return {
    id,
    name: `Item ${id}`,
    description: `Send when asked about ${id}`,
    kind: 'document',
    url: `https://cdn.example.com/${id}.pdf`,
    filename: `${id}.pdf`,
    ...overrides,
  }
}

describe('parseAttachmentMarkers', () => {
  it('returns the text untouched when there is no marker', () => {
    expect(parseAttachmentMarkers('Hello there!')).toEqual({
      text: 'Hello there!',
      keys: [],
    })
  })

  it('extracts a trailing marker and strips it', () => {
    const { text, keys } = parseAttachmentMarkers(
      'Here is our price list.\n[[SEND:A1]]',
    )
    expect(text).toBe('Here is our price list.')
    expect(keys).toEqual(['A1'])
  })

  it('strips a mid-text marker', () => {
    const { text, keys } = parseAttachmentMarkers(
      'Attached [[SEND:A2]] is the brochure.',
    )
    expect(text).toBe('Attached  is the brochure.')
    expect(keys).toEqual(['A2'])
  })

  it('supports a comma-separated key list in one marker', () => {
    const { keys } = parseAttachmentMarkers('Sure!\n[[SEND:A1, A2]]')
    expect(keys).toEqual(['A1', 'A2'])
  })

  it('collects keys across multiple markers', () => {
    const { text, keys } = parseAttachmentMarkers(
      'Sure!\n[[SEND:A1]]\n[[SEND:A3]]',
    )
    expect(text).toBe('Sure!')
    expect(keys).toEqual(['A1', 'A3'])
  })

  it('normalizes whitespace and lowercase keys', () => {
    const { keys } = parseAttachmentMarkers('Ok [[SEND:  a1 ,A2 ]]')
    expect(keys).toEqual(['A1', 'A2'])
  })

  it('strips an empty marker and yields no keys', () => {
    expect(parseAttachmentMarkers('Hi [[SEND:]] there')).toEqual({
      text: 'Hi  there',
      keys: [],
    })
  })

  it('returns empty text when the reply is only a marker', () => {
    expect(parseAttachmentMarkers('[[SEND:A1]]')).toEqual({
      text: '',
      keys: ['A1'],
    })
  })
})

describe('resolveAttachmentKeys', () => {
  const catalog = [item('one'), item('two'), item('three')]

  it('maps keys to catalog positions', () => {
    expect(resolveAttachmentKeys(['A1', 'A3'], catalog)).toEqual([
      catalog[0],
      catalog[2],
    ])
  })

  it('drops unknown or malformed keys silently', () => {
    expect(resolveAttachmentKeys(['A99', 'B1', 'garbage', ''], catalog)).toEqual(
      [],
    )
  })

  it('dedupes repeated keys', () => {
    expect(resolveAttachmentKeys(['A2', 'A2', 'A2'], catalog)).toEqual([
      catalog[1],
    ])
  })

  it(`caps at ${MAX_ATTACHMENTS_PER_REPLY} attachments`, () => {
    const out = resolveAttachmentKeys(['A1', 'A2', 'A3'], catalog)
    expect(out).toHaveLength(MAX_ATTACHMENTS_PER_REPLY)
    expect(out).toEqual([catalog[0], catalog[1]])
  })

  it('returns [] against an empty catalog even for valid-looking keys', () => {
    expect(resolveAttachmentKeys(['A1'], [])).toEqual([])
  })
})

describe('buildAttachmentCatalogSection', () => {
  it('lists every item with its key, name, and description', () => {
    const section = buildAttachmentCatalogSection([item('one'), item('two')])
    expect(section).toContain('[A1] Item one — Send when asked about one')
    expect(section).toContain('[A2] Item two — Send when asked about two')
    expect(section).toContain('[[SEND:')
  })
})

describe('attachmentKey', () => {
  it('is 1-based', () => {
    expect(attachmentKey(0)).toBe('A1')
    expect(attachmentKey(9)).toBe('A10')
  })
})

describe('loadAttachmentCatalog', () => {
  function makeDb(result: { data: unknown; error: unknown }) {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve(result),
            }),
          }),
        }),
      }),
    }
    return db as unknown as SupabaseClient
  }

  it('returns the mapped rows', async () => {
    const rows = [item('one'), item('two')]
    const out = await loadAttachmentCatalog(makeDb({ data: rows, error: null }), 'acct')
    expect(out).toEqual(rows)
  })

  it('returns [] on a DB error instead of throwing', async () => {
    const out = await loadAttachmentCatalog(
      makeDb({ data: null, error: { message: 'boom' } }),
      'acct',
    )
    expect(out).toEqual([])
  })
})
