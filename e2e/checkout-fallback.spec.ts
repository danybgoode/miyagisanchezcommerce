import { test, expect } from '@playwright/test'
import { shouldOfferCoordinatedFallback, pickManualPaymentId } from '../lib/checkout-fallback'

test.describe('checkout-fallback · shouldOfferCoordinatedFallback (S3.2)', () => {
  test('never while a quote is loading', () => {
    expect(shouldOfferCoordinatedFallback({ loading: true, error: 'boom', ratesCount: 0, message: 'x' })).toBe(false)
  })

  test('offered on a hard error (carrier failure / timeout / unreachable)', () => {
    expect(shouldOfferCoordinatedFallback({ loading: false, error: 'El envío tardó demasiado.', ratesCount: 0, message: null })).toBe(true)
  })

  test('offered when zero rates come back with a no-coverage message', () => {
    expect(shouldOfferCoordinatedFallback({ loading: false, error: null, ratesCount: 0, message: 'Sin cobertura para ese destino.' })).toBe(true)
  })

  test('NOT offered when usable rates exist', () => {
    expect(shouldOfferCoordinatedFallback({ loading: false, error: null, ratesCount: 3, message: null })).toBe(false)
  })

  test('NOT offered on an empty-but-silent settle (no error, no message)', () => {
    expect(shouldOfferCoordinatedFallback({ loading: false, error: null, ratesCount: 0, message: null })).toBe(false)
  })
})

test.describe('checkout-fallback · pickManualPaymentId (S3.2)', () => {
  test('returns the first manual ("pago directo") method id', () => {
    const methods = [
      { id: 'stripe' as const, kind: 'online' as const },
      { id: 'manual' as const, kind: 'manual' as const },
    ]
    expect(pickManualPaymentId(methods)).toBe('manual')
  })

  test('returns null when the seller offers no manual method (card-only)', () => {
    const methods = [
      { id: 'stripe' as const, kind: 'online' as const },
      { id: 'mercadopago' as const, kind: 'online' as const },
    ]
    expect(pickManualPaymentId(methods)).toBeNull()
  })

  test('returns null for an empty list', () => {
    expect(pickManualPaymentId([])).toBeNull()
  })
})
