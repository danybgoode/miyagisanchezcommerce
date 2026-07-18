'use client'

import { useState, useCallback } from 'react'
import { SellerBreadcrumb } from '../SellerBreadcrumb'

type DiscountType = 'percentage' | 'fixed'

export interface Coupon {
  id: string
  code: string
  type: DiscountType
  value: number
  active: boolean
  expiry: string | null
  usage_limit: number | null
  uses: number
}

function randomCode(len = 7): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

function formatDiscount(c: Coupon): string {
  return c.type === 'percentage' ? `${c.value}%` : `$${c.value.toLocaleString('es-MX')} MXN`
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'Sin vencimiento'
  const d = new Date(iso)
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PromotionsClient({ shopName, initialCoupons }: { shopName: string; initialCoupons: Coupon[] }) {
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Captured once at mount — keeps render pure (no Date.now() in the render body).
  const [now] = useState(() => Date.now())

  // Create form state
  const [code, setCode] = useState('')
  const [type, setType] = useState<DiscountType>('percentage')
  const [value, setValue] = useState('')
  const [expiry, setExpiry] = useState('')
  const [usageLimit, setUsageLimit] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sell/coupons')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || 'Error al cargar cupones.')
      setCoupons(data.coupons ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar cupones.')
    } finally {
      setLoading(false)
    }
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const normalized = code.trim().toUpperCase().replace(/\s+/g, '')
    if (!normalized) { setFormError('Escribe un código o genera uno.'); return }
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) { setFormError('El monto debe ser mayor a cero.'); return }
    if (type === 'percentage' && num > 100) { setFormError('El porcentaje no puede ser mayor a 100.'); return }

    setCreating(true)
    try {
      const res = await fetch('/api/sell/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: normalized,
          type,
          value: num,
          expiry: expiry || null,
          usage_limit: usageLimit ? Number(usageLimit) : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || 'No se pudo crear el cupón.')
      // Reset form + reload
      setCode(''); setType('percentage'); setValue(''); setExpiry(''); setUsageLimit('')
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'No se pudo crear el cupón.')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(c: Coupon) {
    setCoupons(prev => prev.map(x => x.id === c.id ? { ...x, active: !x.active } : x))
    const res = await fetch(`/api/sell/coupons/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !c.active }),
    })
    if (!res.ok) { await load() } // revert from source of truth on failure
  }

  async function remove(c: Coupon) {
    if (!confirm(`¿Eliminar el cupón ${c.code}? Esta acción no se puede deshacer.`)) return
    setCoupons(prev => prev.filter(x => x.id !== c.id))
    const res = await fetch(`/api/sell/coupons/${c.id}`, { method: 'DELETE' })
    if (!res.ok) { await load() }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <SellerBreadcrumb className="mb-1" />
      <h1 className="text-2xl font-bold mb-1">Cupones de descuento</h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        Crea códigos promocionales para {shopName}. Los compradores los aplican al pagar.
      </p>

      {/* Create form */}
      <form onSubmit={handleCreate} className="border border-[var(--color-border)] rounded-[var(--r-md)] p-5 mb-8">
        <h2 className="font-semibold mb-4">Nuevo cupón</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Código</label>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="VERANO20"
                maxLength={24}
                className="flex-1 border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2 text-sm font-mono tracking-wide bg-[var(--color-background)]"
              />
              <button
                type="button"
                onClick={() => setCode(randomCode())}
                className="px-3 py-2 text-sm border border-[var(--border)] rounded-[var(--r-md)] hover:bg-[var(--surface-muted)] whitespace-nowrap"
              >
                Generar
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tipo de descuento</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as DiscountType)}
              className="w-full border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2 text-sm bg-[var(--color-background)]"
            >
              <option value="percentage">Porcentaje (%)</option>
              <option value="fixed">Monto fijo (MXN)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              {type === 'percentage' ? 'Porcentaje' : 'Monto en MXN'}
            </label>
            <input
              type="number"
              min="0"
              step={type === 'percentage' ? '1' : '0.01'}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={type === 'percentage' ? '20' : '100'}
              className="w-full border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2 text-sm bg-[var(--color-background)]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Vencimiento <span className="text-[var(--color-muted)] font-normal">(opcional)</span></label>
            <input
              type="date"
              value={expiry}
              onChange={e => setExpiry(e.target.value)}
              className="w-full border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2 text-sm bg-[var(--color-background)]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Límite de usos <span className="text-[var(--color-muted)] font-normal">(opcional)</span></label>
            <input
              type="number"
              min="1"
              step="1"
              value={usageLimit}
              onChange={e => setUsageLimit(e.target.value)}
              placeholder="Sin límite"
              className="w-full border border-[var(--color-border)] rounded-[var(--r-md)] px-3 py-2 text-sm bg-[var(--color-background)]"
            />
          </div>
        </div>

        {formError && <p className="text-sm text-red-600 mt-3">{formError}</p>}

        <button
          type="submit"
          disabled={creating}
          className="mt-4 px-4 py-2 text-sm font-medium rounded-[var(--r-md)] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {creating ? 'Creando…' : 'Crear cupón'}
        </button>
      </form>

      {/* List */}
      <h2 className="font-semibold mb-3">Tus cupones</h2>
      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : coupons.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Aún no tienes cupones. Crea el primero arriba.</p>
      ) : (
        <ul className="space-y-2">
          {coupons.map(c => {
            const depleted = c.usage_limit != null && c.uses >= c.usage_limit
            const expired = c.expiry != null && new Date(c.expiry).getTime() < now
            return (
              <li
                key={c.id}
                className="flex items-center justify-between gap-4 border border-[var(--color-border)] rounded-[var(--r-md)] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold tracking-wide">{c.code}</span>
                    <span className="text-sm text-[var(--color-muted)]">· {formatDiscount(c)} de descuento</span>
                    {!c.active && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-[var(--r-sm)] bg-gray-100 text-gray-600">Inactivo</span>}
                    {expired && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-[var(--r-sm)] bg-red-100 text-red-600">Vencido</span>}
                    {depleted && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-[var(--r-sm)] bg-amber-100 text-amber-700">Agotado</span>}
                  </div>
                  <div className="text-xs text-[var(--color-muted)] mt-0.5">
                    {formatExpiry(c.expiry)} · {c.usage_limit != null ? `${c.uses} / ${c.usage_limit} usos` : `${c.uses} usos`}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => toggleActive(c)}
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                    title={c.active ? 'Desactivar' : 'Activar'}
                  >
                    {c.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => remove(c)}
                    className="text-xs text-red-600 hover:text-red-700"
                    title="Eliminar"
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
