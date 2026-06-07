import { test, expect } from '@playwright/test'

/**
 * Checkout & Manual-Payment State Hardening · Sprint 1.2.
 * Guards the auth boundary on the buyer "Ya hice el pago" endpoint — a money-path
 * surface that durably persists buyer_reported_paid. The endpoint must reject any
 * call without a Clerk session; it never mutates without an authenticated owner.
 *
 * The full authed persist → reload round-trip (buyer reports → both sides still
 * show the reported state) is the browser smoke owed to Daniel (real sessions +
 * a live manual order) — see sprint-1.md.
 */
test.describe('buyer report-payment · auth boundary', () => {
  test('POST without a session is rejected (no anonymous state writes)', async ({ request }) => {
    const res = await request.post('/api/orders/order_smoke_unauth/report-payment')
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBeTruthy()
  })
})
