import { expect, test } from '@playwright/test'
import { reviewedStatusMap, selectionAfterBulkApply, type BulkOrderTransitionPlan } from '../lib/order-bulk-preview'

const plans: BulkOrderTransitionPlan[] = [
  { order_id: 'order_1', title: 'Uno', current_status: 'paid', proposed_status: 'shipped', eligible: true, reason: null },
  { order_id: 'order_2', title: 'Dos', current_status: 'pending_payment', proposed_status: 'shipped', eligible: false, reason: 'Falta confirmar pago.' },
  { order_id: 'order_foreign', title: null, current_status: null, proposed_status: 'shipped', eligible: false, reason: 'Pedido no encontrado o no disponible.' },
]

test.describe('order bulk preview helpers', () => {
  test('apply sends only reviewed current states, never a foreign/null baseline', () => {
    expect(reviewedStatusMap(plans)).toEqual({ order_1: 'paid', order_2: 'pending_payment' })
  })

  test('only completed rows leave selection; skipped rows stay available to fix', () => {
    expect([...selectionAfterBulkApply(new Set(['order_1', 'order_2']), ['order_1'])]).toEqual(['order_2'])
  })
})
