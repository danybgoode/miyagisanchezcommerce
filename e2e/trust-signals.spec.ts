import { test, expect } from '@playwright/test'
import {
  selectTrustSignals,
  trustChannelBucket,
  returnsWindowLabel,
  TRUST_COPY,
  type TrustSignalsInput,
} from '../lib/trust-signals'

/**
 * Trust & Messaging Polish (#3c · Epic C) — Sprint 2, C.4.
 *
 * Pure-logic guards on the trust-signal selector: which signal groups render per
 * (channel, variant). No network, no auth, no `next/*` — runs in the `api` gate.
 * This is the single source of truth the shared `<TrustSignals>` component reads,
 * and the contract Epic D will consume.
 */

const FULL: TrustSignalsInput = {
  channel: 'marketplace',
  variant: 'full',
  hasPayment: true,
  hasFulfillment: true,
  processingLabel: '1 día hábil',
  returnsLabel: '7 días',
  verified: true,
  paymentProtected: true,
}

test.describe('trust-signals · channel bucketing', () => {
  test('marketplace + api collapse to the platform bucket', () => {
    expect(trustChannelBucket('marketplace')).toBe('platform')
    expect(trustChannelBucket('api')).toBe('platform')
  })
  test('custom_domain + subdomain collapse to off_platform', () => {
    expect(trustChannelBucket('custom_domain')).toBe('off_platform')
    expect(trustChannelBucket('subdomain')).toBe('off_platform')
  })
  test('embed is its own bucket', () => {
    expect(trustChannelBucket('embed')).toBe('embed')
  })
  test('defaults to platform when unset', () => {
    expect(trustChannelBucket()).toBe('platform')
  })
})

test.describe('trust-signals · full variant (the PDP block)', () => {
  test('shows the pills + both method grids when data is present', () => {
    const v = selectTrustSignals(FULL)
    expect(v.showProcessingPill).toBe(true)
    expect(v.showReturnsPill).toBe(true)
    expect(v.showPaymentGrid).toBe(true)
    expect(v.showFulfillmentGrid).toBe(true)
  })
  test('full variant never re-renders identity (that lives in SellerTrustCard)', () => {
    const v = selectTrustSignals(FULL)
    expect(v.showVerified).toBe(false)
    expect(v.showProtection).toBe(false)
  })
  test('each pill/grid is gated on its own data', () => {
    expect(selectTrustSignals({ ...FULL, processingLabel: null }).showProcessingPill).toBe(false)
    expect(selectTrustSignals({ ...FULL, returnsLabel: null }).showReturnsPill).toBe(false)
    expect(selectTrustSignals({ ...FULL, hasPayment: false }).showPaymentGrid).toBe(false)
    expect(selectTrustSignals({ ...FULL, hasFulfillment: false }).showFulfillmentGrid).toBe(false)
  })
  test('variant defaults to full when unset', () => {
    const { variant: _omit, ...noVariant } = FULL
    expect(selectTrustSignals(noVariant).showPaymentGrid).toBe(true)
  })
})

test.describe('trust-signals · slim variant (the negotiation capsule)', () => {
  const slim: TrustSignalsInput = { ...FULL, variant: 'slim' }

  test('surfaces verification + protection + return window, hides the heavy grids', () => {
    const v = selectTrustSignals(slim)
    expect(v.showVerified).toBe(true)
    expect(v.showProtection).toBe(true)
    expect(v.showReturnsPill).toBe(true)
    expect(v.showPaymentGrid).toBe(false)
    expect(v.showFulfillmentGrid).toBe(false)
    expect(v.showProcessingPill).toBe(false)
  })
  test('each slim chip is gated on its own input', () => {
    expect(selectTrustSignals({ ...slim, verified: false }).showVerified).toBe(false)
    expect(selectTrustSignals({ ...slim, paymentProtected: false }).showProtection).toBe(false)
    expect(selectTrustSignals({ ...slim, returnsLabel: null }).showReturnsPill).toBe(false)
  })
})

test.describe('trust-signals · S2.1 confidence capsule (returns moves up, no duplicate)', () => {
  // The redesign PDP feeds the returns window to the SLIM capsule beside the price and
  // passes `returnsLabel={null}` to the FULL block below, so the signal moves up rather
  // than rendering twice. These assert that contract against the real selector inputs the
  // page passes (verificado · pago protegido · devoluciones in one place).
  const WINDOW = '14 días'

  test('slim capsule fed a window surfaces the returns chip alongside verified + protection', () => {
    const v = selectTrustSignals({
      channel: 'marketplace',
      variant: 'slim',
      hasPayment: false,
      hasFulfillment: false,
      processingLabel: null,
      returnsLabel: WINDOW,
      verified: true,
      paymentProtected: true,
    })
    expect(v.showReturnsPill).toBe(true)
    expect(v.showVerified).toBe(true)
    expect(v.showProtection).toBe(true)
  })

  test('full block fed null returns does NOT render the returns pill (no duplicate)', () => {
    const v = selectTrustSignals({ ...FULL, returnsLabel: null })
    expect(v.showReturnsPill).toBe(false)
    // …while the rest of the full block is untouched.
    expect(v.showPaymentGrid).toBe(true)
    expect(v.showProcessingPill).toBe(true)
  })
})

test.describe('trust-signals · parity-first (every channel shows the same signals for now)', () => {
  test('marketplace, custom_domain, subdomain, embed render identically in C.4', () => {
    const channels: TrustSignalsInput['channel'][] = ['marketplace', 'custom_domain', 'subdomain', 'embed']
    const base = selectTrustSignals({ ...FULL, channel: 'marketplace' })
    for (const channel of channels) {
      expect(selectTrustSignals({ ...FULL, channel })).toEqual(base)
    }
  })
})

test.describe('trust-signals · returnsWindowLabel', () => {
  test('maps the positive windows to es-MX labels', () => {
    expect(returnsWindowLabel('7d')).toBe('7 días')
    expect(returnsWindowLabel('14d')).toBe('14 días')
    expect(returnsWindowLabel('30d')).toBe('30 días')
  })
  test('returns null for absent / "no returns" / unknown windows', () => {
    expect(returnsWindowLabel(null)).toBeNull()
    expect(returnsWindowLabel(undefined)).toBeNull()
    expect(returnsWindowLabel('')).toBeNull()
    expect(returnsWindowLabel('none')).toBeNull()
  })
})

test.describe('trust-signals · copy', () => {
  test('es-MX chip copy is stable', () => {
    expect(TRUST_COPY.verified).toBe('Vendedor verificado')
    expect(TRUST_COPY.protection).toBe('Pago protegido')
    expect(TRUST_COPY.returns('7 días')).toBe('Devoluciones 7 días')
  })
})
