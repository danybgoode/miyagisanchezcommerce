'use client'

/**
 * SubdomainSection — the subdomain paywall buy + monthly↔yearly switch UI (epic 07 ·
 * subdomain-pricing). Extracted from Canal.tsx (which is at the anti-monolith line
 * cap) as a self-contained client section, the same way Canal delegates to
 * DomainCadenceField / PromoterCodeField / EmbedSnippetSection.
 *
 * The white-label subdomain <slug>.miyagisanchez.com is a paid SKU:
 *   - not entitled            → the buy upsell (yearly $199 / monthly $25);
 *   - active recurring sub    → the monthly↔yearly cadence switch (prorated, no gap);
 *   - entitled via a grant    → a plain "incluido" note (nothing to switch).
 * Reuses the already-shipped /api/sell/shop/subdomain/{subscribe,switch} routes — no
 * new money logic here. Renders nothing structural when entitled without a
 * subscription other than the small note, so it's invisible for grandfathered shops.
 */

import { useState } from 'react'
import { SUBDOMAIN_PRICE_LABEL, SUBDOMAIN_PRICE_MONTHLY_LABEL } from '@/lib/subdomain-pricing'
import type { SubdomainInterval } from '@/lib/subdomain-billing'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/feedback/Banner'

export default function SubdomainSection({
  subdomainUrl,
  shopSlug,
  entitled,
  active,
  hasMonthly,
  lapsed,
}: {
  subdomainUrl: string
  shopSlug: string
  /** False ⇒ show the buy upsell. Defaults true (ungated) upstream. */
  entitled: boolean
  /** True ⇒ an active recurring subscription → show the cadence switch. */
  active: boolean
  /** True once the $25/mo price is seeded → gate the monthly options. */
  hasMonthly: boolean
  /** True ⇒ a subscription lapsed and the subdomain reverted to /s/slug. */
  lapsed: boolean
}) {
  // Buy upsell: which cadence to purchase (yearly is the discounted default).
  const [buyInterval, setBuyInterval] = useState<SubdomainInterval>('year')
  const [subscribing, setSubscribing] = useState(false)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)
  // Cadence switch (active subscribers): in-place, no redirect.
  const [switching, setSwitching] = useState<SubdomainInterval | null>(null)
  const [switchNote, setSwitchNote] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  async function activate() {
    setSubscribing(true); setSubscribeError(null)
    try {
      const res = await fetch('/api/sell/shop/subdomain/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadence: 'recurring', interval: buyInterval }),
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

  async function switchTo(target: SubdomainInterval) {
    setSwitching(target); setSwitchError(null); setSwitchNote(null)
    try {
      const res = await fetch('/api/sell/shop/subdomain/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: target }),
      })
      const data = await res.json() as { ok?: boolean; switched?: boolean; error?: string }
      if (!res.ok || !data.ok) { setSwitchError(data.error ?? 'No se pudo cambiar tu plan.'); return }
      const label = target === 'month' ? SUBDOMAIN_PRICE_MONTHLY_LABEL.es : SUBDOMAIN_PRICE_LABEL.es
      setSwitchNote(
        data.switched
          ? `Listo — tu subdominio ahora se factura ${target === 'month' ? 'cada mes' : 'cada año'} (${label}). Se prorrateó el cambio, sin cargo doble.`
          : `Tu subdominio ya se factura ${target === 'month' ? 'cada mes' : 'cada año'}. No se hizo ningún cambio.`,
      )
    } catch {
      setSwitchError('Sin conexión. Intenta de nuevo.')
    } finally {
      setSwitching(null)
    }
  }

  // ── Not entitled → buy upsell ──────────────────────────────────────────────
  if (!entitled) {
    return (
      <div className="mt-3 border border-[var(--color-border)] rounded-[var(--r-lg)] p-4 bg-[var(--color-surface-alt)]">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-base">✦</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-accent)]">Función premium</span>
        </div>
        <p className="text-sm font-semibold mb-1">Subdominio propio</p>
        <p className="text-xs text-[var(--color-muted)] leading-relaxed mb-2.5">
          Sirve tu tienda como sitio independiente en{' '}
          <span className="font-mono">{subdomainUrl}</span> (sin la barra de la plataforma).
          {hasMonthly
            ? ` ${SUBDOMAIN_PRICE_LABEL.es} o ${SUBDOMAIN_PRICE_MONTHLY_LABEL.es} — el plan anual sale más barato; el mensual es sin compromiso.`
            : ` ${SUBDOMAIN_PRICE_LABEL.es}.`}
          {' '}Tu <strong>URL gratis</strong> (<span className="font-mono">/s/</span>) sigue activa siempre.
        </p>
        {lapsed && (
          <Banner variant="warning" className="mb-2.5 text-xs">
            Tu suscripción al subdominio terminó y tu tienda volvió a tu URL gratis
            (<span className="font-mono">/s/{shopSlug}</span>). Reactívala para volver a servir tu subdominio.
          </Banner>
        )}
        {hasMonthly && (
          <div className="flex gap-2 mb-2.5" role="radiogroup" aria-label="Frecuencia de pago">
            {([
              ['year', SUBDOMAIN_PRICE_LABEL.es, 'Más barato'],
              ['month', SUBDOMAIN_PRICE_MONTHLY_LABEL.es, 'Sin compromiso'],
            ] as const).map(([iv, label, hint]) => (
              <button
                key={iv}
                type="button"
                role="radio"
                aria-checked={buyInterval === iv}
                onClick={() => { setBuyInterval(iv); if (subscribeError) setSubscribeError(null) }}
                className={`flex-1 text-left rounded-[var(--r-md)] border px-3 py-2 transition-colors ${buyInterval === iv ? 'border-[var(--color-accent)] bg-[var(--color-surface)] ring-1 ring-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)]'}`}
              >
                <span className="block text-xs font-semibold">{label}</span>
                <span className="block text-[10px] text-[var(--color-muted)]">{hint}</span>
              </button>
            ))}
          </div>
        )}
        {subscribeError && <p className="text-xs text-[var(--danger)] mb-2">{subscribeError}</p>}
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={activate}
          disabled={subscribing}
        >
          {subscribing
            ? <><span className="inline-block w-3 h-3 rounded-[var(--r-pill)] border-2 border-white border-t-transparent animate-spin" />Redirigiendo…</>
            : (lapsed ? 'Reactivar subdominio →' : 'Activar subdominio propio →')}
        </Button>
      </div>
    )
  }

  // ── Active recurring subscription → cadence switch ─────────────────────────
  if (active) {
    return (
      <div className="mt-3 border border-[var(--color-border)] rounded-[var(--r-lg)] p-4 bg-[var(--color-surface-alt)]">
        <p className="text-sm font-semibold mb-0.5">✓ Subdominio propio activo</p>
        <p className="text-xs text-[var(--color-muted)] leading-relaxed mb-2.5">
          Tu tienda se sirve como sitio independiente en <span className="font-mono">{subdomainUrl}</span> (sin la barra de la plataforma).
          {hasMonthly && ' Cambia tu facturación cuando quieras — se prorratea, sin cargo doble.'}
        </p>
        {hasMonthly && (
          <div className="flex flex-wrap gap-2 mb-2">
            {([
              ['year', `Cambiar a anual (${SUBDOMAIN_PRICE_LABEL.es})`],
              ['month', `Cambiar a mensual (${SUBDOMAIN_PRICE_MONTHLY_LABEL.es})`],
            ] as const).map(([iv, label]) => (
              <Button
                key={iv}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => switchTo(iv)}
                disabled={switching !== null}
              >
                {switching === iv && <span className="inline-block w-3 h-3 rounded-[var(--r-pill)] border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />}
                {label}
              </Button>
            ))}
          </div>
        )}
        {switchNote && <p className="text-xs text-[var(--success)]">{switchNote}</p>}
        {switchError && <p className="text-xs text-[var(--danger)]">{switchError}</p>}
      </div>
    )
  }

  // ── Entitled via a grandfather / comp / one-time grant → plain note ────────
  return (
    <p className="mt-3 text-xs text-[var(--color-muted)]">
      ✓ Tu subdominio propio (<span className="font-mono">{subdomainUrl}</span>) está activo — incluido en tu tienda.
    </p>
  )
}
