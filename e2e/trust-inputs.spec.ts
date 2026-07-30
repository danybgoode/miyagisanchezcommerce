import { test, expect } from '@playwright/test'
import { deriveShopTrustInputs } from '../lib/trust-inputs'

/**
 * Cross-channel Storefront Trust Parity (#3c · Epic D) — Sprint 1, D.0.
 *
 * Pure-logic guards on the shop-level trust-input deriver — the seam D.1 (embed grid)
 * and D.2 (white-label shell) share to feed Epic C's presentational `<TrustSignals>`.
 * No network, no auth, no `next/*` — runs in the `api` gate. Does NOT duplicate C.4's
 * `selectTrustSignals` spec (that covers which groups *render*); this covers the
 * settings→props derivation C.4 deliberately left to Epic D.
 */

// A fully-configured public projection: MP + Stripe + SPEI + DiMo + WhatsApp,
// local pickup with two spots, a Cal.com booking, 3–5d processing, 14d returns, verified.
const FULL_META = {
  mp_enabled: true,
  settings: {
    theme: { social: { whatsapp: '525512345678' } },
    checkout: {
      whatsapp_cta: true,
      bank_transfer: { enabled: true, configured: true },
      dimo: { enabled: true, configured: true },
    },
    shipping: { local_pickup: true, pickup_spots: [{ name: 'Roma Norte' }, { name: 'Condesa' }] },
    calcom: { connected: true, booking_url: 'https://cal.com/x', event_type_title: 'Cita' },
    orders: { processing_time: '3-5d' },
    returns_policy: { window: '14d' },
    stripe: { connected: true, enabled: true, charges_enabled: true },
    mercadopago: { connected: true, enabled: true },
  },
}

test.describe('trust-inputs · deriveShopTrustInputs', () => {
  test('a fully-configured shop derives every signal group', () => {
    const t = deriveShopTrustInputs(FULL_META, true)
    expect(t.paymentMethods.map(m => m.label)).toEqual(['Mercado Pago', 'Tarjeta', 'SPEI', 'DiMo', 'WhatsApp'])
    expect(t.paymentMethods.find(m => m.label === 'SPEI')?.note).toBe('Transferencia bancaria')
    expect(t.fulfillmentMethods.map(m => m.label)).toEqual(['Recolección local', 'Agenda'])
    expect(t.fulfillmentMethods[0].note).toBe('2 puntos de entrega')
    expect(t.processingLabel).toBe('3–5 días hábiles')
    expect(t.returnsLabel).toBe('14 días')
    expect(t.verified).toBe(true)
    expect(t.paymentProtected).toBe(true)
  })

  test('an empty shop yields empty arrays + null labels (component renders nothing)', () => {
    // An opt-out with no connected status stays unavailable.
    const t = deriveShopTrustInputs({ mp_enabled: false, settings: {} }, false)
    expect(t.paymentMethods).toEqual([])
    expect(t.fulfillmentMethods).toEqual([])
    expect(t.processingLabel).toBeNull()
    expect(t.returnsLabel).toBeNull()
    expect(t.verified).toBe(false)
    expect(t.paymentProtected).toBe(false)
  })

  test('null/undefined metadata is tolerated (no throw, all-empty)', () => {
    for (const m of [null, undefined]) {
      const t = deriveShopTrustInputs(m, undefined)
      expect(t.paymentMethods).toEqual([])
      expect(t.paymentProtected).toBe(false)
      expect(t.fulfillmentMethods).toEqual([])
      expect(t.returnsLabel).toBeNull()
      expect(t.verified).toBe(false)
    }
  })

  test('configured must be explicitly true; enabled false suppresses a configured rail', () => {
    const t = deriveShopTrustInputs({
      settings: {
        checkout: {
          bank_transfer: { configured: false },
          dimo: { configured: true, enabled: false },
        },
      },
    }, false)
    expect(t.paymentMethods).toEqual([])
  })

  test('only 7/14/30-day return windows surface; others are null', () => {
    expect(deriveShopTrustInputs({ settings: { returns_policy: { window: '7d' } } }).returnsLabel).toBe('7 días')
    expect(deriveShopTrustInputs({ settings: { returns_policy: { window: '30d' } } }).returnsLabel).toBe('30 días')
    expect(deriveShopTrustInputs({ settings: { returns_policy: { window: 'none' } } }).returnsLabel).toBeNull()
  })

  test('a single named pickup spot reads its name + address', () => {
    const t = deriveShopTrustInputs({
      settings: { shipping: { local_pickup: true, pickup_spots: [{ name: 'Centro', address: 'Av. Juárez 10' }] } },
    })
    expect(t.fulfillmentMethods[0].note).toBe('Centro · Av. Juárez 10')
  })
})
