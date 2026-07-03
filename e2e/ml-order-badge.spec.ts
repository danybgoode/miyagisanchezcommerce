import { test, expect } from '@playwright/test'
import { isMlOrder, mlOrderBadgeLabel } from '../lib/ml-order-badge'

/**
 * ml-orders-native S1 · US-3 — pure source-badge derivation. No network; reads
 * only the top-level `source`/`ml_order_id`/`ml_pack_id` fields the backend's
 * `normalizeMedusaOrder` curates (mirrors `manual-payment-state.spec.ts`'s
 * pure-logic pattern for a shared, agent-and-UI-trusted vocabulary).
 */

test.describe('ml-order-badge · isMlOrder', () => {
  test('true only when source is exactly "mercadolibre"', () => {
    expect(isMlOrder({ source: 'mercadolibre' })).toBe(true)
    expect(isMlOrder({ source: 'miyagi' })).toBe(false)
    expect(isMlOrder({ source: null })).toBe(false)
    expect(isMlOrder({})).toBe(false)
  })
})

test.describe('ml-order-badge · mlOrderBadgeLabel', () => {
  test('renders the ML badge label only for ML orders', () => {
    expect(mlOrderBadgeLabel({ source: 'mercadolibre' })).toBe('Mercado Libre')
    expect(mlOrderBadgeLabel({ source: 'miyagi' })).toBeNull()
    expect(mlOrderBadgeLabel({})).toBeNull()
  })
})
