import { test, expect } from '@playwright/test'
import {
  BUYER_MESSAGE_KINDS,
  buildBuyerMessage,
  escapeHtml,
} from '../lib/notifications/buyer-messages'

/**
 * Buyer Telegram channel · Sprint 2. Pure-logic completeness guard on the
 * centralized buyer push + Telegram copy — the single source the dispatchToBuyer
 * call-sites read. No network/auth. Proves every wired buyer event has non-empty
 * push + Telegram copy and that the Telegram body HTML-escapes user input.
 */

const SAMPLE = { listingTitle: 'Bonsái Junípero', url: 'https://miyagisanchez.com/account/orders/x' }

test.describe('buyer-messages · completeness', () => {
  test('every wired buyer event builds non-empty push + telegram', () => {
    for (const kind of BUYER_MESSAGE_KINDS) {
      const m = buildBuyerMessage(kind, {
        ...SAMPLE,
        refundAmount: '$250',
        isPartial: kind === 'return_accepted',
      })
      expect(m.push.title.trim().length, kind).toBeGreaterThan(0)
      expect(m.push.body.trim().length, kind).toBeGreaterThan(0)
      expect(m.push.url, kind).toBe(SAMPLE.url)
      expect(['order', 'offer', 'new_message'], kind).toContain(m.push.kind)
      expect(m.telegram.trim().length, kind).toBeGreaterThan(0)
      // The listing title appears (escaped) in the Telegram body.
      expect(m.telegram, kind).toContain('Bonsái Junípero')
    }
  })

  test('order_confirmed/payment_confirmed include the amount when passed', () => {
    for (const kind of ['order_confirmed', 'payment_confirmed'] as const) {
      const withAmount = buildBuyerMessage(kind, { ...SAMPLE, amountPaid: '$1,200' })
      const withoutAmount = buildBuyerMessage(kind, SAMPLE)
      expect(withAmount.telegram, kind).toContain('$1,200')
      expect(withAmount.push.body, kind).toContain('$1,200')
      expect(withoutAmount.telegram, kind).not.toContain('$1,200')
    }
  })

  test('partial vs full refund changes the accepted copy', () => {
    const full = buildBuyerMessage('return_accepted', { ...SAMPLE, refundAmount: '$250', isPartial: false })
    const partial = buildBuyerMessage('return_accepted', { ...SAMPLE, refundAmount: '$100', isPartial: true })
    expect(full.push.title).not.toBe(partial.push.title)
    expect(partial.push.title.toLowerCase()).toContain('parcial')
  })

  test('telegram body escapes HTML in the listing title (parse_mode=HTML safe)', () => {
    const m = buildBuyerMessage('order_shipped', { listingTitle: 'A <b>x</b> & <i>', url: SAMPLE.url })
    expect(m.telegram).toContain('&lt;b&gt;')
    expect(m.telegram).toContain('&amp;')
    expect(m.telegram).not.toContain('<b>x</b>')
  })

  test('escapeHtml handles &, <, >', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })
})
