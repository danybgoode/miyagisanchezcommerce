import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The legacy Supabase-backed Stripe checkout rail is MX-only.
 *
 * It hard-codes a DESTINATION charge (`transfer_data` + `application_fee_amount`) in
 * platform context and collects a Mexican shipping address. For a US seller — merchant
 * of record, paid by a DIRECT charge on their own connected account — that is the
 * wrong money movement, and it bypasses every guard in the Medusa `start-checkout`
 * rail because it never goes near it.
 *
 * This rail is reachable from the agent/UCP surface, so a US listing sold to an agent
 * was the concrete path to a wrong charge. US checkout belongs on the Medusa rail;
 * here it must refuse rather than grow a second charge-strategy implementation.
 */

const ROOT = path.join(import.meta.dirname, '..')
const ROUTE = fs.readFileSync(path.join(ROOT, 'app/api/stripe/checkout/route.ts'), 'utf8')

test.describe('UCP stripe checkout · the legacy rail is MX-only', () => {
  test('refuses a non-MXN listing before creating any Stripe session', () => {
    const guard = ROUTE.indexOf('CHECKOUT_MARKET_UNSUPPORTED')
    const session = ROUTE.indexOf('stripe.checkout.sessions.create')
    expect(guard).toBeGreaterThan(-1)
    // Ordering is the assertion that matters: a refusal AFTER the session create
    // would already have moved money.
    expect(guard).toBeLessThan(session)
  })

  test('the refusal is a 422, not a green body with a warning', () => {
    const window = ROUTE.slice(ROUTE.indexOf('CHECKOUT_MARKET_UNSUPPORTED') - 400, ROUTE.indexOf('CHECKOUT_MARKET_UNSUPPORTED') + 400)
    expect(window).toContain('status: 422')
  })

  test('the destination-charge shape is still what MX gets — this rail is not being rewritten', () => {
    expect(ROUTE).toContain('transfer_data: { destination: stripeSettings.account_id }')
    expect(ROUTE).toContain('application_fee_amount: 0')
  })

  // If someone later makes this rail market-aware for real, this spec should be
  // replaced deliberately — not left passing while US quietly flows through again.
  test('no direct-charge context is set up here (US must not use this rail)', () => {
    expect(ROUTE).not.toContain('stripeAccount')
  })
})
