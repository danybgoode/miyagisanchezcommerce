import { test, expect } from '@playwright/test'

/**
 * ml-orders-native S3 · US-8 — route-guard smoke for the bulk-status proxy.
 * No live seller session/fixture exists for a full "3 orders → 2 advance, 1
 * reports why" walkthrough (same fixture gap as `agent-connector.spec.ts`) —
 * that live check is owed to Daniel. This asserts the proxy is Clerk-gated
 * and never 500s on well-formed-but-anonymous or malformed input.
 */

test.describe('orders bulk-status · Clerk-gated, never 500s', () => {
  test('anonymous PATCH with a well-formed body → 401', async ({ request }) => {
    const res = await request.patch('/api/orders/bulk-status', {
      data: { order_ids: ['order_01JZZZZZZZZZZZZZZZZZZZZZZZ'], status: 'shipped' },
    })
    expect(res.status()).toBe(401)
  })

  test('anonymous PATCH with a malformed body → still 401, not 500 (auth checked first)', async ({ request }) => {
    const res = await request.patch('/api/orders/bulk-status', { data: {} })
    expect(res.status()).toBe(401)
  })

  test('anonymous PATCH with no body at all → still 401 (auth is checked before body parsing)', async ({ request }) => {
    const res = await request.patch('/api/orders/bulk-status')
    expect(res.status()).toBe(401)
  })
})
