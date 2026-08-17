import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatWaitingOrderUrgency, oldestWaitingOrderAgeMs } from '../lib/order-urgency'

const repoRoot = process.cwd()
const sellerSources = [
  'app/(shell)/sell/SellWizard.tsx',
  'app/(shell)/shop/manage/orders/OrdersInbox.tsx',
].map((path) => readFileSync(join(repoRoot, path), 'utf8')).join('\n')

test.describe('seller depth copy · factual es-MX', () => {
  test('the audited invented figures and bilingual leaks stay absent', () => {
    for (const forbidden of ['4×', '3×', '70%', '23%', 'Estado / State', 'Municipio / Municipality', 'Listing location']) {
      expect(sellerSources).not.toContain(forbidden)
    }
    expect(sellerSources).toContain('100% gratis')
  })

  test('urgency comes from the seller’s actual oldest waiting order', () => {
    const now = Date.parse('2026-08-17T12:00:00.000Z')
    const orders = [
      { created_at: '2026-08-17T11:30:00.000Z' },
      { created_at: '2026-08-16T09:00:00.000Z' },
    ]
    expect(oldestWaitingOrderAgeMs(orders, now)).toBe(27 * 60 * 60 * 1000)
    expect(formatWaitingOrderUrgency(orders, now)).toBe('El pedido más antiguo lleva 1 día esperando una actualización.')
    expect(formatWaitingOrderUrgency([], now)).toBe('Revisa cada pedido cuando llegue y mantén su estado actualizado.')
  })
})
