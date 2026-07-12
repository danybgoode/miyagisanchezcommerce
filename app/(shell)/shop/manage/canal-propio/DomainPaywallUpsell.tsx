'use client'

/**
 * DomainPaywallUpsell — the custom-domain premium SKU buy upsell (epic:
 * custom-domain-paywall, S1–S3). Extracted verbatim from Canal.tsx (which is at the
 * anti-monolith line cap) as a self-contained client section, the twin of
 * SubdomainSection. Canal renders it in the not-entitled branch of the domain block;
 * the connect-form (entitled) branch stays in Canal.
 *
 * Behavior-preserving move: owns the domain-subscribe state + POST to
 * /api/sell/shop/domain/subscribe (recurring | one-time cadence, optional campaign
 * coupon + promoter code). No logic change.
 */

import { useState } from 'react'
import PromoterCodeField from './PromoterCodeField'
import DomainCadenceField from './DomainCadenceField'
import { CUSTOM_DOMAIN_PRICE_LABEL, CUSTOM_DOMAIN_PRICE_CENTS } from '@/lib/domain-pricing'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/feedback/Banner'

export default function DomainPaywallUpsell({
  domainLapsed,
  promoterEnabled,
}: {
  /** True when a previously-active custom-domain subscription lapsed → re-activate prompt. */
  domainLapsed: boolean
  /** Promoter Program (promoter.enabled) — shows the code field + cadence selector. */
  promoterEnabled: boolean
}) {
  const [subscribing, setSubscribing] = useState(false)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)
  const [domainCoupon, setDomainCoupon] = useState('') // S3: campaign coupon (miyagisan)
  // Sprint 2: payment cadence (recurring default | one-time pay-a-year-up-front)
  // + the promoter code lifted up from PromoterCodeField for the REAL one-time charge.
  const [domainCadence, setDomainCadence] = useState<'recurring' | 'one_time'>('recurring')
  const [promoterCode, setPromoterCode] = useState('')

  async function handleActivateDomain() {
    setSubscribing(true); setSubscribeError(null)
    try {
      const coupon = domainCoupon.trim()
      const code = promoterCode.trim()
      const res = await fetch('/api/sell/shop/domain/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(coupon ? { coupon } : {}),
          cadence: domainCadence,
          ...(domainCadence === 'one_time' && code ? { promoterCode: code } : {}),
        }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) { setSubscribeError(data.error ?? 'No se pudo iniciar el pago.'); return }
      window.location.href = data.url
    } catch {
      setSubscribeError('Sin conexión. Intenta de nuevo.')
    } finally {
      setSubscribing(false)
    }
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 bg-[var(--color-surface-alt)]">
      <div className="flex items-center gap-2 mb-2">
        <i className="iconoir-globe text-lg" aria-hidden />
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-accent)]">Función premium</span>
      </div>
      <p className="text-sm font-semibold mb-1.5">Dominio propio</p>
      <p className="text-base font-bold mb-1.5">{CUSTOM_DOMAIN_PRICE_LABEL.es}</p>
      <p className="text-xs text-[var(--color-muted)] leading-relaxed mb-3">
        Conecta tu propio dominio (tutienda.com) para que tu tienda viva en tu marca, con SSL e
        infraestructura nuestra y sin miyagisanchez.com en la URL. Se renueva cada año; puedes
        cancelar cuando quieras. Tu <strong>URL gratis</strong> y tu <strong>subdominio</strong>
        {' '}(arriba) siguen siendo gratis.
      </p>
      {domainLapsed && (
        <Banner variant="warning" className="mb-3">
          Tu suscripción al dominio propio terminó y tu dominio se desconectó. Tu tienda sigue
          activa en tu URL gratis y tu subdominio. Vuelve a activarla para reconectar tu dominio.
        </Banner>
      )}
      {/* Campaign coupon (epic: custom-domain-paywall, S3) — miyagisan comps year 1. */}
      <div className="mb-3">
        <label className="block text-[11px] font-medium text-[var(--color-muted)] mb-1">
          ¿Tienes un cupón?
        </label>
        <input
          type="text"
          value={domainCoupon}
          onChange={(e) => { setDomainCoupon(e.target.value); if (subscribeError) setSubscribeError(null) }}
          placeholder="Código de cupón (opcional)"
          autoCapitalize="characters"
          className="w-full sm:w-64 text-xs px-3 py-2 rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
      </div>
      {/* Promoter Program (epic 08, Sprint 1) — code → discount PREVIEW, behind promoter.enabled.
          Sprint 2: the typed code is lifted up to drive the REAL one-time discount on pay. */}
      {promoterEnabled && (
        <PromoterCodeField
          priceCents={CUSTOM_DOMAIN_PRICE_CENTS}
          sku="custom_domain"
          onCodeChange={setPromoterCode}
        />
      )}
      {/* Payment cadence (epic 08 · Sprint 2) — pay yearly subscription or one year up front.
          Behind promoter.enabled: with the flag off the selector is hidden and the purchase
          stays recurring (today's behavior), so the whole sprint is dark until launch. */}
      {promoterEnabled && (
        <DomainCadenceField
          value={domainCadence}
          onChange={setDomainCadence}
          onInteract={() => { if (subscribeError) setSubscribeError(null) }}
        />
      )}
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={handleActivateDomain}
        disabled={subscribing}
      >
        {subscribing
          ? <><span className="inline-block w-3 h-3 rounded-[var(--r-pill)] border-2 border-white border-t-transparent animate-spin" />Redirigiendo…</>
          : (domainLapsed ? 'Reactivar dominio propio →' : 'Activar dominio propio →')}
      </Button>
      {subscribeError && <p className="mt-2 text-xs text-[var(--danger)]"><i className="iconoir-warning-triangle" aria-hidden /> {subscribeError}</p>}
    </div>
  )
}
