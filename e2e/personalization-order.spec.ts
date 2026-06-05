import { test, expect } from '@playwright/test'
import { personalizationFromOrderItems } from '../lib/personalization'

/**
 * Configurable & Personalized Products · Sprint 3.
 * The order read-path helper that feeds the seller/buyer order screens and the
 * confirmation emails from a Medusa order's line items. Pure-logic; deterministic.
 */
test.describe('personalization · order line items → blocks', () => {
  test('single personalized item → one block with its title + fields', () => {
    const blocks = personalizationFromOrderItems([
      {
        title: 'Taza personalizada',
        metadata: { personalization: { fields: [{ id: 'a', label: 'Nombre', value: 'Ana' }] } },
      },
    ])
    expect(blocks).toEqual([{ title: 'Taza personalizada', fields: [{ id: 'a', label: 'Nombre', value: 'Ana' }] }])
  })

  test('bundle → one block per personalized item; plain items are skipped', () => {
    const blocks = personalizationFromOrderItems([
      { title: 'Grabado', metadata: { personalization: { fields: [{ id: 'a', label: 'Texto', value: 'Hola' }] } } },
      { title: 'Sin personalizar', metadata: null },
      { title: 'Tarjeta', metadata: { personalization: { fields: [{ id: 'b', label: 'Mensaje', value: 'Feliz' }] } } },
    ])
    expect(blocks.map(b => b.title)).toEqual(['Grabado', 'Tarjeta'])
    expect(blocks).toHaveLength(2)
  })

  test('no personalization anywhere → empty array (safe for empty render)', () => {
    expect(personalizationFromOrderItems([{ title: 'X', metadata: {} }])).toEqual([])
    expect(personalizationFromOrderItems(null)).toEqual([])
    expect(personalizationFromOrderItems(undefined)).toEqual([])
  })

  test('empty-value fields are dropped (no blank rows reach the order/email)', () => {
    const blocks = personalizationFromOrderItems([
      { title: 'X', metadata: { personalization: { fields: [{ id: 'a', label: 'Nombre', value: '   ' }] } } },
    ])
    expect(blocks).toEqual([])
  })
})
