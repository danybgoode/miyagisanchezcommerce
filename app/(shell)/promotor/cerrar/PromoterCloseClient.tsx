'use client'

import { useEffect, useState } from 'react'

type Bound = { code: string; name: string | null } | null
type Shop = { shopId: string; slug: string; name: string }

/** Promoter Funnel v2 · Sprint 4 (US-4.1) — a net-remittance transfer request. */
type Transfer = {
  id: string
  sku: string
  method: 'spei' | 'dimo' | 'codi'
  owed_cents: number
  transfer_details: { clabe?: string; bank_name?: string; account_holder?: string; dimo_phone?: string; codi_reference?: string }
  status: 'pending' | 'reported' | 'approved' | 'rejected'
}

/**
 * Promoter "close" workspace client island (epic 08 · S4). Four steps for the
 * in-store motion: (1) bind your PRM- code, (2) set up the merchant's shop,
 * (3) charge a SKU on their behalf (a picker over the one-time close routes —
 * domain / ml-sync — with an optional net-remittance transfer alongside Stripe,
 * Sprint 4 · US-4.1), (4) hand off the WhatsApp claim link.
 * Thin screens over /api/promoter/{me/bind,shop/setup,close/<sku>,close/transfer/*,claim/link}.
 */
export default function PromoterCloseClient({ bound: initialBound, transferEnabled }: { bound: Bound; transferEnabled: boolean }) {
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
      {shop && <CloseStep shop={shop} transferEnabled={transferEnabled} />}
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

const TRANSFER_METHOD_LABEL: Record<Transfer['method'], string> = {
  spei: 'SPEI',
  dimo: 'DiMo',
  codi: 'CoDi',
}

const mxn = (cents: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(cents / 100)

function CloseStep({ shop, transferEnabled }: { shop: Shop; transferEnabled: boolean }) {
  const [sku, setSku] = useState<CloseSkuId>('domain')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<'stripe' | 'transfer'>('stripe')
  const [transferMethod, setTransferMethod] = useState<Transfer['method']>('spei')
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [reporting, setReporting] = useState(false)

  const selected = CLOSE_SKUS.find((s) => s.id === sku) ?? CLOSE_SKUS[0]

  // Restore a persisted transfer for this shop+SKU on mount / SKU change — so a
  // reload after "Ya transferí" doesn't lose the "pendiente de aprobación" state.
  useEffect(() => {
    if (!transferEnabled) { setTransfer(null); return }
    const transferSku = sku === 'ml-sync' ? 'ml_sync' : sku
    let cancelled = false
    fetch(`/api/promoter/close/transfer?shopId=${encodeURIComponent(shop.shopId)}&sku=${transferSku}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setTransfer(data?.transfer ?? null) })
      .catch(() => { /* best-effort restore — a fresh close is still possible */ })
    return () => { cancelled = true }
  }, [shop.shopId, sku, transferEnabled])

  async function pay() {
    setBusy(true); setError(null); setDone(null)
    try {
      const res = await fetch(`/api/promoter/close/${sku}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: shop.shopId,
          ...(payMethod === 'transfer' ? { paymentMethod: 'transfer', transferMethod } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo iniciar el pago.'); return }
      if (data.transfer) { setTransfer(data.transfer); return }
      if (data.free) { setDone('¡Listo! El subdominio ya está activo — sin costo, primer año GRATIS.'); return }
      if (!data.url) { setError('No se pudo iniciar el pago.'); return }
      window.location.href = data.url
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setBusy(false) }
  }

  async function reportTransfer() {
    if (!transfer) return
    setReporting(true); setError(null)
    try {
      const res = await fetch(`/api/promoter/close/transfer/${encodeURIComponent(transfer.id)}/report`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo reportar la transferencia.'); return }
      setTransfer(data.transfer)
    } catch { setError('Error de red. Intenta de nuevo.') }
    finally { setReporting(false) }
  }

  // A transfer already exists for this shop+SKU — show its state instead of the picker.
  if (transfer) {
    return (
      <Card n={2} title="Cobrar y pagar (a nombre del comerciante)">
        {transfer.status === 'pending' && (
          <div className="space-y-3">
            <p className="text-sm">
              Transfiere <span className="font-semibold">{mxn(transfer.owed_cents)}</span> vía{' '}
              <span className="font-semibold">{TRANSFER_METHOD_LABEL[transfer.method]}</span>:
            </p>
            <ul className="text-sm space-y-1 rounded-lg bg-[var(--color-surface)] p-3">
              {transfer.transfer_details.clabe && <li>CLABE: <span className="font-mono">{transfer.transfer_details.clabe}</span></li>}
              {transfer.transfer_details.bank_name && <li>Banco: {transfer.transfer_details.bank_name}</li>}
              {transfer.transfer_details.account_holder && <li>Titular: {transfer.transfer_details.account_holder}</li>}
              {transfer.transfer_details.dimo_phone && <li>DiMo: {transfer.transfer_details.dimo_phone}</li>}
              {transfer.transfer_details.codi_reference && <li>CoDi: {transfer.transfer_details.codi_reference}</li>}
            </ul>
            {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
            <button onClick={reportTransfer} disabled={reporting}
              className="rounded-lg bg-[var(--color-accent)] text-[var(--fg-inverse)] px-4 py-2 font-medium disabled:opacity-50">
              {reporting ? 'Reportando…' : 'Ya transferí'}
            </button>
          </div>
        )}
        {transfer.status === 'reported' && (
          <p className="text-sm text-[color:var(--success)]">
            Transferencia reportada — pendiente de aprobación. Te avisamos en cuanto se confirme.
          </p>
        )}
        {transfer.status === 'approved' && (
          <p className="text-sm text-[color:var(--success)]">✅ Transferencia aprobada — el beneficio ya está activo.</p>
        )}
        {transfer.status === 'rejected' && (
          <p className="text-sm text-[color:var(--danger)]">
            Esta transferencia fue rechazada. Vuelve a elegir un producto para intentar de nuevo.
          </p>
        )}
      </Card>
    )
  }

  return (
    <Card n={2} title="Cobrar y pagar (a nombre del comerciante)">
      <p className="text-sm text-[var(--color-muted)]">
        Cobra al comerciante (efectivo) y paga con tu tarjeta — o repórtale la transferencia a Miyagi. La
        venta se atribuye a tu código y el beneficio queda activado en la tienda del comerciante.
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
      {transferEnabled && (
        <div className="space-y-2">
          <div className="flex gap-2" role="radiogroup" aria-label="Forma de pago">
            <button type="button" onClick={() => setPayMethod('stripe')} disabled={busy}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${payMethod === 'stripe' ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--fg-inverse)]' : 'border-[var(--color-border)]'}`}>
              Tarjeta (Stripe)
            </button>
            <button type="button" onClick={() => setPayMethod('transfer')} disabled={busy}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${payMethod === 'transfer' ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--fg-inverse)]' : 'border-[var(--color-border)]'}`}>
              Transferir a Miyagi
            </button>
          </div>
          {payMethod === 'transfer' && (
            <label className="block text-sm">
              <span className="text-[var(--color-muted)]">Método de transferencia</span>
              <select
                value={transferMethod}
                onChange={(e) => setTransferMethod(e.target.value as Transfer['method'])}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2"
              >
                <option value="spei">SPEI</option>
                <option value="dimo">DiMo</option>
                <option value="codi">CoDi</option>
              </select>
            </label>
          )}
        </div>
      )}
      {done && <p className="text-sm text-[color:var(--success)]">{done}</p>}
      {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
      <button onClick={pay} disabled={busy}
        className="rounded-lg bg-[var(--color-accent)] text-[var(--fg-inverse)] px-4 py-2 font-medium disabled:opacity-50">
        {busy ? 'Procesando…' : payMethod === 'transfer' ? 'Ver datos de transferencia' : selected.payLabel}
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
