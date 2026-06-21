import { test, expect } from '@playwright/test'
import { personalizationBuyLabels } from '../lib/personalization'

test.describe('personalizationBuyLabels · personalized-event buy label (S1.2)', () => {
  test('without an override → the default "Comprar ahora" labels (non-event, unchanged)', () => {
    expect(personalizationBuyLabels('$1,200')).toEqual({
      buyNow: 'Comprar ahora — $1,200',
      signIn: 'Inicia sesión para comprar',
    })
  })

  test('with the event override → the boleto labels the page computed upstream', () => {
    expect(
      personalizationBuyLabels('$1,200', {
        buyNowLabel: 'Comprar boleto — $1,200',
        signInBuyLabel: 'Inicia sesión para comprar boleto',
      }),
    ).toEqual({
      buyNow: 'Comprar boleto — $1,200',
      signIn: 'Inicia sesión para comprar boleto',
    })
  })

  test('an empty/undefined override object falls back per-field (no partial override surprises)', () => {
    expect(personalizationBuyLabels('$50', {})).toEqual({
      buyNow: 'Comprar ahora — $50',
      signIn: 'Inicia sesión para comprar',
    })
    expect(personalizationBuyLabels('$50', { buyNowLabel: 'Comprar boleto — $50' })).toEqual({
      buyNow: 'Comprar boleto — $50',
      signIn: 'Inicia sesión para comprar',
    })
  })
})
