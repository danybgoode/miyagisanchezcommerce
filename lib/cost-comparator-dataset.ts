/**
 * lib/cost-comparator-dataset.ts
 *
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 1 · US-1.2) — the
 * PURE half of the sourced, editable dataset. Kept next-free/`server-only`-free
 * (mirrors `lib/copy-overrides-merge.ts`) so the Playwright `api` runner can import
 * it directly, and so the CI guard (`validateDataset`) can run with zero network.
 *
 * `lib/cost-comparator-dataset.json` is the baseline: every figure carries
 * `{ value, source, verifiedAt }` — a competitor number without a source+date is a
 * CI failure (`validateDataset`), never a shipped fact. This file does NOT import
 * that JSON itself (same reason `copy-overrides-merge.ts` imports `Dictionary`
 * type-only, not `locales/*.json` at runtime — see that file's header): every
 * function here takes the dataset as a parameter, so a unit spec can hand it a
 * synthetic dataset with zero JSON/framework involved. The one real runtime read
 * of the JSON lives in `lib/cost-comparator-data.ts` (`server-only`, mirrors
 * `lib/copy-overrides.ts`), the only place that also touches Supabase.
 *
 * Overrides reuse the SAME `platform_copy_overrides` shape/contract as
 * `applyCopyOverrides` (namespace/key/locale/value rows, fail-open, never
 * fabricates new figures) — `namespace: 'comparator'`. It can't reuse
 * `applyCopyOverrides` itself: that seam is STRING-only by design (`copy-tree.ts`
 * skips non-string leaves), and every dataset figure here is a number. So
 * `applyDatasetOverrides` is a numeric sibling with the identical contract: only
 * replaces a figure that already exists, `Number(row.value)` must be finite, and
 * an unparseable/mismatched row is silently skipped (baseline wins) — the dataset
 * defines the universe, an override can never fabricate a new figure.
 */

import type { OverrideRow } from './copy-overrides-merge'
import type {
  ShopifyRates,
  MercadoLibreRates,
  WooCommerceRates,
  TiendanubeRates,
  MiyagiRates,
  PremiumAppOption,
} from './cost-comparator'

export const COMPARATOR_NAMESPACE = 'comparator'

/** One sourced figure — the CI-guarded unit of the dataset. */
export interface DatasetFigure {
  value: number
  source: string
  verifiedAt: string
  label: string
}

export interface ComparatorDataset {
  version: number
  generatedAt: string
  figures: Record<string, DatasetFigure>
}

/** Reads a figure's numeric value, throwing loudly on an unknown key (a coding
 * error, not a runtime/data condition) — every key this module reads is a
 * hardcoded literal below, so a throw here means the JSON and this file drifted. */
function value(dataset: ComparatorDataset, key: string): number {
  const figure = dataset.figures[key]
  if (!figure) throw new Error(`cost-comparator dataset: missing figure "${key}"`)
  return figure.value
}

// ---------------------------------------------------------------------------
// CI guard — every figure needs a non-empty source + a plausible ISO date.
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Returns a list of problems (empty = clean). `now` is injectable for specs. */
export function validateDataset(dataset: ComparatorDataset, now: Date = new Date()): string[] {
  const problems: string[] = []
  for (const [key, figure] of Object.entries(dataset.figures)) {
    if (!figure.source || !figure.source.trim()) {
      problems.push(`${key}: missing source`)
    }
    if (!figure.verifiedAt || !ISO_DATE_RE.test(figure.verifiedAt)) {
      problems.push(`${key}: verifiedAt is not an ISO date (YYYY-MM-DD)`)
    } else if (new Date(figure.verifiedAt).getTime() > now.getTime()) {
      problems.push(`${key}: verifiedAt is in the future`)
    }
    if (!Number.isFinite(figure.value)) {
      problems.push(`${key}: value is not a finite number`)
    }
    if (!figure.label || !figure.label.trim()) {
      problems.push(`${key}: missing label`)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Fail-open numeric override merge — the `applyCopyOverrides` sibling.
// ---------------------------------------------------------------------------

/**
 * Apply every `namespace: 'comparator'` override row matching `locale` onto
 * `dataset`. Immutable: returns a new object, `dataset` is never mutated. A row
 * whose `key` doesn't match an existing figure, or whose `value` doesn't parse to
 * a finite number, is silently skipped — mirrors `applyCopyOverrides`'s
 * never-fabricate contract exactly.
 */
export function applyDatasetOverrides(
  dataset: ComparatorDataset,
  overrides: readonly OverrideRow[],
  locale: string = 'es',
): ComparatorDataset {
  let figures = dataset.figures
  let changed = false
  for (const row of overrides) {
    if (row.namespace !== COMPARATOR_NAMESPACE) continue
    if (row.locale !== locale) continue
    const existing = figures[row.key]
    if (!existing) continue
    const parsed = Number(row.value)
    if (!Number.isFinite(parsed)) continue
    figures = { ...figures, [row.key]: { ...existing, value: parsed } }
    changed = true
  }
  return changed ? { ...dataset, figures } : dataset
}

// ---------------------------------------------------------------------------
// Pure adapter — sourced dataset → the plain rate bags lib/cost-comparator.ts
// consumes. This is the ONLY place that knows the dataset's figure keys.
// ---------------------------------------------------------------------------

export function shopifyRatesFromDataset(dataset: ComparatorDataset): ShopifyRates {
  return {
    planMonthlyUsd: {
      basico: value(dataset, 'shopify.plan.basico.monthlyUsd'),
      crecimiento: value(dataset, 'shopify.plan.crecimiento.monthlyUsd'),
      avanzado: value(dataset, 'shopify.plan.avanzado.monthlyUsd'),
    },
    paymentPct: {
      basico: value(dataset, 'shopify.payment.basico.pct'),
      crecimiento: value(dataset, 'shopify.payment.crecimiento.pct'),
      avanzado: value(dataset, 'shopify.payment.avanzado.pct'),
    },
    paymentFixedMxn: value(dataset, 'shopify.payment.fixedMxn'),
    fxUsdToMxn: value(dataset, 'fx.usdToMxn'),
  }
}

export function mercadoLibreRatesFromDataset(dataset: ComparatorDataset): MercadoLibreRates {
  return {
    commissionPct: {
      baja: {
        clasica: value(dataset, 'mercadolibre.commission.baja.clasicaPct'),
        premium: value(dataset, 'mercadolibre.commission.baja.premiumPct'),
      },
      media: {
        clasica: value(dataset, 'mercadolibre.commission.media.clasicaPct'),
        premium: value(dataset, 'mercadolibre.commission.media.premiumPct'),
      },
      alta: {
        clasica: value(dataset, 'mercadolibre.commission.alta.clasicaPct'),
        premium: value(dataset, 'mercadolibre.commission.alta.premiumPct'),
      },
    },
    fixedFeeMxn: {
      under99: value(dataset, 'mercadolibre.fixedFee.under99Mxn'),
      under149: value(dataset, 'mercadolibre.fixedFee.under149Mxn'),
      under299: value(dataset, 'mercadolibre.fixedFee.under299Mxn'),
    },
  }
}

export function wooCommerceRatesFromDataset(dataset: ComparatorDataset): WooCommerceRates {
  return {
    hostingMonthlyUsd: {
      entrada: value(dataset, 'woocommerce.hosting.entrada.monthlyUsd'),
      crecimiento: value(dataset, 'woocommerce.hosting.crecimiento.monthlyUsd'),
    },
    paymentPct: value(dataset, 'woocommerce.payment.pct'),
    paymentFixedMxn: value(dataset, 'woocommerce.payment.fixedMxn'),
    fxUsdToMxn: value(dataset, 'fx.usdToMxn'),
  }
}

export function tiendanubeRatesFromDataset(dataset: ComparatorDataset): TiendanubeRates {
  return {
    planMonthlyMxn: {
      gratis: value(dataset, 'tiendanube.plan.gratis.monthlyMxn'),
      basico: value(dataset, 'tiendanube.plan.basico.monthlyMxn'),
      tiendanube: value(dataset, 'tiendanube.plan.tiendanube.monthlyMxn'),
      avanzado: value(dataset, 'tiendanube.plan.avanzado.monthlyMxn'),
    },
    ownGatewayPct: {
      gratis: value(dataset, 'tiendanube.gateway.gratis.pct'),
      basico: value(dataset, 'tiendanube.gateway.basico.pct'),
      tiendanube: value(dataset, 'tiendanube.gateway.tiendanube.pct'),
      avanzado: value(dataset, 'tiendanube.gateway.avanzado.pct'),
    },
    ownGatewayFixedMxn: value(dataset, 'tiendanube.gateway.fixedMxn'),
    externalGatewayPct: {
      gratis: value(dataset, 'tiendanube.external.gratis.pct'),
      basico: value(dataset, 'tiendanube.external.basico.pct'),
      tiendanube: value(dataset, 'tiendanube.external.tiendanube.pct'),
      avanzado: value(dataset, 'tiendanube.external.avanzado.pct'),
    },
  }
}

export function miyagiRatesFromDataset(dataset: ComparatorDataset): MiyagiRates {
  return {
    subdomainMonthlyMxn: value(dataset, 'miyagi.sku.subdomain.monthlyMxn'),
    customDomainMonthlyMxn: value(dataset, 'miyagi.sku.customDomain.monthlyMxn'),
    mlSyncMonthlyMxn: value(dataset, 'miyagi.sku.mlSync.monthlyMxn'),
    paymentPct: value(dataset, 'miyagi.payment.pct'),
    paymentFixedMxn: value(dataset, 'miyagi.payment.fixedMxn'),
  }
}

/** The three premium-app toggles the UI offers (US-1.3) — each one Miyagi already
 * includes natively, hence `miyagiIncluded: true` on all of them by construction. */
export function premiumAppsFromDataset(dataset: ComparatorDataset): PremiumAppOption[] {
  return [
    {
      id: 'liveChat',
      label: 'Chat en vivo / mensajería',
      monthlyUsd: value(dataset, 'apps.liveChat.competitorMonthlyUsd'),
      miyagiIncluded: true,
    },
    {
      id: 'coupons',
      label: 'Cupones y descuentos',
      monthlyUsd: value(dataset, 'apps.coupons.competitorMonthlyUsd'),
      miyagiIncluded: true,
    },
    {
      id: 'offers',
      label: 'Ofertas y negociación de precio',
      monthlyUsd: value(dataset, 'apps.offers.competitorMonthlyUsd'),
      miyagiIncluded: true,
    },
  ]
}

export function fxUsdToMxnFromDataset(dataset: ComparatorDataset): number {
  return value(dataset, 'fx.usdToMxn')
}
