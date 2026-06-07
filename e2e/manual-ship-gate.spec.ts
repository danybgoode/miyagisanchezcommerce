import { test, expect } from '@playwright/test'

/**
 * Checkout & Manual-Payment State Hardening · Sprint 2.2.
 * The ship endpoints are money-path surfaces (they transition an order to shipped).
 * Both must reject unauthenticated callers — the auth boundary that precedes the
 * payment gate.
 *
 * The authoritative check — a real seller shipping an UNPAID manual order gets 422
 * "Aún no confirmas el pago…", and a 200 after confirmation — needs a live seller
 * session + a seeded manual order (money/auth-gated) and is the browser smoke owed
 * to Daniel (sprint-2.md steps 1–4). The gate's decision logic is unit-covered by
 * canSellerShip in manual-payment-state.spec.ts.
 */
test.describe('seller ship endpoints · auth boundary', () => {
  test('Envia label ship rejects anonymous POST', async ({ request }) => {
    const res = await request.post('/api/orders/order_smoke_unauth/ship', {
      data: { weightGrams: 500 },
    })
    expect(res.status()).toBe(401)
  })

  test('manual-carrier ship rejects anonymous POST', async ({ request }) => {
    const res = await request.post('/api/orders/order_smoke_unauth/ship-manual', {
      data: { carrier: 'estafeta', trackingNumber: '123' },
    })
    expect(res.status()).toBe(401)
  })
})
