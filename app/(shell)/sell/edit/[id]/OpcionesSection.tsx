'use client'

import { useEffect, useState } from 'react'
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
  parseCostPesosToCents,
  rowsFromTiers,
  buildTierLadder,
  tierRangeLabel,
  type TierRowDraft,
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
  variantCosts = {},
}: {
  productId: string
  priceGrid: PriceGrid | null
  isActive: boolean
  currency: string
  /** Per-variant unit costs (COGS) by variant id — seller-private (US-1). */
  variantCosts?: Record<string, number | null>
}) {
  const router = useRouter()
  // A post-save refetch overrides the server-provided grid until the server
  // re-render catches up; otherwise the PROP stays authoritative — trapping
  // the prop in useState would ignore later prop updates (e.g. the grid
  // arriving after the seller activates a paused listing; cross-agent review
  // catch, Antigravity, 2026-07-05).
  const [localGrid, setLocalGrid] = useState<PriceGrid | null>(null)
  // Every router.refresh() re-serializes the server prop (fetched no-store),
  // so a fresh prop always supersedes the post-save override — without this,
  // the override would shadow prop updates until a full remount.
  useEffect(() => { setLocalGrid(null) }, [priceGrid])
  const grid = localGrid ?? priceGrid
  const variants = grid?.variants ?? []
  const isMultiVariant = variants.length > 1

  async function refetchGrid() {
    try {
      const res = await fetch(`/api/sell/listing/${productId}/price-grid`, { cache: 'no-store' })
      if (res.ok) {
        const fresh = readPriceGrid(await res.json())
        if (fresh) setLocalGrid(fresh)
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
        <ConfiguredView
          productId={productId}
          variants={variants}
          dimensionTitles={dimensionTitles}
          currency={currency}
          variantCosts={variantCosts}
          onSaved={refetchGrid}
        />
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

/**
 * Per-variant cards: each combination shows its price/tier summary and expands
 * into an editor for its quantity-tier ladder (a flat price is a one-row
 * ladder — everything saves through `variant_tiers`, one backend path) and,
 * when inventory-managed, its stock (write-only: no store route exposes
 * per-variant stock, so the input sets a new value rather than showing one).
 */
function ConfiguredView({
  productId,
  variants,
  dimensionTitles,
  currency,
  variantCosts,
  onSaved,
}: {
  productId: string
  variants: PriceGridVariant[]
  dimensionTitles: string[]
  currency: string
  variantCosts: Record<string, number | null>
  onSaved: () => Promise<void>
}) {
  return (
    <div>
      <div className="space-y-2">
        {variants.map(v => (
          <VariantCard
            key={v.id}
            productId={productId}
            variant={v}
            dimensionTitles={dimensionTitles}
            currency={currency}
            initialCostCents={variantCosts[v.id] ?? null}
            onSaved={onSaved}
          />
        ))}
      </div>
      <p className="text-xs text-[var(--color-muted)] mt-2">
        Las dimensiones de un anuncio con opciones no se pueden editar todavía — para cambiarlas,
        crea un anuncio nuevo. Los precios, niveles por cantidad y stock por combinación sí se
        pueden ajustar.
      </p>
    </div>
  )
}

function VariantCard({
  productId,
  variant,
  dimensionTitles,
  currency,
  initialCostCents,
  onSaved,
}: {
  productId: string
  variant: PriceGridVariant
  dimensionTitles: string[]
  currency: string
  initialCostCents: number | null
  onSaved: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const comboLabel = dimensionTitles.map(t => variant.options[t]).filter(Boolean).join(' / ')

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-background)]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-[var(--color-text)]">{comboLabel || 'Variante'}</span>
        <span className="flex items-center gap-2 text-sm text-[var(--color-text)] whitespace-nowrap">
          <VariantPriceLabel variant={variant} currency={currency} />
          <span className="text-xs text-[var(--color-accent)] font-medium">{open ? 'Cerrar' : 'Editar'}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] p-3 space-y-4">
          <TierLadderEditor
            productId={productId}
            variantId={variant.id}
            initialTiers={variant.tiers}
            currency={currency}
            onSaved={onSaved}
          />
          <CostEditor
            productId={productId}
            variantId={variant.id}
            initialCostCents={initialCostCents}
            currency={currency}
            onSaved={onSaved}
          />
          {variant.manage_inventory && (
            <StockEditor productId={productId} variantId={variant.id} onSaved={onSaved} />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The variant's price ladder: one row per tier ("desde N piezas → $precio"),
 * `max_quantity` always derived from the NEXT row's start (see
 * `buildTierLadder`) so the seller structurally cannot create the gaps/
 * overlaps the backend 422s on. One row = a flat price.
 */
function TierLadderEditor({
  productId,
  variantId,
  initialTiers,
  currency,
  onSaved,
}: {
  productId: string
  variantId: string
  initialTiers: PriceGridVariant['tiers']
  currency: string
  onSaved: () => Promise<void>
}) {
  const [rows, setRows] = useState<TierRowDraft[]>(() =>
    initialTiers.length > 0 ? rowsFromTiers(initialTiers) : [{ minRaw: '1', priceRaw: '' }],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function update(i: number, patch: Partial<TierRowDraft>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function handleSave() {
    const built = buildTierLadder(rows)
    if (!built.ok) { setError(built.message); return }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/sell/listing/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant_id: variantId, variant_tiers: built.tiers }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        // The backend's es-MX 422 (e.g. the overlap/gap ladder message)
        // surfaces verbatim if anything slips past the constructive builder.
        setError(data.error ?? 'Error al guardar los niveles de precio.')
        return
      }
      setSaved(true)
      await onSaved()
    } catch {
      setError('Sin conexión. Verifica tu internet e inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-text)] mb-1">
        Precio por cantidad ({currency})
      </p>
      <p className="text-xs text-[var(--color-muted)] mb-2">
        Un solo nivel = precio fijo. Agrega niveles para dar descuento por volumen — cada nivel
        aplica desde esa cantidad hasta donde empieza el siguiente.
      </p>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm mb-2 flex items-start gap-2">
          <i className="iconoir-warning-triangle mt-0.5 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}
      {saved && !error && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded px-3 py-2 text-sm mb-2">
          <i className="iconoir-check" aria-hidden /> Niveles guardados.
        </div>
      )}
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              Desde
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={row.minRaw}
                disabled={i === 0}
                onChange={e => update(i, { minRaw: e.target.value.replace(/[^0-9]/g, '') })}
                className="w-16 border border-[var(--color-border)] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent disabled:opacity-60"
              />
              pzas
            </label>
            <span className="text-xs text-[var(--color-muted)] w-14 text-center whitespace-nowrap">
              ({tierRangeLabel(rows, i)})
            </span>
            <div className="relative flex-1 min-w-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-xs">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={row.priceRaw}
                onChange={e => update(i, { priceRaw: e.target.value })}
                placeholder="0.00"
                className="w-full border border-[var(--color-border)] rounded pl-5 pr-2 py-1.5 text-sm text-right bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
              />
            </div>
            <span className="text-xs text-[var(--color-muted)]">c/u</span>
            <button
              type="button"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              disabled={i === 0}
              aria-label="Quitar nivel"
              className="text-red-500 hover:text-red-600 px-1 disabled:opacity-30"
            ><i className="iconoir-xmark" aria-hidden /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <button
          type="button"
          onClick={() => setRows([...rows, { minRaw: '', priceRaw: '' }])}
          className="text-xs font-medium text-[var(--color-accent)] hover:underline"
        >
          + Agregar nivel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-[var(--color-accent)] text-white font-semibold px-4 py-1.5 rounded-lg text-xs hover:bg-[var(--color-accent-hover)] transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? 'Guardando…' : 'Guardar niveles'}
        </button>
      </div>
    </div>
  )
}

/**
 * Per-variant unit cost (COGS) — seller-private (buyers never see it; the
 * profit ledger snapshots it at sale time, so edits never rewrite history).
 * Saves through the same PUT as price/stock ({ variant_id, unit_cost_cents });
 * empty clears it (profit-analyzer S1 · US-1).
 */
function CostEditor({
  productId,
  variantId,
  initialCostCents,
  currency,
  onSaved,
}: {
  productId: string
  variantId: string
  initialCostCents: number | null
  currency: string
  onSaved: () => Promise<void>
}) {
  const [raw, setRaw] = useState(initialCostCents != null ? String(initialCostCents / 100) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    const cents = raw.trim() !== '' ? parseCostPesosToCents(raw) : null
    if (raw.trim() !== '' && cents === null) { setError('El costo debe ser de $0 o más.'); return }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/sell/listing/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant_id: variantId, unit_cost_cents: cents }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Error al guardar el costo.')
        return
      }
      setSaved(true)
      await onSaved()
    } catch {
      setError('Sin conexión. Verifica tu internet e inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-text)] mb-1">
        Costo unitario ({currency}) <span className="text-xs text-[var(--color-muted)] font-normal">— privado</span>
      </p>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm mb-2 flex items-start gap-2">
          <i className="iconoir-warning-triangle mt-0.5 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}
      {saved && !error && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded px-3 py-2 text-sm mb-2">
          <i className="iconoir-check" aria-hidden /> Costo guardado.
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-xs">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder="0.00"
            className="w-28 border border-[var(--color-border)] rounded pl-5 pr-2 py-1.5 text-sm text-right bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-[var(--color-accent)] text-white font-semibold px-4 py-1.5 rounded-lg text-xs hover:bg-[var(--color-accent-hover)] transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? 'Guardando…' : 'Guardar costo'}
        </button>
      </div>
      <p className="text-xs text-[var(--color-muted)] mt-1">
        Lo que te cuesta esta combinación. Solo tú lo ves — alimenta tu análisis de ganancias.
        Déjalo vacío para quitarlo.
      </p>
    </div>
  )
}

/**
 * Write-only per-variant stock: no store route exposes per-variant quantities
 * (the price-grid only carries `manage_inventory`), so this sets a new value
 * rather than editing the current one — stated in the helper copy.
 */
function StockEditor({
  productId,
  variantId,
  onSaved,
}: {
  productId: string
  variantId: string
  onSaved: () => Promise<void>
}) {
  const [raw, setRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    const qty = parseInt(raw, 10)
    if (!Number.isInteger(qty) || qty < 0) { setError('Pon una cantidad de 0 o más.'); return }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/sell/listing/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant_id: variantId, quantity: qty }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Error al guardar el stock.')
        return
      }
      setSaved(true)
      await onSaved()
    } catch {
      setError('Sin conexión. Verifica tu internet e inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-text)] mb-1">Stock de esta combinación</p>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm mb-2 flex items-start gap-2">
          <i className="iconoir-warning-triangle mt-0.5 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}
      {saved && !error && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded px-3 py-2 text-sm mb-2">
          <i className="iconoir-check" aria-hidden /> Stock actualizado.
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={raw}
          onChange={e => setRaw(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="p. ej. 100"
          className="w-28 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || raw.trim() === ''}
          className="bg-[var(--color-accent)] text-white font-semibold px-4 py-1.5 rounded-lg text-xs hover:bg-[var(--color-accent-hover)] transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? 'Guardando…' : 'Guardar stock'}
        </button>
      </div>
      <p className="text-xs text-[var(--color-muted)] mt-1">
        Fija el stock disponible de esta combinación al valor que pongas (las combinaciones nuevas
        empiezan en 0). Pon 0 para marcarla como agotada.
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
          <i className="iconoir-warning-triangle mt-0.5 shrink-0" aria-hidden />
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
              ><i className="iconoir-xmark" aria-hidden /></button>
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
                  ><i className="iconoir-xmark" aria-hidden /></button>
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
              {saving ? 'Creando…' : <><i className="iconoir-check" aria-hidden /> Confirmar y crear</>}
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
