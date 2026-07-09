import { test, expect } from '@playwright/test'
import { deriveInventoryMode, deriveBuyBoxBehavior, type InventoryMode } from '../lib/inventory-mode'

/**
 * Inventory-mode deriver — pure logic (api gate, no browser). Covers the
 * mode → buy-box behavior matrix the catalog-management epic, Sprint 2 ·
 * Story 2.1 QA line names: 3 modes × in_stock true/false.
 */

test.describe('inventory-mode · deriveInventoryMode', () => {
  test('manage_inventory:true, allow_backorder:false → tracked', () => {
    expect(deriveInventoryMode({ manage_inventory: true, allow_backorder: false })).toBe('tracked')
  })

  test('manage_inventory:true, allow_backorder:true → backorder', () => {
    expect(deriveInventoryMode({ manage_inventory: true, allow_backorder: true })).toBe('backorder')
  })

  test('manage_inventory:false → unlimited, regardless of allow_backorder', () => {
    expect(deriveInventoryMode({ manage_inventory: false, allow_backorder: false })).toBe('unlimited')
    // Unmanaged always wins — an unmanaged variant is "unlimited" even if a
    // stray allow_backorder:true is present (impossible via this sprint's own
    // write path, but the deriver must resolve it deterministically).
    expect(deriveInventoryMode({ manage_inventory: false, allow_backorder: true })).toBe('unlimited')
  })
})

test.describe('inventory-mode · deriveBuyBoxBehavior', () => {
  const cases: Array<{ mode: InventoryMode; in_stock: boolean; expected: ReturnType<typeof deriveBuyBoxBehavior> }> = [
    { mode: 'tracked', in_stock: true, expected: { blocked: false, showAgotado: false, showDispatchNote: false } },
    { mode: 'tracked', in_stock: false, expected: { blocked: true, showAgotado: true, showDispatchNote: false } },
    { mode: 'unlimited', in_stock: true, expected: { blocked: false, showAgotado: false, showDispatchNote: false } },
    { mode: 'unlimited', in_stock: false, expected: { blocked: false, showAgotado: false, showDispatchNote: false } },
    { mode: 'backorder', in_stock: true, expected: { blocked: false, showAgotado: false, showDispatchNote: true } },
    { mode: 'backorder', in_stock: false, expected: { blocked: false, showAgotado: false, showDispatchNote: true } },
  ]

  for (const { mode, in_stock, expected } of cases) {
    test(`${mode} × in_stock:${in_stock} → ${JSON.stringify(expected)}`, () => {
      expect(deriveBuyBoxBehavior({ mode, in_stock })).toEqual(expected)
    })
  }

  test('backorder never blocks even at qty 0 — the entire point of the story', () => {
    const behavior = deriveBuyBoxBehavior({ mode: 'backorder', in_stock: false })
    expect(behavior.blocked).toBe(false)
    expect(behavior.showAgotado).toBe(false)
  })
})
