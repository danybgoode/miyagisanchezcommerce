'use client'

import {
  type PriceGrid,
  type PriceGridVariant,
  formatPriceGridAmount,
} from '@/lib/price-grid'

/**
 * Seller-facing "Opciones" section for a listing's priced option dimensions +
 * quantity tiers (custom-print-products Story 2.4). Reads the SAME price-grid
 * the public PDP renders (`GET /store/listings/:id/price-grid`), so what the
 * seller sees here is provably what buyers see.
 *
 * Backend contract (apps/backend src/api/store/_utils/seller-product-update.ts):
 * dimensions can only be ADDED to a listing still on its single Default
 * variant, never edited afterwards (422), and never on a listing with order
 * history (422) — this section states those limits honestly instead of hiding
 * them. The price-grid route only serves PUBLISHED listings, so a paused/
 * draft listing gets an "activate first" state (Daniel-confirmed scope call,
 * 2026-07-05: no backend change for drafts).
 */
export default function OpcionesSection({
  priceGrid,
  isActive,
  currency,
}: {
  priceGrid: PriceGrid | null
  isActive: boolean
  currency: string
}) {
  const variants = priceGrid?.variants ?? []
  const isMultiVariant = variants.length > 1

  // Dimension titles in first-seen order (same derivation as ConfiguratorBuyBox).
  const dimensionTitles: string[] = []
  for (const v of variants) {
    for (const title of Object.keys(v.options)) {
      if (!dimensionTitles.includes(title)) dimensionTitles.push(title)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-1">
        <label className="block text-sm font-medium text-[var(--color-text)]">
          Opciones y precios por combinación
        </label>
        {isMultiVariant && (
          <span className="text-xs text-[var(--color-muted)]">{variants.length} combinaciones</span>
        )}
      </div>
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Dimensiones como Tamaño o Material, cada combinación con su propio precio y niveles de
        precio por cantidad — como lo ve el comprador en tu anuncio.
      </p>

      {!isActive ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg px-4 py-5 text-center">
          <p className="text-sm text-[var(--color-muted)]">
            Activa el anuncio primero para configurar o ver sus opciones.
          </p>
        </div>
      ) : !priceGrid ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg px-4 py-5 text-center">
          <p className="text-sm text-[var(--color-muted)]">
            No se pudieron cargar las opciones. Recarga la página para intentarlo de nuevo.
          </p>
        </div>
      ) : isMultiVariant ? (
        <ConfiguredView variants={variants} dimensionTitles={dimensionTitles} currency={currency} />
      ) : (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg px-4 py-5 text-center">
          <p className="text-sm text-[var(--color-muted)]">Sin opciones configuradas.</p>
        </div>
      )}
    </div>
  )
}

/** Read-only render of the configured dimensions + per-combination prices. */
function ConfiguredView({
  variants,
  dimensionTitles,
  currency,
}: {
  variants: PriceGridVariant[]
  dimensionTitles: string[]
  currency: string
}) {
  return (
    <div>
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--color-background)] text-left">
                {dimensionTitles.map(t => (
                  <th key={t} className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">{t}</th>
                ))}
                <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs text-right">Precio</th>
              </tr>
            </thead>
            <tbody>
              {variants.map(v => (
                <tr key={v.id} className="border-t border-[var(--color-border)]">
                  {dimensionTitles.map(t => (
                    <td key={t} className="px-3 py-2 text-[var(--color-text)]">{v.options[t] ?? '—'}</td>
                  ))}
                  <td className="px-3 py-2 text-right text-[var(--color-text)] whitespace-nowrap">
                    <VariantPriceLabel variant={v} currency={currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-[var(--color-muted)] mt-2">
        Las dimensiones de un anuncio con opciones no se pueden editar todavía — para cambiarlas,
        crea un anuncio nuevo. Los precios, niveles por cantidad y stock por combinación sí se
        pueden ajustar.
      </p>
    </div>
  )
}

function VariantPriceLabel({ variant, currency }: { variant: PriceGridVariant; currency: string }) {
  const tiers = variant.tiers
  if (tiers.length === 0) return <span className="text-[var(--color-muted)]">—</span>
  if (tiers.length === 1) return <span>{formatPriceGridAmount(tiers[0].amount, currency)}</span>
  const amounts = tiers.map(t => t.amount)
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  return (
    <span>
      {formatPriceGridAmount(min, currency)}–{formatPriceGridAmount(max, currency)}
      <span className="text-xs text-[var(--color-muted)]"> · {tiers.length} niveles</span>
    </span>
  )
}
