/**
 * lib/preview-inventory.ts
 *
 * Founding merchant consent-safe previews · Sprint 3.2 — the PURE categorizer behind
 * the read-only historical inventory of promoter-created public/unclaimed shops.
 *
 * Locked decision #4: existing public/unclaimed shops are AUDITED, not bulk-mutated.
 * This module therefore only ever classifies and recommends — it performs no writes
 * and knows nothing about the database. `scripts/preview-inventory.ts` supplies the
 * rows (read-only queries) and renders the artifact.
 *
 * Deliberately zero imports so the classification is directly unit-testable from a
 * Playwright `api` spec, and so a rerun over the same dataset is provably
 * deterministic (no clock, no randomness, no I/O — the report body carries no
 * timestamp for exactly this reason).
 */

export type Provenance = 'promoter' | 'import' | 'unknown'
export type ClaimState = 'claimed' | 'unclaimed'

/**
 * Review categories. These RECOMMEND a disposition for a human to decide; nothing
 * here mutates or auto-applies anything.
 */
export type ReviewCategory =
  | 'merchant_owned'
  | 'in_consent_flow'
  | 'activated_via_consent'
  | 'public_unclaimed_promoter'
  | 'public_unclaimed_other'
  | 'no_public_presence'

export interface InventoryShop {
  id: string
  slug: string
  name: string
  /** `promoter://CODE/slug`, a scraped http(s) URL, or null/absent. */
  sourceUrl: string | null
  /** null ⇒ unclaimed. */
  clerkUserId: string | null
  /** Count of listings currently public (mirror status 'active'). */
  publicListingCount: number
  /** Does the shop carry a consent-preview anchor at all? */
  hasAnchor: boolean
  /** The anchor's lifecycle status, when it has one. */
  anchorStatus: string | null
  /** ISO timestamp of the last relevant activity, or null when unknown. */
  lastActivityAt: string | null
}

export interface InventoryRow extends InventoryShop {
  provenance: Provenance
  claimState: ClaimState
  category: ReviewCategory
  /** Plain-language es-MX recommendation for the human reviewing this row. */
  recommendation: string
}

export interface InventoryReport {
  rows: InventoryRow[]
  summary: {
    total: number
    byCategory: Record<ReviewCategory, number>
    byProvenance: Record<Provenance, number>
  }
}

/**
 * Where did this shop come from? Unknown is a first-class answer — the acceptance
 * requires unknown provenance to be LABELED unknown, never guessed into a bucket.
 */
export function classifyProvenance(sourceUrl: string | null | undefined): Provenance {
  const url = (sourceUrl ?? '').trim()
  if (!url) return 'unknown'
  if (url.toLowerCase().startsWith('promoter://')) return 'promoter'
  if (/^https?:\/\//i.test(url)) return 'import'
  return 'unknown'
}

const RECOMMENDATION: Record<ReviewCategory, string> = {
  merchant_owned:
    'El comerciante ya es dueño de la tienda. Sin acción: la nueva regla de consentimiento no aplica a tiendas reclamadas.',
  in_consent_flow:
    'Ya está en el flujo de consentimiento (vista previa privada). Sin acción histórica.',
  activated_via_consent:
    'Se publicó con aprobación explícita del comerciante. Sin acción.',
  public_unclaimed_promoter:
    'Pública y sin reclamar, creada por un promotor ANTES de la regla de consentimiento. Revisar con el promotor: confirmar con el comerciante, o retirar.',
  public_unclaimed_other:
    'Pública y sin reclamar, de origen distinto al de promotores. Revisar la procedencia antes de decidir.',
  no_public_presence:
    'Sin productos públicos. Prioridad baja: no hay nada expuesto hoy.',
}

/**
 * Categorize one shop. The order of the checks IS the policy:
 *  1. A CLAIMED shop is the merchant's own — the consent rule never applies to it.
 *  2. An anchored shop is already governed by this epic (private, or activated with
 *     explicit approval).
 *  3. What remains is the historical population: unclaimed, unanchored shops —
 *     split by whether anything is actually public, and by provenance.
 */
export function categorizeShop(shop: InventoryShop): InventoryRow {
  const provenance = classifyProvenance(shop.sourceUrl)
  const claimState: ClaimState = shop.clerkUserId ? 'claimed' : 'unclaimed'

  let category: ReviewCategory
  if (claimState === 'claimed') {
    category = 'merchant_owned'
  } else if (shop.hasAnchor && shop.anchorStatus === 'activated') {
    category = 'activated_via_consent'
  } else if (shop.hasAnchor) {
    category = 'in_consent_flow'
  } else if ((shop.publicListingCount ?? 0) <= 0) {
    category = 'no_public_presence'
  } else if (provenance === 'promoter') {
    category = 'public_unclaimed_promoter'
  } else {
    category = 'public_unclaimed_other'
  }

  return { ...shop, provenance, claimState, category, recommendation: RECOMMENDATION[category] }
}

/** Stable ordering: highest-attention category first, then slug. Never by clock. */
const CATEGORY_ORDER: ReviewCategory[] = [
  'public_unclaimed_promoter',
  'public_unclaimed_other',
  'no_public_presence',
  'in_consent_flow',
  'activated_via_consent',
  'merchant_owned',
]

/**
 * Build the full report. Pure + total: the same input rows always produce a
 * byte-identical report (deterministic rerun, per the acceptance).
 */
export function buildInventoryReport(shops: InventoryShop[]): InventoryReport {
  const rows = (shops ?? []).map(categorizeShop).sort((a, b) => {
    const byCategory = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    if (byCategory !== 0) return byCategory
    return a.slug.localeCompare(b.slug, 'en')
  })

  const byCategory = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<ReviewCategory, number>
  const byProvenance: Record<Provenance, number> = { promoter: 0, import: 0, unknown: 0 }
  for (const row of rows) {
    byCategory[row.category] += 1
    byProvenance[row.provenance] += 1
  }

  return { rows, summary: { total: rows.length, byCategory, byProvenance } }
}

/** Render the report as a deterministic Markdown artifact (no clock, no ids churn). */
export function renderInventoryMarkdown(report: InventoryReport): string {
  const lines: string[] = []
  lines.push('# Inventario histórico — tiendas públicas / sin reclamar')
  lines.push('')
  lines.push('Reporte de SOLO LECTURA (founding-merchant-consent-previews S3.2). Generarlo no')
  lines.push('modifica ninguna tienda ni producto. La disposición histórica se decide a mano.')
  lines.push('')
  lines.push(`**Total de tiendas:** ${report.summary.total}`)
  lines.push('')
  lines.push('## Resumen por categoría')
  lines.push('')
  lines.push('| Categoría | Tiendas |')
  lines.push('|---|---:|')
  for (const category of CATEGORY_ORDER) {
    lines.push(`| ${category} | ${report.summary.byCategory[category]} |`)
  }
  lines.push('')
  lines.push('## Resumen por procedencia')
  lines.push('')
  lines.push('| Procedencia | Tiendas |')
  lines.push('|---|---:|')
  for (const provenance of ['promoter', 'import', 'unknown'] as Provenance[]) {
    lines.push(`| ${provenance} | ${report.summary.byProvenance[provenance]} |`)
  }
  lines.push('')
  lines.push('## Tiendas')
  lines.push('')
  lines.push('| Categoría | Tienda | Slug | Procedencia | Reclamo | Productos públicos | Última actividad |')
  lines.push('|---|---|---|---|---|---:|---|')
  for (const row of report.rows) {
    lines.push(
      `| ${row.category} | ${row.name} | ${row.slug} | ${row.provenance} | ${row.claimState} | ` +
        `${row.publicListingCount} | ${row.lastActivityAt ?? 'desconocida'} |`,
    )
  }
  lines.push('')
  lines.push('## Recomendaciones')
  lines.push('')
  for (const category of CATEGORY_ORDER) {
    if (report.summary.byCategory[category] === 0) continue
    lines.push(`- **${category}** — ${RECOMMENDATION[category]}`)
  }
  lines.push('')
  return lines.join('\n')
}
