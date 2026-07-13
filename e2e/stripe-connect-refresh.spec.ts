import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'

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
 * live Stripe onboarding URL to an anonymous caller — plus a cheap static
 * check on the actual regression (a future edit re-dropping `account_id`
 * from the Pagos.tsx href), which the anonymous-only HTTP checks can't see.
 */

test.describe('Pagos.tsx · "Completar configuración" link static check', () => {
  test('the pending-onboarding link includes account_id in its href', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(shell)/shop/manage/settings/_sections/Pagos.tsx'),
      'utf8',
    )
    const hrefLine = source.split('\n').find(l => l.includes('/api/stripe/connect/refresh'))
    expect(hrefLine).toBeTruthy()
    expect(hrefLine).toMatch(/account_id=\$\{initial\.stripe\.account_id\}/)
  })
})
test.describe('stripe/connect/refresh + return · account_id ownership check (static)', () => {
  // A real cross-account exploit check needs a second live shop + a real
  // authenticated session (writes/PII) — same constraint as the rest of this
  // file. What's cheaply, meaningfully testable: the routes must not trust
  // the caller-supplied account_id without cross-checking it against the
  // requester's OWN shop record before minting a link / persisting it.
  test('refresh route looks up the caller\'s own shop and rejects a mismatched account_id', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/stripe/connect/refresh/route.ts'), 'utf8')
    expect(source).toMatch(/clerk_user_id.*userId|eq\('clerk_user_id',\s*userId\)/)
    expect(source).toMatch(/accountId\s*!==\s*stripeSettings\.account_id/)
  })

  test('return route only trusts a requested account_id that matches the shop\'s existing stored value', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/stripe/connect/return/route.ts'), 'utf8')
    expect(source).toMatch(/eq\('clerk_user_id',\s*userId\)/)
    expect(source).toMatch(/requestedAccountId\s*===\s*existingBeforeUpdate\.account_id/)
  })

  // A first attempt at this fix let a shop with NO stored account_id yet
  // trust whatever account_id was passed — an attacker with a fresh shop
  // could plant a victim's account_id on their own shop via a single
  // crafted GET (`/return` always persists what it decides to trust; there's
  // no legitimate case where this route is hit before /connect has already
  // stored the account_id). A second Codex advisory pass caught this before
  // merge. This guards against that exact fallback reappearing.
  test('return route does NOT trust a requested account_id just because the shop has none stored yet', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/stripe/connect/return/route.ts'), 'utf8')
    expect(source).not.toMatch(/!existingBeforeUpdate\.account_id/)
  })
})

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
