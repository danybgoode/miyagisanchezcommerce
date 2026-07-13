import { test, expect } from '@playwright/test'

/**
 * GET /api/stripe/connect/refresh · fix/stripe-connect-redirect-bugs.
 *
 * Bug 1: Pagos.tsx's "Completar configuración →" link pointed at this route
 * with NO `account_id` query param, so the (authenticated) seller was
 * silently bounced back to /shop/manage/settings — the fix restores the
 * param (see Pagos.tsx). Auth is checked before account_id, so an anonymous
 * caller always lands on /sign-in regardless of the param — that branch
 * isn't exercisable from this anonymous-only gate; it's covered by reading
 * the route + the fixed Pagos.tsx href directly. What this gate CAN assert
 * without a real Clerk session or a real Connect account (both writes/PII)
 * is the anonymous-caller shape: auth gated, and no route ever hands out a
 * live Stripe onboarding URL to an anonymous caller.
 */
test.describe('stripe/connect/refresh · anonymous shape', () => {
  test('anonymous caller is redirected to sign-in, regardless of account_id', async ({ request }) => {
    const res = await request.get('/api/stripe/connect/refresh', { maxRedirects: 0 })
    expect([301, 302, 303, 307, 308]).toContain(res.status())
    const location = res.headers()['location'] ?? ''
    expect(location).toContain('/sign-in')

    const withParam = await request.get('/api/stripe/connect/refresh?account_id=acct_test123', { maxRedirects: 0 })
    expect([301, 302, 303, 307, 308]).toContain(withParam.status())
    expect(withParam.headers()['location'] ?? '').toContain('/sign-in')
  })

  test('never hands an anonymous caller a live Stripe onboarding URL', async ({ request }) => {
    const res = await request.get('/api/stripe/connect/refresh?account_id=acct_test123', { maxRedirects: 0 })
    const location = res.headers()['location'] ?? ''
    expect(location).not.toContain('connect.stripe.com')
  })
})
