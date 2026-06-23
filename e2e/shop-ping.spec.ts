import { test, expect } from '@playwright/test'
import { newShopPingText, shouldPingShopCreate } from '../lib/shop-notify'

/**
 * DevOps reliability cleanup · S3 — new-shop ops ping (pure seam).
 *
 * The live Telegram send is owed to Daniel; this asserts the deterministic seam
 * both create paths use: the message format and the "fires on net-new, not on a
 * re-POST/idempotent branch" contract. Pure-logic — no network, no auth.
 */
test.describe('new-shop ping · message + net-new contract', () => {
  test('builds the ops-chat string with name, location, and the /s/<slug> deep link', () => {
    const text = newShopPingText('Acme', 'CDMX', 'acme')
    expect(text).toContain('🏪')
    expect(text).toContain('Nueva tienda reclamada')
    expect(text).toContain('Acme')
    expect(text).toContain('miyagisanchez.com/s/acme')
  })

  test('omits the location segment when location is null', () => {
    const text = newShopPingText('Acme', null, 'acme')
    expect(text).not.toContain(' · ')
    expect(text).toContain('miyagisanchez.com/s/acme')
  })

  test('HTML-escapes the shop name (parse_mode: HTML body)', () => {
    const text = newShopPingText('A & <b>Z</b>', null, 'az')
    expect(text).toContain('A &amp; &lt;b&gt;Z&lt;/b&gt;')
    expect(text).not.toContain('<b>Z</b>')
  })

  test('fires on a net-new create, never on the idempotent/re-claim branch', () => {
    expect(shouldPingShopCreate(true)).toBe(true)
    expect(shouldPingShopCreate(false)).toBe(false)
  })
})
