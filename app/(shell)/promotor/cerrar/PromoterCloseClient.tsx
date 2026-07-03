'use client'

import { useState } from 'react'

type Bound = { code: string; name: string | null } | null
type Shop = { shopId: string; slug: string; name: string }

/**
 * Promoter "close" workspace client island (epic 08 · S4). Four steps for the
 * in-store motion: (1) bind your PRM- code, (2) set up the merchant's shop,
 * (3) charge a SKU on their behalf (a picker over the one-time close routes —
 * domain / ml-sync), (4) hand off the WhatsApp claim link.
 * Thin screens over /api/promoter/{me/bind,shop/setup,close/<sku>,claim/link}.
 */
export default function PromoterCloseClient({ bound: initialBound }: { bound: Bound }) {
  const [bound, setBound] = useState<Bound>(initialBound)
  const [shop, setShop] = useState<Shop | null>(null)

  if (!bound) return <BindStep onBound={setBound} />

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Cerrar venta</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Promotor <span className="font-mono font-semibold">{bound.code}</span>
          {bound.name && <span className="ml-2">· {bound.name}</span>}
        </p>
      </header>

      <SetupStep shop={shop} onShop={setShop} />
      {shop && <CloseStep shop={shop} />}
      {shop && <HandoffStep shop={shop} />}
    </div>
  )
}

function Card({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      <h2 className="font-semibold">
        <span className="text-[var(--color-muted)] mr-2">{n}.</span>{title}
      </h2>
      {children}
    </section>
  )
}

function BindStep({ onBound }: { onBound: (b: Bound) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function bind() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/promoter/me/bind', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo vincular.'); return }
      onBound(data.promoter)
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Vincula tu código</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Ingresa tu código de promotor (PRM-…) para empezar a cerrar ventas.
        </p>
      </header>
      <div className="space-y-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="PRM-XXXXXX"
          className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 font-mono"
        />
        {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
        <button
          onClick={bind}
          disabled={busy || !code.trim()}
          className="rounded-lg bg-[var(--color-accent)] text-[var(--fg-inverse)] px-4 py-2 font-medium disabled:opacity-50"
        >
          {busy ? 'Vinculando…' : 'Vincular código'}
        </button>
      </div>
    </div>
  )
}

function SetupStep({ shop, onShop }: { shop: Shop | null; onShop: (s: Shop) => void }) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function setup() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/promoter/shop/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, location }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo crear.'); return }
      onShop({ shopId: data.shopId, slug: data.slug, name: data.name })
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  return (
    <Card n={1} title="Montar la tienda">
      {shop ? (
        <p className="text-sm">
          ✅ <strong>{shop.name}</strong> · <a className="underline" href={`/s/${shop.slug}`} target="_blank" rel="noreferrer">/s/{shop.slug}</a>
        </p>
      ) : (
        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del negocio"
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2" />
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ubicación (opcional)"
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2" />
          {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
          <button onClick={setup} disabled={busy || name.trim().length < 2}
            className="rounded-lg bg-[var(--color-accent)] text-[var(--fg-inverse)] px-4 py-2 font-medium disabled:opacity-50">
            {busy ? 'Creando…' : 'Crear tienda'}
          </button>
        </div>
      )}
    </Card>
  )
}

/**
 * The one-time SKUs a promoter can close on a merchant's behalf — each maps to a
 * `/api/promoter/close/<id>` route that takes `{ shopId }` and returns `{ url }`
 * (a Stripe checkout redirect) OR, for `subdomain` when the admin has configured
 * the free-first-year perk (Sprint 3 · US-3.1/US-3.2), `{ free: true }` with NO
 * redirect — the grant activates immediately, no charge.
 * (Print is a different flow — it needs ad content — so it's not in this picker.)
 */
const CLOSE_SKUS = [
  { id: 'domain', label: 'Dominio propio', payLabel: 'Pagar dominio propio (1 año)' },
  { id: 'subdomain', label: 'Subdominio propio', payLabel: 'Activar subdominio (1 año)' },
  { id: 'ml-sync', label: 'Sincronización Mercado Libre', payLabel: 'Pagar sincronización ML (1 año)' },
] as const
type CloseSkuId = (typeof CLOSE_SKUS)[number]['id']

function CloseStep({ shop }: { shop: Shop }) {
  const [sku, setSku] = useState<CloseSkuId>('domain')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const selected = CLOSE_SKUS.find((s) => s.id === sku) ?? CLOSE_SKUS[0]

  async function pay() {
    setBusy(true); setError(null); setDone(null)
    try {
      const res = await fetch(`/api/promoter/close/${sku}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shop.shopId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo iniciar el pago.'); return }
      if (data.free) { setDone('¡Listo! El subdominio ya está activo — sin costo, primer año GRATIS.'); return }
      if (!data.url) { setError('No se pudo iniciar el pago.'); return }
      window.location.href = data.url
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  return (
    <Card n={2} title="Cobrar y pagar (a nombre del comerciante)">
      <p className="text-sm text-[var(--color-muted)]">
        Cobra al comerciante (efectivo) y paga con tu tarjeta. La venta se atribuye a tu código y el
        beneficio queda activado en la tienda del comerciante.
      </p>
      <label className="block text-sm">
        <span className="text-[var(--color-muted)]">Producto</span>
        <select
          value={sku}
          onChange={(e) => { setSku(e.target.value as CloseSkuId); setDone(null); setError(null) }}
          disabled={busy}
          aria-label="Producto a cerrar"
          className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2"
        >
          {CLOSE_SKUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {done && <p className="text-sm text-[color:var(--success)]">{done}</p>}
      {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
      <button onClick={pay} disabled={busy}
        className="rounded-lg bg-[var(--color-accent)] text-[var(--fg-inverse)] px-4 py-2 font-medium disabled:opacity-50">
        {busy ? 'Abriendo pago…' : selected.payLabel}
      </button>
    </Card>
  )
}

function HandoffStep({ shop }: { shop: Shop }) {
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function genLink() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/promoter/claim/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shop.shopId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo generar el enlace.'); return }
      setLink(data.whatsappLink)
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  return (
    <Card n={3} title="Entregar por WhatsApp">
      <p className="text-sm text-[var(--color-muted)]">
        Genera el enlace de reclamo y compártelo con el comerciante. Al tocarlo e iniciar sesión, la
        tienda pasa a su cuenta — tu atribución se conserva.
      </p>
      {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
      {link ? (
        <a href={link} target="_blank" rel="noreferrer"
          className="inline-block rounded-lg bg-[color:var(--provider-whatsapp)] text-[color:var(--fg-inverse)] px-4 py-2 font-medium">
          Abrir en WhatsApp →
        </a>
      ) : (
        <button onClick={genLink} disabled={busy}
          className="rounded-lg bg-[var(--color-accent)] text-[var(--fg-inverse)] px-4 py-2 font-medium disabled:opacity-50">
          {busy ? 'Generando…' : 'Generar enlace de reclamo'}
        </button>
      )}
    </Card>
  )
}
