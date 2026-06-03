'use client'

import { useState, useCallback } from 'react'

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

function randomCode(len = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

function formatDiscount(c: Coupon): string {
  return c.type === 'percentage' ? `${c.value}%` : `$${c.value.toLocaleString('es-MX')} MXN`
}

export default function AdminCouponsClient({ secret, initialCoupons }: { secret: string; initialCoupons: Coupon[] }) {
  const q = `?secret=${encodeURIComponent(secret)}`
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [code, setCode] = useState('')
  const [type, setType] = useState<DiscountType>('fixed')
  const [value, setValue] = useState('')
  const [expiry, setExpiry] = useState('')
  const [usageLimit, setUsageLimit] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/coupons${q}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || 'Error al cargar cupones.')
      setCoupons(data.coupons ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar cupones.')
    } finally {
      setLoading(false)
    }
  }, [q])

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
      const res = await fetch(`/api/admin/coupons${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalized, type, value: num, expiry: expiry || null, usage_limit: usageLimit ? Number(usageLimit) : null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || 'No se pudo crear el cupón.')
      setCode(''); setType('fixed'); setValue(''); setExpiry(''); setUsageLimit('')
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'No se pudo crear el cupón.')
    } finally {
      setCreating(false)
    }
  }

  async function remove(c: Coupon) {
    if (!confirm(`¿Eliminar el cupón ${c.code}?`)) return
    setCoupons(prev => prev.filter(x => x.id !== c.id))
    const res = await fetch(`/api/admin/coupons${q}&id=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    if (!res.ok) await load()
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">Cupones de plataforma</h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        Códigos redimibles en la compra de anuncios impresos (tienda <strong>miyagiprints</strong>).
        Sirven para promociones de plataforma y como recompensa de referidos.
      </p>

      <form onSubmit={handleCreate} className="border border-[var(--color-border)] rounded-xl p-5 mb-8">
        <h2 className="font-semibold mb-4">Nuevo cupón de plataforma</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Código</label>
            <div className="flex gap-2">
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="MUNDIAL100" maxLength={24}
                className="flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono tracking-wide bg-[var(--color-background)]" />
              <button type="button" onClick={() => setCode(randomCode())}
                className="px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-muted-bg,#f5f5f5)] whitespace-nowrap">Generar</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tipo de descuento</label>
            <select value={type} onChange={e => setType(e.target.value as DiscountType)}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-background)]">
              <option value="fixed">Monto fijo (MXN)</option>
              <option value="percentage">Porcentaje (%)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{type === 'percentage' ? 'Porcentaje' : 'Monto en MXN'}</label>
            <input type="number" min="0" step={type === 'percentage' ? '1' : '0.01'} value={value} onChange={e => setValue(e.target.value)}
              placeholder={type === 'percentage' ? '50' : '100'}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-background)]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Vencimiento <span className="text-[var(--color-muted)] font-normal">(opcional)</span></label>
            <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-background)]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Límite de usos <span className="text-[var(--color-muted)] font-normal">(opcional)</span></label>
            <input type="number" min="1" step="1" value={usageLimit} onChange={e => setUsageLimit(e.target.value)} placeholder="Sin límite"
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-background)]" />
          </div>
        </div>
        {formError && <p className="text-sm text-red-600 mt-3">{formError}</p>}
        <button type="submit" disabled={creating}
          className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50">
          {creating ? 'Creando…' : 'Crear cupón'}
        </button>
      </form>

      <h2 className="font-semibold mb-3">Cupones activos</h2>
      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : coupons.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Aún no hay cupones de plataforma.</p>
      ) : (
        <ul className="space-y-2">
          {coupons.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-4 border border-[var(--color-border)] rounded-xl px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-semibold tracking-wide">{c.code}</span>
                  <span className="text-sm text-[var(--color-muted)]">· {formatDiscount(c)} de descuento</span>
                  {!c.active && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Inactivo</span>}
                </div>
                <div className="text-xs text-[var(--color-muted)] mt-0.5">
                  {c.expiry ? new Date(c.expiry).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Sin vencimiento'}
                  {' · '}{c.usage_limit != null ? `${c.uses} / ${c.usage_limit} usos` : `${c.uses} usos`}
                </div>
              </div>
              <button onClick={() => remove(c)} className="text-xs text-red-600 hover:text-red-700 shrink-0">Eliminar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
