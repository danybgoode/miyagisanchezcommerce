'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  readPriceGrid,
  type PriceGrid,
  type PriceGridVariant,
  formatPriceGridAmount,
} from '@/lib/price-grid'
import {
  MAX_OPTION_DIMENSIONS,
  MAX_VARIANT_COMBOS,
  MAX_DIMENSION_TEXT_LEN,
  buildVariantComboKey,
  cartesianCombos,
  sanitizeDimensions,
  validateDimensionsClient,
  parsePesosToCents,
} from '@/lib/opciones'

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
 * them. `option_dimensions` cannot ride the form's main "Guardar cambios" PUT
 * (the backend rejects it combined with price_cents/quantity/variant_tiers),
 * so this section owns its save. The price-grid route only serves PUBLISHED
 * listings, so a paused/draft listing gets an "activate first" state
 * (Daniel-confirmed scope call, 2026-07-05: no backend change for drafts).
 */
export default function OpcionesSection({
  productId,
  priceGrid,
  isActive,
  currency,
}: {
  productId: string
  priceGrid: PriceGrid | null
  isActive: boolean
  currency: string
}) {
  const router = useRouter()
  // Local copy so a successful convert can swap in the refetched grid without
  // waiting for the server re-render.
  const [grid, setGrid] = useState<PriceGrid | null>(priceGrid)
  const variants = grid?.variants ?? []
  const isMultiVariant = variants.length > 1

  async function refetchGrid() {
    try {
      const res = await fetch(`/api/sell/listing/${productId}/price-grid`, { cache: 'no-store' })
      if (res.ok) {
        const fresh = readPriceGrid(await res.json())
        if (fresh) setGrid(fresh)
      }
    } catch { /* keep the current grid; the server refresh below still lands */ }
    router.refresh()
  }

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
      ) : !grid ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg px-4 py-5 text-center">
          <p className="text-sm text-[var(--color-muted)]">
            No se pudieron cargar las opciones. Recarga la página para intentarlo de nuevo.
          </p>
        </div>
      ) : isMultiVariant ? (
        <ConfiguredView variants={variants} dimensionTitles={dimensionTitles} currency={currency} />
      ) : (
        <DimensionsEditor
          productId={productId}
          manageInventory={variants[0]?.manage_inventory ?? false}
          currency={currency}
          onConverted={refetchGrid}
        />
      )}
    </div>
  )
}

// ── Configured view (dimensions exist) ───────────────────────────────────────

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

// ── Dimensions editor (single-variant listing → convert) ────────────────────

interface DimensionDraft {
  key: number
  title: string
  values: string[]
}

/**
 * Add up to 3 dimensions + a price per generated combination, then convert the
 * listing in ONE bounded request (`{option_dimensions, variant_prices}` —
 * matching the backend's mutual-exclusivity guard). The convert is
 * irreversible (dimensions aren't editable yet) and, on a managed-inventory
 * listing, every new combination starts at stock 0 — both stated in an inline
 * confirm step before anything is sent.
 */
function DimensionsEditor({
  productId,
  manageInventory,
  currency,
  onConverted,
}: {
  productId: string
  manageInventory: boolean
  currency: string
  onConverted: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [dims, setDims] = useState<DimensionDraft[]>([])
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sanitized = sanitizeDimensions(dims.map(d => ({ title: d.title, values: d.values })))
  const readyDims = sanitized.filter(d => d.title && d.values.length > 0)
  const combos = readyDims.length > 0 ? cartesianCombos(readyDims) : []
  const comboCount = combos.length
  const overComboCap = comboCount > MAX_VARIANT_COMBOS

  const allPriced = combos.length > 0 && combos.every(c => parsePesosToCents(prices[buildVariantComboKey(c)] ?? '') != null)
  const validation = validateDimensionsClient(sanitized)
  const canSubmit = validation.ok && allPriced && !overComboCap && !saving

  function updateDim(key: number, patch: Partial<DimensionDraft>) {
    setDims(dims.map(d => (d.key === key ? { ...d, ...patch } : d)))
  }

  async function handleConvert() {
    if (!validation.ok) { setError(validation.message); return }
    const variantPrices: Record<string, number> = {}
    for (const combo of combos) {
      const cents = parsePesosToCents(prices[buildVariantComboKey(combo)] ?? '')
      if (cents == null) { setError(`Falta el precio para la combinación ${buildVariantComboKey(combo)}.`); return }
      variantPrices[buildVariantComboKey(combo)] = cents
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/sell/listing/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_dimensions: readyDims, variant_prices: variantPrices }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        // The backend's es-MX 422s (order history, already configured, missing
        // combo price…) surface verbatim.
        setError(data.error ?? 'Error al guardar las opciones.')
        setConfirming(false)
        return
      }
      await onConverted()
    } catch {
      setError('Sin conexión. Verifica tu internet e inténtalo de nuevo.')
      setConfirming(false)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="border border-dashed border-[var(--color-border)] rounded-lg px-4 py-5 text-center">
        <p className="text-sm text-[var(--color-muted)] mb-2">Sin opciones configuradas.</p>
        <button
          type="button"
          onClick={() => { setOpen(true); if (dims.length === 0) setDims([{ key: 1, title: '', values: [''] }]) }}
          className="text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          + Agregar opciones con precio (Tamaño, Material…)
        </button>
      </div>
    )
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-background)] space-y-3">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm flex items-start gap-2">
          <span className="mt-0.5 shrink-0">⚠</span>
          <p>{error}</p>
        </div>
      )}

      {/* Dimension rows */}
      <div className="space-y-3">
        {dims.map((dim, idx) => (
          <div key={dim.key} className="border border-[var(--color-border)] rounded-lg p-3 bg-white">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-[var(--color-muted)]">Dimensión {idx + 1}</span>
              <button
                type="button"
                onClick={() => setDims(dims.filter(d => d.key !== dim.key))}
                aria-label="Eliminar dimensión"
                className="text-red-500 hover:text-red-600 px-1"
              >✕</button>
            </div>
            <input
              type="text"
              value={dim.title}
              onChange={e => updateDim(dim.key, { title: e.target.value })}
              maxLength={MAX_DIMENSION_TEXT_LEN}
              placeholder="Nombre (p. ej. Tamaño)"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
            />
            <p className="text-xs text-[var(--color-muted)] mb-1">Valores</p>
            <div className="space-y-1.5">
              {dim.values.map((val, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={val}
                    onChange={e => {
                      const values = [...dim.values]
                      values[i] = e.target.value
                      updateDim(dim.key, { values })
                    }}
                    maxLength={MAX_DIMENSION_TEXT_LEN}
                    placeholder={`Valor ${i + 1} (p. ej. ${idx === 0 ? '5cm' : 'vinil'})`}
                    className="flex-1 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => updateDim(dim.key, { values: dim.values.filter((_, j) => j !== i) })}
                    aria-label="Quitar valor"
                    className="text-red-500 hover:text-red-600 px-1"
                  >✕</button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => updateDim(dim.key, { values: [...dim.values, ''] })}
              className="mt-1.5 text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              + Agregar valor
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        {dims.length < MAX_OPTION_DIMENSIONS ? (
          <button
            type="button"
            onClick={() => setDims(prev => [...prev, { key: prev.reduce((m, d) => Math.max(m, d.key), 0) + 1, title: '', values: [''] }])}
            className="text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            + Agregar dimensión
          </button>
        ) : <span className="text-xs text-[var(--color-muted)]">Máximo {MAX_OPTION_DIMENSIONS} dimensiones.</span>}
        <span className={`text-xs ${overComboCap ? 'text-red-600 font-medium' : 'text-[var(--color-muted)]'}`}>
          {comboCount} / {MAX_VARIANT_COMBOS} combinaciones
        </span>
      </div>

      {/* Per-combination price grid */}
      {comboCount > 0 && !overComboCap && (
        <div>
          <p className="text-sm font-medium text-[var(--color-text)] mb-1">
            Precio por combinación ({currency})
          </p>
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-background)] text-left">
                    {readyDims.map(d => (
                      <th key={d.title} className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs">{d.title}</th>
                    ))}
                    <th className="px-3 py-2 font-medium text-[var(--color-muted)] text-xs text-right">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map(combo => {
                    const key = buildVariantComboKey(combo)
                    return (
                      <tr key={key} className="border-t border-[var(--color-border)]">
                        {readyDims.map(d => (
                          <td key={d.title} className="px-3 py-1.5 text-[var(--color-text)]">{combo[d.title]}</td>
                        ))}
                        <td className="px-3 py-1.5 text-right">
                          <div className="relative inline-block">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-xs">$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={prices[key] ?? ''}
                              onChange={e => setPrices(prev => ({ ...prev, [key]: e.target.value }))}
                              placeholder="0.00"
                              className="w-24 border border-[var(--color-border)] rounded pl-5 pr-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Convert — inline confirm step (no browser dialog) */}
      {!confirming ? (
        <button
          type="button"
          onClick={() => { setError(null); if (validation.ok && allPriced) setConfirming(true); else setError(!validation.ok ? validation.message : 'Ponle precio a cada combinación antes de continuar.') }}
          disabled={saving}
          className="w-full bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[var(--color-accent-hover)] transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Crear {comboCount > 0 ? `${comboCount} combinaciones` : 'combinaciones'}
        </button>
      ) : (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
          <p className="text-sm text-amber-800 mb-1 font-medium">¿Convertir este anuncio a producto con opciones?</p>
          <ul className="text-xs text-amber-800 list-disc pl-4 space-y-0.5 mb-3">
            <li>Las dimensiones no se podrán editar después (para cambiarlas tendrás que crear un anuncio nuevo).</li>
            <li>El precio único actual se reemplaza por el precio de cada combinación.</li>
            {manageInventory && (
              <li>Cada combinación empieza con stock 0 — ajústalo aquí mismo después de crear las combinaciones para que se pueda comprar.</li>
            )}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConvert}
              disabled={saving}
              className="flex-1 bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[var(--color-accent-hover)] transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? 'Creando…' : '✓ Confirmar y crear'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={saving}
              className="flex-1 border border-[var(--color-border)] text-[var(--color-text)] font-medium py-2.5 rounded-lg text-sm hover:bg-[var(--color-background)] transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
