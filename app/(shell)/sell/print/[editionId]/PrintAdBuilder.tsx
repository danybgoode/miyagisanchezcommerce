'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import CopyButton from '@/app/components/CopyButton'
import type { PrintEditionPublic, PrintAdContent } from '@/lib/print'

// ── Types shared with the server page ───────────────────────────────────────

export type BuilderEdition = PrintEditionPublic

export interface BuilderListing {
  id: string
  title: string
  image: string | null
  url: string
}

export interface SellerPrefill {
  seller_id: string
  name: string
  slug: string
  logo_url: string | null
  location: string | null
  whatsapp: string | null
  shop_url: string
}

type Provider = 'stripe' | 'mercadopago' | 'manual'

function formatMXN(cents: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PrintAdBuilder({
  edition, prefill, listings, initialSubmissionId,
}: { edition: BuilderEdition; prefill: SellerPrefill; listings: BuilderListing[]; initialSubmissionId?: string | null }) {
  const availableTiers = edition.tiers.filter((t) => !t.sold_out)

  const [tierKey, setTierKey] = useState<string>(availableTiers[0]?.key ?? '')
  const [headline, setHeadline] = useState('')
  const [subhead, setSubhead] = useState('')
  const [body, setBody] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(prefill.logo_url)
  const [photos, setPhotos] = useState<string[]>([])
  const [phone, setPhone] = useState(prefill.whatsapp ?? '')
  const [whatsapp, setWhatsapp] = useState(prefill.whatsapp ?? '')
  const [ctaType, setCtaType] = useState<'shop' | 'listing'>('shop')
  const [ctaListingId, setCtaListingId] = useState<string>(listings[0]?.id ?? '')

  const [submissionId, setSubmissionId] = useState<string | null>(initialSubmissionId ?? null)
  const [loadedStatus, setLoadedStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'saving' | 'paying'>(null)
  const [error, setError] = useState<string | null>(null)

  // Coupon (referral reward / platform promo, redeemable on print-ad checkout)
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountCents: number } | null>(null)
  const [couponValidating, setCouponValidating] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [manualInfo, setManualInfo] = useState<{
    spei?: { clabe?: string | null; bank_name?: string | null; account_holder?: string | null } | null
    dimo?: { phone?: string | null } | null
    cash?: { note?: string | null } | null
  } | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  // Edit mode: load an existing submission and prefill the form.
  useEffect(() => {
    if (!initialSubmissionId) return
    let active = true
    fetch(`/api/print/submissions/${initialSubmissionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d?.submission) return
        const s = d.submission
        const c = (s.content ?? {}) as PrintAdContent
        if (s.tier_key) setTierKey(s.tier_key)
        setHeadline(c.headline ?? '')
        setSubhead(c.subhead ?? '')
        setBody(c.body ?? '')
        if (c.logo_url) setLogoUrl(c.logo_url)
        if (Array.isArray(c.photos)) setPhotos(c.photos)
        if (c.contact?.whatsapp_seller) setWhatsapp(c.contact.whatsapp_seller)
        if (c.contact?.phone) setPhone(c.contact.phone)
        if (c.cta_target?.type === 'listing') { setCtaType('listing'); if (c.cta_target.id) setCtaListingId(c.cta_target.id) }
        setLoadedStatus(s.status ?? null)
      })
      .catch(() => {})
    return () => { active = false }
  }, [initialSubmissionId])

  // A rejected ad (already paid) is edited then resubmitted, not re-paid.
  const isResubmit = loadedStatus === 'rejected'
  const isLockedEdit = loadedStatus != null && loadedStatus !== 'draft' && loadedStatus !== 'rejected'

  const tier = edition.tiers.find((t) => t.key === tierKey)

  const content = useMemo<PrintAdContent>(() => {
    const ctaListing = listings.find((l) => l.id === ctaListingId)
    return {
      headline: headline.trim(),
      subhead: subhead.trim(),
      body: body.trim(),
      logo_url: logoUrl,
      photos,
      contact: { whatsapp_seller: whatsapp.trim() || null, phone: phone.trim() || null },
      cta_target: ctaType === 'listing' && ctaListing
        ? { type: 'listing', id: ctaListing.id, url: ctaListing.url }
        : { type: 'shop', id: prefill.slug, url: prefill.shop_url },
      featured_listing_ids: ctaType === 'listing' && ctaListing ? [ctaListing.id] : [],
    }
  }, [headline, subhead, body, logoUrl, photos, whatsapp, phone, ctaType, ctaListingId, listings, prefill])

  async function uploadImage(file: File): Promise<string | null> {
    // No client compression — print needs full resolution (server caps at 8 MB).
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/sell/upload', { method: 'POST', body: fd })
    if (!res.ok) return null
    const { url } = await res.json()
    return url ?? null
  }

  async function onPhotos(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    const uploaded: string[] = []
    for (const file of Array.from(files).slice(0, 4)) {
      const url = await uploadImage(file)
      if (url) uploaded.push(url)
    }
    setPhotos((prev) => [...prev, ...uploaded].slice(0, 4))
  }

  /** Create the submission on first save, then PATCH on subsequent saves. Returns the id. */
  async function persist(): Promise<string | null> {
    setError(null)
    if (!tierKey) { setError('Elige un tamaño de anuncio.'); return null }
    if (submissionId) {
      const res = await fetch(`/api/print/submissions/${submissionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier_key: tierKey, content }),
      })
      if (!res.ok) { setError((await res.json().catch(() => ({})))?.error ?? 'No se pudo guardar.'); return null }
      return submissionId
    }
    const res = await fetch('/api/print/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edition_id: edition.id, tier_key: tierKey, content }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data?.error ?? 'No se pudo crear el borrador.'); return null }
    setSubmissionId(data.submission.id)
    return data.submission.id
  }

  async function onSaveDraft() {
    setBusy('saving')
    const id = await persist()
    setBusy(null)
    if (id) setError(null)
  }

  /** Resubmit a rejected (already-paid) ad after editing — back into review. */
  async function onResubmit() {
    if (!submissionId) return
    setBusy('saving'); setError(null)
    const res = await fetch(`/api/print/submissions/${submissionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier_key: tierKey, content, resubmit: true }),
    })
    setBusy(null)
    if (!res.ok) { setError((await res.json().catch(() => ({})))?.error ?? 'No se pudo reenviar.'); return }
    window.location.href = '/account/print-ads'
  }

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase()
    if (!code || !tier) return
    setCouponValidating(true)
    setCouponError(null)
    try {
      const qs = new URLSearchParams({ sellerId: 'miyagiprints', code, itemsCents: String(tier.price_cents) })
      const res = await fetch(`/api/checkout/validate-coupon?${qs}`)
      const data = await res.json() as { valid?: boolean; code?: string; discount_cents?: number; message?: string }
      if (!res.ok || !data.valid) {
        setAppliedCoupon(null)
        setCouponError(data.message ?? 'Cupón no válido.')
        return
      }
      setAppliedCoupon({ code: data.code ?? code, discountCents: data.discount_cents ?? 0 })
      setCouponInput(data.code ?? code)
    } catch {
      setCouponError('No se pudo validar el cupón.')
    } finally {
      setCouponValidating(false)
    }
  }

  async function onPay(provider: Provider) {
    setBusy('paying')
    const id = await persist()
    if (!id) { setBusy(null); return }
    const res = await fetch(`/api/print/submissions/${id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}) }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(data?.error ?? 'No se pudo iniciar el pago.'); return }
    if (data.redirect_url) { window.location.href = data.redirect_url; return }
    // Manual: no redirect — show payment instructions.
    setManualInfo(data.manual_payment ?? {})
  }

  // ── Manual confirmation screen ─────────────────────────────────────────────
  if (manualInfo) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <div className="text-4xl mb-3">🗞️</div>
        <h1 className="text-xl font-bold mb-2">¡Solicitud registrada!</h1>
        <p className="text-sm text-[var(--color-muted)] mb-6">
          Aparta tu lugar en <strong>{edition.title}</strong>. Realiza el pago para confirmar tu anuncio.
        </p>
        {(manualInfo.spei?.clabe || manualInfo.dimo?.phone || manualInfo.cash?.note) ? (
          <div className="border border-[var(--color-border)] rounded-xl p-4 text-left text-sm space-y-3">
            {tier && <div className="pb-2 border-b border-[var(--color-border)]">Monto: <strong>{formatMXN(tier.price_cents)}</strong></div>}
            {manualInfo.spei?.clabe && (
              <div className="space-y-0.5">
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Transferencia SPEI</div>
                <div className="flex items-center gap-2">CLABE: <strong>{manualInfo.spei.clabe}</strong><CopyButton value={manualInfo.spei.clabe} /></div>
                {manualInfo.spei.bank_name && <div>Banco: {manualInfo.spei.bank_name}</div>}
                {manualInfo.spei.account_holder && <div>Titular: {manualInfo.spei.account_holder}</div>}
              </div>
            )}
            {manualInfo.dimo?.phone && (
              <div className="space-y-0.5">
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">DiMo</div>
                <div className="flex items-center gap-2">Teléfono: <strong>{manualInfo.dimo.phone}</strong><CopyButton value={manualInfo.dimo.phone} /></div>
              </div>
            )}
            {manualInfo.cash?.note && (
              <div className="space-y-0.5">
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Efectivo</div>
                <div>{manualInfo.cash.note}</div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm">Te contactaremos con los datos de pago.</p>
        )}
        <p className="text-xs text-[var(--color-muted)] mt-4">Cuando pagues, entra a &ldquo;Mis anuncios&rdquo; y toca &ldquo;Ya hice el pago&rdquo;.</p>
        <Link href="/account/print-ads" className="mt-2 inline-block text-sm text-[var(--color-accent)] no-underline">
          → Ver mis anuncios
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/shop/manage" className="text-sm text-[var(--color-muted)] no-underline">← Mi tienda</Link>
      <h1 className="text-2xl font-bold mt-2">Diseña tu anuncio impreso</h1>
      <p className="text-sm text-[var(--color-muted)]">
        {edition.title} · {edition.provider_name}. Tú nos das los ingredientes; Miyagi diseña el anuncio con estética México 86.
      </p>

      {/* Tier */}
      <Section title="1 · Tamaño del anuncio">
        <div className="grid grid-cols-2 gap-2">
          {edition.tiers.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={t.sold_out}
              onClick={() => setTierKey(t.key)}
              className={`text-left rounded-xl border p-3 transition-colors ${
                t.sold_out ? 'opacity-40 cursor-not-allowed border-[var(--color-border)]'
                  : tierKey === t.key ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
              }`}
            >
              <div className="font-semibold text-sm">{t.label}</div>
              <div className="text-lg font-bold">{formatMXN(t.price_cents)}</div>
              <div className="text-xs text-[var(--color-muted)]">{t.sold_out ? 'Agotado' : `${t.remaining} disponibles`}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* Copy */}
      <Section title="2 · Texto del anuncio">
        <Field label="Titular" hint="El gancho principal (ej. tu nombre o promoción)">
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={60}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </Field>
        <Field label="Subtítulo" hint="Opcional">
          <input value={subhead} onChange={(e) => setSubhead(e.target.value)} maxLength={90}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </Field>
        <Field label="Descripción" hint="Qué ofreces, en pocas palabras">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={280} rows={3}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </Field>
      </Section>

      {/* Images */}
      <Section title="3 · Logo y fotos">
        <div className="flex items-center gap-3">
          {logoUrl && <img src={logoUrl} alt="logo" className="h-14 w-14 rounded-lg object-cover border border-[var(--color-border)]" />}
          <label className="text-sm text-[var(--color-accent)] cursor-pointer">
            {logoUrl ? 'Cambiar logo' : 'Subir logo'}
            <input type="file" accept="image/*" className="hidden"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const u = await uploadImage(f); if (u) setLogoUrl(u) } }} />
          </label>
        </div>
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            {photos.map((url) => (
              <div key={url} className="relative">
                <img src={url} alt="" className="h-20 w-20 rounded-lg object-cover border border-[var(--color-border)]" />
                <button type="button" onClick={() => setPhotos((p) => p.filter((u) => u !== url))}
                  className="absolute -top-2 -right-2 bg-black/70 text-white rounded-full h-5 w-5 text-xs">×</button>
              </div>
            ))}
            {photos.length < 4 && (
              <button type="button" onClick={() => photoInput.current?.click()}
                className="h-20 w-20 rounded-lg border-2 border-dashed border-[var(--color-border)] text-[var(--color-muted)] text-2xl">+</button>
            )}
          </div>
          <input ref={photoInput} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => onPhotos(e.target.files)} />
          <p className="text-xs text-[var(--color-muted)] mt-1">Hasta 4 fotos en alta resolución (mejor para impresión).</p>
        </div>
      </Section>

      {/* Contact + CTA */}
      <Section title="4 · Contacto y enlace">
        <Field label="WhatsApp" hint="Aparece como botón directo en el anuncio">
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </Field>
        <Field label="Teléfono" hint="Opcional">
          <input value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent" />
        </Field>
        <Field label="¿A dónde lleva el código QR?" hint="">
          <div className="flex gap-2">
            <button type="button" onClick={() => setCtaType('shop')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${ctaType === 'shop' ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}>
              Mi tienda
            </button>
            <button type="button" disabled={listings.length === 0} onClick={() => setCtaType('listing')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-40 ${ctaType === 'listing' ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}>
              Un anuncio
            </button>
          </div>
          {ctaType === 'listing' && listings.length > 0 && (
            <select value={ctaListingId} onChange={(e) => setCtaListingId(e.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-transparent">
              {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          )}
        </Field>
      </Section>

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

      {/* Actions */}
      <div className="sticky bottom-0 bg-[var(--color-background)] border-t border-[var(--color-border)] mt-6 py-4 -mx-4 px-4">
        {/* Coupon (referral reward / platform promo) */}
        {!isResubmit && !isLockedEdit && tier && (
          <div className="mb-3">
            {appliedCoupon ? (
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-muted)]">Cupón <strong className="font-mono text-[var(--color-foreground)]">{appliedCoupon.code}</strong></span>
                <span className="flex items-center gap-2">
                  <strong className="text-green-700">−{formatMXN(appliedCoupon.discountCents)}</strong>
                  <button type="button" onClick={() => { setAppliedCoupon(null); setCouponInput('') }} className="text-xs underline text-[var(--color-muted)]">Quitar</button>
                </span>
              </div>
            ) : (
              <div>
                <div className="flex gap-2">
                  <input value={couponInput} onChange={e => { setCouponInput(e.target.value.toUpperCase()); if (couponError) setCouponError(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon() } }}
                    placeholder="¿Tienes un cupón?" maxLength={24}
                    className="flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--color-background)]" />
                  <button type="button" onClick={applyCoupon} disabled={couponValidating || !couponInput.trim()}
                    className="px-3 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] disabled:opacity-50">
                    {couponValidating ? '…' : 'Aplicar'}
                  </button>
                </div>
                {couponError && <p className="text-xs text-red-600 mt-1.5">{couponError}</p>}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[var(--color-muted)]">Total</span>
          <span className="text-xl font-bold">
            {tier ? formatMXN(Math.max(0, tier.price_cents - (appliedCoupon?.discountCents ?? 0))) : '—'}
          </span>
        </div>
        {isResubmit ? (
          // Rejected ad (already paid): edit + resubmit, no re-payment.
          <button type="button" onClick={onResubmit} disabled={!tier || busy !== null}
            className="w-full bg-[var(--color-accent)] text-white rounded-lg py-3 font-semibold disabled:opacity-50">
            {busy === 'saving' ? 'Reenviando…' : 'Reenviar para revisión'}
          </button>
        ) : isLockedEdit ? (
          // Paid/approved/placed: can't be edited here.
          <p className="text-sm text-[var(--color-muted)] text-center">
            Este anuncio ya fue pagado. Para cambios, usa &ldquo;Solicitar cambios&rdquo; en Mis anuncios.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => onPay('stripe')} disabled={!tier || busy !== null}
              className="w-full bg-[var(--color-accent)] text-white rounded-lg py-3 font-semibold disabled:opacity-50">
              {busy === 'paying' ? 'Procesando…' : 'Pagar con tarjeta'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => onPay('mercadopago')} disabled={!tier || busy !== null}
                className="rounded-lg border border-[var(--color-border)] py-2.5 text-sm font-medium disabled:opacity-50">
                MercadoPago
              </button>
              <button type="button" onClick={() => onPay('manual')} disabled={!tier || busy !== null}
                className="rounded-lg border border-[var(--color-border)] py-2.5 text-sm font-medium disabled:opacity-50">
                Pago directo
              </button>
            </div>
            <button type="button" onClick={onSaveDraft} disabled={busy !== null}
              className="w-full text-sm text-[var(--color-muted)] py-1 disabled:opacity-50">
              {busy === 'saving' ? 'Guardando…' : 'Guardar borrador'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Small layout helpers ───────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}{hint && <span className="text-[var(--color-muted)] font-normal"> · {hint}</span>}</div>
      {children}
    </label>
  )
}
