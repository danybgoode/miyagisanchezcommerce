import { test, expect } from '@playwright/test'
import {
  sanitizeFieldDefs,
  validatePersonalization,
  buildPersonalizationPayload,
  formatPersonalizationLines,
  readPersonalization,
  effectiveMaxLength,
  MAX_CUSTOM_FIELDS,
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
