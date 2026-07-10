'use client'

/**
 * Envíos y entrega — the canonical `envios` slug bundles the monolith's two
 * `#comunicacion` + `#envios` sections (contact channels shown on listings + the
 * full Envia.com shipping config: local pickup, pickup spots, origin address,
 * carriers, rate display, package defaults). The section with the most state;
 * extracted verbatim, behavior-preserving.
 *
 * Persists the slice it owns through useSettingsSave():
 *   - `settings.checkout` contact subset (show_phone / phone / whatsapp_cta /
 *     show_email — `show_email` makes the route resolve contact_email, unchanged)
 *   - `settings.theme.social.whatsapp` (the WhatsApp number)
 *   - `settings.shipping` (full block)
 * The PATCH route deep-merges, so the checkout money fields + the rest of
 * theme.social are preserved.
 */

import { useState, useRef } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '../_components/Toast'
import { SectionTitle } from '../_components/SectionTitle'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import { ToggleSwitch } from '../_components/ToggleSwitch'
import { PickupSpotManager } from '../_components/PickupSpotManager'
import { ENVIA_CARRIERS } from '@/lib/shop-settings/helpers'
import { toEnviaStateCode } from '@/lib/mx-locations'
import type { PickupSpot, ShippingSettings } from '@/lib/shop-settings/types'

export interface EnviosInitial {
  checkout: { show_phone?: boolean; phone?: string | null; whatsapp_cta?: boolean; show_email?: boolean } | null
  /** theme.social.whatsapp — owned here (the WhatsApp number) but lives in the theme tree. */
  whatsapp: string | null
  shipping: ShippingSettings | null
  /** Read-only — the seller's scheduling links (edited under Citas), for the pickup-spot dropdown. */
  scheduling_links: Array<{ label: string; url: string }>
  /**
   * Platform Envía kill-switch (`shipping.envia_enabled`), server-evaluated. When
   * false, automatic Envía shipping is paused platform-wide and the per-shop "tarifas
   * en vivo" toggle below is superseded — we show a banner and never overwrite the
   * seller's own `envia_enabled` value. Cosmetic only; the backend is the real gate.
   */
  platform_envia_enabled: boolean
  /**
   * Shipping-provider-expansion · Sprint 2: this shop's own comp grant
   * (`seller.metadata.envia_grant` on the Medusa seller), server-evaluated.
   * When true, this shop rides live Envía even while the platform flag above
   * is OFF for everyone else — shows a distinct "enabled by Miyagi" banner
   * and un-supersedes the toggle below. Cosmetic only; the backend
   * (`enviaKillGate`) is the real gate.
   */
  granted_envia_enabled: boolean
}

export default function Envios({ initial }: { initial: EnviosInitial }) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const mark = markDirty

  const c = initial.checkout ?? {}
  const sh = initial.shipping ?? {}
  const oa = sh.origin_address ?? {}

  // Comunicación
  const [showPhone, setShowPhone]     = useState(c.show_phone === true && !!c.phone)
  const [phoneNumber, setPhoneNumber] = useState(c.phone ?? '')
  const [whatsappCta, setWhatsappCta] = useState(c.whatsapp_cta === true && !!initial.whatsapp)
  const [whatsappHandle, setWhatsappHandle] = useState(initial.whatsapp ?? '')
  const [showEmail, setShowEmail]     = useState(c.show_email ?? false)

  // Envíos
  const [localPickup, setLocalPickup] = useState(sh.local_pickup ?? true)
  const [pickupSpots, setPickupSpots] = useState<PickupSpot[]>(sh.pickup_spots ?? [])
  const schedulingLinks = initial.scheduling_links

  // Origin address (for Envia.com label generation)
  const [originName, setOriginName]             = useState(oa.name ?? '')
  const [originStreet, setOriginStreet]         = useState(oa.street ?? '')
  const [originNumber, setOriginNumber]         = useState(oa.number ?? '')
  const [originColonia, setOriginColonia]       = useState(oa.colonia ?? '')
  const [originCity, setOriginCity]             = useState(oa.city ?? '')
  const [originState, setOriginState]           = useState(oa.state ?? '')
  const [originStateCode, setOriginStateCode]   = useState(oa.state_code ?? toEnviaStateCode(oa.state ?? ''))
  const [originPostalCode, setOriginPostalCode] = useState(oa.postal_code ?? '')
  const [originCpLookupLoading, setOriginCpLookupLoading] = useState(false)
  const [originCpLookupError, setOriginCpLookupError]     = useState<string | null>(null)
  const [originCpResolved, setOriginCpResolved]           = useState(Boolean(oa.state_code))
  const [originColonias, setOriginColonias]               = useState<string[]>([])
  const originCpRef = useRef<AbortController | null>(null)
  const [enviaShippingEnabled, setEnviaShippingEnabled] = useState(sh.envia_enabled ?? true)
  const [allowedCarriers, setAllowedCarriers] = useState<string[]>(
    sh.allowed_carriers?.length ? sh.allowed_carriers : ENVIA_CARRIERS.map(carrier => carrier.id)
  )
  const [shippingRateDisplay, setShippingRateDisplay] = useState<'recommended' | 'cheapest' | 'all'>(
    sh.rate_display ?? 'recommended'
  )
  const pkgDefaults = sh.package_defaults ?? {}
  const [packageWeightGrams, setPackageWeightGrams] = useState(pkgDefaults.weight_grams ?? 500)
  const [packageLengthCm, setPackageLengthCm] = useState(pkgDefaults.length_cm ?? 20)
  const [packageWidthCm, setPackageWidthCm] = useState(pkgDefaults.width_cm ?? 15)
  const [packageHeightCm, setPackageHeightCm] = useState(pkgDefaults.height_cm ?? 10)
  const [handlingFeePesos, setHandlingFeePesos] = useState((sh.handling_fee_cents ?? 0) / 100)

  const originAddressReady = Boolean(
    originStreet.trim() &&
    originCity.trim() &&
    (originStateCode.trim() || originState.trim()) &&
    originPostalCode.trim().length === 5
  )

  function handleOriginCpChange(value: string) {
    const cp = value.replace(/\D/g, '').slice(0, 5)
    setOriginPostalCode(cp)
    mark()

    if (cp.length < 5) {
      setOriginCpResolved(false)
      setOriginCpLookupError(null)
      return
    }

    originCpRef.current?.abort()
    const ctrl = new AbortController()
    originCpRef.current = ctrl
    setOriginCpLookupLoading(true)
    setOriginCpLookupError(null)

    fetch('/api/checkout/postal-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cp }),
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then((data: { stateCode?: string; stateName?: string; alcaldia?: string; municipio?: string; colonias?: string[]; error?: string }) => {
        if (ctrl.signal.aborted) return
        if (data.error || !data.stateCode) {
          setOriginCpLookupError(data.error ?? 'Código postal no encontrado.')
          setOriginCpResolved(false)
          return
        }
        setOriginState(data.stateName ?? '')
        setOriginStateCode(data.stateCode)
        setOriginCity(data.alcaldia ?? data.municipio ?? '')
        setOriginColonias(data.colonias ?? [])
        setOriginCpResolved(true)
        mark()
      })
      .catch(e => {
        if (ctrl.signal.aborted) return
        setOriginCpLookupError('No se pudo validar el código postal.')
        setOriginCpResolved(false)
        console.error('[origin-cp-lookup]', e)
      })
      .finally(() => { if (!ctrl.signal.aborted) setOriginCpLookupLoading(false) })
  }

  function toggleCarrier(carrierId: string) {
    setAllowedCarriers(current => {
      const next = current.includes(carrierId)
        ? current.filter(id => id !== carrierId)
        : [...current, carrierId]
      return next.length ? next : current
    })
    mark()
  }

  async function handleSave() {
    await save({
      settings: {
        checkout: {
          show_phone:   showPhone,
          phone:        phoneNumber.trim().replace(/\D/g, '') || null,
          whatsapp_cta: whatsappCta,
          show_email:   showEmail,
        },
        theme: {
          social: {
            whatsapp: whatsappHandle.trim().replace(/\D/g, '') || null,
          },
        },
        shipping: {
          local_pickup:   localPickup,
          pickup_spots:   pickupSpots,
          envia_enabled:  enviaShippingEnabled,
          allowed_carriers: allowedCarriers,
          rate_display: shippingRateDisplay,
          handling_fee_cents: Math.max(0, Math.round(handlingFeePesos * 100)),
          package_defaults: {
            weight_grams: Math.max(100, Math.round(packageWeightGrams)),
            length_cm:    Math.max(1, Math.round(packageLengthCm)),
            width_cm:     Math.max(1, Math.round(packageWidthCm)),
            height_cm:    Math.max(1, Math.round(packageHeightCm)),
          },
          origin_address: {
            name:        originName.trim()        || null,
            street:      originStreet.trim()      || null,
            number:      originNumber.trim()      || null,
            colonia:     originColonia.trim()     || null,
            city:        originCity.trim()        || null,
            state:       originState.trim()       || null,
            state_code:  originStateCode.trim()   || null,
            postal_code: originPostalCode.trim()  || null,
          },
        },
      },
    })
  }

  return (
    <div>
      {/* ════════════════════════════════════════════════════════════════════
          Comunicación
      ════════════════════════════════════════════════════════════════════ */}
      <section id="comunicacion" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Comunicación</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Agrega tu número o correo y activa qué canales quieres mostrar en tus anuncios.
        </p>

        <div className="space-y-4">
          {/* Phone */}
          <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Teléfono</p>
                <p className="text-xs text-[var(--color-muted)]">Los compradores pueden llamarte o enviarte SMS.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showPhone}
                disabled={!phoneNumber.trim()}
                onClick={() => { if (phoneNumber.trim()) { setShowPhone(v => !v); mark() } }}
                title={!phoneNumber.trim() ? 'Ingresa tu número primero' : undefined}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  showPhone ? 'bg-[var(--color-accent)]' : 'bg-gray-300'
                } ${!phoneNumber.trim() ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${showPhone ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            <input
              type="tel"
              value={phoneNumber}
              onChange={e => {
                const v = e.target.value
                setPhoneNumber(v)
                if (!v.trim()) setShowPhone(false)
                mark()
              }}
              placeholder="55 1234 5678"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <p className="text-xs text-[var(--color-muted)]">Incluye LADA · p. ej. 55 1234 5678 (CDMX) ó 33 1234 5678 (GDL)</p>
            {!phoneNumber.trim() && (
              <p className="text-xs text-amber-600">Ingresa tu número para poder activar esta opción.</p>
            )}
          </div>

          {/* WhatsApp */}
          <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">WhatsApp</p>
                <p className="text-xs text-[var(--color-muted)]">Añade un botón &ldquo;Escribir por WhatsApp&rdquo; en cada anuncio.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={whatsappCta}
                disabled={!whatsappHandle.trim()}
                onClick={() => { if (whatsappHandle.trim()) { setWhatsappCta(v => !v); mark() } }}
                title={!whatsappHandle.trim() ? 'Ingresa tu número de WhatsApp primero' : undefined}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  whatsappCta ? 'bg-[var(--color-accent)]' : 'bg-gray-300'
                } ${!whatsappHandle.trim() ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${whatsappCta ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--color-muted)] flex-shrink-0">+52</span>
              <input
                type="tel"
                value={whatsappHandle}
                onChange={e => {
                  const v = e.target.value
                  setWhatsappHandle(v)
                  if (!v.trim()) setWhatsappCta(false)
                  mark()
                }}
                placeholder="55 1234 5678"
                className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
            <p className="text-xs text-[var(--color-muted)]">Solo dígitos, sin espacios ni guiones</p>
            {!whatsappHandle.trim() && (
              <p className="text-xs text-amber-600">Ingresa tu número para poder activar esta opción.</p>
            )}
          </div>

          {/* Email */}
          <div className="border border-[var(--color-border)] rounded-lg p-3">
            <ToggleSwitch
              checked={showEmail}
              onChange={v => { setShowEmail(v); mark() }}
              label="Mostrar correo electrónico"
              description="Los compradores pueden escribirte directamente al correo de tu cuenta."
            />
            {showEmail && (
              <p className="text-xs text-[var(--color-muted)] mt-1 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded px-3 py-2">
                Se usará el correo asociado a tu cuenta de Miyagi Sánchez.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Envíos y Entregas
      ════════════════════════════════════════════════════════════════════ */}
      <section id="envios" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Envíos y Entregas</SectionTitle>
        <div className="divide-y divide-[var(--color-border)]">
          <div>
            <ToggleSwitch
              checked={localPickup}
              onChange={v => { setLocalPickup(v); mark() }}
              label="Entrega en mano / recoger en tienda"
              description="El comprador puede pasar por el producto. Configura tus puntos de entrega abajo."
            />
            {localPickup && (
              <PickupSpotManager
                spots={pickupSpots}
                onUpdate={spots => { setPickupSpots(spots); mark() }}
                schedulingLinks={schedulingLinks}
              />
            )}
          </div>
          {/* ── Origin address (Envia.com) ──────────────────────────────── */}
          <div className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                📦 Dirección de origen
              </p>
              <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5 font-medium">
                Envia.com
              </span>
            </div>
            <p className="text-xs text-[var(--color-muted)] mb-3">
              Desde aquí se calcularán tarifas y se generarán etiquetas con DHL, FedEx, Estafeta, UPS y más. Todos los campos son necesarios.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Sender name */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Nombre del remitente</label>
                <input
                  type="text"
                  value={originName}
                  onChange={e => { setOriginName(e.target.value); mark() }}
                  placeholder="Tu nombre o razón social"
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>

              {/* CP — entry point that auto-fills state/city */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">
                  Código postal <span className="font-normal">(auto-completa estado y ciudad)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={originPostalCode}
                    onChange={e => handleOriginCpChange(e.target.value)}
                    placeholder="06600"
                    maxLength={5}
                    inputMode="numeric"
                    className={`w-full border rounded px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${
                      originCpLookupError ? 'border-red-400' : originCpResolved ? 'border-green-400' : 'border-[var(--color-border)]'
                    }`}
                  />
                  {originCpLookupLoading && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-muted)] animate-pulse">·</span>
                  )}
                  {originCpResolved && !originCpLookupLoading && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600 text-sm">✓</span>
                  )}
                </div>
                {originCpLookupError && (
                  <p className="text-red-600 text-xs mt-1">{originCpLookupError}</p>
                )}
                {originCpResolved && (
                  <p className="text-green-700 text-xs mt-1">{originCity} · {originState}</p>
                )}
              </div>

              {/* Estado — read-only once CP resolved */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Estado</label>
                <input
                  type="text"
                  value={originState}
                  readOnly={originCpResolved}
                  onChange={e => { if (!originCpResolved) { setOriginState(e.target.value); mark() } }}
                  placeholder="Ciudad de México"
                  className={`w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${originCpResolved ? 'bg-gray-50 text-[var(--color-muted)] cursor-default' : ''}`}
                />
              </div>

              {/* Ciudad — read-only once CP resolved */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Ciudad / Municipio</label>
                <input
                  type="text"
                  value={originCity}
                  readOnly={originCpResolved}
                  onChange={e => { if (!originCpResolved) { setOriginCity(e.target.value); mark() } }}
                  placeholder="Ciudad de México"
                  className={`w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${originCpResolved ? 'bg-gray-50 text-[var(--color-muted)] cursor-default' : ''}`}
                />
              </div>

              {/* Colonia — dropdown when CP resolved, free-text otherwise */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Colonia</label>
                {originCpResolved && originColonias.length > 0 ? (
                  <select
                    value={originColonia}
                    onChange={e => { setOriginColonia(e.target.value); mark() }}
                    className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] bg-white"
                  >
                    <option value="">Selecciona colonia</option>
                    {originColonias.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={originColonia}
                    onChange={e => { setOriginColonia(e.target.value); mark() }}
                    placeholder="Roma Norte"
                    className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  />
                )}
              </div>

              {/* Street */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Calle</label>
                <input
                  type="text"
                  value={originStreet}
                  onChange={e => { setOriginStreet(e.target.value); mark() }}
                  placeholder="Av. Insurgentes"
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>

              {/* Ext number */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Número exterior</label>
                <input
                  type="text"
                  value={originNumber}
                  onChange={e => { setOriginNumber(e.target.value); mark() }}
                  placeholder="123"
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
            </div>
            {!originAddressReady && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-700 leading-relaxed">
                <strong>Completa tu dirección de origen</strong> para poder generar etiquetas y cotizar envíos con Envia.com cuando recibas un pedido.
              </div>
            )}
            {originAddressReady && (
              <div className="mt-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 text-xs text-green-800 leading-relaxed">
                <strong>Origen listo.</strong> El checkout puede cotizar envíos reales desde este punto cuando el comprador escriba su dirección.
              </div>
            )}
          </div>

          {/* ── Envia.com checkout policy ──────────────────────────────── */}
          <div className="pt-4">
            {!initial.platform_envia_enabled && initial.granted_envia_enabled && (
              <div className="mb-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 text-xs text-green-800 leading-relaxed">
                <strong>Envía habilitado por Miyagi.</strong> Aunque el envío automático está en pausa
                para el resto de la plataforma, tu tienda tiene una cortesía activa: el cálculo de
                tarifas en vivo y la generación de etiquetas con Envia.com siguen funcionando normalmente.
              </div>
            )}
            {!initial.platform_envia_enabled && !initial.granted_envia_enabled && (
              <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
                <strong>Envío automático en pausa.</strong> Por ahora el cálculo de tarifas en vivo y la
                generación de etiquetas con Envia.com están desactivados a nivel de plataforma, así que tu
                opción de &ldquo;tarifas en vivo&rdquo; no surte efecto. Mientras tanto, coordina la entrega
                con paquetería manual o entrega acordada. Tu configuración se conserva y se reactivará en
                cuanto el envío automático vuelva a estar disponible.
              </div>
            )}
            <ToggleSwitch
              checked={enviaShippingEnabled}
              onChange={v => { setEnviaShippingEnabled(v); mark() }}
              disabled={!originAddressReady || !(initial.platform_envia_enabled || initial.granted_envia_enabled)}
              label="Envío a domicilio con tarifas en vivo"
              description="Muestra al comprador opciones reales de paquetería calculadas por Envia.com antes de pagar."
            />

            {enviaShippingEnabled && (
              <div className="space-y-4 pt-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                    Paqueterías disponibles
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {ENVIA_CARRIERS.map(carrier => {
                      const active = allowedCarriers.includes(carrier.id)
                      return (
                        <button
                          key={carrier.id}
                          type="button"
                          onClick={() => toggleCarrier(carrier.id)}
                          className={`text-left border rounded-lg px-3 py-2 transition-colors ${
                            active
                              ? 'border-[var(--color-accent)] bg-green-50 text-green-800'
                              : 'border-[var(--color-border)] bg-white text-[var(--color-muted)] hover:border-[var(--color-accent)]'
                          }`}
                        >
                          <span className="block text-sm font-semibold">{carrier.label}</span>
                          <span className="block text-[11px] mt-0.5">{active ? 'Activo en checkout' : 'Oculto'}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                    Opciones que verá el comprador
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {[
                      { id: 'recommended', label: 'Mejores 3', note: 'Equilibrio precio/tiempo' },
                      { id: 'cheapest', label: 'Más barato', note: 'Una sola opción' },
                      { id: 'all', label: 'Todas', note: 'Hasta 8 tarifas' },
                    ].map(option => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => { setShippingRateDisplay(option.id as 'recommended' | 'cheapest' | 'all'); mark() }}
                        className={`text-left border rounded-lg px-3 py-2 transition-colors ${
                          shippingRateDisplay === option.id
                            ? 'border-[var(--color-accent)] bg-green-50 text-green-800'
                            : 'border-[var(--color-border)] bg-white text-[var(--color-muted)] hover:border-[var(--color-accent)]'
                        }`}
                      >
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="block text-[11px] mt-0.5">{option.note}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                    Paquete predeterminado
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Peso</label>
                      <div className="flex">
                        <input
                          type="number"
                          min={100}
                          step={50}
                          value={packageWeightGrams}
                          onChange={e => { setPackageWeightGrams(Number(e.target.value) || 100); mark() }}
                          className="w-full border border-[var(--color-border)] rounded-l px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                        />
                        <span className="border border-l-0 border-[var(--color-border)] rounded-r px-2 py-2 text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)]">g</span>
                      </div>
                    </div>
                    {[
                      { label: 'Largo', value: packageLengthCm, setter: setPackageLengthCm },
                      { label: 'Ancho', value: packageWidthCm, setter: setPackageWidthCm },
                      { label: 'Alto', value: packageHeightCm, setter: setPackageHeightCm },
                    ].map(field => (
                      <div key={field.label}>
                        <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">{field.label}</label>
                        <div className="flex">
                          <input
                            type="number"
                            min={1}
                            value={field.value}
                            onChange={e => { field.setter(Number(e.target.value) || 1); mark() }}
                            className="w-full border border-[var(--color-border)] rounded-l px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                          />
                          <span className="border border-l-0 border-[var(--color-border)] rounded-r px-2 py-2 text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)]">cm</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                    Manejo y empaque
                  </label>
                  <div className="flex max-w-[220px]">
                    <span className="border border-r-0 border-[var(--color-border)] rounded-l px-3 py-2 text-sm text-[var(--color-muted)] bg-[var(--color-surface-alt)]">$</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={handlingFeePesos}
                      onChange={e => { setHandlingFeePesos(Number(e.target.value) || 0); mark() }}
                      className="w-full border border-[var(--color-border)] rounded-r px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    />
                  </div>
                  <p className="text-xs text-[var(--color-muted)] mt-1">
                    Se suma a cada tarifa en checkout para cubrir empaque o traslado al punto de paquetería.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
