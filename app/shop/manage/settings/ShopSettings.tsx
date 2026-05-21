'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { MEXICAN_STATES } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShopStripe {
  account_id?: string
  charges_enabled?: boolean
  onboarding_complete?: boolean
}

export interface ShopSettingsData {
  name: string
  description: string
  location: string | null
  logo_url?: string | null
  mp_enabled: boolean
  ucp_webhook_url?: string | null
  ucp_webhook_secret?: string | null
  stripe?: ShopStripe
  metadata: {
    settings?: {
      preset?: string
      checkout?: {
        escrow_mode?: 'off' | 'optional' | 'required'
        payment_methods?: string[]
        show_phone?: boolean
        whatsapp_cta?: boolean
        bank_transfer?: {
          enabled: boolean
          clabe?: string        // 18-digit CLABE
          bank_name?: string
          account_holder?: string
        }
      }
      shipping?: {
        mercado_envios?: boolean
        local_pickup?: boolean
        custom_rates?: boolean
      }
      notifications?: {
        email_new_view?: boolean
        email_new_message?: boolean
      }
      offers?: {
        min_buyer_trust_level?: 'unverified' | 'basic' | 'trusted' | 'verified' | 'elite'
        negotiation?: {
          enabled: boolean
          auto_accept_pct?: number   // 0–100: auto-accept offers at or above this % of list price
          auto_decline_pct?: number  // 0–100: auto-decline offers below this %
          auto_counter_pct?: number  // 0–100: counter-offer at this % when between thresholds
        }
      }
      ucp?: {
        webhook_url?:    string
        webhook_secret?: string
      }
      theme?: {
        banner_url?: string | null
        accent_color?: string | null
        tagline?: string | null
        social?: {
          instagram?: string
          facebook?: string
          whatsapp?: string
          tiktok?: string
          twitter?: string
        }
      }
    }
  } | null
}

// ── Preset definitions ────────────────────────────────────────────────────────

interface Preset {
  key: string
  icon: string
  label: string
  description: string
  settings: NonNullable<NonNullable<ShopSettingsData['metadata']>['settings']>
}

const PRESETS: Preset[] = [
  {
    key: 'basico',
    icon: '🛒',
    label: 'Básico',
    description: 'Ropa, electrónica, hogar, productos del día a día. Sin protección de pago.',
    settings: {
      checkout: { escrow_mode: 'off', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true, mercado_envios: false },
    },
  },
  {
    key: 'protegido',
    icon: '🛡️',
    label: 'Protegido',
    description: 'Activar Compra Protegida como opción. El comprador elige si la usa.',
    settings: {
      checkout: { escrow_mode: 'optional', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true, mercado_envios: true },
    },
  },
  {
    key: 'alto_valor',
    icon: '💎',
    label: 'Alto valor',
    description: 'Electrónica cara, coleccionables, joyería. Compra Protegida obligatoria.',
    settings: {
      checkout: { escrow_mode: 'required', show_phone: false, whatsapp_cta: false },
      shipping: { local_pickup: false, mercado_envios: true },
    },
  },
  {
    key: 'vehiculos',
    icon: '🚗',
    label: 'Vehículos',
    description: 'Autos, motos, camiones. Pago protegido obligatorio + verificación REPUVE.',
    settings: {
      checkout: { escrow_mode: 'required', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true, mercado_envios: false },
    },
  },
  {
    key: 'inmuebles',
    icon: '🏠',
    label: 'Inmuebles',
    description: 'Venta y renta de propiedades. Depósito protegido para reserva.',
    settings: {
      checkout: { escrow_mode: 'required', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true, mercado_envios: false },
    },
  },
  {
    key: 'digital',
    icon: '💻',
    label: 'Digital',
    description: 'Archivos, plantillas, cursos, licencias. Entrega automática.',
    settings: {
      checkout: { escrow_mode: 'off', show_phone: false, whatsapp_cta: false },
      shipping: { local_pickup: false, mercado_envios: false },
    },
  },
]

// ── Helper: parse location string ────────────────────────────────────────────

function parseLocation(loc: string | null): { city: string; state: string } {
  if (!loc) return { city: '', state: '' }
  const parts = loc.split(', ')
  if (parts.length >= 2) return { city: parts[0], state: parts.slice(1).join(', ') }
  return { city: '', state: parts[0] }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--color-muted)] mb-3">{children}</h2>
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center justify-between gap-4 py-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-[var(--color-muted)]">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
          checked ? 'bg-[var(--color-accent)]' : 'bg-gray-300'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastState { message: string; type: 'success' | 'error' }

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
        toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
      <span>{toast.message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100">×</button>
    </div>
  )
}

// ── Escrow mode selector ──────────────────────────────────────────────────────

const ESCROW_OPTIONS: { key: 'off' | 'optional' | 'required'; label: string; desc: string; color: string }[] = [
  { key: 'off',      label: 'Desactivado',  desc: 'Sin Compra Protegida. El comprador paga directo.',       color: 'border-gray-300 bg-gray-50' },
  { key: 'optional', label: 'Opcional',     desc: 'El comprador puede elegir activar protección de pago.',  color: 'border-amber-300 bg-amber-50' },
  { key: 'required', label: 'Obligatorio',  desc: 'Todos los pagos pasan por Compra Protegida.',             color: 'border-green-400 bg-green-50' },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function ShopSettingsPanel({ initial }: { initial: ShopSettingsData }) {
  const parsedLoc = parseLocation(initial.location)

  // Profile fields
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description ?? '')
  const [city, setCity] = useState(parsedLoc.city)
  const [state, setState] = useState(parsedLoc.state)

  // Settings from metadata
  const s = initial.metadata?.settings ?? {}
  const [preset, setPreset] = useState(s.preset ?? 'basico')
  const [escrowMode, setEscrowMode] = useState<'off' | 'optional' | 'required'>(s.checkout?.escrow_mode ?? 'off')
  const [showPhone, setShowPhone] = useState(s.checkout?.show_phone ?? true)
  const [whatsappCta, setWhatsappCta] = useState(s.checkout?.whatsapp_cta ?? true)
  const [mercadoEnvios, setMercadoEnvios] = useState(s.shipping?.mercado_envios ?? false)
  const [localPickup, setLocalPickup] = useState(s.shipping?.local_pickup ?? true)
  const [emailView, setEmailView] = useState(s.notifications?.email_new_view ?? false)
  const [emailMessage, setEmailMessage] = useState(s.notifications?.email_new_message ?? true)

  // Theme state
  const t = s.theme ?? {}
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logo_url ?? null)
  const [bannerUrl, setBannerUrl] = useState<string | null>(t.banner_url ?? null)
  const [accentColor, setAccentColor] = useState(t.accent_color ?? '#1d6f42')
  const [tagline, setTagline] = useState(t.tagline ?? '')
  const [instagram, setInstagram] = useState(t.social?.instagram ?? '')
  const [facebook, setFacebook] = useState(t.social?.facebook ?? '')
  const [whatsappHandle, setWhatsappHandle] = useState(t.social?.whatsapp ?? '')
  const [tiktok, setTiktok] = useState(t.social?.tiktok ?? '')
  const [logoUploading, setLogoUploading] = useState(false)
  const [bannerUploading, setBannerUploading] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // Bank transfer (SPEI)
  const bt = s.checkout?.bank_transfer ?? {} as NonNullable<NonNullable<NonNullable<ShopSettingsData['metadata']>['settings']>['checkout']>['bank_transfer'] & {}
  const [bankTransferEnabled, setBankTransferEnabled] = useState(bt?.enabled ?? false)
  const [clabe, setClabe]                   = useState(bt?.clabe ?? '')
  const [bankName, setBankName]             = useState(bt?.bank_name ?? '')
  const [accountHolder, setAccountHolder]   = useState(bt?.account_holder ?? '')

  // #14 Trust gate
  type OffersSettings = NonNullable<NonNullable<NonNullable<ShopSettingsData['metadata']>['settings']>['offers']>
  type NegotiationSettings = NonNullable<OffersSettings['negotiation']>
  const offersSettings = (s.offers ?? {}) as OffersSettings
  const neg = (offersSettings.negotiation ?? {}) as NegotiationSettings
  const [minBuyerTrust, setMinBuyerTrust] = useState<'unverified'|'basic'|'trusted'|'verified'|'elite'>(
    offersSettings.min_buyer_trust_level ?? 'unverified'
  )

  // #15 Negotiation rules
  const [negoEnabled, setNegoEnabled]     = useState(neg.enabled ?? false)
  const [acceptPct, setAcceptPct]         = useState(neg.auto_accept_pct ?? 90)
  const [declinePct, setDeclinePct]       = useState(neg.auto_decline_pct ?? 50)
  const [counterPct, setCounterPct]       = useState(neg.auto_counter_pct ?? 75)

  // #16 UCP Webhook
  const [webhookUrl, setWebhookUrl]       = useState(initial.ucp_webhook_url ?? '')
  const [webhookSecret, setWebhookSecret] = useState(initial.ucp_webhook_secret ?? '')
  const [showSecret, setShowSecret]       = useState(false)

  // MercadoPago settings
  const [mpEnabled, setMpEnabled] = useState(initial.mp_enabled ?? true)

  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  async function uploadImage(file: File, onDone: (url: string) => void, setUploading: (v: boolean) => void) {
    if (file.size > 8 * 1024 * 1024) { showToast('La imagen es demasiado grande (máx. 8 MB).', 'error'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/sell/upload', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) { showToast(data.error ?? 'Error al subir imagen.', 'error'); return }
      onDone(data.url)
    } catch {
      showToast('Sin conexión al subir imagen.', 'error')
    } finally {
      setUploading(false)
    }
  }

  // Apply preset defaults
  function applyPreset(key: string) {
    const p = PRESETS.find(x => x.key === key)
    if (!p) return
    setPreset(key)
    const c = p.settings.checkout ?? {}
    const sh = p.settings.shipping ?? {}
    if (c.escrow_mode) setEscrowMode(c.escrow_mode)
    if (c.show_phone !== undefined) setShowPhone(c.show_phone)
    if (c.whatsapp_cta !== undefined) setWhatsappCta(c.whatsapp_cta)
    if (sh.mercado_envios !== undefined) setMercadoEnvios(sh.mercado_envios)
    if (sh.local_pickup !== undefined) setLocalPickup(sh.local_pickup)
  }

  async function handleSave() {
    const errors: Record<string, string> = {}
    if (name.trim().length < 2) errors.name = 'El nombre debe tener al menos 2 caracteres.'
    if (description.length > 500) errors.description = 'Máximo 500 caracteres.'
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return }
    setFieldErrors({})

    setSaving(true)
    try {
      const res = await fetch('/api/sell/shop', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          state: state.trim(),
          city: city.trim(),
          logo_url: logoUrl,
          mp_enabled: mpEnabled,
          ucp_webhook_url:    webhookUrl.trim() || null,
          ucp_webhook_secret: webhookSecret.trim() || null,
          settings: {
            preset,
            checkout: {
              escrow_mode: escrowMode,
              show_phone: showPhone,
              whatsapp_cta: whatsappCta,
              bank_transfer: {
                enabled: bankTransferEnabled,
                clabe: clabe.trim() || undefined,
                bank_name: bankName.trim() || undefined,
                account_holder: accountHolder.trim() || undefined,
              },
            },
            shipping: { mercado_envios: mercadoEnvios, local_pickup: localPickup },
            notifications: { email_new_view: emailView, email_new_message: emailMessage },
            offers: {
              min_buyer_trust_level: minBuyerTrust,
              negotiation: {
                enabled: negoEnabled,
                auto_accept_pct: acceptPct,
                auto_decline_pct: declinePct,
                auto_counter_pct: counterPct,
              },
            },
            theme: {
              banner_url: bannerUrl,
              accent_color: accentColor,
              tagline: tagline.trim() || null,
              social: {
                instagram: instagram.trim().replace(/^@/, '') || undefined,
                facebook: facebook.trim() || undefined,
                whatsapp: whatsappHandle.trim().replace(/\D/g, '') || undefined,
                tiktok: tiktok.trim().replace(/^@/, '') || undefined,
              },
            },
          },
        }),
      })
      const data = await res.json() as { error?: string; field?: string }
      if (!res.ok) {
        if (data.field) setFieldErrors({ [data.field]: data.error ?? 'Error.' })
        else showToast(data.error ?? 'Error al guardar.', 'error')
      } else {
        showToast('Cambios guardados correctamente.', 'success')
      }
    } catch {
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* ── Breadcrumb ───────────────────────────────────────────────────────── */}
      <nav className="text-xs text-[var(--color-muted)] mb-6 flex items-center gap-1.5">
        <Link href="/shop/manage" className="hover:text-[var(--color-foreground)] no-underline">Mi tienda</Link>
        <span>›</span>
        <span>Configuración</span>
      </nav>

      <h1 className="text-2xl font-bold mb-8">Configuración de tienda</h1>

      {/* ══ Section 1: Perfil ═══════════════════════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Perfil de tienda</SectionTitle>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Nombre de tienda <span className="text-red-500">*</span>
            </label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setFieldErrors(p => ({ ...p, name: '' })) }}
              maxLength={80}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              placeholder="Mi tienda"
            />
            {fieldErrors.name && <p className="text-red-600 text-xs mt-1">⚠ {fieldErrors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Descripción
              <span className={`ml-2 text-xs font-normal ${description.length > 450 ? 'text-amber-600' : 'text-[var(--color-muted)]'}`}>
                {description.length}/500
              </span>
            </label>
            <textarea
              value={description}
              onChange={e => { setDescription(e.target.value); setFieldErrors(p => ({ ...p, description: '' })) }}
              maxLength={500}
              rows={3}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] resize-none"
              placeholder="Cuéntanos sobre tu tienda…"
            />
            {fieldErrors.description && <p className="text-red-600 text-xs mt-1">⚠ {fieldErrors.description}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Ciudad</label>
              <input
                value={city}
                onChange={e => setCity(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                placeholder="Ciudad de México"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Estado</label>
              <select
                value={state}
                onChange={e => setState(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] bg-white"
              >
                <option value="">Selecciona estado</option>
                {MEXICAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* ══ Section 2: Perfil de negocio ════════════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Perfil de negocio</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Elige el perfil que mejor describe tu tienda. Ajusta los valores individualmente si lo necesitas.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              title={p.description}
              className={`text-left p-3 rounded-lg border-2 transition-all ${
                preset === p.key
                  ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,white)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-gray-50'
              }`}
            >
              <div className="text-xl mb-1">{p.icon}</div>
              <div className="text-sm font-semibold">{p.label}</div>
              <div className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug line-clamp-2">{p.description}</div>
              {preset === p.key && (
                <div className="text-[10px] text-[var(--color-accent)] font-semibold mt-1 uppercase tracking-wide">Activo</div>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ══ Section 3: Compra Protegida ══════════════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Compra Protegida</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          El dinero queda retenido hasta que el comprador confirma la recepción. Powered by Stripe.
        </p>
        <div className="space-y-2">
          {ESCROW_OPTIONS.map(opt => (
            <label
              key={opt.key}
              className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                escrowMode === opt.key
                  ? `border-[var(--color-accent)] ${opt.color}`
                  : 'border-[var(--color-border)] hover:border-gray-400'
              }`}
            >
              <input
                type="radio"
                name="escrow_mode"
                value={opt.key}
                checked={escrowMode === opt.key}
                onChange={() => setEscrowMode(opt.key)}
                className="accent-[var(--color-accent)]"
              />
              <div>
                <div className="text-sm font-semibold">{opt.label}</div>
                <div className="text-xs text-[var(--color-muted)]">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* ══ Section 4: Comunicación ══════════════════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Comunicación</SectionTitle>
        <div className="divide-y divide-[var(--color-border)]">
          <ToggleSwitch
            checked={showPhone}
            onChange={setShowPhone}
            label="Mostrar teléfono en anuncios"
            description="Los compradores pueden llamarte o enviarte SMS."
          />
          <ToggleSwitch
            checked={whatsappCta}
            onChange={setWhatsappCta}
            label="Botón de WhatsApp"
            description="Añade un CTA de WhatsApp en cada anuncio."
          />
        </div>
      </section>

      {/* ══ Section 5: Envíos ════════════════════════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Envíos</SectionTitle>
        <div className="divide-y divide-[var(--color-border)]">
          <ToggleSwitch
            checked={localPickup}
            onChange={setLocalPickup}
            label="Entrega en mano / recoger en tienda"
            description="El comprador puede pasar por el producto."
          />
          <ToggleSwitch
            checked={mercadoEnvios}
            onChange={setMercadoEnvios}
            label="Mercado Envíos"
            description="Genera etiquetas de envío directamente desde tu tienda. (Próximamente)"
            disabled
          />
        </div>
      </section>

      {/* ══ Section 6: Notificaciones ════════════════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-8">
        <SectionTitle>Notificaciones por correo</SectionTitle>
        <div className="divide-y divide-[var(--color-border)]">
          <ToggleSwitch
            checked={emailMessage}
            onChange={setEmailMessage}
            label="Nuevo mensaje de un comprador"
          />
          <ToggleSwitch
            checked={emailView}
            onChange={setEmailView}
            label="Mi anuncio recibió visitas"
            description="Resumen diario cuando tus anuncios tienen nuevas vistas."
          />
        </div>
      </section>

      {/* ══ Section 7: Pagos en línea (Stripe Connect) ══════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Pagos en línea</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Acepta pagos con tarjeta directamente en tu tienda. Sin comisiones de plataforma — solo la tarifa estándar de Stripe.
        </p>

        {initial.stripe?.charges_enabled ? (
          // ── Connected & active ─────────────────────────────────────────────
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-green-800">Pagos activados</div>
              <div className="text-xs text-green-700 mt-0.5">Tu cuenta Stripe está conectada y lista para recibir pagos.</div>
            </div>
            <a
              href="/api/stripe/connect"
              className="text-xs text-green-700 underline hover:text-green-900 flex-shrink-0"
            >
              Gestionar →
            </a>
          </div>
        ) : initial.stripe?.account_id && !initial.stripe.onboarding_complete ? (
          // ── Account created but onboarding incomplete ──────────────────────
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-4">
            <div className="flex items-start gap-3 mb-3">
              <span className="text-xl">⚠️</span>
              <div>
                <div className="text-sm font-semibold text-amber-800">Configuración pendiente</div>
                <div className="text-xs text-amber-700 mt-0.5">
                  Completa la configuración de tu cuenta Stripe para empezar a cobrar.
                </div>
              </div>
            </div>
            <a
              href="/api/stripe/connect/refresh"
              className="flex items-center justify-center gap-2 w-full bg-amber-600 text-white font-semibold py-2.5 rounded-lg text-sm no-underline hover:bg-amber-700 transition-colors"
            >
              Completar configuración →
            </a>
          </div>
        ) : (
          // ── Not connected ──────────────────────────────────────────────────
          <div className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-4 py-4">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-2xl">💳</span>
              <div>
                <div className="text-sm font-semibold">Acepta tarjetas en tu tienda</div>
                <ul className="text-xs text-[var(--color-muted)] mt-1.5 space-y-0.5">
                  <li>✓ Visa, Mastercard, AMEX</li>
                  <li>✓ 0% comisión de plataforma</li>
                  <li>✓ Pagos directos a tu cuenta bancaria</li>
                  <li>✓ Configuración en 2 minutos</li>
                </ul>
              </div>
            </div>
            <a
              href="/api/stripe/connect"
              className="flex items-center justify-center gap-2 w-full bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-lg text-sm no-underline hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
              </svg>
              Conectar Stripe
            </a>
            <p className="text-[10px] text-center text-[var(--color-muted)] mt-2">
              Serás redirigido a Stripe para crear o conectar tu cuenta.
            </p>
          </div>
        )}
      </section>

      {/* ══ Section 8: Transferencia bancaria (SPEI) ════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Transferencia bancaria (SPEI)</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Permite que tus compradores paguen por transferencia bancaria. Tú confirmas el pago manualmente antes de entregar.
        </p>
        <div className="divide-y divide-[var(--color-border)]">
          <ToggleSwitch
            checked={bankTransferEnabled}
            onChange={setBankTransferEnabled}
            label="Aceptar transferencias bancarias"
            description="Aparecerá como opción de pago en tus anuncios."
          />
        </div>

        {bankTransferEnabled && (
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                CLABE interbancaria <span className="text-red-500">*</span>
              </label>
              <input
                value={clabe}
                onChange={e => setClabe(e.target.value.replace(/\D/g, '').slice(0, 18))}
                maxLength={18}
                placeholder="18 dígitos"
                className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              {clabe && clabe.length !== 18 && (
                <p className="text-amber-600 text-xs mt-1">⚠ La CLABE debe tener exactamente 18 dígitos ({clabe.length}/18)</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Banco</label>
                <input
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  placeholder="BBVA, Banorte, HSBC…"
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Titular de la cuenta</label>
                <input
                  value={accountHolder}
                  onChange={e => setAccountHolder(e.target.value)}
                  placeholder="Nombre completo"
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
              💡 El comprador verá estos datos al momento de pagar. Confirma el pago en tu cuenta antes de enviar o entregar el artículo.
            </p>
          </div>
        )}
      </section>

      {/* ══ Section 9: MercadoPago ═══════════════════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Mercado Pago</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Permite a tus compradores pagar con tarjeta, OXXO, wallet y meses sin intereses a través de Mercado Pago.
        </p>

        <div className="divide-y divide-[var(--color-border)]">
          <ToggleSwitch
            checked={mpEnabled}
            onChange={setMpEnabled}
            label="Activar Mercado Pago"
            description="Muestra el botón de Mercado Pago en tus anuncios físicos."
          />
        </div>

        {!mpEnabled && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            El botón de Mercado Pago estará oculto en tus anuncios mientras esté desactivado.
          </p>
        )}

        <div className="mt-4 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-4 py-3">
          <div className="flex items-start gap-2">
            <span className="text-base mt-0.5">💡</span>
            <p className="text-xs text-[var(--color-muted)] leading-relaxed">
              <strong>Próximamente:</strong> conecta tu propia cuenta de Mercado Pago para recibir pagos directamente, sin intermediarios. Los fondos llegarán a tu cuenta el mismo día.
            </p>
          </div>
        </div>
      </section>

      {/* ══ Section 10: Ofertas y confianza ════════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Ofertas — nivel mínimo de comprador</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Elige el nivel de reputación mínimo que debe tener un comprador para enviarte una oferta. Los compradores por debajo del nivel serán rechazados automáticamente.
        </p>
        <div className="space-y-2">
          {([
            { value: 'unverified', label: '⚠️ Sin verificar', desc: 'Cualquier persona puede hacer una oferta.' },
            { value: 'basic',      label: '📧 Básico',        desc: 'Solo compradores con correo verificado.' },
            { value: 'trusted',    label: '🤝 Confiable',     desc: 'Correo + teléfono o al menos 1 compra previa.' },
            { value: 'verified',   label: '✓ Verificado',     desc: 'Historial sólido de compras y cuenta establecida.' },
            { value: 'elite',      label: '⭐ Elite',         desc: 'Solo los compradores más confiables de la plataforma.' },
          ] as const).map(opt => (
            <label
              key={opt.value}
              className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                minBuyerTrust === opt.value
                  ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,white)]'
                  : 'border-[var(--color-border)] hover:border-gray-400'
              }`}
            >
              <input type="radio" name="min_buyer_trust" value={opt.value}
                checked={minBuyerTrust === opt.value} onChange={() => setMinBuyerTrust(opt.value)}
                className="accent-[var(--color-accent)]" />
              <div>
                <div className="text-sm font-semibold">{opt.label}</div>
                <div className="text-xs text-[var(--color-muted)]">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* ══ Section 11: Negociación automática (A2A) ════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Negociación automática</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Define reglas automáticas para aceptar, rechazar o contraofertear sin tener que revisar cada oferta manualmente. Ideal para catálogos grandes o tiendas de alto volumen.
        </p>
        <div className="divide-y divide-[var(--color-border)]">
          <ToggleSwitch
            checked={negoEnabled}
            onChange={setNegoEnabled}
            label="Activar negociación automática"
            description="Las ofertas dentro de tus rangos se responden al instante."
          />
        </div>

        {negoEnabled && (
          <div className="mt-4 space-y-4">
            {[
              { label: 'Aceptar automáticamente si la oferta es ≥', value: acceptPct, set: setAcceptPct, color: 'green', hint: `Ofertas a ${ acceptPct }% o más del precio de lista se aceptan al instante.` },
              { label: 'Contraofertear al', value: counterPct, set: setCounterPct, color: 'amber', hint: `Si la oferta está entre ${ declinePct }% y ${ acceptPct }%, se contraoferta al ${ counterPct }% del precio.` },
              { label: 'Rechazar automáticamente si la oferta es <', value: declinePct, set: setDeclinePct, color: 'red', hint: `Ofertas por debajo del ${ declinePct }% se rechazan automáticamente.` },
            ].map(row => (
              <div key={row.label}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">{row.label}</label>
                  <span className={`text-sm font-bold tabular-nums ${
                    row.color === 'green' ? 'text-green-700' : row.color === 'amber' ? 'text-amber-700' : 'text-red-700'
                  }`}>{row.value}%</span>
                </div>
                <input
                  type="range" min={0} max={100} step={5}
                  value={row.value}
                  onChange={e => row.set(parseInt(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
                <p className="text-xs text-[var(--color-muted)] mt-0.5">{row.hint}</p>
              </div>
            ))}

            {declinePct >= acceptPct && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                ⚠ El porcentaje de rechazo ({declinePct}%) debe ser menor al de aceptación ({acceptPct}%).
              </p>
            )}
            {counterPct > acceptPct && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠ El porcentaje de contraoferta ({counterPct}%) debe ser menor o igual al de aceptación ({acceptPct}%).
              </p>
            )}
          </div>
        )}
      </section>

      {/* ══ Section 12: UCP Webhook de órdenes ══════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Webhook de órdenes (UCP)</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Recibe notificaciones en tiempo real en tu sistema cuando se completa una venta. El payload incluye datos del comprador, la orden, el anuncio y el nivel de confianza del comprador.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">URL del webhook</label>
            <input
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              type="url"
              placeholder="https://tu-sistema.com/webhooks/ordenes"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Clave secreta (HMAC-SHA256)
              <span className="ml-1 text-xs font-normal text-[var(--color-muted)]">— para verificar autenticidad</span>
            </label>
            <div className="flex gap-2">
              <input
                value={webhookSecret}
                onChange={e => setWebhookSecret(e.target.value)}
                type={showSecret ? 'text' : 'password'}
                placeholder="Genera o pega tu clave secreta"
                className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <button type="button" onClick={() => setShowSecret(s => !s)}
                className="px-3 py-2 border border-[var(--color-border)] rounded text-xs hover:bg-gray-50 transition-colors">
                {showSecret ? 'Ocultar' : 'Ver'}
              </button>
              <button type="button"
                onClick={() => setWebhookSecret(Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2,'0')).join(''))}
                className="px-3 py-2 border border-[var(--color-border)] rounded text-xs hover:bg-gray-50 transition-colors">
                Generar
              </button>
            </div>
          </div>
          {webhookUrl && (
            <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
              💡 Verifica la firma en el header <code className="font-mono">X-UCP-Signature</code> usando HMAC-SHA256 con tu clave secreta y el cuerpo del request.
            </p>
          )}
        </div>
      </section>

      {/* ══ Section 13: Apariencia ═══════════════════════════════════════════════ */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-8">
        <SectionTitle>Apariencia</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-5">
          Personaliza el aspecto de tu tienda pública: banner, logo, color y redes sociales.
        </p>

        {/* Banner */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">Banner de tienda</label>
          <div
            className="relative w-full h-28 rounded-lg overflow-hidden border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-center cursor-pointer hover:border-[var(--color-accent)] transition-colors"
            onClick={() => bannerInputRef.current?.click()}
            style={bannerUrl ? { backgroundImage: `url(${bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', borderStyle: 'solid' } : {}}
          >
            {bannerUploading ? (
              <span className="text-sm text-[var(--color-muted)] animate-pulse">Subiendo…</span>
            ) : bannerUrl ? (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <span className="text-white text-xs font-medium bg-black/50 px-3 py-1.5 rounded">Cambiar banner</span>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-2xl mb-1">🖼️</div>
                <div className="text-xs text-[var(--color-muted)]">Haz clic para subir banner</div>
                <div className="text-xs text-[var(--color-muted)]">Recomendado: 1200 × 300 px · máx. 8 MB</div>
              </div>
            )}
          </div>
          {bannerUrl && (
            <button type="button" onClick={() => setBannerUrl(null)} className="text-xs text-red-600 hover:underline mt-1">
              Eliminar banner
            </button>
          )}
          <input ref={bannerInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f, setBannerUrl, setBannerUploading); e.target.value = '' }} />
        </div>

        {/* Logo */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">Logo de tienda</label>
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full overflow-hidden border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-center cursor-pointer hover:border-[var(--color-accent)] transition-colors flex-shrink-0"
              onClick={() => logoInputRef.current?.click()}
              style={logoUrl ? { backgroundImage: `url(${logoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', borderStyle: 'solid' } : {}}
            >
              {logoUploading ? (
                <span className="text-[10px] text-[var(--color-muted)] animate-pulse text-center px-1">…</span>
              ) : !logoUrl && (
                <span className="text-2xl">🏪</span>
              )}
            </div>
            <div>
              <button type="button" onClick={() => logoInputRef.current?.click()}
                className="text-sm text-[var(--color-accent)] hover:underline block">
                {logoUrl ? 'Cambiar logo' : 'Subir logo'}
              </button>
              {logoUrl && (
                <button type="button" onClick={() => setLogoUrl(null)} className="text-xs text-red-600 hover:underline mt-1 block">
                  Eliminar logo
                </button>
              )}
              <p className="text-xs text-[var(--color-muted)] mt-1">Cuadrado · máx. 8 MB</p>
            </div>
          </div>
          <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f, setLogoUrl, setLogoUploading); e.target.value = '' }} />
        </div>

        {/* Slogan */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-1">
            Slogan
            <span className={`ml-2 text-xs font-normal ${tagline.length > 85 ? 'text-amber-600' : 'text-[var(--color-muted)]'}`}>
              {tagline.length}/100
            </span>
          </label>
          <input
            value={tagline}
            onChange={e => setTagline(e.target.value)}
            maxLength={100}
            placeholder="El mejor lugar para encontrar piezas de colección"
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>

        {/* Color de marca */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">Color de marca</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={accentColor}
              onChange={e => setAccentColor(e.target.value)}
              className="w-10 h-10 rounded cursor-pointer border border-[var(--color-border)] p-0.5 bg-white"
            />
            <div>
              <div className="text-sm font-mono">{accentColor}</div>
              <div className="text-xs text-[var(--color-muted)]">Se aplica en tu tienda pública</div>
            </div>
            <div
              className="ml-auto px-4 py-1.5 rounded text-white text-xs font-medium"
              style={{ backgroundColor: accentColor }}
            >
              Vista previa
            </div>
          </div>
        </div>

        {/* Redes sociales */}
        <div>
          <label className="block text-sm font-medium mb-3">Redes sociales</label>
          <div className="space-y-2">
            {[
              { icon: '📸', label: 'Instagram', value: instagram, set: setInstagram, placeholder: '@tutienda', prefix: 'instagram.com/' },
              { icon: '👥', label: 'Facebook', value: facebook, set: setFacebook, placeholder: 'https://facebook.com/tutienda', prefix: '' },
              { icon: '💬', label: 'WhatsApp', value: whatsappHandle, set: setWhatsappHandle, placeholder: '52 55 1234 5678', prefix: '+' },
              { icon: '🎵', label: 'TikTok', value: tiktok, set: setTiktok, placeholder: '@tutienda', prefix: 'tiktok.com/@' },
            ].map(net => (
              <div key={net.label} className="flex items-center gap-2">
                <span className="text-lg w-7 flex-shrink-0 text-center">{net.icon}</span>
                <span className="text-xs text-[var(--color-muted)] w-20 flex-shrink-0">{net.label}</span>
                <input
                  value={net.value}
                  onChange={e => net.set(e.target.value)}
                  placeholder={net.placeholder}
                  className="flex-1 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Save button ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Link href="/shop/manage" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline">
          ← Volver al panel
        </Link>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-[var(--color-accent)] text-white px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
