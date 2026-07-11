'use client'

import { useMemo, useState } from 'react'
import {
  PROMOTER_SKUS,
  type Promoter,
  type PromoterSettings,
  type PromoterAttribution,
  type PromoterSku,
  type Commission,
} from '@/lib/promoter'
import type { PromoterApplication } from '@/lib/promoter-applications'
import { PROMOTER_SKU_BASE_PRICE_MXN } from '@/lib/promoter-earnings'
import { buildSkuPriceTable, computeBundleRow, type PromoterSkuPrices } from '@/lib/promoter-pricing'
import { TRANSFER_SKU_LABEL, type TransferSku } from '@/lib/promoter-transfer'
import type { PromoterTransfer } from '@/lib/promoter-transfers'

/**
 * Promoter console — provision promoters + edit the seller discount + (S3) set the
 * per-SKU commission % and settle accrued commissions offline, over
 * `/api/admin/promoter*`. **Clerk-gated** (same-origin requests carry the session
 * cookie). The feature stays hidden behind the `promoter.enabled` flag; this admin
 * screen only manages the data.
 *
 * `discount_amount_cents` is reused for both discount types: pesos (×100) when
 * `fixed`, a raw percentage when `percentage` — the input adapts its label.
 */

const SKU_LABEL: Record<PromoterSku, string> = {
  custom_domain: 'Dominio propio',
  print_ad: 'Anuncio impreso',
  subdomain: 'Subdominio propio',
  ml_sync: 'Sincronización Mercado Libre',
  migration: 'Migración de tienda',
}

/**
 * SKUs with no `PROMOTER_SKU_BASE_PRICE_MXN` entry that are STILL directly priced at
 * checkout from `skuPrices[sku]` (unlike `print_ad`, whose real price is per-tier —
 * see `lib/print-server.ts` — and never reads this table at all). The price input
 * below must stay settable for these even though there's no "regular" price to show
 * a discount against — platform-migrations S3, fixing a real gap: the input was
 * unconditionally disabled whenever `base == null`, which made `migration`'s $999
 * flat price impossible to set through this screen (see `lib/migration-checkout.ts`).
 */
const DIRECT_PRICE_SKUS: PromoterSku[] = ['migration']

const mxn = (cents: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)

const APPLICATION_STATUS_LABEL: Record<PromoterApplication['status'], string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
}

/** Build a tappable wa.me link from a stored WhatsApp number (digits only). */
function whatsappLink(whatsapp: string): string {
  return `https://wa.me/${whatsapp.replace(/\D/g, '')}`
}

export default function PromoterAdminClient({
  initialPromoters,
  initialSettings,
  initialCommissionRates,
  initialSkuPrices,
  initialPendingCommissions,
  initialApplications,
  initialPendingTransfers,
  siteUrl,
}: {
  initialPromoters: Promoter[]
  initialSettings: PromoterSettings
  initialCommissionRates: Record<PromoterSku, number>
  initialSkuPrices: PromoterSkuPrices
  initialPendingCommissions: Commission[]
  initialApplications: PromoterApplication[]
  initialPendingTransfers: PromoterTransfer[]
  siteUrl: string
}) {
  const [promoters, setPromoters] = useState<Promoter[]>(initialPromoters)
  const [applications, setApplications] = useState<PromoterApplication[]>(initialApplications)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [settings, setSettings] = useState<PromoterSettings>(initialSettings)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // Per-promoter attribution ledger (lazy-loaded on expand).
  const [openId, setOpenId] = useState<string | null>(null)
  const [attributions, setAttributions] = useState<Record<string, PromoterAttribution[]>>({})
  const [loadingAttrs, setLoadingAttrs] = useState<string | null>(null)
  // S3 — per-SKU commission rates + settlement.
  const [rates, setRates] = useState<Record<PromoterSku, number>>(initialCommissionRates)
  const [savingRate, setSavingRate] = useState<PromoterSku | null>(null)
  const [pending, setPending] = useState<Commission[]>(initialPendingCommissions)
  const [refs, setRefs] = useState<Record<string, string>>({})
  const [settling, setSettling] = useState<string | null>(null)
  // Sprint 3 (US-3.1) — per-SKU promoter price overrides + the bundle offer.
  const [skuPrices, setSkuPrices] = useState<PromoterSkuPrices>(initialSkuPrices)
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>(
    Object.fromEntries(PROMOTER_SKUS.map((sku) => [sku, initialSkuPrices[sku] != null ? String(initialSkuPrices[sku]) : ''])),
  )
  const [savingPrice, setSavingPrice] = useState<PromoterSku | null>(null)
  // Sprint 4 (US-4.2) — pending net-remittance transfers + admin approve/reject.
  const [transfers, setTransfers] = useState<PromoterTransfer[]>(initialPendingTransfers)
  const [decidingTransferId, setDecidingTransferId] = useState<string | null>(null)
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({})
  // Captured once at mount — keeps render pure (no Date.now() in the render body).
  const [now] = useState(() => Date.now())

  const codeById = new Map(promoters.map((p) => [p.id, p.code]))

  // Live preview — the SAME deriver the landing/handbook/close workspace use, so
  // "what you see here is what they see" holds without a deploy or a page reload.
  const priceTable = useMemo(() => buildSkuPriceTable(PROMOTER_SKU_BASE_PRICE_MXN, skuPrices, settings), [skuPrices, settings])
  const bundleRow = useMemo(
    () => computeBundleRow(priceTable, { skus: settings.bundle_skus, bundlePriceMxn: settings.bundle_price_mxn }),
    [priceTable, settings.bundle_skus, settings.bundle_price_mxn],
  )

  async function toggleAttributions(promoterId: string) {
    if (openId === promoterId) { setOpenId(null); return }
    setOpenId(promoterId)
    if (attributions[promoterId]) return // cached
    setLoadingAttrs(promoterId)
    try {
      const res = await fetch(`/api/admin/promoter/attributions?promoterId=${encodeURIComponent(promoterId)}`)
      const data = await res.json().catch(() => ({}))
      setAttributions((m) => ({ ...m, [promoterId]: data.attributions ?? [] }))
    } finally {
      setLoadingAttrs((id) => (id === promoterId ? null : id))
    }
  }

  const isFixed = settings.discount_type === 'fixed'
  const amountDisplay = isFixed ? settings.discount_amount_cents / 100 : settings.discount_amount_cents

  function setAmountFromDisplay(value: number) {
    const cents = isFixed ? Math.round(value * 100) : Math.round(value)
    setSettings((s) => ({ ...s, discount_amount_cents: cents }))
  }

  function shareLink(code: string) {
    return `${siteUrl}/vende?promo=${code}`
  }

  async function createPromoter() {
    setCreating(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/promoter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.promoter) {
        setMsg(data?.error ?? 'No se pudo crear el promotor.')
        return
      }
      setPromoters((list) => [data.promoter, ...list])
      setName('')
      setMsg('Promotor creado.')
    } finally {
      setCreating(false)
    }
  }

  async function saveSettings() {
    setSavingSettings(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/promoter', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data?.error ?? 'No se pudo guardar.')
        return
      }
      if (data.settings) setSettings(data.settings)
      setMsg('Descuento guardado.')
    } finally {
      setSavingSettings(false)
    }
  }

  async function savePrice(sku: PromoterSku) {
    setSavingPrice(sku)
    setMsg(null)
    try {
      const raw = priceInputs[sku] ?? ''
      const promoterPriceMxn = raw.trim() === '' ? null : Number(raw)
      const res = await fetch('/api/admin/promoter/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, promoter_price_mxn: promoterPriceMxn }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data?.error ?? 'No se pudo guardar.')
        return
      }
      // Resync the text input to the SAVED (possibly rounded) value — otherwise a
      // stale unrounded input (e.g. "12.7") can sit next to the actual "13" the
      // server persisted (caught in cross-agent review of PR 165).
      if (data.prices) {
        setSkuPrices(data.prices)
        setPriceInputs((p) => ({ ...p, [sku]: data.prices[sku] != null ? String(data.prices[sku]) : '' }))
      }
      setMsg('Precio guardado.')
    } finally {
      setSavingPrice(null)
    }
  }

  async function saveRate(sku: PromoterSku) {
    setSavingRate(sku)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/promoter/commission', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, rate_pct: rates[sku] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data?.error ?? 'No se pudo guardar.')
        return
      }
      if (data.rates) setRates(data.rates)
      setMsg('Comisión guardada.')
    } finally {
      setSavingRate(null)
    }
  }

  async function settle(id: string) {
    setSettling(id)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/promoter/commission/${encodeURIComponent(id)}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: refs[id] ?? '' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data?.error ?? 'No se pudo marcar como pagada.')
        return
      }
      setPending((list) => list.filter((c) => c.id !== id))
      setMsg(data.alreadyPaid ? 'Ya estaba pagada.' : 'Comisión marcada como pagada.')
    } finally {
      setSettling(null)
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(shareLink(code))
      setCopied(code)
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
    } catch {
      /* clipboard unavailable — the link is visible to copy by hand */
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    setDecidingId(id)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/promoter/applications/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setMsg(data?.error ?? 'No se pudo procesar la solicitud.')
        return
      }
      setApplications((list) => list.map((a) => (a.id === id ? data.application : a)))
      if (data.promoter) setPromoters((list) => [data.promoter, ...list])
      setMsg(action === 'approve' ? 'Solicitud aprobada — se envió el código por correo.' : 'Solicitud rechazada.')
    } finally {
      setDecidingId(null)
    }
  }

  async function decideTransfer(id: string, action: 'approve' | 'reject') {
    setDecidingTransferId(id)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/promoter/transfers/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        ...(action === 'reject' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: rejectReasons[id] ?? '' }) } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setMsg(data?.error ?? 'No se pudo procesar la transferencia.')
        return
      }
      setTransfers((list) => list.filter((t) => t.id !== id))
      setMsg(action === 'approve' ? 'Transferencia aprobada — beneficio activado.' : 'Transferencia rechazada.')
    } finally {
      setDecidingTransferId(null)
    }
  }

  /** Age since reported, es-MX short form — so a stale transfer is visible at a glance. */
  function ageSince(iso: string | null): string {
    if (!iso) return '—'
    const ms = now - new Date(iso).getTime()
    const hours = Math.floor(ms / 3_600_000)
    if (hours < 1) return 'hace unos minutos'
    if (hours < 24) return `hace ${hours}h`
    return `hace ${Math.floor(hours / 24)}d`
  }

  const pendingTotalCents = pending.reduce((sum, c) => sum + (c.commission_cents ?? 0), 0)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Promotores</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Provisiona promotores y configura el descuento que su código ofrece a la tienda. Los cambios aplican sin redeploy.
        </p>
      </div>

      {/* Provision a new promoter */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Nuevo promotor</h2>
        <div className="flex items-end gap-3">
          <label className="block text-sm flex-1">
            Nombre (opcional)
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. María — zona centro"
              className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
            />
          </label>
          <button
            onClick={createPromoter}
            disabled={creating}
            className="bg-[var(--color-accent)] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {creating ? 'Creando…' : 'Crear promotor'}
          </button>
        </div>
      </section>

      {/* Sprint 2 · US-2.2 — self-serve applications */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Solicitudes ({applications.filter((a) => a.status === 'pending').length} pendientes)</h2>
        {applications.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Aún no hay solicitudes.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {applications.map((a) => (
              <li key={a.id} className="p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <span className="font-semibold">{a.name}</span>
                    {a.city && <span className="text-[var(--color-muted)] ml-2">· {a.city}</span>}
                  </div>
                  <span className="text-xs rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5">
                    {APPLICATION_STATUS_LABEL[a.status]}
                  </span>
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  {a.email} ·{' '}
                  <a href={whatsappLink(a.whatsapp)} target="_blank" rel="noreferrer" className="underline">
                    WhatsApp
                  </a>
                </div>
                {a.motivation && <p className="text-xs text-[var(--color-muted)] italic">&ldquo;{a.motivation}&rdquo;</p>}
                {a.status === 'pending' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => decide(a.id, 'approve')}
                      disabled={decidingId === a.id}
                      className="rounded-lg bg-[var(--color-accent)] text-white px-3 py-1 text-sm font-semibold disabled:opacity-50"
                    >
                      {decidingId === a.id ? 'Procesando…' : 'Aprobar'}
                    </button>
                    <button
                      onClick={() => decide(a.id, 'reject')}
                      disabled={decidingId === a.id}
                      className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-sm font-semibold hover:bg-[var(--color-surface)] disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Promoter list with code + share link */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Promotores ({promoters.length})</h2>
        {promoters.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Aún no hay promotores.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {promoters.map((p) => (
              <li key={p.id} className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-mono font-semibold">{p.code}</span>
                    {p.name && <span className="text-sm text-[var(--color-muted)] ml-2">{p.name}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleAttributions(p.id)}
                      className="text-sm rounded-lg border border-[var(--color-border)] px-3 py-1 hover:bg-[var(--color-surface)]"
                    >
                      {openId === p.id ? 'Ocultar' : 'Atribuciones'}
                    </button>
                    <button
                      onClick={() => copy(p.code)}
                      className="text-sm rounded-lg border border-[var(--color-border)] px-3 py-1 hover:bg-[var(--color-surface)]"
                    >
                      {copied === p.code ? 'Copiado' : 'Copiar liga'}
                    </button>
                  </div>
                </div>
                <div className="text-xs text-[var(--color-muted)] font-mono break-all">{shareLink(p.code)}</div>
                {openId === p.id && (
                  <div className="mt-2 rounded-lg bg-[var(--color-surface)] p-2 text-xs">
                    {loadingAttrs === p.id ? (
                      <p className="text-[var(--color-muted)]">Cargando…</p>
                    ) : (attributions[p.id]?.length ?? 0) === 0 ? (
                      <p className="text-[var(--color-muted)]">Sin atribuciones todavía.</p>
                    ) : (
                      <ul className="space-y-1">
                        {attributions[p.id].map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2">
                            <span className="font-mono">{a.sku ?? '—'}</span>
                            <span className="text-[var(--color-muted)] truncate">{a.seller_id ?? '—'}</span>
                            <span className="rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5">{a.status}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Discount settings */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Descuento del promotor</h2>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          Descuento de promotor activo
        </label>

        <label className="block text-sm">
          Tipo de descuento
          <select
            value={settings.discount_type}
            onChange={(e) => setSettings((s) => ({ ...s, discount_type: e.target.value as PromoterSettings['discount_type'] }))}
            className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
          >
            <option value="fixed">Monto fijo (MXN)</option>
            <option value="percentage">Porcentaje (%)</option>
          </select>
        </label>

        <label className="block text-sm">
          {isFixed ? 'Monto (MXN)' : 'Porcentaje (%)'}
          <input
            type="number"
            min={0}
            value={amountDisplay}
            onChange={(e) => setAmountFromDisplay(Number(e.target.value))}
            className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            onClick={saveSettings}
            disabled={savingSettings}
            className="bg-[var(--color-accent)] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {savingSettings ? 'Guardando…' : 'Guardar descuento'}
          </button>
        </div>
      </section>

      {/* Sprint 4 (US-4.1) — net-remittance transfer instructions (admin-config, never hardcoded) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Detalles de transferencia (SPEI/DiMo/CoDi)</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Se muestran al promotor cuando elige &ldquo;Transferir a Miyagi&rdquo; en el cierre.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            ['clabe', 'CLABE'],
            ['bank_name', 'Banco'],
            ['account_holder', 'Titular'],
            ['dimo_phone', 'Teléfono DiMo'],
            ['codi_reference', 'Referencia CoDi'],
          ] as const).map(([key, label]) => (
            <label key={key} className="block text-sm">
              {label}
              <input
                type="text"
                value={settings.transfer_details?.[key] ?? ''}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, transfer_details: { ...s.transfer_details, [key]: e.target.value } }))
                }
                className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
              />
            </label>
          ))}
        </div>
        <button
          onClick={saveSettings}
          disabled={savingSettings}
          className="rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {savingSettings ? 'Guardando…' : 'Guardar datos de transferencia'}
        </button>
      </section>

      {/* Sprint 3 (US-3.1) — per-SKU promoter price + bundle offer */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Precio por SKU + paquete</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Precio exacto con código de promotor por SKU (vacío = usa el descuento general de arriba). El
          checkout cobra exactamente este número — nunca hay diferencia con lo que se anuncia.
        </p>
        <ul className="space-y-2">
          {PROMOTER_SKUS.map((sku) => {
            const base = PROMOTER_SKU_BASE_PRICE_MXN[sku]
            const directPriced = DIRECT_PRICE_SKUS.includes(sku)
            const priceDisabled = base == null && !directPriced
            const placeholder = base != null
              ? 'usar descuento general'
              : directPriced
                ? 'sin descuento general — precio directo'
                : 'variable (anuncio impreso)'
            return (
              <li key={sku} className="flex items-end gap-3">
                <label className="block text-sm flex-1">
                  {SKU_LABEL[sku]} {base != null && <span className="text-[var(--color-muted)]">· regular {mxn(base * 100)}</span>}
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      min={0}
                      placeholder={placeholder}
                      value={priceInputs[sku] ?? ''}
                      onChange={(e) => setPriceInputs((p) => ({ ...p, [sku]: e.target.value }))}
                      disabled={priceDisabled}
                      className="w-48 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent disabled:opacity-40"
                    />
                    <span className="text-sm text-[var(--color-muted)]">MXN</span>
                  </div>
                </label>
                <button
                  onClick={() => savePrice(sku)}
                  disabled={savingPrice === sku || priceDisabled}
                  className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--color-surface)] disabled:opacity-50"
                >
                  {savingPrice === sku ? 'Guardando…' : 'Guardar'}
                </button>
              </li>
            )
          })}
        </ul>

        <div className="pt-2 border-t border-[var(--color-border)] space-y-3">
          <h3 className="text-sm font-semibold">Paquete (todo esto cuesta $X — con tu promotor $Y)</h3>
          <div className="flex flex-wrap gap-3">
            {PROMOTER_SKUS.filter((sku) => PROMOTER_SKU_BASE_PRICE_MXN[sku] != null).map((sku) => (
              <label key={sku} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.bundle_skus.includes(sku)}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      bundle_skus: e.target.checked ? [...s.bundle_skus, sku] : s.bundle_skus.filter((x) => x !== sku),
                    }))
                  }
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                {SKU_LABEL[sku]}
              </label>
            ))}
          </div>
          <label className="block text-sm max-w-xs">
            Precio del paquete (MXN)
            <input
              type="number"
              min={0}
              value={settings.bundle_price_mxn ?? ''}
              onChange={(e) =>
                setSettings((s) => ({ ...s, bundle_price_mxn: e.target.value.trim() === '' ? null : Number(e.target.value) }))
              }
              placeholder="sin configurar"
              className="w-full mt-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
            />
          </label>
          <button
            onClick={saveSettings}
            disabled={savingSettings}
            className="rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {savingSettings ? 'Guardando…' : 'Guardar paquete'}
          </button>
        </div>

        {/* Live preview — same deriver the landing/handbook/close workspace read. */}
        <div className="pt-2 border-t border-[var(--color-border)] space-y-2">
          <h3 className="text-sm font-semibold">Vista previa</h3>
          <ul className="text-sm space-y-1">
            {priceTable.filter((r) => !r.variablePrice).map((r) => (
              <li key={r.sku} className="flex items-center justify-between text-[var(--color-muted)]">
                <span>{SKU_LABEL[r.sku]}</span>
                <span>
                  <span className="line-through mr-2">{mxn((r.regularPriceMxn ?? 0) * 100)}</span>
                  <span className="font-semibold text-[var(--color-fg)]">{r.isFree ? 'GRATIS' : mxn((r.promoterPriceMxn ?? 0) * 100)}</span>
                </span>
              </li>
            ))}
          </ul>
          {bundleRow && (
            <p className="text-sm font-semibold">
              Paquete: {mxn(bundleRow.regularTotalMxn * 100)} → {mxn(bundleRow.bundlePriceMxn * 100)} ({bundleRow.savingsPct}% de ahorro)
            </p>
          )}
        </div>
      </section>

      {/* S3 · US-7 — Per-SKU commission % */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Comisión por SKU</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Porcentaje que gana el promotor sobre cada venta pagada y atribuida. Se acumula solo en el primer pago.
        </p>
        <ul className="space-y-2">
          {PROMOTER_SKUS.map((sku) => (
            <li key={sku} className="flex items-end gap-3">
              <label className="block text-sm flex-1">
                {SKU_LABEL[sku]}
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={rates[sku] ?? 0}
                    onChange={(e) => setRates((r) => ({ ...r, [sku]: Math.round(Number(e.target.value)) }))}
                    className="w-24 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent"
                  />
                  <span className="text-sm text-[var(--color-muted)]">%</span>
                </div>
              </label>
              <button
                onClick={() => saveRate(sku)}
                disabled={savingRate === sku}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--color-surface)] disabled:opacity-50"
              >
                {savingRate === sku ? 'Guardando…' : 'Guardar'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* S3 · US-9 — Offline settlement */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Liquidación de comisiones</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Comisiones acumuladas pendientes de pago (liquidación en efectivo/transferencia — no mueve dinero en la app).
          Total pendiente: <span className="font-semibold">{mxn(pendingTotalCents)}</span>.
        </p>
        {pending.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">No hay comisiones pendientes.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {pending.map((c) => (
              <li key={c.id} className="p-3 flex items-center justify-between gap-3 text-sm flex-wrap">
                <div>
                  <div className="font-mono font-semibold">{codeById.get(c.promoter_id) ?? c.promoter_id}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {SKU_LABEL[(c.sku ?? '') as PromoterSku] ?? c.sku ?? '—'} · {c.rate_pct}% · {mxn(c.commission_cents)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Referencia"
                    value={refs[c.id] ?? ''}
                    onChange={(e) => setRefs((m) => ({ ...m, [c.id]: e.target.value }))}
                    className="w-32 rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm bg-transparent"
                  />
                  <button
                    onClick={() => settle(c.id)}
                    disabled={settling === c.id}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-sm font-semibold hover:bg-[var(--color-surface)] disabled:opacity-50"
                  >
                    {settling === c.id ? 'Marcando…' : 'Marcar pagada'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sprint 4 (US-4.2) — pending net-remittance transfers */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Transferencias pendientes ({transfers.length})</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Aprobar activa el producto en la tienda del comerciante y notifica al promotor; rechazar regresa la
          venta a estado sin pagar.
        </p>
        {transfers.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">No hay transferencias pendientes.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {transfers.map((t) => (
              <li key={t.id} className="p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <span className="font-mono font-semibold">{codeById.get(t.promoter_id) ?? t.promoter_id}</span>
                    <span className="text-[var(--color-muted)] ml-2">
                      {TRANSFER_SKU_LABEL[t.sku as TransferSku] ?? t.sku} · {t.method.toUpperCase()}
                    </span>
                  </div>
                  <span className="text-xs rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5">
                    {ageSince(t.reported_at)}
                  </span>
                </div>
                <div className="text-xs text-[var(--color-muted)] truncate">Tienda: {t.seller_id}</div>
                <div className="font-semibold">{mxn(t.owed_cents)} <span className="text-xs font-normal text-[var(--color-muted)]">(comisión retenida: {mxn(t.commission_cents)})</span></div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => decideTransfer(t.id, 'approve')}
                    disabled={decidingTransferId === t.id}
                    className="rounded-lg bg-[var(--color-accent)] text-white px-3 py-1 text-sm font-semibold disabled:opacity-50"
                  >
                    {decidingTransferId === t.id ? 'Procesando…' : 'Aprobar'}
                  </button>
                  <input
                    type="text"
                    placeholder="Motivo de rechazo (opcional)"
                    value={rejectReasons[t.id] ?? ''}
                    onChange={(e) => setRejectReasons((m) => ({ ...m, [t.id]: e.target.value }))}
                    className="w-48 rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm bg-transparent"
                  />
                  <button
                    onClick={() => decideTransfer(t.id, 'reject')}
                    disabled={decidingTransferId === t.id}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-sm font-semibold hover:bg-[var(--color-surface)] disabled:opacity-50"
                  >
                    Rechazar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {msg && <p className="text-sm text-[var(--color-muted)]">{msg}</p>}
    </div>
  )
}
