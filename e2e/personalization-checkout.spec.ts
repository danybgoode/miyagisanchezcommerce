import { test, expect } from '@playwright/test'
import {
  sanitizeFieldDefs,
  buildPersonalizationPayload,
  readPersonalization,
} from '../lib/personalization'
import { lineItemPersonalizationMetadata } from '../lib/cart'

/**
 * Configurable & Personalized Products · Sprint 2.
 * The buy-box → checkout → line-item chain: a buyer's raw input becomes a payload,
 * which is attached to the Medusa cart line item as `metadata.personalization`
 * (the native seam into the order). Pure-logic; no network, no real payment.
 */
test.describe('personalization · line-item hand-off', () => {
  const defs = sanitizeFieldDefs([
    { type: 'short_text', label: 'Nombre a grabar', required: true, max_length: 15 },
    { type: 'select', label: 'Color', required: false, options: ['Oro', 'Plata'] },
  ])

  test('a filled buy box attaches metadata.personalization to the line item', () => {
    const payload = buildPersonalizationPayload(defs, {
      [defs[0].id]: 'Ana & Luis',
      [defs[1].id]: 'Oro',
    })
    const body = lineItemPersonalizationMetadata(payload)
    expect(body).toHaveProperty('metadata.personalization')
    const round = readPersonalization((body as { metadata: { personalization: unknown } }).metadata.personalization)
    expect(round?.fields.map(f => `${f.label}: ${f.value}`)).toEqual([
      'Nombre a grabar: Ana & Luis',
      'Color: Oro',
    ])
  })

  test('an empty payload leaves the line item unchanged (no metadata key)', () => {
    expect(lineItemPersonalizationMetadata(null)).toEqual({})
    expect(lineItemPersonalizationMetadata({ fields: [] })).toEqual({})
    expect(lineItemPersonalizationMetadata(buildPersonalizationPayload(defs, {}))).toEqual({})
  })
})
