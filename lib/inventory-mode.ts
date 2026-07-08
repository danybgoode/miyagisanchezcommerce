/**
 * Inventory-mode deriver — pure, next-free (catalog-management epic, Sprint 2 ·
 * Story 2.1). Turns the two native Medusa variant flags into the seller-facing
 * mode, and the mode + current stock into the buy-box behavior a PDP should
 * show. Separate from `lib/catalog-status.ts` (the table-facing status label)
 * since this is the PDP-facing buy-box concern.
 */

export type InventoryMode = 'tracked' | 'unlimited' | 'backorder'

export interface InventoryModeInput {
  manage_inventory: boolean
  allow_backorder: boolean
}

/** `manage_inventory: false` always wins — an unmanaged variant is "unlimited" regardless of allow_backorder. */
export function deriveInventoryMode(input: InventoryModeInput): InventoryMode {
  if (!input.manage_inventory) return 'unlimited'
  if (input.allow_backorder) return 'backorder'
  return 'tracked'
}

export interface BuyBoxBehavior {
  /** Whether the buy box should block the purchase (e.g. show "Agotado" and hide Buy). */
  blocked: boolean
  /** Whether to show the "Agotado" pill/notice. */
  showAgotado: boolean
  /** Whether to show the "Sobre pedido — envío estimado" note. */
  showDispatchNote: boolean
}

/**
 * `tracked` blocks (and shows Agotado) only when out of stock. `unlimited`
 * and `backorder` never block — Medusa's own `reserveInventoryStep`/
 * `completeCartWorkflow` already honor `allow_backorder` natively, so no
 * custom checkout-blocking logic is needed here either; this just decides
 * what copy the buy box shows.
 */
export function deriveBuyBoxBehavior(input: { mode: InventoryMode; in_stock: boolean }): BuyBoxBehavior {
  if (input.mode === 'tracked') {
    const outOfStock = input.in_stock === false
    return { blocked: outOfStock, showAgotado: outOfStock, showDispatchNote: false }
  }
  if (input.mode === 'backorder') {
    return { blocked: false, showAgotado: false, showDispatchNote: true }
  }
  // 'unlimited'
  return { blocked: false, showAgotado: false, showDispatchNote: false }
}
