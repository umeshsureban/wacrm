import { describe, it, expect } from 'vitest'
import { buildCapturePrompt, parseCaptureJson, type ResolvedTarget } from './capture'

const nameTarget: ResolvedTarget = {
  jsonKey: 'name',
  kind: 'builtin',
  builtinKey: 'name',
  label: 'name',
  fieldType: 'text',
  options: [],
  optional: false,
}
const bhkTarget: ResolvedTarget = {
  jsonKey: 'BHK',
  kind: 'custom',
  customFieldId: 'cf-1',
  label: 'BHK',
  fieldType: 'select',
  options: ['2 BHK', '3 BHK'],
  optional: false,
}

describe('buildCapturePrompt', () => {
  it('lists every target key and select options', () => {
    const p = buildCapturePrompt([nameTarget, bhkTarget])
    expect(p).toContain('"name"')
    expect(p).toContain('"BHK"')
    expect(p).toContain('2 BHK')
    expect(p).toContain('ONLY the JSON object')
  })
})

describe('parseCaptureJson', () => {
  it('parses a plain JSON object', () => {
    expect(parseCaptureJson('{"name":"Ravi","BHK":"3 BHK"}')).toEqual({
      name: 'Ravi',
      BHK: '3 BHK',
    })
  })

  it('strips markdown fences and surrounding prose', () => {
    expect(
      parseCaptureJson('Here you go:\n```json\n{"name":"Ravi"}\n```'),
    ).toEqual({ name: 'Ravi' })
  })

  it('drops nulls, empties, placeholders, and non-scalars', () => {
    expect(
      parseCaptureJson(
        '{"name":null,"email":"","budget":"unknown","BHK":{"a":1},"loan":"N/A","timeline":"3 months"}',
      ),
    ).toEqual({ timeline: '3 months' })
  })

  it('stringifies numbers', () => {
    expect(parseCaptureJson('{"budget":7500000}')).toEqual({ budget: '7500000' })
  })

  it('returns {} for malformed input', () => {
    expect(parseCaptureJson('not json at all')).toEqual({})
    expect(parseCaptureJson('[1,2,3]')).toEqual({})
    expect(parseCaptureJson('')).toEqual({})
  })
})
