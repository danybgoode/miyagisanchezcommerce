import { expect, test } from '@playwright/test'
import {
  computeShopifyCost,
  computeMercadoLibreCost,
  computeWooCommerceCost,
  computeTiendanubeCost,
  computeMiyagiCost,
  computeSelectedAppsMonthlyMxn,
  combineStacks,
  applyLineOverrides,
  formatMxn,
  type ShopifyRates,
  type MercadoLibreRates,
  type WooCommerceRates,
  type TiendanubeRates,
  type MiyagiRates,
  type PremiumAppOption,
} from '../lib/cost-comparator'

// Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 1 · US-1.1) — unit
// coverage for the PURE stacked-cost model. Synthetic rates throughout (not the real
// sourced dataset — that's lib/cost-comparator-dataset.ts's job, covered by
// cost-comparator-dataset.spec.ts) so every number here is hand-computable and this
// spec never drifts when a competitor re-prices.

test.describe('cost-comparator · Shopify', () => {
  const rates: ShopifyRates = {
    planMonthlyUsd: { basico: 20, crecimiento: 50, avanzado: 400 },
    paymentPct: { basico: 3, crecimiento: 2, avanzado: 1 },
    paymentFixedMxn: 2,
    fxUsdToMxn: 20,
  }
  const inputs = { volumeMonthly: 10, aovMxn: 100 } // revenue = 1000

  test('stacks plan + payment processing, tier-dependent', () => {
    const result = computeShopifyCost(inputs, 'basico', rates)
    // plan: 20 * 20 = 400. payment: 1000*0.03 + 10*2 = 30 + 20 = 50. apps: 0.
    expect(result.lines.find((l) => l.key === 'plan')?.monthlyMxn).toBe(400)
    expect(result.lines.find((l) => l.key === 'payment')?.monthlyMxn).toBe(50)
    expect(result.monthlyTotalMxn).toBe(450)
    expect(result.annualTotalMxn).toBe(5400)
  })

  test('a higher tier changes both the plan fee and the payment rate', () => {
    const result = computeShopifyCost(inputs, 'avanzado', rates)
    // plan: 400 * 20 = 8000. payment: 1000*0.01 + 10*2 = 10 + 20 = 30.
    expect(result.lines.find((l) => l.key === 'plan')?.monthlyMxn).toBe(8000)
    expect(result.lines.find((l) => l.key === 'payment')?.monthlyMxn).toBe(30)
    expect(result.monthlyTotalMxn).toBe(8030)
  })

  test('apps stack on top of the platform total', () => {
    const result = computeShopifyCost(inputs, 'basico', rates, 25)
    expect(result.lines.find((l) => l.key === 'apps')?.monthlyMxn).toBe(25)
    expect(result.monthlyTotalMxn).toBe(475)
  })
})

test.describe('cost-comparator · Mercado Libre', () => {
  const rates: MercadoLibreRates = {
    commissionPct: {
      baja: { clasica: 10, premium: 12.5 },
      media: { clasica: 13, premium: 16 },
      alta: { clasica: 15, premium: 19.5 },
    },
    fixedFeeMxn: { under99: 25, under149: 30, under299: 37 },
  }

  test('Clásica under $99 carries the low-price fixed surcharge', () => {
    const inputs = { volumeMonthly: 10, aovMxn: 50 } // revenue = 500
    const result = computeMercadoLibreCost(inputs, 'media', 'clasica', rates)
    expect(result.lines.find((l) => l.key === 'commission')?.monthlyMxn).toBe(65) // 500*0.13
    expect(result.lines.find((l) => l.key === 'fixedFee')?.monthlyMxn).toBe(250) // 25*10
    expect(result.monthlyTotalMxn).toBe(315)
  })

  test('Premium never carries the fixed surcharge, even under $99', () => {
    const inputs = { volumeMonthly: 10, aovMxn: 50 }
    const result = computeMercadoLibreCost(inputs, 'media', 'premium', rates)
    expect(result.lines.find((l) => l.key === 'fixedFee')?.monthlyMxn).toBe(0)
    expect(result.monthlyTotalMxn).toBe(80) // 500*0.16
  })

  test('an item at $299+ carries no fixed surcharge even on Clásica', () => {
    const inputs = { volumeMonthly: 10, aovMxn: 300 }
    const result = computeMercadoLibreCost(inputs, 'media', 'clasica', rates)
    expect(result.lines.find((l) => l.key === 'fixedFee')?.monthlyMxn).toBe(0)
  })

  test('an override to the commission rate changes the total (US-1.1 override coverage)', () => {
    const overridden: MercadoLibreRates = {
      ...rates,
      commissionPct: { ...rates.commissionPct, media: { clasica: 20, premium: 16 } },
    }
    const inputs = { volumeMonthly: 10, aovMxn: 50 }
    const result = computeMercadoLibreCost(inputs, 'media', 'clasica', overridden)
    expect(result.lines.find((l) => l.key === 'commission')?.monthlyMxn).toBe(100) // 500*0.20
    expect(result.monthlyTotalMxn).toBe(350) // 100 + 250 fixed fee
  })
})

test.describe('cost-comparator · WooCommerce', () => {
  const rates: WooCommerceRates = {
    hostingMonthlyUsd: { entrada: 15, crecimiento: 25 },
    paymentPct: 3.6,
    paymentFixedMxn: 3,
    fxUsdToMxn: 20,
  }
  const inputs = { volumeMonthly: 10, aovMxn: 100 } // revenue = 1000

  test('hosting + your own gateway rate', () => {
    const result = computeWooCommerceCost(inputs, 'entrada', rates)
    expect(result.lines.find((l) => l.key === 'hosting')?.monthlyMxn).toBe(300) // 15*20
    expect(result.lines.find((l) => l.key === 'payment')?.monthlyMxn).toBe(66) // 1000*.036 + 10*3
    expect(result.monthlyTotalMxn).toBe(366)
  })
})

test.describe('cost-comparator · Tiendanube', () => {
  const rates: TiendanubeRates = {
    planMonthlyMxn: { gratis: 0, basico: 149, tiendanube: 374, avanzado: 999 },
    ownGatewayPct: { gratis: 3.99, basico: 3.49, tiendanube: 3.39, avanzado: 3.29 },
    ownGatewayFixedMxn: 3,
    externalGatewayPct: { gratis: 2, basico: 1, tiendanube: 0.6, avanzado: 0 },
  }
  const inputs = { volumeMonthly: 10, aovMxn: 100 } // revenue = 1000

  test('Pago Nube (own gateway) stacks plan + tier-rated processing with a fixed fee', () => {
    const result = computeTiendanubeCost(inputs, 'basico', true, rates)
    expect(result.lines.find((l) => l.key === 'plan')?.monthlyMxn).toBe(149)
    expect(result.lines.find((l) => l.key === 'payment')?.monthlyMxn).toBe(64.9) // 1000*.0349 + 10*3
    expect(result.monthlyTotalMxn).toBe(213.9)
  })

  test('an external gateway uses the lower platform cut with no Pago Nube fixed fee', () => {
    const result = computeTiendanubeCost(inputs, 'basico', false, rates)
    expect(result.lines.find((l) => l.key === 'payment')?.monthlyMxn).toBe(10) // 1000*.01
    expect(result.monthlyTotalMxn).toBe(159)
  })
})

test.describe('cost-comparator · Miyagi (the comparison side — the Miyagi shape)', () => {
  const rates: MiyagiRates = {
    subdomainMonthlyMxn: 25,
    customDomainMonthlyMxn: 42,
    mlSyncMonthlyMxn: 30,
    paymentPct: 3.6,
    paymentFixedMxn: 3,
  }
  const inputs = { volumeMonthly: 10, aovMxn: 100 } // revenue = 1000

  test('0% commission always, payment processing is the only mandatory cost', () => {
    const result = computeMiyagiCost(inputs, { subdomain: false, customDomain: false, mlSync: false }, rates)
    expect(result.lines.find((l) => l.key === 'commission')?.monthlyMxn).toBe(0)
    expect(result.lines.find((l) => l.key === 'payment')?.monthlyMxn).toBe(66) // 1000*.036 + 10*3
    expect(result.monthlyTotalMxn).toBe(66)
  })

  test('opting into every SKU stacks each one on top', () => {
    const result = computeMiyagiCost(inputs, { subdomain: true, customDomain: true, mlSync: true }, rates)
    expect(result.monthlyTotalMxn).toBe(66 + 25 + 42 + 30)
  })

  test('apps are always $0 — the "incluido" line', () => {
    const result = computeMiyagiCost(inputs, { subdomain: false, customDomain: false, mlSync: false }, rates)
    expect(result.lines.find((l) => l.key === 'apps')?.monthlyMxn).toBe(0)
  })
})

test.describe('cost-comparator · premium apps', () => {
  const apps: PremiumAppOption[] = [
    { id: 'a', label: 'A', monthlyUsd: 10, miyagiIncluded: true },
    { id: 'b', label: 'B', monthlyUsd: 20, miyagiIncluded: true },
  ]

  test('sums only the selected apps, converted to MXN', () => {
    expect(computeSelectedAppsMonthlyMxn(apps, ['a'], 20)).toBe(200)
    expect(computeSelectedAppsMonthlyMxn(apps, ['a', 'b'], 20)).toBe(600)
    expect(computeSelectedAppsMonthlyMxn(apps, [], 20)).toBe(0)
  })
})

test.describe('cost-comparator · combos + overrides + formatting', () => {
  test('combineStacks sums two independent channel stacks (marketplace + own site)', () => {
    const stackA = computeMiyagiCost({ volumeMonthly: 1, aovMxn: 100 }, { subdomain: false, customDomain: false, mlSync: false }, {
      subdomainMonthlyMxn: 0, customDomainMonthlyMxn: 0, mlSyncMonthlyMxn: 0, paymentPct: 0, paymentFixedMxn: 100,
    })
    const stackB = computeMiyagiCost({ volumeMonthly: 1, aovMxn: 100 }, { subdomain: false, customDomain: false, mlSync: false }, {
      subdomainMonthlyMxn: 0, customDomainMonthlyMxn: 0, mlSyncMonthlyMxn: 0, paymentPct: 0, paymentFixedMxn: 50,
    })
    const combined = combineStacks(stackA, stackB)
    expect(combined.monthlyTotalMxn).toBe(stackA.monthlyTotalMxn + stackB.monthlyTotalMxn)
  })

  test('applyLineOverrides replaces a rendered line and recomputes totals (US-1.3 inline edit)', () => {
    const base = computeShopifyCost({ volumeMonthly: 10, aovMxn: 100 }, 'basico', {
      planMonthlyUsd: { basico: 20, crecimiento: 50, avanzado: 400 },
      paymentPct: { basico: 3, crecimiento: 2, avanzado: 1 },
      paymentFixedMxn: 2,
      fxUsdToMxn: 20,
    })
    expect(base.monthlyTotalMxn).toBe(450)
    const edited = applyLineOverrides(base, { plan: 999 })
    expect(edited.lines.find((l) => l.key === 'plan')?.monthlyMxn).toBe(999)
    expect(edited.monthlyTotalMxn).toBe(999 + 50)
    // The original stack is untouched (pure — no mutation).
    expect(base.lines.find((l) => l.key === 'plan')?.monthlyMxn).toBe(400)
  })

  test('formatMxn is the single es-MX currency formatter the UI and specs share', () => {
    expect(formatMxn(1234.5)).toBe('$1,234.50')
    expect(formatMxn(0)).toBe('$0.00')
  })
})
