'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import Link from 'next/link'
import EmbedSnippetSection from './EmbedSnippetSection'
import { MEXICAN_STATES, MAJOR_MEXICAN_CITIES, CITIES_BY_STATE } from '@/lib/types'
import { toEnviaStateCode, ESTADOS } from '@/lib/mx-locations'
import { dnsRecordFor } from '@/lib/domain-utils'
import { SlugField, type SlugStatus } from '@/components/SlugField'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShopStripe {
  account_id?: string
  charges_enabled?: boolean
  onboarding_complete?: boolean
  enabled?: boolean
}

export interface PickupSpot {
  id: string
  name: string
  address: string
  hours?: string
  notes?: string
  scheduling_url?: string
}

// Predefined Mexican banks for the structured "Pago directo" config (+ "Otro").
const MX_BANKS = [
  'BBVA', 'Banorte', 'Santander', 'Citibanamex', 'HSBC', 'Scotiabank',
  'Banco Azteca', 'Inbursa', 'BanCoppel', 'Afirme', 'Banregio', 'BanBajío',
  'Nu', 'Hey Banco', 'Klar', 'Mercado Pago', 'Otro',
]

export interface ShopSettingsData {
  name: string
  description: string
  location: string | null
  logo_url?: string | null
  mp_enabled: boolean
  ucp_webhook_url?: string | null
  ucp_webhook_secret?: string | null
  /** Whether an MCP agent token has already been provisioned (Sprint 4). */
  agent_token_set?: boolean
  // Federated commerce — own channel
  slug?: string
  custom_domain?: string | null
  custom_domain_verified?: boolean
  calcom_connected?: boolean
  calcom_username?: string | null
  calcom_event_type_title?: string | null
  calcom_booking_url?: string | null
  stripe?: ShopStripe
  mercadopago?: { connected?: boolean; enabled?: boolean; live_mode?: boolean }
  metadata: {
    settings?: {
      preset?: string
      checkout?: {
        escrow_mode?: 'off' | 'optional' | 'required'
        payment_methods?: string[]
        show_phone?: boolean
        phone?: string | null
        whatsapp_cta?: boolean
        show_email?: boolean
        contact_email?: string | null
        bank_transfer?: {
          enabled: boolean
          clabe?: string | null
          bank_name?: string | null
          account_holder?: string | null
        }
      }
      shipping?: {
        local_pickup?: boolean
        custom_rates?: boolean
        envia_enabled?: boolean
        allowed_carriers?: string[]
        rate_display?: 'recommended' | 'cheapest' | 'all'
        handling_fee_cents?: number
        package_defaults?: {
          weight_grams?: number
          length_cm?: number
          width_cm?: number
          height_cm?: number
        }
        pickup_spots?: PickupSpot[]
        origin_address?: {
          name?: string | null
          street?: string | null
          number?: string | null
          colonia?: string | null
          city?: string | null
          state?: string | null
          state_code?: string | null
          postal_code?: string | null
        }
      }
      notifications?: {
        email_new_view?: boolean
        email_new_message?: boolean
      }
      offers?: {
        min_buyer_trust_level?: 'unverified' | 'basic' | 'trusted' | 'verified' | 'elite'
        negotiation?: {
          enabled: boolean
          auto_accept_pct?: number
          auto_decline_pct?: number
          auto_counter_pct?: number
        }
      }
      scheduling?: {
        links?: Array<{ label: string; url: string }>
      }
      orders?: {
        processing_time?: string
        auto_accept?: boolean
        dispatch_window_days?: number
        auto_confirm_days?: number
      }
      returns_policy?: {
        window?: string
        conditions?: string
        shipping_paid_by?: 'buyer' | 'seller'
        custom_note?: string | null
      } | null
      bundles?: {
        enabled?: boolean
        tiers?: Array<{ min_items: number; percent_off: number }>
      }
      ucp?: {
        webhook_url?: string
        webhook_secret?: string
      }
      theme?: {
        banner_url?: string | null
        accent_color?: string | null
        tagline?: string | null
        social?: {
          instagram?: string | null
          facebook?: string | null
          whatsapp?: string | null
          tiktok?: string | null
          twitter?: string | null
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
    label: 'Tienda general',
    description: 'Ropa, hogar, artículos del día a día. Sin retención de fondos.',
    settings: {
      checkout: { escrow_mode: 'off', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true },
    },
  },
  {
    key: 'protegido',
    icon: '🛡️',
    label: 'Con garantía',
    description: 'El comprador activa la protección si lo desea. Recomendado para electrónica usada.',
    settings: {
      checkout: { escrow_mode: 'optional', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true },
    },
  },
  {
    key: 'alto_valor',
    icon: '💎',
    label: 'Artículos de valor',
    description: 'Joyería, coleccionables, electrónica cara. Compra Protegida siempre activa.',
    settings: {
      checkout: { escrow_mode: 'required', show_phone: false, whatsapp_cta: false },
      shipping: { local_pickup: false },
    },
  },
  {
    key: 'vehiculos',
    icon: '🚗',
    label: 'Vehículos',
    description: 'Autos, motos, camiones. Pago protegido obligatorio + verificación REPUVE.',
    settings: {
      checkout: { escrow_mode: 'required', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true },
    },
  },
  {
    key: 'inmuebles',
    icon: '🏠',
    label: 'Inmuebles',
    description: 'Venta y renta de propiedades. Depósito protegido para reserva.',
    settings: {
      checkout: { escrow_mode: 'required', show_phone: true, whatsapp_cta: true },
      shipping: { local_pickup: true },
    },
  },
  {
    key: 'digital',
    icon: '💻',
    label: 'Digital / Cursos',
    description: 'Archivos, plantillas, cursos, licencias. Entrega automática.',
    settings: {
      checkout: { escrow_mode: 'off', show_phone: false, whatsapp_cta: false },
      shipping: { local_pickup: false },
    },
  },
]

// ── Navigation groups ─────────────────────────────────────────────────────────

interface NavItem { id: string; label: string; soon?: boolean; href?: string }
interface NavGroup { label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Tienda',
    items: [
      { id: 'perfil', label: 'Perfil' },
      { id: 'apariencia', label: 'Apariencia' },
      { id: 'tipo', label: 'Tipo de tienda' },
    ],
  },
  {
    label: 'Pagos',
    items: [
      { id: 'proteccion', label: 'Compra Protegida' },
      { id: 'stripe', label: 'Stripe' },
      { id: 'mercadopago', label: 'MercadoPago' },
      { id: 'spei', label: 'SPEI' },
    ],
  },
  {
    label: 'Ventas',
    items: [
      { id: 'comunicacion', label: 'Comunicación' },
      { id: 'envios', label: 'Envíos' },
      { id: 'citas', label: 'Citas y Reservas' },
      { id: 'ofertas', label: 'Ofertas' },
      { id: 'pedidos', label: 'Pedidos', href: '/shop/manage/orders' },
      { id: 'politicas', label: 'Devoluciones' },
    ],
  },
  {
    label: 'Canal propio',
    items: [
      { id: 'canal', label: 'Dominio propio' },
      { id: 'widget', label: 'Widget para tu web' },
    ],
  },
  {
    label: 'Integraciones',
    items: [
      { id: 'notificaciones', label: 'Notificaciones' },
      { id: 'webhook', label: 'Conectar sistema' },
    ],
  },
]

// ── URL slug → section IDs mapping ────────────────────────────────────────────
// The settings index links to /shop/manage/settings/[slug] (e.g. "pagos").
// ShopSettings renders sections with their own IDs (e.g. "proteccion", "stripe").
// This map converts the URL slug to the section IDs that should be visible.

const SLUG_TO_SECTION_IDS: Record<string, string[]> = {
  perfil:         ['perfil'],
  pagos:          ['proteccion', 'stripe', 'mercadopago', 'spei'],
  envios:         ['comunicacion', 'envios'],
  negociacion:    ['ofertas'],
  citas:          ['citas'],
  notificaciones: ['notificaciones'],
  diseno:         ['apariencia', 'tipo'],
  agentes:        ['webhook'],
  canal:          ['canal', 'widget'],
  widget:         ['widget'],
  pedidos:        ['pedidos'],
  politicas:      ['politicas'],
  bundles:        ['bundles'],
}

// ── Escrow options ────────────────────────────────────────────────────────────

const ESCROW_OPTIONS: { key: 'off' | 'optional' | 'required'; label: string; desc: string; color: string }[] = [
  { key: 'off',      label: 'Desactivado',  desc: 'Sin Compra Protegida. El comprador paga directo al vendedor.',    color: 'border-gray-300 bg-gray-50' },
  { key: 'optional', label: 'Opcional',     desc: 'El comprador puede elegir activar la protección de pago.',        color: 'border-amber-300 bg-amber-50' },
  { key: 'required', label: 'Obligatorio',  desc: 'Todos los pagos pasan por Compra Protegida sin excepción.',       color: 'border-green-400 bg-green-50' },
]

// ── Registrar DNS guides ─────────────────────────────────────────────────────

const REGISTRAR_GUIDES: Record<string, { name: string; icon: string; url: string; steps: string[] }> = {
  cloudflare: {
    name: 'Cloudflare',
    icon: '☁️',
    url: 'https://dash.cloudflare.com',
    steps: [
      'Ve a dash.cloudflare.com → elige tu dominio',
      'En la barra lateral clic en "DNS" → "Agregar registro"',
      'Tipo: CNAME · Nombre: @ · Contenido: cname.vercel-dns.com',
      'Proxy (nube naranja): desactivar → DNS only · Guardar',
    ],
  },
  godaddy: {
    name: 'GoDaddy',
    icon: '🐐',
    url: 'https://dcc.godaddy.com/manage',
    steps: [
      'Ve a dcc.godaddy.com → Mis dominios → "Administrar DNS"',
      'Desplázate hasta "Registros CNAME" → clic en "Agregar"',
      'Host: @ · Apunta a: cname.vercel-dns.com · TTL: 1 hora',
      'Clic en "Guardar"',
    ],
  },
  namecheap: {
    name: 'Namecheap',
    icon: '🌐',
    url: 'https://ap.www.namecheap.com/domains/list',
    steps: [
      'Ve a namecheap.com → Domain List → "Manage" junto a tu dominio',
      'Pestaña "Advanced DNS" → "Add New Record"',
      'Tipo: CNAME Record · Host: @ · Value: cname.vercel-dns.com',
      'TTL: Automático → "Save All Changes"',
    ],
  },
  google: {
    name: 'Google Domains / Squarespace',
    icon: '🔠',
    url: 'https://domains.google.com',
    steps: [
      'Ve a domains.google.com → tu dominio → "DNS"',
      'En "Custom records" → "Manage custom records" → "Create new record"',
      'Tipo: CNAME · Nombre: (vacío o @) · Datos: cname.vercel-dns.com',
      'Clic en "Save"',
    ],
  },
  squarespace: {
    name: 'Squarespace',
    icon: '🔲',
    url: 'https://account.squarespace.com/domains',
    steps: [
      'Ve a account.squarespace.com/domains → tu dominio → "DNS settings"',
      'Clic en "Add record" → Tipo: CNAME',
      'Host: @ · Data: cname.vercel-dns.com',
      'Clic en "Save"',
    ],
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseLocation(loc: string | null): { city: string; state: string } {
  if (!loc) return { city: '', state: '' }
  const parts = loc.split(', ')
  if (parts.length >= 2) return { city: parts[0], state: parts.slice(1).join(', ') }
  return { city: '', state: parts[0] }
}

function detectSchedulingService(url: string): string {
  if (url.includes('cal.com'))              return 'Cal.com'
  if (url.includes('calendly.com'))         return 'Calendly'
  if (url.includes('acuityscheduling.com')) return 'Acuity'
  if (url.includes('tidycal.com'))          return 'TidyCal'
  if (url.includes('google.com/calendar'))  return 'Google Calendar'
  return 'Cita en línea'
}

function generateHex32(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

const ENVIA_CARRIERS = [
  { id: 'dhl', label: 'DHL' },
  { id: 'fedex', label: 'FedEx' },
  { id: 'estafeta', label: 'Estafeta' },
  { id: 'ups', label: 'UPS' },
  { id: 'redpack', label: 'Redpack' },
  { id: 'paquetexpress', label: 'Paquetexpress' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--color-muted)] mb-3">
      {children}
    </h2>
  )
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

interface ToastState { message: string; type: 'success' | 'error' }

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
        toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
      <span>{toast.message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100">×</button>
    </div>
  )
}

function SoonBadge() {
  return (
    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
      Próximamente
    </span>
  )
}

function CopyPromptButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(prompt)
        setCopied(true)
        setTimeout(() => setCopied(false), 3000)
      }}
      title="Copia este prompt y pégalo en Claude, ChatGPT o tu IA favorita para obtener una opinión independiente"
      className={`inline-flex items-center gap-1.5 text-xs border rounded-full px-3 py-1 transition-colors whitespace-nowrap ${
        copied
          ? 'border-green-300 text-green-700 bg-green-50'
          : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
      }`}
    >
      <span>🤖</span>
      {copied ? '¡Copiado! Pégalo en tu IA' : 'Pregunta a tu IA'}
    </button>
  )
}

// ── Pickup Spot Manager ───────────────────────────────────────────────────────

function PickupSpotManager({
  spots,
  onUpdate,
  schedulingLinks,
}: {
  spots: PickupSpot[]
  onUpdate: (spots: PickupSpot[]) => void
  schedulingLinks: Array<{ label: string; url: string }>
}) {
  const emptyForm = { name: '', address: '', hours: '', notes: '', scheduling_url: '' }
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  function resetForm() {
    setForm(emptyForm)
    setEditId(null)
    setShowForm(false)
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.address.trim()) return
    if (editId) {
      onUpdate(spots.map(s => s.id === editId ? { ...form, id: editId } : s))
    } else {
      onUpdate([...spots, { ...form, id: Math.random().toString(36).slice(2) }])
    }
    resetForm()
  }

  function handleEdit(spot: PickupSpot) {
    setForm({
      name: spot.name,
      address: spot.address,
      hours: spot.hours ?? '',
      notes: spot.notes ?? '',
      scheduling_url: spot.scheduling_url ?? '',
    })
    setEditId(spot.id)
    setShowForm(true)
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Puntos de entrega
        </p>
        {spots.length > 0 && (
          <span className="text-xs text-[var(--color-accent)] font-medium">
            {spots.length} punto{spots.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {spots.length > 0 && (
        <div className="space-y-2 mb-3">
          {spots.map(spot => (
            <div key={spot.id} className="flex items-start gap-2 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2.5">
              <span className="text-base mt-0.5 flex-shrink-0">📍</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{spot.name}</p>
                <p className="text-xs text-[var(--color-muted)]">{spot.address}</p>
                {spot.hours && <p className="text-xs text-[var(--color-muted)] mt-0.5">🕐 {spot.hours}</p>}
                {spot.notes && <p className="text-xs text-[var(--color-muted)] mt-0.5 italic">{spot.notes}</p>}
                {spot.scheduling_url && (
                  <p className="text-xs text-[var(--color-accent)] mt-0.5 truncate">📅 Cita en línea configurada</p>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => handleEdit(spot)}
                  className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] px-2 py-1 border border-[var(--color-border)] rounded hover:bg-gray-50 transition-colors"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate(spots.filter(s => s.id !== spot.id))}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1 border border-red-200 rounded hover:bg-red-50 transition-colors"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="border border-[var(--color-accent)] rounded-lg p-3 space-y-2.5 bg-[var(--color-surface-alt)]">
          <p className="text-xs font-semibold text-[var(--color-foreground)]">
            {editId ? 'Editar punto' : 'Nuevo punto de entrega'}
          </p>
          <div>
            <label className="block text-xs font-medium mb-1">
              Nombre del punto <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Casa matriz, Bodega norte, Local 12…"
              className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Dirección <span className="text-red-500">*</span>
            </label>
            <input
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Av. Insurgentes 1234, Col. Del Valle, CDMX"
              className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">Horario</label>
              <input
                value={form.hours}
                onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}
                placeholder="Lun-Vie 9am-6pm"
                className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Notas para el comprador</label>
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Tocar el timbre del 3er piso"
                className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Enlace para agendar recogida (opcional)</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={form.scheduling_url}
                onChange={e => setForm(f => ({ ...f, scheduling_url: e.target.value }))}
                placeholder="https://cal.com/tu-usuario/recogida"
                className="flex-1 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              {schedulingLinks.length > 0 && (
                <select
                  onChange={e => { if (e.target.value) setForm(f => ({ ...f, scheduling_url: e.target.value })) }}
                  className="border border-[var(--color-border)] rounded px-2 py-1.5 text-xs bg-white focus:outline-none"
                  defaultValue=""
                >
                  <option value="">Mis enlaces ▾</option>
                  {schedulingLinks.map(l => (
                    <option key={l.url} value={l.url}>{l.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={resetForm}
              className="flex-1 border border-[var(--color-border)] rounded py-1.5 text-sm hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!form.name.trim() || !form.address.trim()}
              onClick={handleSubmit}
              className="flex-1 bg-[var(--color-accent)] text-white rounded py-1.5 text-sm font-semibold disabled:opacity-40 hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              {editId ? 'Guardar cambios' : 'Agregar punto'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-[var(--color-border)] rounded-lg py-2.5 text-sm text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
        >
          + Agregar punto de entrega
        </button>
      )}

      <p className="text-xs text-[var(--color-muted)] mt-2 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2 leading-relaxed">
        💡 Los compradores verán estos puntos al finalizar su compra. Próximamente podrán elegir el punto y agendar hora de recogida directamente desde el anuncio.
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ShopSettingsPanel({
  initial,
  stripeError,
  mpError,
  activeSection: focusSection,
}: {
  initial: ShopSettingsData
  stripeError?: string | null
  mpError?: string | null
  activeSection?: string
}) {
  const parsedLoc = parseLocation(initial.location)
  const s = initial.metadata?.settings ?? {}

  async function handleMpDisconnect() {
    if (!confirm('¿Desconectar Mercado Pago? Dejarás de aceptar pagos con Mercado Pago hasta que lo reconectes.')) return
    try {
      await fetch('/api/mp/connect', { method: 'DELETE' })
    } catch { /* ignore */ }
    window.location.reload()
  }

  // Dirty tracking
  const [isDirty, setIsDirty] = useState(false)
  const mark = useCallback(() => setIsDirty(true), [])

  // Profile
  const [name, setName]               = useState(initial.name)
  const [description, setDescription] = useState(initial.description ?? '')
  const [city, setCity]               = useState(parsedLoc.city)
  const [state, setState]             = useState(parsedLoc.state)
  const [isCityOther, setIsCityOther] = useState(() => {
    const citiesForState = parsedLoc.state ? CITIES_BY_STATE[parsedLoc.state] : undefined
    return citiesForState
      ? parsedLoc.city !== '' && !citiesForState.includes(parsedLoc.city)
      : false
  })

  // Preset
  const [preset, setPreset] = useState(s.preset ?? 'basico')

  // Checkout settings
  const [escrowMode, setEscrowMode]   = useState<'off' | 'optional' | 'required'>(s.checkout?.escrow_mode ?? 'off')
  const [showPhone, setShowPhone]     = useState(s.checkout?.show_phone === true && !!s.checkout?.phone)
  const [phoneNumber, setPhoneNumber] = useState(s.checkout?.phone ?? '')
  const [whatsappCta, setWhatsappCta] = useState(s.checkout?.whatsapp_cta === true && !!(s.theme?.social?.whatsapp))
  const [showEmail, setShowEmail]     = useState(s.checkout?.show_email ?? false)

  // Shipping
  const [localPickup, setLocalPickup]     = useState(s.shipping?.local_pickup ?? true)
  const [pickupSpots, setPickupSpots]     = useState<PickupSpot[]>(s.shipping?.pickup_spots ?? [])

  // Origin address (for Envia.com label generation)
  const oa = s.shipping?.origin_address ?? {}
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
  const [enviaShippingEnabled, setEnviaShippingEnabled] = useState(s.shipping?.envia_enabled ?? true)
  const [allowedCarriers, setAllowedCarriers] = useState<string[]>(
    s.shipping?.allowed_carriers?.length ? s.shipping.allowed_carriers : ENVIA_CARRIERS.map(carrier => carrier.id)
  )
  const [shippingRateDisplay, setShippingRateDisplay] = useState<'recommended' | 'cheapest' | 'all'>(
    s.shipping?.rate_display ?? 'recommended'
  )
  const pkgDefaults = s.shipping?.package_defaults ?? {}
  const [packageWeightGrams, setPackageWeightGrams] = useState(pkgDefaults.weight_grams ?? 500)
  const [packageLengthCm, setPackageLengthCm] = useState(pkgDefaults.length_cm ?? 20)
  const [packageWidthCm, setPackageWidthCm] = useState(pkgDefaults.width_cm ?? 15)
  const [packageHeightCm, setPackageHeightCm] = useState(pkgDefaults.height_cm ?? 10)
  const [handlingFeePesos, setHandlingFeePesos] = useState((s.shipping?.handling_fee_cents ?? 0) / 100)

  // Notifications
  const [emailView, setEmailView]       = useState(s.notifications?.email_new_view ?? false)
  const [emailMessage, setEmailMessage] = useState(s.notifications?.email_new_message ?? true)

  // Theme
  const t = s.theme ?? {}
  const [logoUrl, setLogoUrl]         = useState<string | null>(initial.logo_url ?? null)
  const [bannerUrl, setBannerUrl]     = useState<string | null>(t.banner_url ?? null)
  const [accentColor, setAccentColor] = useState(t.accent_color ?? '#1d6f42')
  const [tagline, setTagline]         = useState(t.tagline ?? '')
  const [instagram, setInstagram]     = useState(t.social?.instagram ?? '')
  const [facebook, setFacebook]       = useState(t.social?.facebook ?? '')
  const [whatsappHandle, setWhatsappHandle] = useState(t.social?.whatsapp ?? '')
  const [tiktok, setTiktok]           = useState(t.social?.tiktok ?? '')
  const [logoUploading, setLogoUploading]   = useState(false)
  const [bannerUploading, setBannerUploading] = useState(false)
  const logoInputRef   = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // Pago directo — SPEI / DiMo / efectivo al recoger
  const bt = s.checkout?.bank_transfer ?? {} as NonNullable<NonNullable<NonNullable<ShopSettingsData['metadata']>['settings']>['checkout']>['bank_transfer'] & {}
  const [bankTransferEnabled, setBankTransferEnabled] = useState(bt?.enabled ?? false)
  const [clabe, setClabe]               = useState(bt?.clabe ?? '')
  const [bankName, setBankName]         = useState(bt?.bank_name ?? '')
  const [accountHolder, setAccountHolder] = useState(bt?.account_holder ?? '')
  const [bankIsOther, setBankIsOther]   = useState(!!bt?.bank_name && !MX_BANKS.includes(bt.bank_name))
  // DiMo (transfer by phone number) + efectivo al recoger
  const dimoCfg = (s.checkout as any)?.dimo ?? {}
  const [dimoEnabled, setDimoEnabled]   = useState<boolean>(dimoCfg.enabled ?? false)
  const [dimoPhone, setDimoPhone]       = useState<string>(dimoCfg.phone ?? '')
  const cashCfg = (s.checkout as any)?.cash_pickup ?? {}
  const [cashPickupEnabled, setCashPickupEnabled] = useState<boolean>(cashCfg.enabled ?? true)
  const [cashPickupNote, setCashPickupNote]       = useState<string>(cashCfg.note ?? '')

  // Offers / trust gate
  type OffersSettings = NonNullable<NonNullable<NonNullable<ShopSettingsData['metadata']>['settings']>['offers']>
  type NegotiationSettings = NonNullable<OffersSettings['negotiation']>
  const offersSettings = (s.offers ?? {}) as OffersSettings
  const neg = (offersSettings.negotiation ?? {}) as NegotiationSettings
  const [minBuyerTrust, setMinBuyerTrust] = useState<'unverified'|'basic'|'trusted'|'verified'|'elite'>(
    offersSettings.min_buyer_trust_level ?? 'unverified'
  )
  const [negoEnabled, setNegoEnabled] = useState(neg.enabled ?? false)
  const [acceptPct, setAcceptPct]     = useState(neg.auto_accept_pct ?? 90)
  const [declinePct, setDeclinePct]   = useState(neg.auto_decline_pct ?? 50)
  const [counterPct, setCounterPct]   = useState(neg.auto_counter_pct ?? 75)

  // Bundle discount
  type BundleTier = { min_items: number; percent_off: number }
  const bundleConfig = (s.bundles ?? {}) as { enabled?: boolean; tiers?: BundleTier[] }
  const [bundlesEnabled, setBundlesEnabled] = useState(bundleConfig.enabled ?? false)
  const [bundleTiers, setBundleTiers]       = useState<BundleTier[]>(
    bundleConfig.tiers?.length ? bundleConfig.tiers : [{ min_items: 2, percent_off: 5 }]
  )

  // Own channel — custom domain
  // Source of truth: domainDnsOk = our own DNS lookup confirmed live (CNAME for a
  // subdomain, or the Vercel A record for an apex). Vercel's `verified` flag only
  // means "registered on project + SSL issued" — surfaced separately as domainSslReady.
  const [shopSlug, setShopSlug]                     = useState(initial.slug ?? '')
  // Slug editor (US-3) + free-URL display (US-5)
  const [slugEditing, setSlugEditing]               = useState(false)
  const [slugInput, setSlugInput]                   = useState(initial.slug ?? '')
  const [slugStatus, setSlugStatus]                 = useState<SlugStatus>('idle')
  const [slugSaving, setSlugSaving]                 = useState(false)
  const [slugError, setSlugError]                   = useState<string | null>(null)
  const [slugCopied, setSlugCopied]                 = useState(false)
  const [domainInput, setDomainInput]               = useState(initial.custom_domain ?? '')
  const [savedDomain, setSavedDomain]               = useState(initial.custom_domain ?? '')
  const [domainDnsOk, setDomainDnsOk]               = useState(initial.custom_domain_verified ?? false)
  // Optimistic: a domain we've already confirmed live has long since had its SSL
  // issued. A fresh status fetch on mount (below) corrects this if it's not true.
  const [domainSslReady, setDomainSslReady]         = useState(initial.custom_domain_verified ?? false)
  const [domainCnameCurrent, setDomainCnameCurrent] = useState<string | null>(null)
  const [domainSaving, setDomainSaving]             = useState(false)
  const [domainChecking, setDomainChecking]         = useState(false)
  const [domainRemoving, setDomainRemoving]         = useState(false)
  const [domainEditing, setDomainEditing]           = useState(false)
  const [domainError, setDomainError]               = useState<string | null>(null)
  const [domainRemovedNote, setDomainRemovedNote]   = useState<string | null>(null)
  const [domainCopied, setDomainCopied]             = useState(false)
  const [domainLastChecked, setDomainLastChecked]   = useState<Date | null>(null)
  const [detectedRegistrar, setDetectedRegistrar]   = useState<string | null>(null)
  const [cfTokenInput, setCfTokenInput]             = useState('')
  const [cfSaving, setCfSaving]                     = useState(false)
  const [cfError, setCfError]                       = useState<string | null>(null)
  const [cfSuccess, setCfSuccess]                   = useState(false)
  const [showCfPanel, setShowCfPanel]               = useState(false)
  const domainPollRef                               = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-poll DNS every 8s after domain is saved, until live or 5 min elapsed
  function startDomainPolling() {
    stopDomainPolling()
    const deadline = Date.now() + 5 * 60 * 1000
    domainPollRef.current = setInterval(async () => {
      if (Date.now() > deadline) { stopDomainPolling(); return }
      const ok = await checkDomainDns()
      if (ok) stopDomainPolling()
    }, 8000)
  }
  function stopDomainPolling() {
    if (domainPollRef.current) { clearInterval(domainPollRef.current); domainPollRef.current = null }
  }
  useEffect(() => () => stopDomainPolling(), []) // cleanup on unmount

  // Refresh real DNS + SSL status once on load when a domain is already saved,
  // so a returning seller sees the current state (not just the persisted flag).
  useEffect(() => {
    if (savedDomain) checkDomainDns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Core DNS check — returns true when the domain resolves to us (CNAME or apex A).
  // Also captures Vercel's `verified` flag so we can surface SSL provisioning (US-2).
  async function checkDomainDns(): Promise<boolean> {
    setDomainChecking(true)
    try {
      const res = await fetch('/api/sell/shop/domain')
      if (!res.ok) return false
      const data = await res.json() as { dns_ok?: boolean; cname_current?: string | null; verified?: boolean }
      const ok = data.dns_ok ?? false
      setDomainDnsOk(ok)
      setDomainSslReady(!!data.verified)
      setDomainCnameCurrent(data.cname_current ?? null)
      setDomainLastChecked(new Date())
      // Keep polling until DNS *and* the SSL cert are both ready.
      return ok && !!data.verified
    } catch { return false }
    finally { setDomainChecking(false) }
  }

  async function handleDomainSave() {
    const domainRaw = domainInput.trim()
    // Replace flow: submitting the same domain just exits edit mode (no-op POST).
    if (domainEditing && domainRaw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') === savedDomain) {
      setDomainEditing(false); return
    }
    setDomainSaving(true); setDomainError(null); setDomainRemovedNote(null)
    try {
      const res = await fetch('/api/sell/shop/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainRaw }),
      })
      const data = await res.json() as { domain?: string; error?: string }
      if (!res.ok) { setDomainError(data.error ?? 'Error al guardar.'); return }
      const domain = data.domain ?? domainRaw
      setSavedDomain(domain)
      setDomainEditing(false)
      setDomainDnsOk(false)   // never trust Vercel's `verified` — always confirm via DNS
      setDomainSslReady(false)
      setDomainCnameCurrent(null)
      setDomainLastChecked(null)
      setDetectedRegistrar(null)
      setCfSuccess(false)
      startDomainPolling()    // start auto-checking in background

      // Detect registrar in background (non-blocking)
      fetch(`/api/sell/shop/domain/detect?domain=${encodeURIComponent(domain)}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { registrar?: string } | null) => {
          if (d?.registrar) {
            setDetectedRegistrar(d.registrar)
            // Auto-expand CF panel when Cloudflare is detected
            if (d.registrar === 'cloudflare') setShowCfPanel(true)
          }
        })
        .catch(() => { /* non-fatal */ })
    } catch { setDomainError('Sin conexión. Verifica tu internet.') }
    finally { setDomainSaving(false) }
  }

  async function handleDomainVerifyManual() {
    setDomainError(null)
    await checkDomainDns()
  }

  // US-3 — open the edit/replace box pre-filled (non-destructive: the current
  // domain stays live until a new one is saved; the server releases the old one).
  function startDomainEdit() {
    setDomainInput(savedDomain)
    setDomainEditing(true)
    setDomainError(null)
  }
  function cancelDomainEdit() {
    setDomainEditing(false)
    setDomainInput(savedDomain)
    setDomainError(null)
  }

  async function handleDomainRemove() {
    if (!confirm(`¿Eliminar el dominio ${savedDomain}? Tu tienda solo estará disponible en miyagisanchez.com.`)) return
    const removed = savedDomain
    setDomainRemoving(true); setDomainError(null)
    stopDomainPolling()
    try {
      const res = await fetch('/api/sell/shop/domain', { method: 'DELETE' })
      if (!res.ok) { const d = await res.json() as { error?: string }; setDomainError(d.error ?? 'Error.'); return }
      setSavedDomain(''); setDomainInput(''); setDomainDnsOk(false); setDomainSslReady(false)
      setDomainEditing(false)
      setDomainCnameCurrent(null); setDomainLastChecked(null)
      setDomainRemovedNote(removed)
    } catch { setDomainError('Sin conexión. Verifica tu internet.') }
    finally { setDomainRemoving(false) }
  }

  async function handleCfAutoConfig() {
    setCfSaving(true); setCfError(null); setCfSuccess(false)
    try {
      const res = await fetch('/api/sell/shop/domain/cloudflare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cf_token: cfTokenInput.trim() }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setCfError(data.error ?? 'Error al configurar.'); return }
      setCfSuccess(true); setCfTokenInput('')
      startDomainPolling() // restart polling now that DNS should be set
    } catch { setCfError('Sin conexión.') }
    finally { setCfSaving(false) }
  }

  // ── Slug editor (US-3) ──────────────────────────────────────────────────
  const shopUrl = `miyagisanchez.com/s/${shopSlug}`
  function startSlugEdit() { setSlugInput(shopSlug); setSlugStatus('idle'); setSlugError(null); setSlugEditing(true) }
  function cancelSlugEdit() { setSlugInput(shopSlug); setSlugEditing(false); setSlugError(null) }
  function copyShopUrl() {
    navigator.clipboard.writeText(`https://${shopUrl}`)
    setSlugCopied(true); setTimeout(() => setSlugCopied(false), 2000)
  }
  async function handleSlugSave() {
    const next = slugInput.trim().toLowerCase()
    if (next === shopSlug) { setSlugEditing(false); return }
    setSlugSaving(true); setSlugError(null)
    try {
      const res = await fetch('/api/sell/shop/slug', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: next }),
      })
      const data = await res.json() as { slug?: string; error?: string }
      if (!res.ok || !data.slug) { setSlugError(data.error ?? 'No se pudo cambiar.'); return }
      setShopSlug(data.slug)
      setSlugEditing(false)
    } catch { setSlugError('Sin conexión. Intenta de nuevo.') }
    finally { setSlugSaving(false) }
  }
  const slugSaveBlocked = slugSaving || slugStatus === 'taken' || slugStatus === 'invalid' || slugStatus === 'checking'

  // The exact DNS record this domain needs (A at @ for apex, CNAME on the
  // sub-label for a subdomain). Drives the record card + all the guides (US-5).
  const dnsRecord = savedDomain ? dnsRecordFor(savedDomain) : null

  // Derive one explicit status from what we know, instead of a lone boolean (US-1/US-2).
  //   active      — DNS live AND SSL cert issued → fully online
  //   provisioning — DNS live, Vercel still issuing the SSL certificate
  //   error       — a record exists but points elsewhere, or a save error
  //   unverified  — we've checked at least once and found nothing pointing to us
  //   pending_dns — saved, not yet confirmed (freshly added / propagating)
  type DomainStatus = 'active' | 'provisioning' | 'error' | 'unverified' | 'pending_dns' | 'none'
  const domainStatus: DomainStatus = (() => {
    if (!savedDomain) return 'none'
    if (domainError) return 'error'
    if (domainDnsOk) return domainSslReady ? 'active' : 'provisioning'
    if (domainCnameCurrent && domainCnameCurrent !== 'cname.vercel-dns.com') return 'error'
    if (domainLastChecked) return 'unverified'
    return 'pending_dns'
  })()

  // UCP Webhook
  const [webhookUrl, setWebhookUrl]         = useState(initial.ucp_webhook_url ?? '')
  const [webhookSecret, setWebhookSecret]   = useState(initial.ucp_webhook_secret ?? '')
  const [showWebhookSecret, setShowWebhookSecret] = useState(false)
  const [webhookAdvanced, setWebhookAdvanced]     = useState(false)
  const [showPayloadPreview, setShowPayloadPreview] = useState(false)
  const [webhookCopied, setWebhookCopied]   = useState(false)
  const [webhookUrlError, setWebhookUrlError] = useState('')

  // MCP agent token (Sprint 4) — inbound credential a seller's agent uses to
  // read/patch this shop's config. We only ever see the plaintext at creation.
  const [agentTokenSet, setAgentTokenSet]   = useState(initial.agent_token_set ?? false)
  const [agentToken, setAgentToken]         = useState<string | null>(null) // plaintext, shown once
  const [agentTokenBusy, setAgentTokenBusy] = useState(false)
  const [agentTokenCopied, setAgentTokenCopied] = useState(false)
  const [mcpConfigCopied, setMcpConfigCopied] = useState(false)

  async function handleGenerateAgentToken() {
    setAgentTokenBusy(true)
    try {
      const res = await fetch('/api/sell/agent-token', { method: 'POST' })
      const data = await res.json() as { token?: string; error?: string }
      if (!res.ok || !data.token) { showToast(data.error ?? 'No se pudo generar el token.', 'error'); return }
      setAgentToken(data.token)
      setAgentTokenSet(true)
      showToast('Token de agente generado. Cópialo ahora — no se vuelve a mostrar.', 'success')
    } catch { showToast('Error de red al generar el token.', 'error') }
    finally { setAgentTokenBusy(false) }
  }

  async function handleRevokeAgentToken() {
    setAgentTokenBusy(true)
    try {
      const res = await fetch('/api/sell/agent-token', { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})) as { error?: string }; showToast(d.error ?? 'No se pudo revocar.', 'error'); return }
      setAgentToken(null)
      setAgentTokenSet(false)
      showToast('Token de agente revocado.', 'success')
    } catch { showToast('Error de red al revocar.', 'error') }
    finally { setAgentTokenBusy(false) }
  }

  // Payment providers
  const [mpEnabled, setMpEnabled]           = useState(initial.mp_enabled ?? true)
  const [stripeEnabled, setStripeEnabled]   = useState(initial.stripe?.enabled !== false)

  // Cal.com scheduling
  const [calcomConnected, setCalcomConnected]       = useState(initial.calcom_connected ?? false)
  const [calcomUsername, setCalcomUsername]         = useState(initial.calcom_username ?? '')
  const [calcomEventTitle, setCalcomEventTitle]     = useState(initial.calcom_event_type_title ?? '')
  const [calcomBookingUrl, setCalcomBookingUrl]     = useState(initial.calcom_booking_url ?? '')
  const [calcomApiKey, setCalcomApiKey]             = useState('')
  const [calcomConnecting, setCalcomConnecting]     = useState(false)
  const [calcomEventTypes, setCalcomEventTypes]     = useState<Array<{ id: number; slug: string; title: string }>>([])
  const [calcomPickEventTypeId, setCalcomPickEventTypeId] = useState<number | null>(null)
  const [calcomPickStep, setCalcomPickStep]         = useState(false)
  const [showApiKeyForm, setShowApiKeyForm]         = useState(false)

  // Booking links
  type SchedulingLink = { label: string; url: string }
  const schedulingMeta = ((s.scheduling as Record<string, unknown> | undefined)?.links ?? []) as SchedulingLink[]
  const [schedulingLinks, setSchedulingLinks] = useState<SchedulingLink[]>(schedulingMeta)
  const [newLinkUrl, setNewLinkUrl]           = useState('')
  const [newLinkLabel, setNewLinkLabel]       = useState('')

  // Order management
  type OrdersSettings = NonNullable<NonNullable<ShopSettingsData['metadata']>['settings']>['orders']
  const ordersSettings = (s.orders ?? {}) as NonNullable<OrdersSettings>
  const [processingTime, setProcessingTime]           = useState(ordersSettings.processing_time ?? '1-3d')
  const [autoAccept, setAutoAccept]                   = useState(ordersSettings.auto_accept ?? true)
  const [dispatchWindowDays, setDispatchWindowDays]   = useState(ordersSettings.dispatch_window_days ?? 3)
  const [autoConfirmDays, setAutoConfirmDays]         = useState(ordersSettings.auto_confirm_days ?? 7)

  // Returns policy
  type ReturnsPolicySettings = NonNullable<NonNullable<ShopSettingsData['metadata']>['settings']>['returns_policy']
  const returnsPolicySettings = (s.returns_policy ?? {}) as NonNullable<ReturnsPolicySettings>
  // '' = not yet configured by seller (no pill on PDP); 'none' = explicitly "no returns"
  const [returnsWindow, setReturnsWindow]             = useState(returnsPolicySettings.window ?? '')
  const [returnsConditions, setReturnsConditions]     = useState(returnsPolicySettings.conditions ?? 'original')
  const [returnsShippingBy, setReturnsShippingBy]     = useState<'buyer' | 'seller'>(returnsPolicySettings.shipping_paid_by ?? 'buyer')
  const [returnsNote, setReturnsNote]                 = useState(returnsPolicySettings.custom_note ?? '')

  // UI
  const [saving, setSaving]           = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [toast, setToast]             = useState<ToastState | null>(null)
  const [activeSection, setActiveSection] = useState('perfil')
  const [showEscrowExplainer, setShowEscrowExplainer] = useState(false)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

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
        // Prefer alcaldia (region_2) — for CDMX gives the specific alcaldía
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

  // Scroll-based active section tracking
  useEffect(() => {
    const allItems = NAV_GROUPS.flatMap(g => g.items)
    function handleScroll() {
      const scrollY = window.scrollY + 100
      let current = allItems[0]?.id ?? 'perfil'
      for (const { id } of allItems) {
        const el = document.getElementById(id)
        if (el && el.offsetTop <= scrollY) current = id
      }
      setActiveSection(current)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  function scrollToSection(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    const y = el.getBoundingClientRect().top + window.scrollY - 72
    window.scrollTo({ top: y, behavior: 'smooth' })
    setActiveSection(id)
  }

  async function uploadImage(file: File, onDone: (url: string) => void, setUploading: (v: boolean) => void) {
    if (file.size > 8 * 1024 * 1024) { showToast('La imagen es demasiado grande (máx. 8 MB).', 'error'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/sell/upload', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) { showToast(data.error ?? 'Error al subir imagen.', 'error'); return }
      onDone(data.url)
      mark()
    } catch {
      showToast('Sin conexión al subir imagen.', 'error')
    } finally {
      setUploading(false)
    }
  }

  function applyPreset(key: string) {
    const p = PRESETS.find(x => x.key === key)
    if (!p) return
    setPreset(key)
    const c  = p.settings.checkout ?? {}
    const sh = p.settings.shipping ?? {}
    if (c.escrow_mode)              setEscrowMode(c.escrow_mode)
    if (c.show_phone !== undefined) setShowPhone(c.show_phone)
    if (c.whatsapp_cta !== undefined) setWhatsappCta(c.whatsapp_cta)
    if (sh.local_pickup  !== undefined) setLocalPickup(sh.local_pickup)
    mark()
  }

  function addSchedulingLink() {
    const url = newLinkUrl.trim()
    if (!url) return
    if (!url.startsWith('http')) { showToast('URL inválida — debe comenzar con https://', 'error'); return }
    const label = newLinkLabel.trim() || detectSchedulingService(url)
    setSchedulingLinks(prev => [...prev, { label, url }])
    setNewLinkUrl('')
    setNewLinkLabel('')
    mark()
  }

  async function handleCalcomConnect(eventTypeId?: number) {
    if (!calcomApiKey.trim() && !eventTypeId) { showToast('Pega tu API key de Cal.com primero.', 'error'); return }
    setCalcomConnecting(true)
    try {
      const body: Record<string, unknown> = {}
      if (calcomApiKey.trim()) body.api_key = calcomApiKey.trim()
      if (eventTypeId) body.event_type_id = eventTypeId
      const res  = await fetch('/api/sell/shop/calcom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as {
        step?: string
        user?: { username: string }
        eventTypes?: Array<{ id: number; slug: string; title: string }>
        username?: string
        eventType?: { id: number; title: string }
        bookingUrl?: string
        error?: string
      }
      if (!res.ok) { showToast(data.error ?? 'Error al conectar.', 'error'); return }

      if (data.step === 'pick_event_type' && data.eventTypes) {
        setCalcomEventTypes(data.eventTypes)
        setCalcomPickEventTypeId(data.eventTypes[0]?.id ?? null)
        setCalcomPickStep(true)
        return
      }
      if (data.step === 'connected') {
        setCalcomConnected(true)
        setCalcomUsername(data.username ?? '')
        setCalcomEventTitle(data.eventType?.title ?? '')
        setCalcomBookingUrl(data.bookingUrl ?? '')
        setCalcomApiKey('')
        setCalcomPickStep(false)
        showToast('Cal.com conectado correctamente.', 'success')
      }
    } catch { showToast('Error de red al conectar Cal.com.', 'error') }
    finally { setCalcomConnecting(false) }
  }

  async function handleCalcomDisconnect() {
    try {
      await fetch('/api/sell/shop/calcom', { method: 'DELETE' })
      setCalcomConnected(false)
      setCalcomUsername('')
      setCalcomEventTitle('')
      setCalcomBookingUrl('')
      setCalcomApiKey('')
      setCalcomPickStep(false)
      showToast('Cal.com desconectado.', 'success')
    } catch { showToast('Error al desconectar.', 'error') }
  }

  async function handleSave() {
    const errors: Record<string, string> = {}
    if (name.trim().length < 2)     errors.name = 'El nombre debe tener al menos 2 caracteres.'
    if (description.length > 500)   errors.description = 'Máximo 500 caracteres.'
    if (webhookUrl.trim() && !webhookUrl.trim().startsWith('https://')) {
      errors.webhook = 'La URL del webhook debe usar HTTPS.'
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      if (errors.webhook) scrollToSection('webhook')
      return
    }
    setFieldErrors({})

    let secretToSave = webhookSecret.trim()
    if (webhookUrl.trim() && !secretToSave) {
      secretToSave = generateHex32()
      setWebhookSecret(secretToSave)
    }

    setSaving(true)
    try {
      const res = await fetch('/api/sell/shop', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:              name.trim(),
          description:       description.trim(),
          state:             state.trim(),
          city:              city.trim(),
          logo_url:          logoUrl,
          mp_enabled:        mpEnabled,
          stripe_enabled:    stripeEnabled,
          ucp_webhook_url:   webhookUrl.trim() || null,
          ucp_webhook_secret: secretToSave || null,
          settings: {
            preset,
            checkout: {
              escrow_mode:    escrowMode,
              show_phone:     showPhone,
              phone:          phoneNumber.trim().replace(/\D/g, '') || null,
              whatsapp_cta:   whatsappCta,
              show_email:     showEmail,
              bank_transfer: {
                enabled:        bankTransferEnabled,
                clabe:          clabe.trim() || null,
                bank_name:      bankName.trim() || null,
                account_holder: accountHolder.trim() || null,
              },
              dimo: {
                enabled: dimoEnabled,
                phone:   dimoPhone.trim().replace(/\D/g, '') || null,
              },
              cash_pickup: {
                enabled: cashPickupEnabled,
                note:    cashPickupNote.trim() || null,
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
            notifications:  { email_new_view: emailView, email_new_message: emailMessage },
            offers: {
              min_buyer_trust_level: minBuyerTrust,
              negotiation: {
                enabled:          negoEnabled,
                auto_accept_pct:  acceptPct,
                auto_decline_pct: declinePct,
                auto_counter_pct: counterPct,
              },
            },
            bundles: {
              enabled: bundlesEnabled,
              tiers:   bundleTiers.filter(t => t.min_items >= 2 && t.percent_off > 0).sort((a, b) => a.min_items - b.min_items),
            },
            scheduling:   { links: schedulingLinks },
            orders: {
              processing_time:     processingTime,
              auto_accept:         autoAccept,
              dispatch_window_days: dispatchWindowDays,
              auto_confirm_days:   autoConfirmDays,
            },
            returns_policy: returnsWindow ? {
              window:           returnsWindow,
              conditions:       returnsConditions,
              shipping_paid_by: returnsShippingBy,
              custom_note:      returnsNote.trim() || null,
            } : null,
            theme: {
              banner_url:   bannerUrl,
              accent_color: accentColor,
              tagline:      tagline.trim() || null,
              social: {
                instagram: instagram.trim().replace(/^@/, '') || null,
                facebook:  facebook.trim() || null,
                whatsapp:  whatsappHandle.trim().replace(/\D/g, '') || null,
                tiktok:    tiktok.trim().replace(/^@/, '') || null,
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
        setIsDirty(false)
      }
    } catch {
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Active preset summary ─────────────────────────────────────────────────

  const activePreset = PRESETS.find(p => p.key === preset)

  const ESCROW_LABEL = { off: 'Desactivada', optional: 'Opcional', required: 'Obligatoria' }
  const originAddressReady = Boolean(
    originStreet.trim() &&
    originCity.trim() &&
    (originStateCode.trim() || originState.trim()) &&
    originPostalCode.trim().length === 5
  )

  // ── When rendered from a section page, auto-scroll to first visible section ──
  const focusSectionIds = focusSection ? (SLUG_TO_SECTION_IDS[focusSection] ?? [focusSection]) : []

  useEffect(() => {
    if (focusSectionIds.length > 0) {
      const el = document.getElementById(focusSectionIds[0])
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSection])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={focusSectionIds.length > 0 ? '' : 'px-4 py-8'}>

      {/* When a specific section is focused, hide everything else via CSS */}
      {focusSectionIds.length > 0 && (
        <style dangerouslySetInnerHTML={{ __html:
          `#shop-settings-sections section${focusSectionIds.map(id => `:not(#${id})`).join('')} { display: none !important; }`
        }} />
      )}

      {/* ── Mobile top nav — hidden in focus mode ───────────────────────────── */}
      <div className={`lg:hidden sticky top-0 z-40 bg-[var(--color-background)] border-b border-[var(--color-border)] -mx-4 px-4 py-2 mb-6${focusSectionIds.length > 0 ? ' hidden' : ''}`}>
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {NAV_GROUPS.flatMap(g => g.items).map(item => (
            item.href ? (
              <Link
                key={item.id}
                href={item.href}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--color-surface-alt)] text-[var(--color-muted)] hover:bg-gray-200 transition-colors no-underline"
              >
                {item.label} →
              </Link>
            ) : (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeSection === item.id
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface-alt)] text-[var(--color-muted)] hover:bg-gray-200'
                } ${item.soon ? 'opacity-50' : ''}`}
              >
                {item.label}
              </button>
            )
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto flex gap-8">

        {/* ── Desktop sidebar — hidden in focus mode ────────────────────────── */}
        <aside className={`w-52 flex-shrink-0 hidden${focusSectionIds.length > 0 ? '' : ' lg:block'}`}>
          <div className="sticky top-6">
            <nav className="space-y-4">
              {NAV_GROUPS.map(group => (
                <div key={group.label}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)] px-2 mb-1">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map(item => (
                      <li key={item.id}>
                        {item.href ? (
                          <Link
                            href={item.href}
                            className={`flex items-center w-full text-sm px-2 py-1.5 rounded-md transition-colors no-underline text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-gray-100`}
                          >
                            {item.label}
                            <span className="ml-auto text-xs opacity-40">→</span>
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => scrollToSection(item.id)}
                            className={`w-full text-left text-sm px-2 py-1.5 rounded-md transition-colors ${
                              activeSection === item.id
                                ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,white)] text-[var(--color-accent)] font-semibold'
                                : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-gray-100'
                            } ${item.soon ? 'opacity-50' : ''}`}
                          >
                            {item.label}
                            {item.soon && (
                              <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-600 px-1 py-0.5 rounded">
                                pronto
                              </span>
                            )}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        {/* ── Main content ──────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0" id="shop-settings-sections">

          {/* Breadcrumb */}
          <nav className="text-xs text-[var(--color-muted)] mb-6 flex items-center gap-1.5">
            <Link href="/shop/manage" className="hover:text-[var(--color-foreground)] no-underline">Mi tienda</Link>
            <span>›</span>
            <span>Configuración</span>
          </nav>
          <h1 className="text-2xl font-bold mb-8">Configuración de tienda</h1>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 1: Perfil de tienda
          ════════════════════════════════════════════════════════════════════ */}
          <section id="perfil" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <SectionTitle>Perfil de tienda</SectionTitle>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Nombre de tienda <span className="text-red-500">*</span>
                </label>
                <input
                  value={name}
                  onChange={e => { setName(e.target.value); mark(); setFieldErrors(p => ({ ...p, name: '' })) }}
                  maxLength={80}
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="Mi tienda"
                />
                {fieldErrors.name && <p className="text-red-600 text-xs mt-1">⚠ {fieldErrors.name}</p>}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">
                    Descripción
                    <span className={`ml-2 text-xs font-normal ${description.length > 450 ? 'text-amber-600' : 'text-[var(--color-muted)]'}`}>
                      {description.length}/500
                    </span>
                  </label>
                  <CopyPromptButton prompt={`Ayúdame a escribir una descripción de 2-3 oraciones para mi tienda en línea en México llamada "${name || 'mi tienda'}". La descripción debe aparecer en mi página pública y transmitir confianza a compradores mexicanos. Máximo 500 caracteres, en español. ${description ? `Mejora esta versión: "${description}"` : 'Mi tienda vende:'}`} />
                </div>
                <textarea
                  value={description}
                  onChange={e => { setDescription(e.target.value); mark(); setFieldErrors(p => ({ ...p, description: '' })) }}
                  maxLength={500}
                  rows={3}
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] resize-none"
                  placeholder="Cuéntanos sobre tu tienda…"
                />
                {fieldErrors.description && <p className="text-red-600 text-xs mt-1">⚠ {fieldErrors.description}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Estado / State</label>
                  <select
                    value={state}
                    onChange={e => {
                      const newState = e.target.value
                      setState(newState)
                      setCity('')
                      setIsCityOther(false)
                      mark()
                    }}
                    className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] bg-white"
                  >
                    <option value="">Selecciona estado</option>
                    {ESTADOS.map(e => <option key={e.inegi_code} value={e.name}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Ciudad / Municipio</label>
                  {isCityOther ? (
                    <div className="space-y-1.5">
                      <input
                        value={city}
                        onChange={e => { setCity(e.target.value); mark() }}
                        placeholder="Escribe tu ciudad"
                        className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => { setCity(''); setIsCityOther(false); mark() }}
                        className="text-xs text-[var(--color-accent)] hover:underline"
                      >
                        ← Seleccionar de la lista
                      </button>
                    </div>
                  ) : (
                    <select
                      value={city}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '__other__') {
                          setCity('')
                          setIsCityOther(true)
                        } else {
                          setCity(v)
                        }
                        mark()
                      }}
                      className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] bg-white"
                    >
                      <option value="">{state ? 'Selecciona ciudad' : 'Primero elige estado'}</option>
                      {(state ? CITIES_BY_STATE[state] ?? [] : MAJOR_MEXICAN_CITIES).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                      <option value="__other__">Mi ciudad no aparece en la lista…</option>
                    </select>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 2: Apariencia
          ════════════════════════════════════════════════════════════════════ */}
          <section id="apariencia" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
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
                <button type="button" onClick={() => { setBannerUrl(null); mark() }} className="text-xs text-red-600 hover:underline mt-1">
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
                    <button type="button" onClick={() => { setLogoUrl(null); mark() }} className="text-xs text-red-600 hover:underline mt-1 block">
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
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">
                  Slogan
                  <span className={`ml-2 text-xs font-normal ${tagline.length > 85 ? 'text-amber-600' : 'text-[var(--color-muted)]'}`}>
                    {tagline.length}/100
                  </span>
                </label>
                <CopyPromptButton prompt={`Dame 5 opciones de slogan corto (máx. 100 caracteres cada uno) para mi tienda "${name || 'mi tienda'}" en México. El slogan debe ser en español, memorable y reflejar lo que vendo. ${tagline ? `El slogan actual es: "${tagline}"` : ''}`} />
              </div>
              <input
                value={tagline}
                onChange={e => { setTagline(e.target.value); mark() }}
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
                  onChange={e => { setAccentColor(e.target.value); mark() }}
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
                  { icon: '📸', label: 'Instagram', value: instagram,      set: setInstagram,      placeholder: '@tutienda' },
                  { icon: '👥', label: 'Facebook',  value: facebook,       set: setFacebook,       placeholder: 'https://facebook.com/tutienda' },
                  { icon: '💬', label: 'WhatsApp',  value: whatsappHandle, set: setWhatsappHandle, placeholder: '52 55 1234 5678' },
                  { icon: '🎵', label: 'TikTok',    value: tiktok,         set: setTiktok,         placeholder: '@tutienda' },
                ].map(net => (
                  <div key={net.label} className="flex items-center gap-2">
                    <span className="text-lg w-7 flex-shrink-0 text-center">{net.icon}</span>
                    <span className="text-xs text-[var(--color-muted)] w-20 flex-shrink-0">{net.label}</span>
                    <input
                      value={net.value}
                      onChange={e => { net.set(e.target.value); mark() }}
                      placeholder={net.placeholder}
                      className="flex-1 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 3: Tipo de tienda
          ════════════════════════════════════════════════════════════════════ */}
          <section id="tipo" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <SectionTitle>Tipo de tienda</SectionTitle>
            <p className="text-xs text-[var(--color-muted)] mb-4">
              Pre-configura el comportamiento de checkout y envíos según lo que vendes. Puedes ajustar cada opción individualmente más adelante.
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

            {/* Active preset summary */}
            {activePreset && (
              <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-muted)] mb-2 font-medium">Configuración aplicada:</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    escrowMode === 'off' ? 'bg-gray-100 text-gray-600' :
                    escrowMode === 'optional' ? 'bg-amber-100 text-amber-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    Compra Protegida: {ESCROW_LABEL[escrowMode]}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${localPickup ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                    Entrega en mano: {localPickup ? 'Sí' : 'No'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${showPhone ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                    Teléfono visible: {showPhone ? 'Sí' : 'No'}
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 4: Compra Protegida
          ════════════════════════════════════════════════════════════════════ */}
          <section id="proteccion" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Compra Protegida</SectionTitle>
              <div className="flex items-center gap-2 -mt-3">
                <CopyPromptButton prompt="¿Cómo funciona realmente un sistema de pago en custodia (escrow) en un marketplace? Quiero validar si es confiable antes de activarlo en mi tienda. Busca información en la documentación oficial de Stripe Connect: https://stripe.com/docs/connect — ¿Tiene Stripe algún mecanismo de retención de fondos? ¿Qué pasa si el comprador no confirma la recepción en 3 días? ¿Qué riesgos existen para el vendedor?" />
                <button
                  type="button"
                  onClick={() => setShowEscrowExplainer(v => !v)}
                  className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0"
                >
                  {showEscrowExplainer ? 'Ocultar' : '¿Qué es? →'}
                </button>
              </div>
            </div>

            {showEscrowExplainer && (
              <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-blue-800 mb-3">¿Cómo funciona Compra Protegida?</p>
                <div className="flex items-start gap-1 flex-wrap sm:flex-nowrap">
                  {[
                    { icon: '💳', title: 'Comprador paga',    desc: 'El monto se cobra de forma segura' },
                    { icon: '🔒', title: 'Fondos retenidos',  desc: 'El dinero queda en custodia temporal' },
                    { icon: '📦', title: 'Recibes el pago',   desc: 'Entrega el producto al comprador' },
                    { icon: '✅', title: 'Confirma recepción', desc: 'Los fondos se liberan al vendedor' },
                  ].map((step, i, arr) => (
                    <div key={step.title} className="flex items-center gap-1">
                      <div className="text-center min-w-[72px]">
                        <div className="text-xl mb-1">{step.icon}</div>
                        <div className="text-[11px] font-semibold text-blue-800 leading-tight">{step.title}</div>
                        <div className="text-[10px] text-blue-600 leading-tight mt-0.5">{step.desc}</div>
                      </div>
                      {i < arr.length - 1 && <span className="text-blue-400 font-bold hidden sm:block mx-1">→</span>}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-blue-700 mt-3 pt-2 border-t border-blue-200">
                  💡 Si el comprador no confirma la recepción en <strong>3 días hábiles</strong>, los fondos se liberan automáticamente. Powered by Stripe.
                </p>
              </div>
            )}

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
                    onChange={() => { setEscrowMode(opt.key); mark() }}
                    className="accent-[var(--color-accent)]"
                  />
                  <div>
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-xs text-[var(--color-muted)]">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {escrowMode === 'required' && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
                <strong>Impacto para el comprador:</strong> El pago quedará retenido hasta que confirme haber recibido el producto. Algunos compradores pueden preferir tiendas sin esta restricción.
              </div>
            )}
            {escrowMode === 'off' && (
              <div className="mt-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 text-xs text-green-800">
                <strong>Impacto para el comprador:</strong> El pago va directo al vendedor al momento de pagar. El proceso es más rápido para el comprador.
              </div>
            )}
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 5: Comunicación
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
              SECTION 6: Envíos y Entregas
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
                <ToggleSwitch
                  checked={enviaShippingEnabled}
                  onChange={v => { setEnviaShippingEnabled(v); mark() }}
                  disabled={!originAddressReady}
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

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 7: Citas y Reservas
          ════════════════════════════════════════════════════════════════════ */}
          <section id="citas" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">📅</span>
              <h2 className="font-semibold text-sm">Citas y Reservas</h2>
            </div>
            <p className="text-xs text-[var(--color-muted)] mb-2">
              Para servicios, rentas, creadores y cualquier negocio que trabaje por cita.
            </p>
            <div className="flex flex-wrap gap-1.5 mb-5">
              {['Consultas', 'Pruebas de manejo', 'Visitas a propiedades', 'Sesiones de fotos', 'Encuentros con fans', 'Clases', 'Rentas por hora'].map(tag => (
                <span key={tag} className="text-[11px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-muted)] px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>

            {/* Tier 1: booking links */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  🔗 Mis enlaces de reservas
                </p>
                {schedulingLinks.length > 0 && (
                  <span className="text-xs text-green-700 font-medium bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    {schedulingLinks.length} enlace{schedulingLinks.length > 1 ? 's' : ''} guardado{schedulingLinks.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {schedulingLinks.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {schedulingLinks.map((link, i) => (
                    <div key={i} className="flex items-center gap-2 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
                      <span className="text-base">
                        {link.url.includes('cal.com') ? '📅' : link.url.includes('calendly.com') ? '📆' : '🔗'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{link.label}</p>
                        <p className="text-xs text-[var(--color-muted)] truncate">{link.url}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSchedulingLinks(prev => prev.filter((_, j) => j !== i)); mark() }}
                        className="text-xs text-red-500 hover:text-red-700 flex-shrink-0 px-1"
                        aria-label="Eliminar enlace"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <input
                  type="url"
                  value={newLinkUrl}
                  onChange={e => setNewLinkUrl(e.target.value)}
                  placeholder="https://cal.com/tu-usuario/consulta  ó  https://calendly.com/tu-usuario"
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSchedulingLink() } }}
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newLinkLabel}
                    onChange={e => setNewLinkLabel(e.target.value)}
                    placeholder="Etiqueta (opcional) — se detecta automáticamente"
                    className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  />
                  <button
                    type="button"
                    onClick={addSchedulingLink}
                    disabled={!newLinkUrl.trim()}
                    className="bg-[var(--color-accent)] text-white px-4 py-2 rounded text-sm font-semibold disabled:opacity-40 hover:bg-[var(--color-accent-hover)] transition-colors whitespace-nowrap"
                  >
                    + Agregar
                  </button>
                </div>
              </div>

              <p className="text-xs text-[var(--color-muted)] mt-2">
                Funciona con Cal.com, Calendly, Acuity, TidyCal, Google Calendar y cualquier enlace de reservas.
              </p>

              {schedulingLinks.length === 0 && !calcomConnected && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-700 leading-relaxed">
                  <strong>¿No tienes cuenta de agendamiento?</strong> Cal.com es gratuito, tarda 3 minutos y te da una página profesional.{' '}
                  <a href="https://cal.com/signup" target="_blank" rel="noopener noreferrer" className="text-amber-800 underline hover:text-amber-900">
                    Crear cuenta gratis ↗
                  </a>
                </div>
              )}
            </div>

            {/* Tier 2: Cal.com API */}
            <div className="border-t border-[var(--color-border)] pt-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                      ✨ Cal.com — Agentes de IA
                    </p>
                    <CopyPromptButton prompt="¿Es seguro compartir mi API key de Cal.com con una plataforma de terceros? Verifica con la documentación oficial de Cal.com: https://cal.com/docs/enterprise-features/api/api-keys — ¿Qué acceso otorga una API key? ¿Puede la plataforma modificar mi calendario o crear citas sin mi permiso? ¿Cómo puedo revocar el acceso si es necesario?" />
                  </div>
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">
                    {calcomConnected
                      ? 'Los agentes de IA pueden verificar disponibilidad y agendar automáticamente.'
                      : 'Conecta tu API key para que agentes de IA agenden citas en tu nombre.'}
                  </p>
                </div>
                {!calcomConnected && !calcomPickStep && (
                  <button
                    type="button"
                    onClick={() => setShowApiKeyForm(v => !v)}
                    className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0 ml-3"
                  >
                    {showApiKeyForm ? 'Ocultar' : 'Conectar API →'}
                  </button>
                )}
              </div>

              {calcomConnected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <span className="text-lg">✓</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-green-800">Conectado como @{calcomUsername}</p>
                      <p className="text-xs text-green-600 mt-0.5 truncate">
                        Evento: {calcomEventTitle} ·{' '}
                        <a href={calcomBookingUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          Ver página ↗
                        </a>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCalcomDisconnect}
                      className="text-xs text-red-600 hover:text-red-700 border border-red-200 rounded px-2.5 py-1 hover:bg-red-50 transition-colors flex-shrink-0"
                    >
                      Desconectar
                    </button>
                  </div>
                </div>
              ) : calcomPickStep ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Selecciona qué tipo de evento usar:</p>
                  <div className="space-y-2">
                    {calcomEventTypes.map(et => (
                      <label key={et.id} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                        calcomPickEventTypeId === et.id ? 'border-[var(--color-accent)] bg-green-50' : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                      }`}>
                        <input
                          type="radio"
                          name="cal_event_type"
                          checked={calcomPickEventTypeId === et.id}
                          onChange={() => setCalcomPickEventTypeId(et.id)}
                          className="accent-[var(--color-accent)]"
                        />
                        <div>
                          <p className="text-sm font-medium">{et.title}</p>
                          <p className="text-xs text-[var(--color-muted)]">/{et.slug}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setCalcomPickStep(false); setCalcomEventTypes([]) }}
                      className="flex-1 border border-[var(--color-border)] rounded py-2 text-sm hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={!calcomPickEventTypeId || calcomConnecting}
                      onClick={() => calcomPickEventTypeId && handleCalcomConnect(calcomPickEventTypeId)}
                      className="flex-1 bg-[var(--color-accent)] text-white rounded py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {calcomConnecting ? 'Conectando…' : 'Usar este evento'}
                    </button>
                  </div>
                </div>
              ) : showApiKeyForm ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1.5">
                      API Key de Cal.com
                      <a
                        href="https://app.cal.com/settings/developer/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-[var(--color-accent)] font-normal no-underline hover:underline"
                      >
                        Obtener API key ↗
                      </a>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={calcomApiKey}
                        onChange={e => setCalcomApiKey(e.target.value)}
                        placeholder="cal_live_xxxxxxxxxxxxxxxxxxxx"
                        className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      />
                      <button
                        type="button"
                        disabled={!calcomApiKey.trim() || calcomConnecting}
                        onClick={() => handleCalcomConnect()}
                        className="bg-[var(--color-accent)] text-white px-4 py-2 rounded text-sm font-semibold disabled:opacity-40 hover:bg-[var(--color-accent-hover)] transition-colors whitespace-nowrap"
                      >
                        {calcomConnecting ? 'Verificando…' : 'Conectar'}
                      </button>
                    </div>
                  </div>
                  <div className="bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg p-3 text-xs text-[var(--color-muted)] space-y-1">
                    <p className="font-medium text-[var(--color-foreground)]">¿Cómo obtener tu API key?</p>
                    <ol className="list-decimal list-inside space-y-0.5 ml-1">
                      <li>Ve a <a href="https://app.cal.com/settings/developer/api-keys" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] hover:underline no-underline">cal.com/settings/developer/api-keys</a></li>
                      <li>Crea una nueva API key (nombre: &ldquo;Miyagi Sánchez&rdquo;)</li>
                      <li>Copia y pega la key aquí arriba</li>
                    </ol>
                  </div>
                </div>
              ) : (
                schedulingLinks.length > 0 && (
                  <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
                    💡 <strong>¿Quieres más poder?</strong> Conecta tu API key de Cal.com para que los agentes de IA verifiquen disponibilidad y agenden citas automáticamente.{' '}
                    <button type="button" onClick={() => setShowApiKeyForm(true)} className="text-[var(--color-accent)] hover:underline">
                      Conectar →
                    </button>
                  </p>
                )
              )}
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 8: Pagos en línea (Stripe Connect)
          ════════════════════════════════════════════════════════════════════ */}
          <section id="stripe" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-1">
              <SectionTitle>Pagos con tarjeta (Stripe)</SectionTitle>
              <div className="-mt-3">
                <CopyPromptButton prompt="¿Es seguro conectar mi cuenta bancaria a Stripe Express en un marketplace de terceros? Verifica revisando la documentación oficial de Stripe Connect: https://stripe.com/docs/connect/express-accounts — ¿Qué acceso le da al marketplace sobre mi cuenta? ¿Cómo funciona el modelo Express? ¿Puedo desconectarme en cualquier momento? ¿Stripe cobra comisiones adicionales?" />
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted)] mb-4">
              Acepta pagos con tarjeta directamente en tu tienda. Sin comisiones de plataforma — solo la tarifa estándar de Stripe.
            </p>

            {stripeError && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-800">
                <span className="font-semibold">Error al conectar Stripe:</span>{' '}{stripeError}
              </div>
            )}

            {initial.stripe?.charges_enabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-green-800">Cuenta Stripe conectada</div>
                    <div className="text-xs text-green-700 mt-0.5">Tu cuenta está activa y lista para recibir pagos con tarjeta.</div>
                  </div>
                  <a href="/api/stripe/connect/dashboard" className="text-xs text-green-700 underline hover:text-green-900 flex-shrink-0">
                    Gestionar →
                  </a>
                </div>
                <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
                  <ToggleSwitch
                    checked={stripeEnabled}
                    onChange={v => { setStripeEnabled(v); mark() }}
                    label="Aceptar pagos con tarjeta (Stripe)"
                    description="Muestra el botón de pago con tarjeta en tus anuncios."
                  />
                </div>
                {stripeEnabled ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 text-xs text-green-800 space-y-0.5">
                    <p className="font-semibold">Lo que verán los compradores:</p>
                    <p>✓ Botón &ldquo;Pagar con tarjeta&rdquo; visible en cada anuncio</p>
                    <p>✓ Checkout seguro de Stripe — Visa, Mastercard, AMEX</p>
                    <p>✓ El pago llega a tu cuenta Stripe directamente</p>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
                    El botón de pago con tarjeta estará <strong>oculto</strong> en tus anuncios mientras esté desactivado.
                  </div>
                )}
              </div>
            ) : initial.stripe?.account_id && !initial.stripe.onboarding_complete ? (
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
                <a href="/api/stripe/connect/refresh"
                  className="flex items-center justify-center gap-2 w-full bg-amber-600 text-white font-semibold py-2.5 rounded-lg text-sm no-underline hover:bg-amber-700 transition-colors">
                  Completar configuración →
                </a>
              </div>
            ) : (
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
                <a href="/api/stripe/connect"
                  className="flex items-center justify-center gap-2 w-full bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-lg text-sm no-underline hover:bg-[var(--color-accent-hover)] transition-colors">
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

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 9: MercadoPago
          ════════════════════════════════════════════════════════════════════ */}
          <section id="mercadopago" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-1">
              <SectionTitle>Mercado Pago</SectionTitle>
              <div className="-mt-3">
                <CopyPromptButton prompt="¿Cómo funciona Mercado Pago Checkout Pro para vendedores en México? Verifica con la documentación oficial: https://www.mercadopago.com.mx/developers/es/docs — ¿Qué métodos de pago incluye? ¿Hay comisiones para el vendedor? ¿Cuándo recibe el dinero el vendedor? ¿Es confiable para un marketplace?" />
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted)] mb-4">
              Conecta tu cuenta de Mercado Pago para aceptar tarjeta, OXXO, wallet y meses sin intereses. El dinero llega directo a tu cuenta — sin comisiones de plataforma.
            </p>

            {mpError && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-800">
                <span className="font-semibold">Error al conectar Mercado Pago:</span>{' '}{mpError}
              </div>
            )}

            {initial.mercadopago?.connected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-green-800">Mercado Pago conectado</div>
                    <div className="text-xs text-green-700 mt-0.5">Tu cuenta está lista. Los pagos llegan directo a tu cuenta de Mercado Pago.</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <a href="https://www.mercadopago.com.mx/activities" target="_blank" rel="noreferrer" className="text-xs text-green-700 underline hover:text-green-900">
                      Ver mi cuenta →
                    </a>
                    <button type="button" onClick={handleMpDisconnect} className="text-xs text-red-700 underline hover:text-red-900">
                      Desconectar
                    </button>
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-xs text-blue-800 space-y-0.5">
                  <p className="font-semibold">Lo que verán los compradores:</p>
                  <p>✓ Botón &ldquo;Pagar con Mercado Pago&rdquo; en tus anuncios</p>
                  <p>✓ Tarjeta, OXXO, saldo MP, meses sin intereses</p>
                  <p>✓ El pago llega directo a tu cuenta de Mercado Pago</p>
                </div>
                {initial.mercadopago?.live_mode === false && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Conectado en modo de prueba (sandbox).
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-4 py-4">
                <div className="flex items-start gap-3 mb-4">
                  <span className="text-2xl">🔵</span>
                  <div>
                    <div className="text-sm font-semibold">Conecta tu cuenta de Mercado Pago</div>
                    <ul className="text-xs text-[var(--color-muted)] mt-1.5 space-y-0.5">
                      <li>✓ Tarjeta, OXXO, saldo MP, meses sin intereses</li>
                      <li>✓ 0% comisión de plataforma</li>
                      <li>✓ El dinero llega directo a tu cuenta</li>
                      <li>✓ Checkout familiar para compradores mexicanos</li>
                    </ul>
                  </div>
                </div>
                <a href="/api/mp/connect"
                  className="flex items-center justify-center gap-2 w-full bg-[#009EE3] text-white font-semibold py-2.5 rounded-lg text-sm no-underline hover:opacity-90 transition-opacity">
                  Conectar Mercado Pago
                </a>
                <p className="text-[10px] text-center text-[var(--color-muted)] mt-2">
                  Serás redirigido a Mercado Pago para autorizar la conexión.
                </p>
              </div>
            )}
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 10: Transferencia bancaria (SPEI)
          ════════════════════════════════════════════════════════════════════ */}
          <section id="spei" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-1">
              <SectionTitle>Pago directo al vendedor</SectionTitle>
              <div className="-mt-3">
                <CopyPromptButton prompt="¿Es seguro compartir mi CLABE interbancaria con compradores en línea en México? ¿Qué puede hacer alguien con mi CLABE? Verifica con información oficial del sistema SPEI del Banco de México: https://www.banxico.org.mx/sistemas-de-pago/spei.html — ¿Es reversible una transferencia SPEI? ¿Qué riesgos tiene este método de pago para el vendedor?" />
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted)] mb-4">
              El comprador te paga directamente (sin protección de Miyagi). Tú confirmas el pago manualmente antes de entregar. Elige los métodos que aceptas.
            </p>
            <div className="divide-y divide-[var(--color-border)]">
              <ToggleSwitch
                checked={bankTransferEnabled}
                onChange={v => { setBankTransferEnabled(v); mark() }}
                label="Transferencia SPEI (CLABE)"
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
                    onChange={e => { setClabe(e.target.value.replace(/\D/g, '').slice(0, 18)); mark() }}
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
                    <select
                      value={bankIsOther ? 'Otro' : bankName}
                      onChange={e => {
                        const v = e.target.value
                        if (v === 'Otro') { setBankIsOther(true); setBankName('') }
                        else { setBankIsOther(false); setBankName(v) }
                        mark()
                      }}
                      className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    >
                      <option value="">Selecciona tu banco…</option>
                      {MX_BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                    {bankIsOther && (
                      <input
                        value={bankName}
                        onChange={e => { setBankName(e.target.value); mark() }}
                        placeholder="Nombre del banco"
                        className="w-full mt-2 border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Titular de la cuenta</label>
                    <input
                      value={accountHolder}
                      onChange={e => { setAccountHolder(e.target.value); mark() }}
                      placeholder="Nombre completo"
                      className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    />
                  </div>
                </div>
                {clabe && clabe.length === 18 ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-xs text-blue-800 space-y-1">
                    <p className="font-semibold">Vista previa — lo que verá el comprador:</p>
                    <div className="bg-white border border-blue-100 rounded px-3 py-2 space-y-0.5 font-mono">
                      <p>CLABE: <span className="font-semibold">{clabe}</span></p>
                      {bankName && <p>Banco: {bankName}</p>}
                      {accountHolder && <p>Titular: {accountHolder}</p>}
                    </div>
                    <p className="font-normal">Confirma el pago en tu banco antes de entregar el producto.</p>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
                    💡 El comprador verá la CLABE al momento de pagar. Confirma el pago en tu cuenta antes de enviar o entregar.
                  </p>
                )}
              </div>
            )}

            {/* DiMo — transfer by phone number */}
            <div className="divide-y divide-[var(--color-border)] mt-2">
              <ToggleSwitch
                checked={dimoEnabled}
                onChange={v => { setDimoEnabled(v); mark() }}
                label="DiMo (transferencia por teléfono)"
                description="El comprador transfiere a tu número de teléfono vía DiMo / CoDi."
              />
            </div>
            {dimoEnabled && (
              <div className="mt-3">
                <label className="block text-sm font-medium mb-1">
                  Teléfono DiMo <span className="text-red-500">*</span>
                </label>
                <input
                  value={dimoPhone}
                  onChange={e => { setDimoPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); mark() }}
                  inputMode="tel"
                  maxLength={10}
                  placeholder="10 dígitos"
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
                {dimoPhone && dimoPhone.length !== 10 && (
                  <p className="text-amber-600 text-xs mt-1">⚠ El teléfono debe tener 10 dígitos ({dimoPhone.length}/10)</p>
                )}
              </div>
            )}

            {/* Efectivo al recoger — only meaningful with local pickup */}
            <div className="divide-y divide-[var(--color-border)] mt-2">
              <ToggleSwitch
                checked={cashPickupEnabled}
                onChange={v => { setCashPickupEnabled(v); mark() }}
                label="Efectivo al recoger"
                description="El comprador paga en efectivo al recoger su pedido."
              />
            </div>
            {cashPickupEnabled && !localPickup && (
              <p className="text-amber-600 text-xs mt-2">
                ⚠ Activa “Recolección en mano” en Envíos para que esta opción aparezca en el checkout.
              </p>
            )}
            {cashPickupEnabled && (
              <div className="mt-3">
                <label className="block text-sm font-medium mb-1">Instrucciones (opcional)</label>
                <input
                  value={cashPickupNote}
                  onChange={e => { setCashPickupNote(e.target.value); mark() }}
                  placeholder="Ej. Trae el monto exacto"
                  className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
            )}
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 11: Ofertas y Negociación
          ════════════════════════════════════════════════════════════════════ */}
          <section id="ofertas" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <SectionTitle>Ofertas y Negociación</SectionTitle>

            {/* Trust gate */}
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-1">
                Nivel mínimo de comprador
              </p>
              <p className="text-xs text-[var(--color-muted)] mb-3">
                Los compradores por debajo del nivel elegido no podrán enviarte una oferta.
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
                      checked={minBuyerTrust === opt.value}
                      onChange={() => { setMinBuyerTrust(opt.value); mark() }}
                      className="accent-[var(--color-accent)]" />
                    <div>
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className="text-xs text-[var(--color-muted)]">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Negotiation rules */}
            <div className="pt-5 border-t border-[var(--color-border)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-1">
                Negociación automática
              </p>
              <p className="text-xs text-[var(--color-muted)] mb-3">
                Responde ofertas automáticamente sin revisar cada una. Ideal para catálogos grandes.
              </p>
              <div className="divide-y divide-[var(--color-border)]">
                <ToggleSwitch
                  checked={negoEnabled}
                  onChange={v => { setNegoEnabled(v); mark() }}
                  label="Activar negociación automática"
                  description="Las ofertas dentro de tus rangos se responden al instante."
                />
              </div>

              {negoEnabled && (
                <div className="mt-4 space-y-4">
                  {[
                    { label: 'Aceptar automáticamente si la oferta es ≥', value: acceptPct, set: setAcceptPct, color: 'green', hint: `Ofertas a ${acceptPct}% o más del precio de lista se aceptan al instante.` },
                    { label: 'Contraofertear al', value: counterPct, set: setCounterPct, color: 'amber', hint: `Si la oferta está entre ${declinePct}% y ${acceptPct}%, se contraoferta al ${counterPct}% del precio.` },
                    { label: 'Rechazar automáticamente si la oferta es <', value: declinePct, set: setDeclinePct, color: 'red', hint: `Ofertas por debajo del ${declinePct}% se rechazan automáticamente.` },
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
                        onChange={e => { row.set(parseInt(e.target.value)); mark() }}
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
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION: Paquetes / Descuentos por volumen
          ════════════════════════════════════════════════════════════════════ */}
          <section id="bundles" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <SectionTitle>Descuentos por paquete</SectionTitle>
            <p className="text-sm text-[var(--color-muted)] mb-4">
              Incentiva a los compradores a llevar más de un artículo de tu tienda ofreciendo un descuento automático según la cantidad. Se aplica sobre el subtotal de artículos, antes del envío.
            </p>

            <ToggleSwitch
              checked={bundlesEnabled}
              onChange={v => { setBundlesEnabled(v); mark() }}
              label="Activar descuentos por paquete"
              description="Cuando está activo, el descuento se aplica automáticamente al pagar."
            />

            {bundlesEnabled && (
              <div className="mt-4 space-y-3">
                <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Niveles de descuento</p>

                {bundleTiers.map((tier, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="flex items-center gap-1 flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 bg-white">
                      <span className="text-sm text-[var(--color-muted)] whitespace-nowrap">Desde</span>
                      <input
                        type="number"
                        min={2}
                        max={20}
                        value={tier.min_items}
                        onChange={e => {
                          const v = Math.max(2, Math.min(20, parseInt(e.target.value) || 2))
                          setBundleTiers(prev => prev.map((t, i) => i === idx ? { ...t, min_items: v } : t))
                          mark()
                        }}
                        className="w-12 text-sm font-semibold text-center border-0 outline-none bg-transparent"
                      />
                      <span className="text-sm text-[var(--color-muted)] whitespace-nowrap">artículos →</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={tier.percent_off}
                        onChange={e => {
                          const v = Math.max(1, Math.min(50, parseInt(e.target.value) || 1))
                          setBundleTiers(prev => prev.map((t, i) => i === idx ? { ...t, percent_off: v } : t))
                          mark()
                        }}
                        className="w-12 text-sm font-semibold text-center border-0 outline-none bg-transparent"
                      />
                      <span className="text-sm text-[var(--color-muted)]">% de descuento</span>
                    </div>
                    {bundleTiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => { setBundleTiers(prev => prev.filter((_, i) => i !== idx)); mark() }}
                        className="text-[var(--color-muted)] hover:text-[var(--color-danger)] text-lg leading-none"
                        aria-label="Eliminar nivel"
                      >×</button>
                    )}
                  </div>
                ))}

                {bundleTiers.length < 4 && (
                  <button
                    type="button"
                    onClick={() => {
                      const maxItems = Math.max(...bundleTiers.map(t => t.min_items))
                      setBundleTiers(prev => [...prev, { min_items: maxItems + 1, percent_off: 10 }])
                      mark()
                    }}
                    className="text-sm text-[var(--color-accent)] hover:underline"
                  >
                    + Agregar nivel
                  </button>
                )}

                {/* Preview */}
                <div className="mt-3 p-3 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg">
                  <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">Vista previa para el comprador</p>
                  {[...bundleTiers]
                    .filter(t => t.min_items >= 2 && t.percent_off > 0)
                    .sort((a, b) => a.min_items - b.min_items)
                    .map((t, i) => (
                      <p key={i} className="text-xs text-[var(--color-text)] leading-relaxed">
                        <span className="inline-block bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold mr-1">
                          {t.percent_off}% off
                        </span>
                        al comprar {t.min_items} o más artículos de tu tienda
                      </p>
                    ))
                  }
                </div>
              </div>
            )}
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 12: Notificaciones
          ════════════════════════════════════════════════════════════════════ */}
          <section id="notificaciones" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <SectionTitle>Notificaciones por correo</SectionTitle>
            <div className="divide-y divide-[var(--color-border)]">
              <ToggleSwitch
                checked={emailMessage}
                onChange={v => { setEmailMessage(v); mark() }}
                label="Nuevo mensaje de un comprador"
              />
              <ToggleSwitch
                checked={emailView}
                onChange={v => { setEmailView(v); mark() }}
                label="Mi anuncio recibió visitas"
                description="Resumen diario cuando tus anuncios tienen nuevas vistas."
              />
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 13: Conectar tu sistema (UCP Webhook)
          ════════════════════════════════════════════════════════════════════ */}
          <section id="webhook" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-1">
              <SectionTitle>Conectar tu sistema</SectionTitle>
              <div className="-mt-3">
                <CopyPromptButton prompt="¿Qué es un webhook y para qué sirve en un sistema de e-commerce? Explícame en términos sencillos qué es HMAC-SHA256 y cómo sirve para verificar que las notificaciones son auténticas. ¿Qué herramientas sin código como Zapier o Make.com puedo usar para recibir estos datos sin saber programar? Referencia: https://en.wikipedia.org/wiki/HMAC y https://zapier.com/blog/what-are-webhooks/" />
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted)] mb-4">
              Recibe una notificación automática cada vez que se complete una venta — directo a tu herramienta o sistema.
            </p>

            {/* Explainer cuando no hay URL */}
            {!webhookUrl && (
              <div className="mb-4 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-xl p-4">
                <p className="text-xs font-semibold mb-2">¿Para qué sirve esto?</p>
                <p className="text-xs text-[var(--color-muted)] mb-3 leading-relaxed">
                  Cuando alguien compra en tu tienda, enviamos los datos del pedido (comprador, artículo, monto, dirección) a la URL que configures. Es como una llamada automática de &ldquo;llegó un pedido&rdquo; a tu sistema.
                </p>
                <div className="flex flex-wrap gap-2">
                  {['Zapier', 'Make.com', 'n8n', 'CRM propio', 'ERP', 'Sistema de inventarios'].map(tool => (
                    <span key={tool} className="text-xs bg-white border border-[var(--color-border)] text-[var(--color-muted)] px-2.5 py-1 rounded-full">
                      {tool}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-[var(--color-muted)] mt-3">
                  Si no tienes un sistema técnico, <strong>no necesitas esto</strong>. Puedes gestionar pedidos directamente desde tu panel.
                </p>
              </div>
            )}

            {/* URL input */}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">URL de notificación</label>
                <input
                  value={webhookUrl}
                  onChange={e => {
                    const v = e.target.value
                    setWebhookUrl(v)
                    mark()
                    if (v && !v.startsWith('https://')) {
                      setWebhookUrlError('La URL debe comenzar con https://')
                    } else {
                      setWebhookUrlError('')
                    }
                  }}
                  type="url"
                  placeholder="https://tu-sistema.com/pedidos"
                  className={`w-full border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${
                    webhookUrlError || fieldErrors.webhook ? 'border-red-400' : 'border-[var(--color-border)]'
                  }`}
                />
                {(webhookUrlError || fieldErrors.webhook) && (
                  <p className="text-red-600 text-xs mt-1">⚠ {webhookUrlError || fieldErrors.webhook}</p>
                )}
              </div>

              {/* Secret display */}
              {webhookUrl && !webhookUrlError && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium">Clave de seguridad</label>
                    {!webhookSecret && (
                      <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                        Se genera al guardar
                      </span>
                    )}
                  </div>

                  {webhookSecret ? (
                    <div className="flex items-center gap-2 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
                      <code className="flex-1 text-xs font-mono text-[var(--color-muted)] truncate">
                        {showWebhookSecret ? webhookSecret : '•'.repeat(Math.min(webhookSecret.length, 32))}
                      </code>
                      <button type="button"
                        onClick={() => setShowWebhookSecret(v => !v)}
                        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] flex-shrink-0 px-1.5">
                        {showWebhookSecret ? 'Ocultar' : 'Ver'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(webhookSecret)
                          setWebhookCopied(true)
                          setTimeout(() => setWebhookCopied(false), 2000)
                        }}
                        className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0 px-1.5"
                      >
                        {webhookCopied ? '✓ Copiado' : 'Copiar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setWebhookSecret(generateHex32()); mark() }}
                        className="text-xs text-[var(--color-muted)] border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-gray-100 flex-shrink-0"
                      >
                        Regenerar
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2">
                      🔐 Cuando guardes los cambios, se generará una clave secreta automáticamente. Úsala para verificar que las notificaciones vienen de Miyagi Sánchez.
                    </p>
                  )}
                </div>
              )}

              {/* Modo avanzado */}
              {webhookUrl && !webhookUrlError && (
                <div>
                  <button
                    type="button"
                    onClick={() => setWebhookAdvanced(v => !v)}
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] flex items-center gap-1"
                  >
                    <span>{webhookAdvanced ? '▾' : '▸'}</span>
                    Modo avanzado — HMAC-SHA256
                  </button>

                  {webhookAdvanced && (
                    <div className="mt-3 space-y-3 pl-3 border-l-2 border-[var(--color-border)]">
                      <p className="text-xs text-[var(--color-muted)]">
                        Verifica la firma en el header <code className="font-mono bg-gray-100 px-1 rounded">X-UCP-Signature</code> usando HMAC-SHA256 con tu clave secreta y el cuerpo del request.
                      </p>
                      <div>
                        <label className="block text-xs font-medium mb-1">Clave personalizada (opcional)</label>
                        <div className="flex gap-2">
                          <input
                            value={webhookSecret}
                            onChange={e => { setWebhookSecret(e.target.value); mark() }}
                            type={showWebhookSecret ? 'text' : 'password'}
                            placeholder="Ingresa tu propia clave o usa la generada"
                            className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                          />
                          <button type="button" onClick={() => setShowWebhookSecret(v => !v)}
                            className="px-3 py-2 border border-[var(--color-border)] rounded text-xs hover:bg-gray-50">
                            {showWebhookSecret ? 'Ocultar' : 'Ver'}
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowPayloadPreview(v => !v)}
                        className="text-xs text-[var(--color-accent)] hover:underline"
                      >
                        {showPayloadPreview ? '▾' : '▸'} ¿Qué datos recibes? — Ver ejemplo de payload
                      </button>
                      {showPayloadPreview && (
                        <div className="relative">
                          <pre className="text-[10px] bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto leading-relaxed">{`{
  "event": "order.completed",
  "order_id": "ord_abc123",
  "created_at": "2025-05-23T12:00:00Z",
  "listing": {
    "id": "lst_xyz",
    "title": "iPhone 14 Pro Max",
    "price_mxn": 18500
  },
  "buyer": {
    "email": "comprador@ejemplo.com",
    "trust_level": "verified",
    "trust_score": 82
  },
  "payment": {
    "method": "stripe",
    "status": "paid"
  }
}`}</pre>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText('{"event":"order.completed","order_id":"ord_abc123"}')}
                            className="absolute top-2 right-2 text-[10px] bg-gray-700 text-gray-300 hover:bg-gray-600 px-2 py-0.5 rounded"
                          >
                            Copiar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── MCP agent token — let an AI agent read/patch this shop's config ── */}
            <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-1">
                <SectionTitle>Token para tu agente (MCP)</SectionTitle>
                <CopyPromptButton prompt="¿Qué es el Model Context Protocol (MCP) y cómo puede un agente de IA configurar mi tienda por mí? Explícame en términos sencillos cómo funciona un token tipo 'Bearer' y por qué solo debo compartirlo con mi propio asistente de confianza." />
              </div>
              <p className="text-xs text-[var(--color-muted)] mb-4">
                Genera un token para que tu propio agente de IA lea y ajuste la configuración de tu tienda
                vía MCP (<code className="font-mono bg-gray-100 px-1 rounded">get_store_configuration</code> /
                <code className="font-mono bg-gray-100 px-1 rounded">patch_store_configuration</code>) sin entrar al panel.
                Solo afecta a esta tienda. No incluye pagos, dominio ni claves — eso siempre se queda en un paso manual.
              </p>

              {agentToken ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-amber-800 mb-2">
                    ⚠️ Copia este token ahora — no se vuelve a mostrar.
                  </p>
                  <div className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                    <code className="flex-1 text-xs font-mono text-[var(--color-foreground)] break-all">{agentToken}</code>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(agentToken); setAgentTokenCopied(true); setTimeout(() => setAgentTokenCopied(false), 2000) }}
                      className="text-xs text-[var(--color-accent)] hover:underline flex-shrink-0 px-1.5"
                    >
                      {agentTokenCopied ? '✓ Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <p className="text-[11px] text-amber-700 mt-2">
                    Úsalo como <code className="font-mono">Authorization: Bearer {'{token}'}</code> contra el servidor MCP en <code className="font-mono">/api/ucp/mcp</code>.
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateAgentToken}
                    disabled={agentTokenBusy}
                    className="bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
                  >
                    {agentTokenBusy ? 'Generando…' : agentTokenSet ? 'Regenerar token' : 'Generar token de agente'}
                  </button>
                  {agentTokenSet && (
                    <>
                      <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">✓ Token activo</span>
                      <button
                        type="button"
                        onClick={handleRevokeAgentToken}
                        disabled={agentTokenBusy}
                        className="text-xs text-red-600 border border-red-200 rounded px-2.5 py-1 hover:bg-red-50 disabled:opacity-50"
                      >
                        Revocar
                      </button>
                    </>
                  )}
                </div>
              )}
              {agentTokenSet && !agentToken && (
                <p className="text-[11px] text-[var(--color-muted)] mt-2">
                  Regenerar invalida el token anterior. Si crees que se filtró, revócalo de inmediato.
                </p>
              )}
            </div>

            {/* ── Conecta tu agente — ready-to-paste MCP config ── */}
            <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
              <SectionTitle>Conecta tu agente</SectionTitle>
              <p className="text-xs text-[var(--color-muted)] mb-3">
                Pega esta configuración en tu cliente MCP (Claude Desktop u otro) para que tu agente lea y
                ajuste tu tienda. Reemplaza el token por el que generaste arriba.
              </p>
              {(() => {
                const token = agentToken ?? 'PEGA_TU_TOKEN_AQUÍ'
                const snippet = `{
  "mcpServers": {
    "mi-tienda-miyagi": {
      "url": "https://miyagisanchez.com/api/ucp/mcp",
      "transport": "http",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}`
                return (
                  <div className="relative">
                    <pre className="text-[11px] bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto leading-relaxed">{snippet}</pre>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(snippet); setMcpConfigCopied(true); setTimeout(() => setMcpConfigCopied(false), 2000) }}
                      className="absolute top-2 right-2 text-[10px] bg-gray-700 text-gray-300 hover:bg-gray-600 px-2 py-0.5 rounded"
                    >
                      {mcpConfigCopied ? '✓ Copiado' : 'Copiar'}
                    </button>
                  </div>
                )
              })()}
              <ol className="mt-3 text-xs text-[var(--color-muted)] list-decimal list-inside space-y-1">
                <li>Genera tu token arriba y cópialo.</li>
                <li>Pega esta configuración en tu cliente MCP, con tu token en lugar del marcador.</li>
                <li>Tu agente podrá usar <code className="font-mono">get_store_configuration</code> y <code className="font-mono">patch_store_configuration</code>.</li>
              </ol>
              <p className="text-[11px] text-[var(--color-muted)] mt-2">
                Tu agente puede ajustar perfil, envíos, negociación, notificaciones, pedidos y devoluciones.
                Pagos, dominio y Cal.com siempre requieren un paso manual.
              </p>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION: Canal propio — custom domain
          ════════════════════════════════════════════════════════════════════ */}
          <section id="canal" className="border border-[var(--color-border)] rounded-xl overflow-hidden mb-5">

            {/* ── Header ── */}
            <div className="px-5 pt-5 pb-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--color-muted)]">
                  Canal Propio
                </h2>
                {domainStatus === 'active' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">🟢 Dominio activo</span>
                )}
                {domainStatus === 'provisioning' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">● Emitiendo SSL…</span>
                )}
                {domainStatus === 'error' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">● Revisa la configuración</span>
                )}
                {domainStatus === 'unverified' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">● Aún no apunta a nosotros</span>
                )}
                {domainStatus === 'pending_dns' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                    {domainChecking ? '● Comprobando…' : '● Configurando DNS…'}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                Tu tienda en tu dominio, sin comisiones ni marca ajena.
                Tus clientes llegan a <strong>tutienda.mx</strong> — nosotros manejamos todo el comercio por atrás.
              </p>
            </div>

            <div className="px-5 py-5 space-y-6">

              {/* ══ Free shop URL (slug) — US-3 / US-5 ═══════════════════════════ */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className="text-sm font-medium">Tu URL gratis</h3>
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">Incluida</span>
                </div>
                {!slugEditing ? (
                  <>
                    <div className="flex items-center gap-2 mt-2">
                      <code className="flex-1 min-w-0 truncate text-sm font-mono bg-white border border-[var(--color-border)] rounded px-3 py-2">
                        {shopUrl}
                      </code>
                      <button
                        type="button"
                        onClick={copyShopUrl}
                        className={`text-xs px-3 py-2 rounded transition-colors whitespace-nowrap ${slugCopied ? 'bg-green-100 text-green-700' : 'bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'}`}
                      >
                        {slugCopied ? '✓ Copiado' : 'Copiar'}
                      </button>
                      <button
                        type="button"
                        onClick={startSlugEdit}
                        className="text-xs px-3 py-2 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface)] whitespace-nowrap"
                      >
                        Cambiar
                      </button>
                    </div>
                    <p className="text-xs text-[var(--color-muted)] mt-2">
                      Compártela en redes y tarjetas. ¿Quieres tu propio dominio sin <span className="font-mono">/s/</span>?{' '}
                      <a href="#canal" onClick={(e) => { e.preventDefault(); document.getElementById('canal')?.scrollIntoView({ behavior: 'smooth' }) }} className="text-[var(--color-accent)] hover:underline">
                        Mejora a dominio propio ↓
                      </a>
                    </p>
                  </>
                ) : (
                  <div className="mt-2 space-y-3">
                    <SlugField
                      value={slugInput}
                      onChange={setSlugInput}
                      currentSlug={shopSlug}
                      onStatusChange={setSlugStatus}
                      label="Elige tu nueva URL"
                      autoFocus
                    />
                    {slugError && <p className="text-xs text-red-600">{slugError}</p>}
                    <p className="text-xs text-[var(--color-muted)]">
                      Tu URL anterior seguirá redirigiendo aquí por 90 días.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSlugSave}
                        disabled={slugSaveBlocked}
                        className="text-xs px-4 py-2 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {slugSaving ? 'Guardando…' : 'Guardar URL'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelSlugEdit}
                        className="text-xs px-4 py-2 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ══ STEP 1 — Enter domain ════════════════════════════════════════ */}
              <div className="flex gap-2 items-start">
                <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${savedDomain ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-muted)]'}`}>
                  {savedDomain ? '✓' : '1'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-2">
                    {domainEditing ? 'Cambia tu dominio' : savedDomain ? 'Dominio registrado' : 'Ingresa tu dominio'}
                  </p>

                  {/* Removal confirmation (US-7) — shown after a domain is deleted */}
                  {!savedDomain && domainRemovedNote && (
                    <div className="mb-3 flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                      <span className="text-green-600 flex-shrink-0">✓</span>
                      <p className="text-xs text-green-700">
                        Dominio <span className="font-mono">{domainRemovedNote}</span> eliminado. Tu tienda sigue
                        activa en <span className="font-mono">miyagisanchez.com/s/{shopSlug}</span>.
                      </p>
                    </div>
                  )}

                  {(!savedDomain || domainEditing) ? (
                    <>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={domainInput}
                          onChange={e => setDomainInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && !domainSaving && domainInput.trim() && handleDomainSave()}
                          placeholder="tutienda.mx"
                          className="flex-1 min-w-0 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] font-mono"
                        />
                        <div className="flex gap-2">
                          {domainEditing && (
                            <button
                              type="button"
                              onClick={cancelDomainEdit}
                              disabled={domainSaving}
                              className="flex-1 sm:flex-none border border-[var(--color-border)] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--color-surface-alt)] disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              Cancelar
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleDomainSave}
                            disabled={domainSaving || !domainInput.trim()}
                            className="flex-1 sm:flex-none bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors whitespace-nowrap"
                          >
                            {domainSaving ? (domainEditing ? 'Reemplazando…' : 'Conectando…') : (domainEditing ? 'Reemplazar' : 'Conectar')}
                          </button>
                        </div>
                      </div>
                      {domainEditing ? (
                        <p className="text-xs text-[var(--color-muted)] mt-2">
                          Tu dominio actual sigue activo hasta que el nuevo quede listo.
                        </p>
                      ) : (
                        <p className="text-xs text-[var(--color-muted)] mt-2">
                          ¿No tienes dominio?{' '}
                          <a href="https://www.cloudflare.com/products/registrar/" target="_blank" rel="noopener noreferrer"
                            className="text-[var(--color-accent)] underline">
                            Regístralo a precio de costo en Cloudflare →
                          </a>
                        </p>
                      )}
                    </>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
                        <span className="font-mono text-sm font-medium truncate">{savedDomain}</span>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <button
                            type="button"
                            onClick={startDomainEdit}
                            disabled={domainRemoving}
                            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50 underline"
                          >
                            Cambiar
                          </button>
                          <button
                            type="button"
                            onClick={handleDomainRemove}
                            disabled={domainRemoving}
                            className="text-xs text-[var(--color-muted)] hover:text-red-600 transition-colors disabled:opacity-50 underline"
                          >
                            {domainRemoving ? 'Eliminando…' : 'Eliminar'}
                          </button>
                        </div>
                      </div>
                      {/* Registrar badge — shown while DNS pending */}
                      {detectedRegistrar && detectedRegistrar !== 'unknown' && !domainDnsOk && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                          <span>{REGISTRAR_GUIDES[detectedRegistrar]?.icon ?? '🌐'}</span>
                          <span>
                            Registrador detectado:{' '}
                            <strong className="text-[var(--color-foreground)]">
                              {REGISTRAR_GUIDES[detectedRegistrar]?.name ?? detectedRegistrar}
                            </strong>
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {domainError && <p className="mt-2 text-xs text-red-600">⚠ {domainError}</p>}
                </div>
              </div>

              {/* ══ STEP 2 — Configure DNS ═══════════════════════════════════════ */}
              {savedDomain && (
                <div className={`flex gap-2 items-start transition-opacity ${domainDnsOk ? 'opacity-50' : ''}`}>
                  <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${domainDnsOk ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-alt)] border-2 border-[var(--color-accent)] text-[var(--color-accent)]'}`}>
                    {domainDnsOk ? '✓' : '2'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium mb-1">
                      {domainDnsOk ? 'DNS configurado ✓' : 'Apunta tu dominio a Miyagi Sánchez'}
                    </p>
                    <p className="text-xs text-[var(--color-muted)] mb-3">
                      {domainDnsOk
                        ? `${savedDomain} apunta correctamente a nuestros servidores.`
                        : `Agrega este registro ${dnsRecord?.type ?? 'CNAME'} en el panel de DNS de tu dominio.`
                      }
                    </p>

                    {/* Fix hints for the error / unverified states (US-1) */}
                    {domainStatus === 'error' && domainCnameCurrent && (
                      <div className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                        <span className="text-red-500 flex-shrink-0 mt-0.5">⚠</span>
                        <p className="text-xs text-red-700">
                          Tu CNAME apunta a <span className="font-mono break-all">{domainCnameCurrent}</span>.
                          Cámbialo a <span className="font-mono">cname.vercel-dns.com</span> para conectar tu tienda.
                        </p>
                      </div>
                    )}
                    {domainStatus === 'unverified' && (
                      <div className="mb-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                        <span className="text-amber-500 flex-shrink-0 mt-0.5">⚠</span>
                        <p className="text-xs text-amber-700">
                          Tu dominio aún no apunta a nosotros. Agrega el registro de abajo en tu proveedor de
                          DNS; en cuanto propague, tu tienda se activa sola.
                        </p>
                      </div>
                    )}

                    {/* DNS record card — terminal style. Record adapts to apex (A) vs subdomain (CNAME) (US-5). */}
                    <div className="rounded-lg border border-[var(--color-border)] overflow-hidden bg-[#1a1a1a] mb-4">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                        <span className="text-xs text-white/50 font-mono">Registro DNS — {dnsRecord?.type ?? 'CNAME'}</span>
                        <button
                          type="button"
                          onClick={() => { navigator.clipboard.writeText(dnsRecord?.value ?? 'cname.vercel-dns.com'); setDomainCopied(true); setTimeout(() => setDomainCopied(false), 2000) }}
                          className={`text-xs px-2 py-0.5 rounded transition-all ${domainCopied ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'}`}
                        >
                          {domainCopied ? '✓ Copiado' : 'Copiar valor'}
                        </button>
                      </div>
                      <div className="px-3 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                        <div><div className="text-white/30 mb-1">TIPO</div><div className="text-amber-300">{dnsRecord?.type ?? 'CNAME'}</div></div>
                        <div><div className="text-white/30 mb-1">NOMBRE</div><div className="text-white break-all">{dnsRecord?.host ?? '@'}</div></div>
                        <div><div className="text-white/30 mb-1">VALOR</div><div className="text-green-300 break-all">{dnsRecord?.value ?? 'cname.vercel-dns.com'}</div></div>
                      </div>
                    </div>

                    {/* Apex domains: offer the CNAME-flattening alternative for providers that support it */}
                    {!domainDnsOk && dnsRecord?.isApex && (
                      <p className="text-xs text-[var(--color-muted)] -mt-2 mb-4">
                        ¿Tu proveedor permite CNAME en la raíz (p. ej. Cloudflare)? También puedes usar
                        <span className="font-mono"> CNAME · @ · cname.vercel-dns.com</span> en lugar del registro A.
                      </p>
                    )}

                    {/* ── Context-aware DNS setup panels ────────────────────────── */}
                    {!domainDnsOk && (
                      <div className="space-y-3 mb-3">

                        {/* Cloudflare auto-config — prominent when CF detected, accordion otherwise */}
                        <div className={`border rounded-lg overflow-hidden ${detectedRegistrar === 'cloudflare' ? 'border-orange-300 bg-orange-50/30' : 'border-[var(--color-border)]'}`}>
                          <button
                            type="button"
                            onClick={() => setShowCfPanel(v => !v)}
                            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-surface-alt)] transition-colors"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="text-lg">☁️</span>
                              <div>
                                <p className="text-xs font-semibold">
                                  {detectedRegistrar === 'cloudflare'
                                    ? '¡Tu dominio está en Cloudflare! Configura en segundos'
                                    : 'Configurar automáticamente con Cloudflare'}
                                </p>
                                <p className="text-xs text-[var(--color-muted)]">
                                  {detectedRegistrar === 'cloudflare'
                                    ? 'Crea un token de API y nosotros hacemos el resto'
                                    : 'Si tu dominio usa Cloudflare, lo configuramos por ti'}
                                </p>
                              </div>
                            </div>
                            <span className="text-xs text-[var(--color-muted)] flex-shrink-0 ml-3">{showCfPanel ? '▲' : '▼'}</span>
                          </button>

                          {showCfPanel && (
                            <div className="px-4 pb-4 pt-3 border-t border-[var(--color-border)] space-y-4 bg-[var(--color-surface-alt)]">

                              {/* Step 1 — Get the token */}
                              <div>
                                <p className="text-xs font-semibold text-[var(--color-foreground)] mb-2">
                                  Paso 1 — Crea el token en Cloudflare
                                </p>
                                <a
                                  href="https://dash.cloudflare.com/profile/api-tokens/create"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 bg-[#f6821f] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#e07216] transition-colors no-underline mb-3"
                                >
                                  <span>☁️</span> Abrir Cloudflare → Crear token
                                </a>
                                <ol className="space-y-1.5">
                                  {[
                                    <>En la página de Cloudflare, clic en <strong>&ldquo;Use template&rdquo;</strong> junto a <strong>&ldquo;Edit zone DNS&rdquo;</strong></>,
                                    <>En &ldquo;Zone Resources&rdquo; → selecciona <strong>Specific zone</strong> → elige <strong>{savedDomain || 'tu dominio'}</strong></>,
                                    <>Clic en <strong>&ldquo;Continue to summary&rdquo;</strong> → <strong>&ldquo;Create Token&rdquo;</strong></>,
                                    <>Copia el token generado (solo se muestra una vez) y pégalo abajo</>,
                                  ].map((step, i) => (
                                    <li key={i} className="flex gap-2 text-xs text-[var(--color-muted)]">
                                      <span className="flex-shrink-0 w-4 h-4 rounded-full bg-white border border-[var(--color-border)] flex items-center justify-center text-[10px] font-bold mt-0.5">{i + 1}</span>
                                      <span className="leading-relaxed">{step}</span>
                                    </li>
                                  ))}
                                </ol>
                              </div>

                              {/* Step 2 — Paste and apply */}
                              <div>
                                <p className="text-xs font-semibold text-[var(--color-foreground)] mb-2">
                                  Paso 2 — Pega el token y aplica
                                </p>
                                <div className="flex gap-2">
                                  <input
                                    type="password"
                                    value={cfTokenInput}
                                    onChange={e => setCfTokenInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && cfTokenInput.trim() && !cfSaving && handleCfAutoConfig()}
                                    placeholder="Pega tu API Token aquí"
                                    autoComplete="off"
                                    className="flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                  />
                                  <button
                                    type="button"
                                    onClick={handleCfAutoConfig}
                                    disabled={cfSaving || !cfTokenInput.trim()}
                                    className="bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors whitespace-nowrap"
                                  >
                                    {cfSaving
                                      ? <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />Configurando…</span>
                                      : 'Configurar DNS'}
                                  </button>
                                </div>
                              </div>

                              {cfError && (
                                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                                  <span className="text-red-500 flex-shrink-0 mt-0.5">⚠</span>
                                  <p className="text-xs text-red-700">{cfError}</p>
                                </div>
                              )}
                              {cfSuccess && (
                                <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                                  <span className="text-green-600 flex-shrink-0">✓</span>
                                  <p className="text-xs text-green-700">
                                    Registro CNAME creado en Cloudflare. Verificando propagación automáticamente…
                                  </p>
                                </div>
                              )}

                              <p className="text-[10px] text-[var(--color-muted)]">
                                🔒 El token se usa una sola vez para crear el registro y no se almacena en nuestros servidores.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Per-registrar step-by-step (for non-CF known registrars) */}
                        {detectedRegistrar && detectedRegistrar !== 'cloudflare' && detectedRegistrar !== 'unknown' && REGISTRAR_GUIDES[detectedRegistrar] && (
                          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
                            <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)]">
                              <span className="text-base">{REGISTRAR_GUIDES[detectedRegistrar].icon}</span>
                              <div>
                                <p className="text-xs font-semibold">
                                  Instrucciones para {REGISTRAR_GUIDES[detectedRegistrar].name}
                                </p>
                                <p className="text-xs text-[var(--color-muted)]">
                                  Detectamos que tu dominio está en {REGISTRAR_GUIDES[detectedRegistrar].name}
                                </p>
                              </div>
                            </div>
                            <ol className="px-4 py-3 space-y-2">
                              {REGISTRAR_GUIDES[detectedRegistrar].steps.map((step, i) => (
                                <li key={i} className="flex gap-2.5 text-xs text-[var(--color-muted)]">
                                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex items-center justify-center text-[10px] font-bold mt-0.5">
                                    {i + 1}
                                  </span>
                                  <span className="leading-relaxed">{step}</span>
                                </li>
                              ))}
                            </ol>
                            {/* Subdomain caveat — these guides assume an apex (@); a subdomain uses its own host */}
                            {dnsRecord && !dnsRecord.isApex && (
                              <p className="px-4 pb-2 text-[10px] text-amber-700">
                                ⚠ Como es un subdominio, usa Nombre/Host{' '}
                                <span className="font-mono">{dnsRecord.host}</span> (no <span className="font-mono">@</span>).
                              </p>
                            )}
                            <div className="px-4 pb-3">
                              <a
                                href={REGISTRAR_GUIDES[detectedRegistrar].url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline no-underline"
                              >
                                Abrir panel de {REGISTRAR_GUIDES[detectedRegistrar].name} →
                              </a>
                            </div>
                          </div>
                        )}

                        {/* Generic instructions when registrar unknown or undetected */}
                        {(!detectedRegistrar || detectedRegistrar === 'unknown') && (
                          <div className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-4 py-3">
                            <p className="text-xs font-semibold mb-2">Instrucciones generales:</p>
                            <ol className="space-y-1.5">
                              {[
                                'Ve al panel de DNS de tu proveedor de dominio (GoDaddy, Namecheap, etc.)',
                                `Crea un nuevo registro tipo ${dnsRecord?.type ?? 'CNAME'}`,
                                `Nombre / Host: ${dnsRecord?.host ?? '@'} · Valor / Apunta a: ${dnsRecord?.value ?? 'cname.vercel-dns.com'}`,
                                'Guarda los cambios — la propagación puede tomar hasta 48 horas',
                              ].map((step, i) => (
                                <li key={i} className="flex gap-2 text-xs text-[var(--color-muted)]">
                                  <span className="flex-shrink-0 font-bold text-[var(--color-accent)]">{i + 1}.</span>
                                  <span>{step}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Live status row */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                        {domainChecking ? (
                          <>
                            <span className="inline-block w-3 h-3 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
                            <span>Comprobando propagación DNS…</span>
                          </>
                        ) : domainStatus === 'error' && domainCnameCurrent ? (
                          <>
                            <span className="text-red-500">⚠</span>
                            <span>
                              CNAME actual: <span className="font-mono break-all">{domainCnameCurrent}</span> — apunta a otro lugar
                            </span>
                          </>
                        ) : domainStatus === 'unverified' ? (
                          <span>Tu dominio aún no apunta a nosotros — última comprobación: {domainLastChecked?.toLocaleTimeString()}</span>
                        ) : !domainDnsOk ? (
                          <span>Configurando DNS — comprobando automáticamente cada 8 segundos…</span>
                        ) : null}
                      </div>
                      {!domainDnsOk && (
                        <button
                          type="button"
                          onClick={handleDomainVerifyManual}
                          disabled={domainChecking}
                          className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                        >
                          {domainChecking ? 'Comprobando…' : '↻ Comprobar ahora'}
                        </button>
                      )}
                    </div>
                    {!domainDnsOk && (
                      <p className="text-xs text-[var(--color-muted)] mt-2">
                        Configurando DNS, puede tomar entre 5 minutos y 48 horas según tu proveedor.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ══ STEP 3 — Live / dual channel display ═════════════════════════ */}
              {savedDomain && (
                <div className={`flex gap-2 items-start transition-all ${!domainDnsOk ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                  <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${domainDnsOk ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-muted)]'}`}>
                    {domainDnsOk ? '✓' : '3'}
                  </div>
                  <div className="flex-1 min-w-0">
                    {domainStatus === 'active' ? (
                      <>
                        <p className="text-sm font-semibold mb-3">🎉 ¡Tu tienda está activa en 2 canales!</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">

                          {/* Canal propio */}
                          <div className="border-2 border-[var(--color-accent)] rounded-xl p-4 bg-[color-mix(in_srgb,var(--color-accent)_5%,white)]">
                            <div className="flex items-center gap-1.5 mb-2">
                              <span className="text-sm">🌐</span>
                              <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-accent)]">
                                Canal Propio
                              </span>
                            </div>
                            <p className="font-mono text-sm font-semibold truncate mb-1">{savedDomain}</p>
                            <p className="text-xs text-[var(--color-muted)] mb-3 leading-relaxed">
                              Tu dominio, tu marca. Sin miyagisanchez.com en la URL. SSL activo, infraestructura nuestra.
                            </p>
                            <a
                              href={`https://${savedDomain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)] hover:underline no-underline"
                            >
                              Abrir tienda →
                            </a>
                          </div>

                          {/* Canal marketplace */}
                          <div className="border border-[var(--color-border)] rounded-xl p-4 bg-[var(--color-surface-alt)]">
                            <div className="flex items-center gap-1.5 mb-2">
                              <span className="text-sm">🏪</span>
                              <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">
                                Miyagi Sánchez
                              </span>
                            </div>
                            <p className="font-mono text-xs font-medium text-[var(--color-muted)] truncate mb-1">
                              miyagisanchez.com/s/{shopSlug}
                            </p>
                            <p className="text-xs text-[var(--color-muted)] mb-3 leading-relaxed">
                              Visible en el marketplace para descubrimiento y SEO. Sin cambios.
                            </p>
                            {shopSlug && (
                              <a
                                href={`/s/${shopSlug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline hover:underline"
                              >
                                Ver en marketplace →
                              </a>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-3 py-2 leading-relaxed">
                          💡 Los dos canales comparten el mismo inventario, checkout y panel de administración. Cada venta se etiqueta con su canal de origen para que puedas ver de dónde vienen tus clientes.
                        </p>
                      </>
                    ) : domainStatus === 'provisioning' ? (
                      <>
                        <p className="text-sm font-medium mb-1">DNS correcto ✓ — emitiendo certificado SSL…</p>
                        <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                          Tu dominio ya apunta a nosotros. Estamos emitiendo el certificado SSL (suele tardar uno o
                          dos minutos). En cuanto esté listo, tu tienda abrirá con candado seguro 🔒.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium mb-1">Tu tienda estará lista en cuanto propague el DNS</p>
                        <p className="text-xs text-[var(--color-muted)]">
                          SSL activado automáticamente. Verás aquí los links a tus dos canales.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 13b: Embeddable widget — snippet generator (Sprint 3)
          ════════════════════════════════════════════════════════════════════ */}
          <EmbedSnippetSection slug={shopSlug} accent={accentColor} />


          {/* ════════════════════════════════════════════════════════════════════
              SECTION 14: Gestión de pedidos
          ════════════════════════════════════════════════════════════════════ */}
          <section id="pedidos" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
            <SectionTitle>Gestión de pedidos</SectionTitle>
            <p className="text-xs text-[var(--color-muted)] mb-5">
              Estas preferencias se muestran a los compradores en el anuncio y al finalizar su compra.
            </p>

            {/* Processing time */}
            <div className="mb-5">
              <p className="text-sm font-medium mb-1">Tiempo de procesamiento</p>
              <p className="text-xs text-[var(--color-muted)] mb-3">¿Cuánto tardas en preparar y enviar un pedido?</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: '1d',   label: '1 día hábil',      desc: 'Ideal para artículos listos para enviar' },
                  { key: '1-3d', label: '1–3 días hábiles', desc: 'Estándar para la mayoría de tiendas' },
                  { key: '3-5d', label: '3–5 días hábiles', desc: 'Para artículos hechos a mano o stock bajo' },
                  { key: '1-2w', label: '1–2 semanas',      desc: 'Artículos por encargo o personalizados' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { setProcessingTime(opt.key); mark() }}
                    className={`text-left p-3 rounded-lg border-2 transition-colors ${
                      processingTime === opt.key
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                        : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${processingTime === opt.key ? 'text-[var(--color-accent)]' : ''}`}>{opt.label}</p>
                    <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-accept */}
            <div className="border-t border-[var(--color-border)] pt-4 mb-4">
              <ToggleSwitch
                checked={autoAccept}
                onChange={v => { setAutoAccept(v); mark() }}
                label="Confirmación automática"
                description="Acepta pedidos al instante sin revisión manual. Desactívalo si necesitas aprobar cada pedido antes de procesar el pago."
              />
            </div>

            {/* Dispatch window */}
            <div className="border-t border-[var(--color-border)] pt-4 mb-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Ventana de despacho</p>
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">Días disponibles para preparar el envío tras recibir el pedido</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => { setDispatchWindowDays(Math.max(1, dispatchWindowDays - 1)); mark() }}
                    className="w-7 h-7 rounded-full border border-[var(--color-border)] flex items-center justify-center text-sm hover:bg-[var(--color-surface-alt)] transition-colors"
                  >−</button>
                  <span className="w-10 text-center text-sm font-semibold tabular-nums">{dispatchWindowDays}d</span>
                  <button
                    type="button"
                    onClick={() => { setDispatchWindowDays(Math.min(14, dispatchWindowDays + 1)); mark() }}
                    className="w-7 h-7 rounded-full border border-[var(--color-border)] flex items-center justify-center text-sm hover:bg-[var(--color-surface-alt)] transition-colors"
                  >+</button>
                </div>
              </div>
            </div>

            {/* Auto-confirm delivery */}
            <div className="border-t border-[var(--color-border)] pt-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Confirmación automática de entrega</p>
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">Si el comprador no confirma la entrega, el pedido se cierra automáticamente</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => { setAutoConfirmDays(Math.max(3, autoConfirmDays - 1)); mark() }}
                    className="w-7 h-7 rounded-full border border-[var(--color-border)] flex items-center justify-center text-sm hover:bg-[var(--color-surface-alt)] transition-colors"
                  >−</button>
                  <span className="w-16 text-center text-sm font-semibold tabular-nums">{autoConfirmDays} días</span>
                  <button
                    type="button"
                    onClick={() => { setAutoConfirmDays(Math.min(30, autoConfirmDays + 1)); mark() }}
                    className="w-7 h-7 rounded-full border border-[var(--color-border)] flex items-center justify-center text-sm hover:bg-[var(--color-surface-alt)] transition-colors"
                  >+</button>
                </div>
              </div>
            </div>

            {/* Inbox link */}
            <div className="mt-5 pt-4 border-t border-[var(--color-border)] flex items-center justify-between">
              <p className="text-xs text-[var(--color-muted)]">Ver y gestionar tus pedidos activos</p>
              <a href="/shop/manage/orders" className="text-xs font-semibold text-[var(--color-accent)] no-underline hover:underline flex items-center gap-1">
                Ir a pedidos →
              </a>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════════
              SECTION 15: Política de devoluciones
          ════════════════════════════════════════════════════════════════════ */}
          <section id="politicas" className="border border-[var(--color-border)] rounded-xl p-5 mb-8">
            <SectionTitle>Política de devoluciones</SectionTitle>
            <p className="text-xs text-[var(--color-muted)] mb-5">
              Define claramente qué pasa cuando un comprador quiere devolver un artículo. Se mostrará en cada anuncio y durante el checkout.
            </p>

            {/* Return window */}
            <div className="mb-5">
              <p className="text-sm font-medium mb-1">Ventana de devolución</p>
              <p className="text-xs text-[var(--color-muted)] mb-3">
                Las ventanas de 14–30 días generan más confianza y menos disputas.
                {' '}<strong className="font-semibold text-[var(--color-text)]">Independientemente de tu política</strong>, los compradores siempre pueden abrir un caso si el artículo no es como se describió.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: '14d', label: '14 días', desc: 'Recomendado · genera confianza, reduce disputas' },
                  { key: '30d', label: '30 días',  desc: 'Política amplia — ideal para artículos nuevos' },
                  { key: '7d',  label: '7 días',   desc: 'Mínimo recomendado para artículos de segunda mano' },
                  { key: 'none', label: 'Sin devoluciones', desc: 'Solo aceptas casos de artículo no conforme' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { setReturnsWindow(opt.key); mark() }}
                    className={`text-left p-3 rounded-lg border-2 transition-colors ${
                      returnsWindow === opt.key
                        ? opt.key === 'none'
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                        : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${
                      returnsWindow === opt.key
                        ? opt.key === 'none' ? 'text-amber-700' : 'text-[var(--color-accent)]'
                        : ''
                    }`}>{opt.label}</p>
                    <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug">{opt.desc}</p>
                  </button>
                ))}
              </div>
              {!returnsWindow && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                  Sin configurar — los compradores no verán ninguna política en tus anuncios.
                </p>
              )}
            </div>

            {/* Conditions + shipping — only when seller has chosen a positive return window */}
            {returnsWindow && returnsWindow !== 'none' && (
              <>
                <div className="border-t border-[var(--color-border)] pt-4 mb-4">
                  <p className="text-sm font-medium mb-1">Condición aceptada</p>
                  <p className="text-xs text-[var(--color-muted)] mb-3">¿En qué estado debe estar el artículo para aceptar la devolución?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'original',  label: 'Estado original', desc: 'Sin uso, sin daños, con empaque original' },
                      { key: 'undamaged', label: 'Sin daños',       desc: 'Puede tener uso normal, pero sin roturas' },
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => { setReturnsConditions(opt.key); mark() }}
                        className={`text-left p-3 rounded-lg border-2 transition-colors ${
                          returnsConditions === opt.key
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                        }`}
                      >
                        <p className={`text-sm font-semibold ${returnsConditions === opt.key ? 'text-[var(--color-accent)]' : ''}`}>{opt.label}</p>
                        <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[var(--color-border)] pt-4 mb-4">
                  <p className="text-sm font-medium mb-1">Flete de devolución</p>
                  <p className="text-xs text-[var(--color-muted)] mb-3">¿Quién paga el envío de regreso?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'buyer',  label: 'El comprador', desc: 'El comprador paga el envío de regreso' },
                      { key: 'seller', label: 'Yo lo pago',   desc: 'Cubres el costo — genera más confianza' },
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => { setReturnsShippingBy(opt.key as 'buyer' | 'seller'); mark() }}
                        className={`text-left p-3 rounded-lg border-2 transition-colors ${
                          returnsShippingBy === opt.key
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                        }`}
                      >
                        <p className={`text-sm font-semibold ${returnsShippingBy === opt.key ? 'text-[var(--color-accent)]' : ''}`}>{opt.label}</p>
                        <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Custom note */}
            <div className="border-t border-[var(--color-border)] pt-4">
              <p className="text-sm font-medium mb-1">Nota adicional <span className="font-normal text-[var(--color-muted)]">(opcional)</span></p>
              <p className="text-xs text-[var(--color-muted)] mb-2">Texto libre que aparecerá junto a tu política. Máx. 200 caracteres.</p>
              <textarea
                value={returnsNote}
                onChange={e => { if (e.target.value.length <= 200) { setReturnsNote(e.target.value); mark() } }}
                placeholder="Ej. Contáctame por WhatsApp para iniciar una devolución."
                rows={2}
                className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 bg-white"
              />
              <p className="text-xs text-[var(--color-muted)] text-right mt-0.5">{returnsNote.length}/200</p>
            </div>

            {/* Policy preview */}
            <div className="mt-4 p-3 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-1">Vista previa en el anuncio</p>
              <p className="text-xs text-[var(--color-text)] leading-relaxed">
                {!returnsWindow
                  ? <span className="text-[var(--color-muted)] italic">Sin configurar — no aparecerá ninguna política.</span>
                  : returnsWindow === 'none'
                    ? '— Sin política de devoluciones publicada.'
                    : <>
                        <span style={{ background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 'var(--r-pill)', padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                          ↩ Devoluciones: {returnsWindow === '7d' ? '7 días' : returnsWindow === '14d' ? '14 días' : '30 días'}
                        </span>
                        {' · condición '}
                        {returnsConditions === 'original' ? 'original' : 'sin daños'}
                        {' · flete por '}
                        {returnsShippingBy === 'buyer' ? 'el comprador' : 'el vendedor'}
                        {returnsNote.trim() && `. ${returnsNote.trim()}`}
                      </>
                }
              </p>
            </div>
          </section>

          {/* ── Save button ───────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-24">
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

        </main>
      </div>

      {/* ── Sticky unsaved bar ────────────────────────────────────────────────── */}
      {isDirty && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--color-border)] shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              Tienes cambios sin guardar
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] px-3 py-1.5 border border-[var(--color-border)] rounded-lg transition-colors"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="bg-[var(--color-accent)] text-white px-5 py-1.5 rounded-lg font-semibold text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
