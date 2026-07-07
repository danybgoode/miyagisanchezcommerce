import { test, expect } from '@playwright/test'
import {
  sanitizeFieldDefs,
  validatePersonalization,
  buildPersonalizationPayload,
  formatPersonalizationLines,
  readPersonalization,
  effectiveMaxLength,
  typeCap,
  MAX_CUSTOM_FIELDS,
  MAX_ARTWORK_SIZE_MB,
  ARTWORK_FORMATS,
  LONG_TEXT_LIMIT,
  type CustomFieldDef,
} from '../lib/personalization'

/**
 * Configurable & Personalized Products · Sprint 1.
 * Pure-logic guards on the shared personalization model — the gate that every
 * later stage (buy box, cart, order, email) trusts. No network; deterministic.
 */
test.describe('personalization · field-definition sanitisation', () => {
  test('keeps valid defs, generates ids, drops labelless entries', () => {
    const defs = sanitizeFieldDefs([
      { type: 'short_text', label: 'Nombre a grabar', required: true },
      { type: 'long_text', label: '', required: false }, // no label → dropped
    ])
    expect(defs).toHaveLength(1)
    expect(defs[0].label).toBe('Nombre a grabar')
    expect(defs[0].required).toBe(true)
    expect(defs[0].id).toBeTruthy()
  })

  test('coerces unknown types to short_text and clamps max_length to the type cap', () => {
    const defs = sanitizeFieldDefs([
      { type: 'wat', label: 'X', max_length: 9999 },
    ])
    expect(defs[0].type).toBe('short_text')
    expect(effectiveMaxLength(defs[0])).toBeLessThanOrEqual(LONG_TEXT_LIMIT)
    expect(defs[0].max_length).toBeLessThanOrEqual(80)
  })

  test('select needs options — dedupes, caps, drops empty-option selects', () => {
    const ok = sanitizeFieldDefs([
      { type: 'select', label: 'Talla', options: ['S', 'M', 'M', 'L', ''] },
    ])
    expect(ok[0].options).toEqual(['S', 'M', 'L'])

    const dropped = sanitizeFieldDefs([{ type: 'select', label: 'Vacío', options: [] }])
    expect(dropped).toHaveLength(0)
  })

  test('caps the number of fields at MAX_CUSTOM_FIELDS', () => {
    const many = Array.from({ length: MAX_CUSTOM_FIELDS + 5 }, (_, i) => ({
      type: 'short_text', label: `F${i}`,
    }))
    expect(sanitizeFieldDefs(many)).toHaveLength(MAX_CUSTOM_FIELDS)
  })

  test('non-array input is safe', () => {
    expect(sanitizeFieldDefs(null)).toEqual([])
    expect(sanitizeFieldDefs('nope')).toEqual([])
    expect(sanitizeFieldDefs({})).toEqual([])
  })
})

test.describe('personalization · buyer validation + payload', () => {
  const defs: CustomFieldDef[] = sanitizeFieldDefs([
    { type: 'short_text', label: 'Nombre', required: true, max_length: 15 },
    { type: 'long_text', label: 'Mensaje', required: false },
  ])

  test('required-field validation reports the first blank field', () => {
    expect(validatePersonalization(defs, { [defs[1].id]: 'hola' }))
      .toMatchObject({ ok: false, missingFieldId: defs[0].id })
    expect(validatePersonalization(defs, { [defs[0].id]: 'Ana' }).ok).toBe(true)
  })

  test('payload drops empties, clamps to max, keeps label, and round-trips', () => {
    const payload = buildPersonalizationPayload(defs, {
      [defs[0].id]: 'Esto es un nombre demasiado largo',
      [defs[1].id]: '   ',
    })
    expect(payload).not.toBeNull()
    expect(payload!.fields).toHaveLength(1)
    expect(payload!.fields[0].label).toBe('Nombre')
    expect(payload!.fields[0].value.length).toBe(15)

    // formatting + narrowing helpers used downstream
    expect(formatPersonalizationLines(payload)).toEqual([`Nombre: ${payload!.fields[0].value}`])
    expect(readPersonalization(JSON.parse(JSON.stringify(payload)))).toEqual(payload)
  })

  test('all-empty answers yield a null payload', () => {
    expect(buildPersonalizationPayload(defs, { [defs[0].id]: '', [defs[1].id]: '' })).toBeNull()
    expect(formatPersonalizationLines(null)).toEqual([])
    expect(readPersonalization({ fields: 'nope' })).toBeNull()
  })
})

/**
 * Custom print products · Sprint 3, Story 3.1.
 * The `file` CustomFieldType extends this same seam — an uploaded artwork's
 * value IS an R2 URL, so the one load-bearing regression here is: it must
 * survive `buildPersonalizationPayload` completely unmodified (no character
 * truncation), the same exception `select` already gets.
 */
test.describe('personalization · file field (S3.1)', () => {
  test('sanitizeFieldDefs defaults allowed_formats to the full set and clamps max_size_mb', () => {
    const [def] = sanitizeFieldDefs([{ type: 'file', label: 'Arte', required: true }])
    expect(def.type).toBe('file')
    expect(def.allowed_formats).toEqual([...ARTWORK_FORMATS])
    expect(def.max_size_mb).toBe(MAX_ARTWORK_SIZE_MB)
  })

  test('sanitizeFieldDefs keeps a valid allowed_formats subset and clamps an oversized max_size_mb', () => {
    const [def] = sanitizeFieldDefs([
      { type: 'file', label: 'Arte', allowed_formats: ['png', 'pdf', 'not-a-format'], max_size_mb: 9999 },
    ])
    expect(def.allowed_formats).toEqual(['png', 'pdf'])
    expect(def.max_size_mb).toBe(MAX_ARTWORK_SIZE_MB)
  })

  test('an empty/invalid allowed_formats array falls back to the full set, never an impossible field', () => {
    const [def] = sanitizeFieldDefs([{ type: 'file', label: 'Arte', allowed_formats: ['bogus'] }])
    expect(def.allowed_formats).toEqual([...ARTWORK_FORMATS])
  })

  test('typeCap(\'file\') is never the 80-char short-text default', () => {
    expect(typeCap('file')).not.toBe(80)
  })

  test('buildPersonalizationPayload never truncates a file value (the load-bearing fix)', () => {
    const [def] = sanitizeFieldDefs([{ type: 'file', label: 'Arte', required: true }])
    const longUrl = `https://cdn.example.com/artwork/${'a'.repeat(120)}.png` // > 80 chars
    const payload = buildPersonalizationPayload([def], { [def.id]: longUrl })
    expect(payload!.fields[0].value).toBe(longUrl)
    expect(payload!.fields[0].value.length).toBeGreaterThan(80)
    expect(payload!.fields[0].type).toBe('file')
  })

  test('readPersonalization passes `type` through and validates it against known types', () => {
    const roundTripped = readPersonalization({
      fields: [{ id: 'f1', label: 'Arte', value: 'https://cdn.example.com/a.png', type: 'file' }],
    })
    expect(roundTripped!.fields[0].type).toBe('file')

    // An unknown/forged `type` string is dropped, not trusted — a render site
    // branching on `type === 'file'` must never see an arbitrary value here.
    const forged = readPersonalization({
      fields: [{ id: 'f1', label: 'X', value: 'y', type: 'not-a-real-type' }],
    })
    expect(forged!.fields[0].type).toBeUndefined()
  })

  test('a required file field blocks validation exactly like any other required field', () => {
    const [def] = sanitizeFieldDefs([{ type: 'file', label: 'Arte', required: true }])
    expect(validatePersonalization([def], {})).toMatchObject({ ok: false, missingFieldId: def.id })
    expect(validatePersonalization([def], { [def.id]: 'https://cdn.example.com/a.png' }).ok).toBe(true)
  })
})
